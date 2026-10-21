// Démarre un vrai serveur (port libre, dossier temporaire) et joue les scénarios d'arrivée
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 17000 + Math.floor(Math.random() * 1000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encavale-'));
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ name: 'Test', port: PORT, password: 'secret', joinApproval: true, adminCode: 'code123', maxPlayers: 4 }));
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
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, cid: cid(), ...hello })));
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

test('approbation, chat, expulsion, bannissement', async () => {
  const admin = connect({ name: 'Hote', pass: 'secret', admin: 'code123' });
  const w = await admin.wait((m) => m.t === 'welcome');
  assert.equal(w.admin, true); // le code admin passe l'approbation
  const bob = connect({ name: 'Bob', pass: 'secret' });
  await bob.wait((m) => m.t === 'pending');
  const req = await admin.wait((m) => m.t === 'joinreq' && m.n === 'Bob');
  admin.send({ t: 'approve', req: req.req, ok: true });
  const wb = await bob.wait((m) => m.t === 'welcome');
  // chat nettoyé
  bob.send({ t: 'chat', x: `salut${String.fromCharCode(0x202e)} tout le monde` });
  const ch = await admin.wait((m) => m.t === 'chat' && m.n === 'Bob');
  assert.equal(ch.x, 'salut tout le monde');
  // un joueur normal ne peut pas expulser
  bob.send({ t: 'kick', id: w.id });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(admin.ws.readyState, WebSocket.OPEN);
  // bannissement, puis retour impossible (même navigateur)
  admin.send({ t: 'ban', id: wb.id, why: 'test' });
  const k = await bob.wait((m) => m.t === 'kick');
  assert.match(k.why, /banni/);
  const bans = JSON.parse(fs.readFileSync(path.join(dir, 'bans.json'), 'utf8')).bans;
  assert.equal(bans.length, 1);
  admin.ws.close();
});
