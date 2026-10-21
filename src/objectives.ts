// Objectifs des fuyards et réparations, choisis et validés par le serveur (il connaît la carte grâce
// au moteur de simulation) :
//  - chaque fuyard a SON braquage, puis SON receleur à rejoindre avant la fin du chrono ;
//  - de temps en temps, un « gros coup » commun apparaît pour tous : le premier qui le braque rafle
//    un butin ×3 (les autres fuyards et les flics le voient : ça crée des rencontres) ;
//  - les réparations sont communes : leur nombre suit le nombre de fuyards encore en jeu.
// Les flics voient sur la carte les objectifs de tous les fuyards.
// Le client mesure le temps passé dans la zone ; le serveur vérifie avec les positions reçues.
import crypto from 'node:crypto';
import {
  ROB_TIME, DROP_TIME, ROB_R, DROP_R, PICKUP_R, PICKUP_HEAL, BIG_LOOT, MULTS, multFor, pickupTarget,
} from './protocol.ts';
import type { ServerSim, SimSpot, SimHideout } from '../sim/sim.js';
import type { GameServer, Player } from './server.ts';

export interface Objective {
  st: 'goto' | 'deliver';
  spot: number; // braquage visé (goto)
  x: number; z: number; name: string; place: string;
  loot: number; // butin à livrer (deliver)
  until: number; // heure limite de la livraison
  tmax: number;
  big: boolean; // butin du gros coup
  dwell: number; // temps passé dans la zone (vu par le serveur)
}

export interface BigHeist { spot: number; x: number; z: number; name: string; place: string; until: number }
export interface Pickup { id: number; x: number; z: number; born: number }

const BIG_FIRST = [100, 160]; // premier gros coup après 100 à 160 s
const BIG_EVERY = [150, 230]; // puis toutes les 150 à 230 s
const BIG_LIFE = 110; // le gros coup reste offert 110 s
const PICKUP_LIFE = 160;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const hyp = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);

export class Objectives {
  srv: GameServer;
  sim: ServerSim;
  spots: SimSpot[];
  hideouts: SimHideout[];
  active = false;
  big: BigHeist | null = null;
  bigNext = 0;
  pickups = new Map<number, Pickup>();
  pickSeq = 1;
  pickNext = 0;
  dirty = false; // objectifs à renvoyer à tous
  sendT = 0;
  slowT = 0;

  constructor(srv: GameServer, sim: ServerSim) {
    this.srv = srv;
    this.sim = sim;
    this.spots = sim.heistSpots();
    this.hideouts = sim.hideouts();
  }

  start(startAt: number): void {
    this.active = this.spots.length > 0 && this.hideouts.length > 0;
    this.big = null;
    this.bigNext = startAt + rnd(BIG_FIRST[0], BIG_FIRST[1]);
    this.pickups.clear();
    this.pickNext = startAt + 25;
    this.dirty = true;
  }

  stop(): void {
    this.active = false;
    this.big = null;
    this.pickups.clear();
  }

  // ------------------------------------------------------------------ choix

  pickHeist(p: Player, fromX: number, fromZ: number): Objective {
    const last = p.obj?.st === 'goto' ? p.obj.spot : p.lastSpot ?? -1;
    const all = this.spots.map((s, i) => ({ s, i })).filter((o) => o.i !== last && o.i !== this.big?.spot);
    let cands = all.filter((o) => { const d = hyp(o.s.x, o.s.z, fromX, fromZ); return d > 250 && d < 1300; });
    if (!cands.length) cands = all.length ? all : this.spots.map((s, i) => ({ s, i }));
    const { s, i } = cands[crypto.randomInt(cands.length)];
    return { st: 'goto', spot: i, x: s.x, z: s.z, name: s.name, place: s.place, loot: 0, until: 0, tmax: 0, big: false, dwell: 0 };
  }

