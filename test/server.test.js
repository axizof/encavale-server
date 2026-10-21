// Démarre un vrai serveur (port libre, dossier temporaire) et joue les scénarios d'arrivée
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL } from '../src/protocol.js';

const PORT = 17000 + Math.floor(Math.random() * 1000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encavale-'));
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ name: 'Test', port: PORT, password: 'secret', joinApproval: true, maxPlayers: 4, panelPassword: 'panneau-test' }));
let proc;

test.before(async () => {
  proc = spawn(process.execPath, ['src/main.js', '--config', path.join(dir, 'config.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/info`); if (r.ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('le serveur ne démarre pas');
});
test.after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const cid = () => [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
function connect(hello) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (d, bin) => {
    if (bin) return;
    const m = JSON.parse(d);
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const closed = new Promise((res) => ws.on('close', (code) => res(code)));
  const wait = (pred, ms = 3000) => new Promise((res, rej) => {
    const old = msgs.find(pred);
    if (old) return res(old);
    waiters.push({ pred, res });
    setTimeout(() => rej(new Error('message attendu non reçu')), ms);
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, cid: cid(), ...hello })));
  return { ws, msgs, wait, closed, send: (o) => ws.send(JSON.stringify(o)) };
}

test('/info', async () => {
  const r = await (await fetch(`http://localhost:${PORT}/info`)).json();
  assert.equal(r.name, 'Test');
  assert.equal(r.password, true);
});

test('mauvais mot de passe : refusé', async () => {
  const c = connect({ name: 'Intrus', pass: 'faux' });
  const k = await c.wait((m) => m.t === 'kick');
  assert.match(k.why, /mot de passe/);
  await c.closed;
});

// le panneau (seul poste d'admin avec le terminal) : connexion puis actions
async function panel() {
  const U = `http://localhost:${PORT}/admin/api`;
  const r = await fetch(`${U}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify({ password: 'panneau-test' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const get = async (p) => (await fetch(`${U}/${p}`, { headers: { cookie } })).json();
  const act = async (o) => (await fetch(`${U}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1', cookie }, body: JSON.stringify(o) })).json();
  return { get, act };
}

test('approbation par l\'hôte, chat, aucun pouvoir admin en jeu, bannissement', async () => {
  const P = await panel();
  const alice = connect({ name: 'Alice', pass: 'secret' });
  await alice.wait((m) => m.t === 'pending');
  let g = await P.get('game');
  const ra = g.pending.find((r) => r.name === 'Alice');
  assert.ok(ra, 'demande visible dans le panneau');
  await P.act({ a: 'approve', req: ra.req, ok: true });
  const wa = await alice.wait((m) => m.t === 'welcome');
  const bob = connect({ name: 'Bob', pass: 'secret' });
  await bob.wait((m) => m.t === 'pending');
  g = await P.get('game');
  await P.act({ a: 'approve', req: g.pending.find((r) => r.name === 'Bob').req, ok: true });
  const wb = await bob.wait((m) => m.t === 'welcome');
  // chat nettoyé
  bob.send({ t: 'chat', x: `salut${String.fromCharCode(0x202e)} tout le monde` });
  const ch = await alice.wait((m) => m.t === 'chat' && m.n === 'Bob');
  assert.equal(ch.x, 'salut tout le monde');
  // en jeu, personne ne peut expulser, régler la partie ou devenir admin
  bob.send({ t: 'kick', id: wa.id });
  bob.send({ t: 'set', s: { preset: 'chasse' } });
  bob.send({ t: 'chat', x: '/admin 1234' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(alice.ws.readyState, WebSocket.OPEN);
  assert.notEqual((await P.get('game')).settings.preset, 'chasse');
  // réglage par le panneau, puis bannissement : retour impossible
  await P.act({ a: 'set', s: { preset: 'chasse', deadToCop: true } });
  const st = (await P.get('game')).settings;
  assert.equal(st.preset, 'chasse');
  assert.equal(st.deadToCop, true);
  await P.act({ a: 'ban', id: wb.id, why: 'test' });
  const k = await bob.wait((m) => m.t === 'kick');
  assert.match(k.why, /banni/);
  const bans = JSON.parse(fs.readFileSync(path.join(dir, 'bans.json'), 'utf8')).bans;
  assert.equal(bans.length, 1);
  alice.ws.close();
});

test('panneau admin : mot de passe, en-tête anti-CSRF, statistiques', async () => {
  const U = `http://localhost:${PORT}/admin/api`;
  const post = (p, body, headers = { 'X-Panel': '1' }) => fetch(`${U}/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${U}/stats`)).status, 401);
  assert.equal((await post('login', { password: 'panneau-test' }, {})).status, 403); // sans l'en-tête du panneau
  assert.equal((await post('login', { password: 'faux' })).status, 401);
  const ok = await post('login', { password: 'panneau-test' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  await new Promise((r) => setTimeout(r, 1200));
  const st = await (await fetch(`${U}/stats?range=5m`, { headers: { cookie } })).json();
  assert.equal(st.server.name, 'Test');
  assert.ok(st.now && typeof st.now.cpu === 'number');
  const log = await (await fetch(`${U}/log`, { headers: { cookie } })).json();
  assert.ok(!log.join('\n').includes('panneau-test') && !log.join('\n').includes('code123')); // pas de secret dans le journal
});
