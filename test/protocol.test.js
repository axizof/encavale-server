import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntities, decodeEntities, MSG_STATE, botId, botOwner, copCountFor, allowedCopCars } from '../src/protocol.js';
import { cleanText, cleanName, ChatGuard } from '../src/text.js';

test('positions : encodage / décodage', () => {
  const e = { id: 3, kind: 2, flags: 5, x: 123.25, z: -456.5, y: 7.75, h: 2.5, vx: 31.2, vz: -12.34, steer: -0.5, hp: 87, extra: 4 };
  const d = decodeEntities(encodeEntities(MSG_STATE, 12.5, [e]));
  assert.equal(d.type, MSG_STATE);
  assert.equal(d.list.length, 1);
  const r = d.list[0];
  assert.equal(r.id, 3); assert.equal(r.kind, 2); assert.equal(r.flags, 5); assert.equal(r.hp, 87); assert.equal(r.extra, 4);
  assert.ok(Math.abs(r.x - e.x) < 1e-3 && Math.abs(r.z - e.z) < 1e-3);
  assert.ok(Math.abs(r.h - e.h) < 1e-3 && Math.abs(r.vx - e.vx) < 0.01 && Math.abs(r.steer - e.steer) < 0.01);
});

test('positions : messages mal formés refusés', () => {
  assert.equal(decodeEntities(new Uint8Array([2, 3, 0, 0, 0, 0])), null); // annonce 3 voitures, n'en contient aucune
  const ok = encodeEntities(MSG_STATE, 0, [{ id: 1, kind: 0, flags: 0, x: 0, z: 0, y: 0, h: 0, vx: 0, vz: 0, steer: 0, hp: 1, extra: 0 }]);
  new DataView(ok.buffer).setFloat32(6 + 4, NaN, true);
  assert.equal(decodeEntities(ok), null);
});

test('identifiants des polices IA', () => {
  for (const [o, s] of [[1, 0], [7, 20], [255, 31]]) assert.equal(botOwner(botId(o, s)), o);
});

test('répartition des rôles', () => {
  assert.equal(copCountFor('half', 6), 3);
  assert.equal(copCountFor('allButOne', 5), 4);
  assert.equal(copCountFor(10, 3), 2); // toujours au moins un fuyard
  assert.deepEqual(allowedCopCars(1, 4), ['interceptor', 'suv', 'police']);
  assert.deepEqual(allowedCopCars(5, 1), ['police']);
});

test('chat : caractères invisibles, texte inversé, zalgo, longueur', () => {
  const rlo = String.fromCharCode(0x202e), zw = String.fromCharCode(0x200b), nul = String.fromCharCode(0);
  assert.equal(cleanText(`a${rlo}b${zw}c${nul}d`), 'abcd');
  const zalgo = 'z' + String.fromCharCode(0x301, 0x302, 0x303, 0x304, 0x305, 0x306);
  assert.ok([...cleanText(zalgo).normalize('NFD')].length <= 4); // z + au plus 3 accents (1 composé + 2 empilés)
  assert.equal([...cleanText('é'.repeat(400))].length, 160);
  assert.equal(cleanText('  plein   d espaces  '), 'plein d espaces');
});

test('pseudos', () => {
  assert.equal(cleanName('Jean-Luc_42'), 'Jean-Luc_42');
  assert.equal(cleanName('ab'), null);
  assert.equal(cleanName('<script>'), null);
  assert.equal(cleanName('a'.repeat(30)), 'a'.repeat(16));
});

test('anti-flood', () => {
  const g = new ChatGuard();
  assert.equal(g.check('salut'), null);
  assert.notEqual(g.check('salut encore'), null); // trop rapide
});