  pickDelivery(fromX: number, fromZ: number, loot: number, big: boolean): Objective {
    const scored = this.hideouts.map((h) => ({ h, d: hyp(h.x, h.z, fromX, fromZ) }));
    let cands = scored.filter((o) => o.d > 450 && o.d < 1150);
    if (!cands.length) cands = scored.filter((o) => o.d > 250);
    if (!cands.length) cands = scored;
    const { h } = cands[crypto.randomInt(cands.length)];
    // ≈ 80 km/h de moyenne + 45 s pour semer les flics avant de décharger (comme en solo)
    const len = this.sim.routeLength(fromX, fromZ, h.x, h.z) || hyp(fromX, fromZ, h.x, h.z) * 1.3;
    const tmax = Math.ceil((len / 22 + 45) / 5) * 5;
    return { st: 'deliver', spot: -1, x: h.x, z: h.z, name: h.name, place: h.place, loot, until: this.srv.now() + tmax, tmax, big, dwell: 0 };
  }

  rollLoot(spot: SimSpot): number {
    const [a, b] = spot.value;
    return Math.round((a + Math.random() * (b - a)) / 10) * 10;
  }

  setObj(p: Player, o: Objective, extra: Record<string, unknown> = {}): void {
    p.obj = o;
    this.dirty = true;
    this.srv.send(p.conn, this.objMsg(p, extra));
  }

  objMsg(p: Player, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const o = p.obj;
    if (!o) return { t: 'obj', st: null };
    return {
      t: 'obj', st: o.st, x: Math.round(o.x * 10) / 10, z: Math.round(o.z * 10) / 10, name: o.name, place: o.place,
      loot: o.loot, timer: o.st === 'deliver' ? Math.max(0, o.until - this.srv.now()) : 0, tmax: o.tmax, big: o.big,
      val: o.st === 'goto' ? this.spots[o.spot]?.value ?? null : null, ...extra,
    };
  }

  /** objectifs de tous les fuyards (affichés aux flics), gros coup et réparations */
  stateMsg(): Record<string, unknown> {
    const list = [];
    for (const p of this.srv.players.values()) {
      if (!p.inRound || p.role !== 'fugitive' || !p.alive || !p.obj) continue;
      list.push({ id: p.id, st: p.obj.st, x: Math.round(p.obj.x), z: Math.round(p.obj.z), name: p.obj.name, big: p.obj.big });
    }
    const b = this.big;
    return {
      t: 'objs', list,
      big: b ? { x: Math.round(b.x * 10) / 10, z: Math.round(b.z * 10) / 10, name: b.name, place: b.place, left: Math.max(0, b.until - this.srv.now()) } : null,
      pk: [...this.pickups.values()].map((k) => ({ id: k.id, x: Math.round(k.x * 10) / 10, z: Math.round(k.z * 10) / 10 })),
    };
  }

  // ------------------------------------------------------------------ boucle (15 fois par seconde)

  tick(now: number, dt: number): void {
    if (!this.active) return;
    const fugs = [...this.srv.players.values()].filter((p) => p.inRound && p.role === 'fugitive' && p.alive);
    for (const p of fugs) {
      if (!p.st) continue;
      if (!p.obj) { this.setObj(p, this.pickHeist(p, p.st.x, p.st.z), { first: true }); continue; }
      const o = p.obj;
      // temps passé dans la zone (avec de la marge : positions en retard, petite tolérance)
      const inZone = hyp(p.st.x, p.st.z, o.x, o.z) < (o.st === 'goto' ? ROB_R : DROP_R) + 5;
      o.dwell = inZone ? o.dwell + dt : Math.max(0, o.dwell - dt * 0.5);
      const b = this.big;
      p.bigDwell = b && o.st === 'goto' && hyp(p.st.x, p.st.z, b.x, b.z) < ROB_R + 5 ? (p.bigDwell || 0) + dt : Math.max(0, (p.bigDwell || 0) - dt * 0.5);
      // trop tard : le receleur est parti, butin perdu
      if (o.st === 'deliver' && now > o.until + 0.5) {
        if (o.big) this.srv.sys(`${p.name} a perdu le butin du gros coup !`);
        this.setObj(p, this.pickHeist(p, p.st.x, p.st.z), { lost: true });
      }
    }
    this.slowT += dt;
    if (this.slowT >= 1) { this.slowT = 0; this.tickBig(now, fugs); this.tickPickups(now, fugs); }
    this.sendT += dt;
    if (this.dirty && this.sendT > 0.25) { this.sendT = 0; this.dirty = false; this.srv.broadcast(this.stateMsg()); }
  }

