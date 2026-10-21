// Moteur de simulation : la carte se construit, la circulation apparaît autour d'un joueur,
// la police serveur prend en chasse un fuyard recherché ; objectifs et réparations du serveur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerSim } from '../sim/sim.js';
import { Objectives } from '../src/objectives.ts';
import { normalizeSettings } from '../src/settings.ts';
import { ROB_TIME, DROP_TIME } from '../src/protocol.ts';
import type { GameServer, Player } from '../src/server.ts';

const simP = ServerSim.create();

test('simulation : circulation et police serveur', async () => {
  const sim = await simP;
  sim.startRound({ traffic: 'normal', policeServer: true, tuning: null });
  const p = sim.roadPoint(0, 0, 400);
  assert.ok(p, 'route trouvée');
  const st = { x: p.x, z: p.z, y: sim.groundAt(p.x, p.z), h: 0, vx: 0, vz: 0, flags: 0 };
  for (let i = 0; i < 30 * 8; i++) {
    sim.setPlayer(1, st, 'fugitive', 'fugitive', true);
    if (i === 30) sim.squad(1)!.wanted.alarm(st.x, st.z, 60);
    sim.step(1 / 30);
  }
  const s = sim.stats();
  assert.ok(s.traffic > 5, `circulation (${s.traffic})`);
  assert.ok(s.police > 0, `police (${s.police})`);
  const ents = sim.entities({ x: st.x, z: st.z });
  assert.ok(ents.some((e) => e.id >= 8448) && ents.some((e) => e.id >= 256 && e.id < 8448));
  assert.ok(sim.drain().some((e) => e.t === 'wanted' && e.to === 1));
  // le fuyard part : sa police disparaît
  sim.removePlayer(1);
  assert.equal(sim.stats().squads, 0);
  sim.stopRound();
});

// faux serveur : juste ce dont les objectifs ont besoin
function fakeServer() {
  let t = 0;
  const sent: Record<string, any>[] = [], all: Record<string, any>[] = [];
  const srv = {
    players: new Map<number, Player>(), settings: normalizeSettings({}), lobbyDirty: false,
    now: () => t, send: (_c: unknown, m: Record<string, any>) => sent.push(m), broadcast: (m: Record<string, any>) => all.push(m),
    sys: (x: string) => all.push({ t: 'chat', sys: true, x }), starsOf: () => 2,
  };
  return { srv, sent, all, advance: (dt: number) => { t += dt; } };
}

test('objectifs : braquage, livraison validés par le serveur, réparations communes', async () => {
  const sim = await simP;
  const { srv, sent, all, advance } = fakeServer();
  const O = new Objectives(srv as unknown as GameServer, sim);
  const start = sim.roadPoint(0, 0, 400)!;
  const p = {
    id: 1, name: 'Alice', conn: {}, inRound: true, alive: true, role: 'fugitive', hp: 50, maxHp: 100, score: 0,
    stats: { heists: 0 }, st: { x: start.x, z: start.z, vx: 0, vz: 0 }, obj: null,
  } as unknown as Player;
  srv.players.set(1, p);
  O.start(0);
  const step = (secs: number) => { for (let i = 0; i < secs * 15; i++) { advance(1 / 15); O.tick(srv.now(), 1 / 15); } };
  step(0.2);
  const first = sent.find((m) => m.t === 'obj');
  assert.ok(first && first.st === 'goto', 'premier braquage choisi');
  // trop tôt : refusé (le serveur n'a pas vu la voiture dans la zone)
  O.onRob(p, false);
  assert.equal(p.obj!.st, 'goto');
  assert.ok(sent.some((m) => m.retry));
  // dans la zone pendant le temps du braquage : butin, receleur, chrono
  p.st!.x = p.obj!.x; p.st!.z = p.obj!.z;
  step(ROB_TIME);
  O.onRob(p, false);
  assert.equal(p.obj!.st, 'deliver');
  const loot = p.obj!.loot;
  assert.ok(loot > 0 && p.obj!.tmax > 45);
  // déchargement chez le receleur : points (×1,5 pour 2 étoiles) et un peu de vie
  p.st!.x = p.obj!.x; p.st!.z = p.obj!.z;
  step(DROP_TIME);
  O.onCash(p, loot * 10, 1.5); // un client qui gonfle son butin est plafonné
  assert.equal(p.score, Math.round(loot * 1.5));
  assert.equal(p.hp, 75);
  assert.equal(p.obj!.st, 'goto');
  // réparations : une pour un fuyard, ramassée seulement de près
  step(30);
  assert.equal(O.pickups.size, 1);
  const k = [...O.pickups.values()][0];
  O.onPick(p, k.id);
  assert.equal(O.pickups.size, 1, 'trop loin');
  p.st!.x = k.x; p.st!.z = k.z;
  O.onPick(p, k.id);
  assert.equal(O.pickups.size, 0);
  assert.equal(p.hp, 100);
  assert.ok(all.some((m) => m.t === 'picked' && m.id === k.id));
  // le délai de livraison passe : butin perdu, nouveau braquage
  p.st!.x = p.obj!.x; p.st!.z = p.obj!.z;
  step(ROB_TIME);
  O.onRob(p, false);
  assert.equal(p.obj!.st, 'deliver');
  step(p.obj!.tmax + 1);
  assert.equal(p.obj!.st, 'goto');
  assert.ok(sent.some((m) => m.t === 'obj' && m.lost));
});

test('gros coup : le premier qui le braque rafle le butin ×3', async () => {
  const sim = await simP;
  const { srv, all, advance } = fakeServer();
  const O = new Objectives(srv as unknown as GameServer, sim);
  const a = sim.roadPoint(-300, 0, 400)!, b = sim.roadPoint(300, 200, 400)!;
  const mk = (id: number, pt: { x: number; z: number }) => ({
    id, name: `J${id}`, conn: {}, inRound: true, alive: true, role: 'fugitive', hp: 100, maxHp: 100, score: 0,
    stats: { heists: 0 }, st: { x: pt.x, z: pt.z, vx: 0, vz: 0 }, obj: null,
  } as unknown as Player);
  const p1 = mk(1, a), p2 = mk(2, b);
  srv.players.set(1, p1); srv.players.set(2, p2);
  O.start(0);
  const step = (secs: number) => { for (let i = 0; i < secs * 15; i++) { advance(1 / 15); O.tick(srv.now(), 1 / 15); } };
  step(170);
  assert.ok(O.big, 'gros coup annoncé');
  assert.ok(all.some((m) => m.t === 'bigheist'));
  const big = O.big!;
  p2.st!.x = big.x; p2.st!.z = big.z;
  step(ROB_TIME);
  O.onRob(p1, true); // pas sur place
  assert.ok(O.big);
  O.onRob(p2, true);
  assert.equal(O.big, null);
  assert.equal(p2.obj!.st, 'deliver');
  assert.ok(p2.obj!.big && p2.obj!.loot > 0 && p2.obj!.loot % 30 === 0, 'butin ×3');
  const state = O.stateMsg() as { list: { id: number; big: boolean }[] };
  assert.ok(state.list.some((o) => o.id === 2 && o.big), 'les flics voient qui porte le gros coup');
});
