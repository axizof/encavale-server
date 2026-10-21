// Démarre un vrai serveur (port libre, dossier temporaire) et joue les scénarios d'arrivée
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL } from '../src/protocol.ts';

type Msg = Record<string, any>;

const PORT = 17000 + Math.floor(Math.random() * 1000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encavale-'));
// clé de test pour signer de vrais tickets Discord (le serveur l'utilise à la place de celle du site)
const keys = crypto.generateKeyPairSync('ed25519');
const pubB64 = Buffer.from((keys.publicKey.export({ format: 'jwk' }).x as string), 'base64url').toString('base64');
const ADMIN_DID = '123456789012345678';
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  name: 'Test', port: PORT, password: 'secret', joinApproval: true, maxPlayers: 6, panelPassword: 'panneau-test',
  ticketPublicKey: pubB64, admins: [ADMIN_DID],
}));
let proc: ChildProcess;

function ticket(did: string, name: string): string {
  const payload = Buffer.from(JSON.stringify({ did, name, av: null, aud: `localhost:${PORT}`, exp: Math.floor(Date.now() / 1000) + 600 }));
  return `${payload.toString('base64url')}.${crypto.sign(null, payload, keys.privateKey).toString('base64url')}`;
}

test.before(async () => {
  proc = spawn(process.execPath, ['src/main.ts', '--config', path.join(dir, 'config.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/info`); if (r.ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('le serveur ne démarre pas');
});
test.after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const cid = () => [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
function connect(hello: Msg) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const msgs: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; res: (m: Msg) => void }[] = [];
  ws.on('message', (d, bin) => {
    if (bin) return;
    const m = JSON.parse(d.toString());
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const closed = new Promise((res) => ws.on('close', (code) => res(code)));
  const wait = (pred: (m: Msg) => boolean, ms = 3000): Promise<Msg> => new Promise((res, rej) => {
    const old = msgs.find(pred);
    if (old) return res(old);
    waiters.push({ pred, res });
    setTimeout(() => rej(new Error('message attendu non reçu')), ms);
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, cid: cid(), ...hello })));
  return { ws, msgs, wait, closed, send: (o: Msg) => ws.send(JSON.stringify(o)) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// le panneau : connexion puis actions
async function panel() {
  const U = `http://localhost:${PORT}/admin/api`;
  const r = await fetch(`${U}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify({ password: 'panneau-test' }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const get = async (p: string): Promise<Msg> => (await fetch(`${U}/${p}`, { headers: { cookie } })).json() as Promise<Msg>;
  const act = async (o: Msg): Promise<Msg> => (await fetch(`${U}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1', cookie }, body: JSON.stringify(o) })).json() as Promise<Msg>;
  return { get, act };
}

test('/info', async () => {
  const r = await (await fetch(`http://localhost:${PORT}/info`)).json() as Msg;
  assert.equal(r.name, 'Test');
  assert.equal(r.password, true);
  assert.equal(r.protocol, PROTOCOL);
});

test('mauvais mot de passe : refusé', async () => {
  const c = connect({ name: 'Intrus', pass: 'faux' });
  const k = await c.wait((m) => m.t === 'kick');
  assert.match(k.why, /mot de passe/);
  await c.closed;
});

test('ancienne version du jeu : refusée', async () => {
  const c = connect({ name: 'Ancien', pass: 'secret', v: 2 });
  const k = await c.wait((m) => m.t === 'kick');
  assert.match(k.why, /version/);
});

test('approbation par l\'hôte, chat, invité sans pouvoir, bannissement', async () => {
  const P = await panel();
  const alice = connect({ name: 'Alice', pass: 'secret' });
  await alice.wait((m) => m.t === 'pending');
  let g = await P.get('game');
  const ra = g.pending.find((r: Msg) => r.name === 'Alice');
  assert.ok(ra, 'demande visible dans le panneau');
  await P.act({ a: 'approve', req: ra.req, ok: true });
  const wa = await alice.wait((m) => m.t === 'welcome');
  assert.equal(wa.admin, false);
  const bob = connect({ name: 'Bob', pass: 'secret' });
  await bob.wait((m) => m.t === 'pending');
  g = await P.get('game');
  await P.act({ a: 'approve', req: g.pending.find((r: Msg) => r.name === 'Bob').req, ok: true });
  const wb = await bob.wait((m) => m.t === 'welcome');
  // chat nettoyé
  bob.send({ t: 'chat', x: `salut${String.fromCharCode(0x202e)} tout le monde` });
  const ch = await alice.wait((m) => m.t === 'chat' && m.n === 'Bob');
  assert.equal(ch.x, 'salut tout le monde');
  // un invité n'a aucun pouvoir : ni commande admin, ni ancien code dans le chat
  bob.send({ t: 'adm', a: 'kick', id: wa.id });
  bob.send({ t: 'adm', a: 'set', s: { preset: 'chasse' } });
  bob.send({ t: 'chat', x: '/admin 1234' });
  await sleep(300);
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
  const acc = await P.get('access');
  assert.equal(acc.bans.length, 1);
  await P.act({ a: 'unban', key: '1' });
  assert.equal((await P.get('access')).bans.length, 0);
  alice.ws.close();
});

test('admin en jeu par compte Discord : entre sans attendre, règle, voit les demandes, lance, arrête', async () => {
  const P = await panel();
  // ticket falsifié : refusé, on joue en invité (et on attend l'accord)
  const bad = ticket(ADMIN_DID, 'Patron').replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const fake = connect({ name: 'Faussaire', pass: 'secret', ticket: bad });
  await fake.wait((m) => m.t === 'pending');
  fake.ws.close();
  // vrai ticket d'un admin désigné : entrée directe
  const adm = connect({ pass: 'secret', ticket: ticket(ADMIN_DID, 'Patron') });
  const w = await adm.wait((m) => m.t === 'welcome');
  assert.equal(w.admin, true);
  assert.equal(w.name, 'Patron');
  // il reçoit les demandes d'entrée et peut les accepter
  const gus = connect({ name: 'Gus', pass: 'secret' });
  await gus.wait((m) => m.t === 'pending');
  const pend = await adm.wait((m) => m.t === 'pend' && m.list.some((r: Msg) => r.name === 'Gus'));
  assert.ok(!('ip' in pend.list[0]), 'pas d\'adresse IP chez les admins en jeu');
  adm.send({ t: 'adm', a: 'approve', req: pend.list.find((r: Msg) => r.name === 'Gus').req, ok: true });
  const wg = await gus.wait((m) => m.t === 'welcome');
  // réglages, lancement et arrêt d'une manche
  adm.send({ t: 'adm', a: 'set', s: { preset: 'classique', bigHeists: false } });
  await adm.wait((m) => m.t === 'admres' && m.a === 'set' && !m.err);
  assert.equal((await P.get('game')).settings.bigHeists, false);
  adm.send({ t: 'adm', a: 'start' });
  const round = await gus.wait((m) => m.t === 'round');
  assert.equal(round.objs, true, 'objectifs gérés par le serveur');
  adm.send({ t: 'adm', a: 'stop' });
  const res = await gus.wait((m) => m.t === 'results');
  assert.match(res.text, /Patron/);
  // un admin ne peut pas toucher aux accès (réservé à l'hôte) ; l'hôte peut lui retirer ses droits
  adm.send({ t: 'adm', a: 'password', password: 'pirate' });
  adm.send({ t: 'adm', a: 'adminId', discord: '999999999', on: true });
  await sleep(300);
  const acc = await P.get('access');
  assert.equal(acc.admins.length, 1);
  await P.act({ a: 'adminId', discord: ADMIN_DID, on: false });
  const off = await adm.wait((m) => m.t === 'admin' && m.on === false);
  assert.ok(off);
  adm.send({ t: 'adm', a: 'kick', id: wg.id });
  await sleep(300);
  assert.equal(gus.ws.readyState, WebSocket.OPEN);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.deepEqual(cfg.admins, []);
  adm.ws.close(); gus.ws.close();
});

test('panneau admin : mot de passe, en-tête anti-CSRF, statistiques', async () => {
  const U = `http://localhost:${PORT}/admin/api`;
  const post = (p: string, body: Msg, headers: Record<string, string> = { 'X-Panel': '1' }) => fetch(`${U}/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${U}/stats`)).status, 401);
  assert.equal((await post('login', { password: 'panneau-test' }, {})).status, 403); // sans l'en-tête du panneau
  assert.equal((await post('login', { password: 'faux' })).status, 401);
  const ok = await post('login', { password: 'panneau-test' });
  assert.equal(ok.status, 200);
  const sc = ok.headers.get('set-cookie') || '';
  const cookie = sc.split(';')[0];
  assert.match(sc, /HttpOnly/);
  await sleep(1200);
  const st = await (await fetch(`${U}/stats?range=5m`, { headers: { cookie } })).json() as Msg;
  assert.equal(st.server.name, 'Test');
  assert.ok(st.now && typeof st.now.cpu === 'number');
  const log = await (await fetch(`${U}/log`, { headers: { cookie } })).json() as string[];
  assert.ok(!log.join('\n').includes('panneau-test')); // pas de secret dans le journal
});