  tickBig(now: number, fugs: Player[]): void {
    const S = this.srv.settings;
    const copPlayers = [...this.srv.players.values()].some((p) => p.inRound && p.role === 'cop');
    if (this.big && now > this.big.until) {
      this.big = null;
      this.bigNext = now + rnd(BIG_EVERY[0], BIG_EVERY[1]);
      this.srv.sys('Le gros coup est annulé : personne n\'a osé.');
      this.dirty = true;
    }
    // un gros coup quand il y a de la concurrence (2 fuyards) ou des flics joueurs pour le défendre
    if (this.big || !S.bigHeists || now < this.bigNext || !(fugs.length >= 2 || (fugs.length >= 1 && copPlayers))) return;
    const pos = fugs.filter((p) => p.st).map((p) => p.st!);
    if (!pos.length) return;
    // le lieu le plus équitable : celui dont le fuyard le plus éloigné est le moins loin (et personne dessus)
    const scored = this.spots.map((s, i) => {
      const ds = pos.map((q) => hyp(q.x, q.z, s.x, s.z));
      return { s, i, worst: Math.max(...ds), near: Math.min(...ds) };
    }).filter((o) => o.near > 220).sort((a, b) => a.worst - b.worst).slice(0, 3);
    if (!scored.length) { this.bigNext = now + 20; return; }
    const { s, i } = scored[crypto.randomInt(scored.length)];
    this.big = { spot: i, x: s.x, z: s.z, name: s.name, place: s.place, until: now + BIG_LIFE };
    this.dirty = true;
    this.srv.broadcast({ t: 'bigheist', name: s.name, place: s.place });
    this.srv.sys(`GROS COUP : ${s.name} (${s.place}) — le premier fuyard qui le braque rafle un butin ×${BIG_LOOT} !`);
  }

  tickPickups(now: number, fugs: Player[]): void {
    let changed = false;
    // réparations trop vieilles ou trop loin de tous les fuyards : retirées
    for (const k of this.pickups.values()) {
      const far = !fugs.some((p) => p.st && hyp(p.st.x, p.st.z, k.x, k.z) < 900);
      if (now - k.born > PICKUP_LIFE || far) { this.pickups.delete(k.id); changed = true; }
    }
    const target = pickupTarget(fugs.length);
    if (this.pickups.size < target && now >= this.pickNext) {
      // plus il y a de fuyards, plus elles reviennent vite (une pour deux fuyards) ; pas de place : on réessaie vite
      if (this.spawnPickup(fugs, now)) { changed = true; this.pickNext = now + 70 / Math.max(1, target); } else this.pickNext = now + 5;
    }
    if (changed) this.dirty = true;
  }

