// Moteur de simulation : la carte se construit, la circulation apparaît autour d'un joueur,
// la police serveur prend en chasse un fuyard recherché.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerSim } from '../sim/sim.js';

test('simulation : circulation et police serveur', async () => {
  const sim = await ServerSim.create();
  assert.ok(sim.world.nav && sim.world.statics, 'carte construite');
  sim.startRound({ traffic: 'normal', policeServer: true, tuning: null });
  const p = sim.world.nav.randomPoint(Math.random);
  const st = { x: p.x, z: p.z, y: sim.world.surfaceAt(p.x, p.z), h: Math.atan2(p.dirX, p.dirZ), vx: 0, vz: 0, flags: 0 };
  for (let i = 0; i < 30 * 8; i++) {
    sim.setPlayer(1, st, 'fugitive', 'fugitive', true);
    if (i === 30) sim.squad(1).wanted.alarm(st.x, st.z, 60);
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