  spawnPickup(fugs: Player[], now: number): boolean {
    const withPos = fugs.filter((p) => p.st);
    if (!withPos.length) return false;
    // près du fuyard qui en a le moins autour de lui
    const count = (p: Player) => [...this.pickups.values()].filter((k) => hyp(k.x, k.z, p.st!.x, p.st!.z) < 500).length;
    withPos.sort((a, b) => count(a) - count(b) || Math.random() - 0.5);
    const anchor = withPos[0].st!;
    const players = [...this.srv.players.values()].filter((p) => p.inRound && p.alive && p.st);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(180, 480);
      const pt = this.sim.roadPoint(anchor.x + Math.cos(a) * r, anchor.z + Math.sin(a) * r, 120);
      if (!pt) continue;
      if ([...this.pickups.values()].some((k) => hyp(k.x, k.z, pt.x, pt.z) < 150)) continue;
      if (players.some((p) => hyp(p.st!.x, p.st!.z, pt.x, pt.z) < 90)) continue; // pas sous le nez de quelqu'un
      const k = { id: this.pickSeq++, x: pt.x, z: pt.z, born: now };
      this.pickups.set(k.id, k);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ signalements des fuyards

  /** braquage terminé (big : le gros coup) */
  onRob(p: Player, big: boolean): void {
    const o = p.obj;
    if (!this.active || !o || o.st !== 'goto' || !p.st) return;
    const b = this.big;
    if (big) {
      if (!b || (p.bigDwell || 0) < ROB_TIME * 0.6 || hyp(p.st.x, p.st.z, b.x, b.z) > ROB_R + 10) return this.resend(p);
      const loot = this.rollLoot(this.spots[b.spot]) * BIG_LOOT;
      this.big = null;
      this.bigNext = this.srv.now() + rnd(BIG_EVERY[0], BIG_EVERY[1]);
      p.lastSpot = b.spot;
      this.srv.sys(`${p.name} a raflé le gros coup : ${loot.toLocaleString('fr-FR')} € ! Les flics le savent…`);
      this.setObj(p, this.pickDelivery(p.st.x, p.st.z, loot, true), { robbed: true, ax: b.x, az: b.z });
      return;
    }
    if (o.dwell < ROB_TIME * 0.6 || hyp(p.st.x, p.st.z, o.x, o.z) > ROB_R + 10) return this.resend(p);
    const loot = this.rollLoot(this.spots[o.spot]);
    p.lastSpot = o.spot;
    this.setObj(p, this.pickDelivery(p.st.x, p.st.z, loot, false), { robbed: true, ax: o.x, az: o.z });
  }

  /** butin déchargé chez le receleur. loot : ce qui reste (billets envolés dans les chocs), m : multiplicateur */
  onCash(p: Player, loot: number, m: number): void {
    const o = p.obj;
    if (!this.active || !o || o.st !== 'deliver' || !p.st) return;
    if (o.dwell < DROP_TIME * 0.6 || hyp(p.st.x, p.st.z, o.x, o.z) > DROP_R + 10 || this.srv.now() > o.until + 1.5) return this.resend(p);
    const stars = this.srv.starsOf(p);
    const ok = MULTS.some((x) => Math.abs(m - x) < 1e-6 || Math.abs(m - 2 * x) < 1e-6) && m <= 2 * multFor(stars) + 1e-6;
    const mult = ok ? m : multFor(stars);
    const base = Math.min(Math.max(0, loot), o.loot);
    const v = Math.round(base * mult);
    p.score += v;
    p.stats.heists++;
    p.hp = Math.min(p.maxHp, p.hp + 25); // le receleur retape un peu la voiture
    this.srv.lobbyDirty = true;
    this.srv.send(p.conn, { t: 'hp', hp: p.hp });
    if (o.big) this.srv.sys(`${p.name} a livré le gros coup (+${v.toLocaleString('fr-FR')}) !`);
    this.setObj(p, this.pickHeist(p, p.st.x, p.st.z), { cashed: v, base });
  }

  onPick(p: Player, id: number): void {
    const k = this.pickups.get(id);
    if (!this.active || !k || !p.inRound || p.role !== 'fugitive' || !p.alive || !p.st) return;
    if (hyp(p.st.x, p.st.z, k.x, k.z) > PICKUP_R + 9) return;
    this.pickups.delete(id);
    p.hp = Math.min(p.maxHp, p.hp + PICKUP_HEAL);
    const v = Math.round(150 * multFor(this.srv.starsOf(p)));
    p.score += v;
    this.srv.lobbyDirty = true;
    this.srv.send(p.conn, { t: 'hp', hp: p.hp });
    this.srv.broadcast({ t: 'picked', id, by: p.id, v });
    this.dirty = true;
  }

  // refus : on renvoie l'objectif actuel (le client reprend la progression)
  resend(p: Player): void { this.srv.send(p.conn, this.objMsg(p, { retry: true })); }

  /** fuyard éliminé (ou parti) */
  drop(p: Player): void {
    if (p.obj?.big && p.obj.st === 'deliver') this.srv.sys(`Le butin du gros coup est perdu avec ${p.name}.`);
    p.obj = null;
    this.dirty = true;
  }
}
