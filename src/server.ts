// Le serveur de jeu : salon, manches, autorité sur la vie / les morts / les scores, chat.
// L'administration se fait depuis le terminal du serveur, le panneau web (/admin), et en jeu par les
// admins désignés par l'hôte : des comptes Discord vérifiés (ticket signé par le site), jamais un code.
//
// Répartition des rôles :
//  - chaque client simule SA voiture (et, pour un fuyard, SES voitures de police IA) et envoie leur
//    position ~15 fois par seconde, datée ; le serveur vérifie la vitesse (pas de téléportation) ;
//  - la vie de chaque voiture appartient au serveur : un client ne peut pas se soigner, il signale
//    ses chocs, que le serveur plafonne et valide ;
//  - les chocs entre deux joueurs sont signalés par les deux : le serveur garde le plus fort
//    (on ne peut pas éviter les dégâts d'un flic en mentant) ;
//  - les arrestations par un flic joueur sont calculées ici, à partir des positions ;
//  - les objectifs (braquages, receleurs, gros coups) et les réparations sont tirés et validés ici.
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket, RawData } from 'ws';
import {
  PROTOCOL, KIND, COP_CARS, F, botId, MAX_BOTS_PER_PLAYER, MSG_SNAPSHOT, MSG_STATE,
  FUGITIVE_COLORS, PRESETS, copCountFor, allowedCopCars, SPIKES, SPIKE_TTL, COP_RESPAWN, HP, ARMOR,
  impactDamage, encodeEntities, decodeEntities, botTuning, MULTS, multFor, SEND_HZ,
} from './protocol.ts';
import type { Entity, PlayerKind, CopCar, BotsLevel, SpikesLevel } from './protocol.ts';
import { normalizeSettings, mergeSettings } from './settings.ts';
import type { Settings } from './settings.ts';
import { cleanText, cleanName, Bucket, ChatGuard } from './text.ts';
import { verifyTicket } from './identity.ts';
import type { DiscordIdentity } from './identity.ts';
import { DISCORD_ID_RE } from './store.ts';
import type { Config, Bans, Identity } from './store.ts';
import { Objectives } from './objectives.ts';
import type { Objective } from './objectives.ts';
import { log } from './log.ts';
import type { ServerSim, SimEvent } from '../sim/sim.js';
import type { Metrics } from './metrics.ts';

const TICK_HZ = SEND_HZ; // les joueurs à chaque tour, le reste (police IA, circulation) un tour sur deux
const MAX_SPEED = 115; // m/s entre deux positions (vitesse de pointe ≈ 80 m/s + glisse / chocs)
const AOI = 950; // portée d'envoi des voitures de police IA des autres
const RESULTS_TIME = 14;
const COUNTDOWN = 5;

// plafonds de points par événement (comme le classement en ligne)
const CAPS: Record<string, number> = {
  'DÉRAPAGE': 30000, 'GROS SAUT': 3000, 'SAUT': 3000, 'FRÔLÉ UN FLIC': 180, 'FRÔLÉ': 120, 'FLIC NEUTRALISÉ': 500,
  'SEMÉS': 600, 'BUTIN ENCAISSÉ': 11000, 'DÉFI RÉUSSI': 250, 'BONUS DÉFI': 2800, 'PASSÉ DEVANT LE TRAIN': 1600,
  'FLASHÉ': 2600, 'CARNAGE': 6000,
};
type RepairKind = 'pickup' | 'deliver' | 'challenge';
const REPAIR: Record<RepairKind, { max: number; cd: number }> = { pickup: { max: 40, cd: 12 }, deliver: { max: 25, cd: 18 }, challenge: { max: 35, cd: 20 } };
type Pref = 'any' | 'fugitive' | 'cop' | 'spectate';
const PREFS: Pref[] = ['any', 'fugitive', 'cop', 'spectate'];
// ce qu'un admin en jeu peut faire (le reste — mots de passe, admins, bannis — reste à l'hôte)
const ADMIN_ACTIONS = new Set(['kick', 'ban', 'mute', 'force', 'set', 'start', 'stop', 'approve', 'say']);

export { normalizeSettings };

type Msg = Record<string, unknown>;
const hyp = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const safeEq = (a: string, b: string): boolean => {
  const ha = crypto.createHash('sha256').update(String(a)).digest(), hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export interface Conn {
  ws: WebSocket;
  ip: string;
  host: string;
  player: Player | null;
  pendingReq: number | null;
  bucket: Bucket;
  binBucket: Bucket;
  closed: boolean;
  over: number;
  helloDone?: boolean;
  helloTimer?: NodeJS.Timeout;
}

interface Stats { kills: number; busts: number; dmg: number; spikes: number; deaths: number; surv: number; heists: number }

export interface Player {
  id: number;
  conn: Conn;
  key: string;
  name: string;
  discord: DiscordIdentity | null;
  admin: boolean;
  cid: string;
  fp: string | null;
  ip: string;
  pref: Pref;
  car: CopCar;
  role: 'spectator' | 'fugitive' | 'cop';
  kind: PlayerKind | null;
  color: number | null;
  ping: number;
  chat: ChatGuard;
  smuted: boolean;
  joinedAt: number;
  inRound: boolean;
  alive: boolean;
  view: { x: number; z: number } | null;
  scBucket: Bucket;
  hitBucket: Bucket;
  // manche
  maxHp: number;
  hp: number;
  st: Entity | null; // dernière position reçue
  stT: number; // heure de réception
  stTs: number; // heure de la mesure (selon le client, bornée)
  valid: { x: number; z: number; t: number } | null;
  viol: number[];
  tpAllow: { reason: string; until: number } | null;
  resetT: number;
  bust: number;
  bustSent: number;
  respawnAt: number;
  respawnOk: boolean;
  bots: Entity[];
  botsT: number;
  score: number;
  ppT: number;
  turned: boolean;
  stats: Stats;
  rep: Partial<Record<RepairKind, number>>;
  lastHitBy: Player | null;
  lastHitT: number;
  deadAt: number;
  spk: { n: number; next: number } | null;
  simStars: number;
  simBust: number;
  obj: Objective | null;
  lastSpot?: number;
  bigDwell?: number;
  alarmT?: number;
  heatWin?: [number, number][];
  dropT?: number;
}

interface Round {
  id: number; seed: number; startAt: number; endAt: number; bots: BotsLevel; spikes: SpikesLevel; cars: CopCar[];
  fugitives: number; cops: number; spikeRecharge: number; order: number[];
  policeSim: 'client' | 'server'; traffic: string; objs: boolean;
}

interface Pending { id: number; conn: Conn; info: Identity & { cid: string; discord: DiscordIdentity | null; ticketBad: boolean }; timer: NodeJS.Timeout }
interface Spike { sid: number; x: number; z: number; h: number; w: number; owner: number; until: number }

export class GameServer {
  cfg: Config;
  bans: Bans;
  saveConfig: () => void;
  players = new Map<number, Player>(); // id -> joueur accepté
  pending = new Map<number, Pending>(); // demandes d'entrée en attente (approbation)
  conns = new Set<Conn>();
  reqSeq = 1;
  phase: 'lobby' | 'countdown' | 'playing' | 'results' = 'lobby';
  phaseEnd = 0;
  settings: Settings;
  round: Round | null = null;
  roundSeq = 0;
  spikes = new Map<number, Spike>();
  spikeSeq = 1;
  bests = new Map<string, { name: string; score: number }>(); // clé d'identité -> meilleur score
  authFails = new Map<string, { n: number; until: number }>(); // ip -> essais ratés
  t0 = Date.now();
  lobbyDirty = true;
  lobbyT = 0;
  lastResults: Msg | null = null;
  timer: NodeJS.Timeout;
  sim: ServerSim | null = null; // moteur serveur (circulation, police serveur) : branché par attachSim()
  simTimer: NodeJS.Timeout | null = null;
  simAt = 0; // heure du dernier pas de simulation
  simMs = 0;
  tickMs = 0;
  bytesOut = 0;
  bytesIn = 0;
  obj: Objectives | null = null;
  metrics: Metrics | null = null;
  update: { latest: string; url: string } | null = null; // nouvelle version publiée (voir update.ts)
  pairEv = new Map<string, { t: number; d: Record<number, number> }>();

  constructor(cfg: Config, { bans, saveConfig }: { bans: Bans; saveConfig: () => void }) {
    this.cfg = cfg;
    this.bans = bans;
    this.saveConfig = saveConfig;
    this.settings = normalizeSettings(cfg.settings || {});
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  attachSim(sim: ServerSim): void {
    this.sim = sim;
    this.obj = new Objectives(this, sim);
    // 30 pas par seconde (la physique fait ses propres sous-pas à 120 Hz)
    this.simTimer = setInterval(() => this.simTick(), 1000 / 30);
  }

  simTick(): void {
    const sim = this.sim;
    if (!sim || !sim.active) return;
    const t0 = performance.now();
    sim.step(1 / 30);
    this.simAt = this.now();
    this.simMs = performance.now() - t0;
    for (const e of sim.drain()) this.onSimEvent(e);
  }

  onSimEvent(e: SimEvent): void {
    if (e.t === 'spike' || e.t === 'spikedel') { this.broadcast(e); return; }
    const p = this.players.get(e.to ?? 0);
    if (!p || !p.inRound) return;
    switch (e.t) {
      case 'msg': this.send(p.conn, { t: 'msg', x: String(e.x).slice(0, 80), k: e.k }); break;
      case 'tires': this.send(p.conn, { t: 'tires' }); break;
      case 'pts': {
        if (!p.alive || this.phase !== 'playing') break;
        const m = Number(e.m);
        const v = Math.round(Math.min(Number(e.b) || 0, 3000) * (MULTS.includes(m) ? m : 1));
        p.score += v;
        this.lobbyDirty = true;
        this.send(p.conn, { t: 'pts', l: e.l, v });
        break;
      }
      case 'busted': if (p.alive && this.phase === 'playing') this.eliminate(p, 'busted', null); break;
      case 'wanted':
        p.simStars = Number(e.s) || 0;
        p.simBust = Number(e.bust) || 0;
        this.send(p.conn, e);
        break;
    }
  }

  now(): number { return (Date.now() - this.t0) / 1000; }

  /** étoiles de recherche d'un fuyard (celles du serveur en mode police serveur, sinon celles qu'il annonce) */
  starsOf(p: Player): number {
    return this.round?.policeSim === 'server' ? p.simStars || 0 : p.st ? Math.min(6, p.st.extra) : 0;
  }

  // ------------------------------------------------------------------ connexions

  onConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = clientIp(req);
    const perIp = [...this.conns].filter((c) => c.ip === ip).length;
    if (this.conns.size >= this.cfg.maxPlayers + 8 || perIp >= 10) {
      ws.close(1013, 'trop de connexions');
      return;
    }
    const conn: Conn = {
      ws, ip, host: String(req.headers.host || '').toLowerCase().slice(0, 120), player: null, pendingReq: null,
      bucket: new Bucket(80, 160), // messages texte
      binBucket: new Bucket(70, 140), // positions (30 par seconde)
      closed: false, over: 0,
    };
    this.conns.add(conn);
    conn.helloTimer = setTimeout(() => { if (!conn.player && !conn.pendingReq) this.drop(conn, 'délai dépassé'); }, 15000);
    ws.on('message', (data: RawData, isBinary: boolean) => {
      try { this.onMessage(conn, data, isBinary); } catch (e) { log.error(`message de ${conn.player?.name || conn.ip} : ${(e as Error).message}`); }
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => {});
  }

  send(conn: Conn | null | undefined, msg: unknown): void {
    if (!conn || conn.closed || conn.ws.readyState !== 1) return;
    const s = JSON.stringify(msg);
    this.bytesOut += s.length;
    conn.ws.send(s);
  }

  sendBin(conn: Conn, bytes: Uint8Array): void {
    if (!conn || conn.closed || conn.ws.readyState !== 1) return;
    // file d'attente pleine (connexion lente) : on saute une image plutôt que d'accumuler du retard
    if (conn.ws.bufferedAmount > 256 * 1024) return;
    this.bytesOut += bytes.byteLength;
    conn.ws.send(bytes, { binary: true });
  }

  broadcast(msg: unknown, except: Player | null = null): void {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.conn.ws.readyState === 1) { p.conn.ws.send(s); this.bytesOut += s.length; }
  }

  sys(text: string, to: Player | null = null): void {
    const m = { t: 'chat', sys: true, x: text };
    if (to) this.send(to.conn, m); else this.broadcast(m);
  }

  drop(conn: Conn, why: string): void {
    if (conn.closed) return;
    this.send(conn, { t: 'kick', why });
    try { conn.ws.close(4000, why.slice(0, 100)); } catch { /* déjà fermé */ }
  }

  onClose(conn: Conn): void {
    if (conn.closed) return;
    conn.closed = true;
    clearTimeout(conn.helloTimer);
    this.conns.delete(conn);
    if (conn.pendingReq) {
      const r = this.pending.get(conn.pendingReq);
      if (r) { clearTimeout(r.timer); this.pending.delete(conn.pendingReq); this.notifyPending(); }
    }
    const p = conn.player;
    if (!p) return;
    this.players.delete(p.id);
    if (this.sim) this.sim.removePlayer(p.id);
    if (this.obj && p.obj) this.obj.drop(p);
    log.info(`${log.bold(p.name)} est parti (${this.players.size}/${this.cfg.maxPlayers})`);
    this.sys(`${p.name} a quitté le serveur`);
    if (p.inRound && p.alive && p.role === 'fugitive') this.checkRoundEnd();
    if (!this.players.size && this.phase !== 'lobby') this.toLobby();
    this.lobbyDirty = true;
  }

  // ------------------------------------------------------------------ messages

  onMessage(conn: Conn, data: RawData, isBinary: boolean): void {
    if (conn.closed) return;
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.bytesIn += buf.byteLength;
    if (isBinary) {
      if (!conn.player || !conn.binBucket.take()) return;
      return this.onState(conn.player, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    }
    if (!conn.bucket.take()) {
      // inondation de messages : on coupe
      if (++conn.over > 200) this.drop(conn, 'trop de messages');
      return;
    }
    if (buf.byteLength > 4096) return;
    let m: Msg;
    try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const p = conn.player;
    if (!p) {
      if (m.t === 'hello' && !conn.pendingReq && !conn.helloDone) return this.onHello(conn, m);
      if (m.t === 'ping') return this.send(conn, { t: 'pong', c: m.c, s: this.now() });
      return;
    }
    switch (m.t) {
      case 'ping': p.ping = num(m.rtt, 0, 9999) ?? p.ping; this.send(conn, { t: 'pong', c: m.c, s: this.now() }); break;
      case 'chat': this.onChat(p, m.x); break;
      case 'pref': this.onPref(p, m); break;
      case 'becomecop': this.onBecomeCop(p); break;
      case 'hit': this.onHit(p, m); break;
      case 'rep': this.onRepair(p, m); break;
      case 'sc': this.onScore(p, m); break;
      case 'pp': this.onPassive(p, m); break;
      case 'tp': this.onTeleport(p, m); break;
      case 'spk': this.onSpike(p, m); break;
      case 'spkhit': this.onSpikeHit(p, m); break;
      case 'busted': this.onBustedByBots(p); break;
      case 'alarm': this.onAlarm(p, m); break;
      case 'heat': this.onHeat(p, m); break;
      case 'dropstar': this.onDropStar(p); break;
      case 'rob': if (this.inPlay(p)) this.obj?.onRob(p, m.big === true); break;
      case 'cash': if (this.inPlay(p)) this.obj?.onCash(p, num(m.loot, 0, 1e6) ?? 0, num(m.m, 0, 12) ?? 1); break;
      case 'pick': if (this.inPlay(p)) this.obj?.onPick(p, Number(m.id)); break;
      case 'adm': this.onAdmin(p, m); break;
      case 'view': p.view = { x: num(m.x, -3000, 3000) ?? 0, z: num(m.z, -3000, 3000) ?? 0 }; break;
    }
  }

  inPlay(p: Player): boolean { return p.inRound && p.alive && p.role === 'fugitive' && this.phase === 'playing'; }

  // ------------------------------------------------------------------ arrivée d'un joueur

  onHello(conn: Conn, m: Msg): void {
    conn.helloDone = true;
    clearTimeout(conn.helloTimer);
    if (m.v !== PROTOCOL) return this.drop(conn, `version différente (serveur v${PROTOCOL}) : recharge la page`);
    const fail = this.authFails.get(conn.ip);
    if (fail && fail.until > Date.now()) return this.drop(conn, 'trop d\'essais, réessaie dans une minute');
    const cid = typeof m.cid === 'string' && /^[a-f0-9]{16,64}$/.test(m.cid) ? m.cid : null;
    if (!cid) return this.drop(conn, 'client invalide');
    const fp = typeof m.fp === 'string' && /^[a-zA-Z0-9]{8,64}$/.test(m.fp) ? m.fp : null;
    // identité Discord (ticket signé par le site) ou invité
    const hosts = [conn.host, ...this.cfg.publicHost];
    const discord = m.ticket ? verifyTicket(m.ticket, hosts, this.cfg.ticketPublicKey || undefined) : null;
    const name = discord ? cleanName(discord.name) || cleanName(discord.name.replace(/[^\p{L}\p{N} _.\-]/gu, '').slice(0, 16)) || `Joueur${discord.id.slice(-4)}` : cleanName(m.name);
    if (!name) return this.drop(conn, 'pseudo invalide (3 à 16 caractères : lettres, chiffres, espace, - _ .)');
    const info = { name, discord, cid, fp, ip: conn.ip, ticketBad: !!m.ticket && !discord };
    const ban = this.bans.match(info);
    if (ban) return this.drop(conn, `banni de ce serveur${ban.reason ? ` : ${ban.reason}` : ''}`);
    // mot de passe
    if (this.cfg.password && !safeEq(str(m.pass), this.cfg.password)) {
      const f = this.authFails.get(conn.ip) || { n: 0, until: 0 };
      f.n++;
      if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; }
      this.authFails.set(conn.ip, f);
      return this.drop(conn, 'mot de passe incorrect');
    }
    if (this.players.size >= this.cfg.maxPlayers) return this.drop(conn, 'serveur plein');
    // déjà connecté avec le même compte / navigateur : l'ancienne connexion est fermée
    for (const o of this.players.values()) if ((discord && o.discord?.id === discord.id) || o.cid === cid) this.drop(o.conn, 'connecté ailleurs');
    // un admin désigné entre sans attendre
    if (this.cfg.joinApproval && !(discord && this.cfg.admins.includes(discord.id))) return this.askApproval(conn, info);
    this.accept(conn, info);
  }

  askApproval(conn: Conn, info: Pending['info']): void {
    const id = this.reqSeq++;
    conn.pendingReq = id;
    const r = { id, conn, info, timer: setTimeout(() => this.resolveRequest(id, false, 'personne n\'a répondu'), 120000) };
    this.pending.set(id, r);
    this.send(conn, { t: 'pending' });
    log.warn(`Demande d'entrée n°${id} : ${log.bold(info.name)}${info.discord ? ' (Discord)' : ''} — tape « accepter ${id} » ou « refuser ${id} » (ou panneau web)`);
    this.notifyPending();
  }

  resolveRequest(id: number, ok: boolean, why = 'refusé par l\'hôte'): boolean {
    const r = this.pending.get(id);
    if (!r) return false;
    clearTimeout(r.timer);
    this.pending.delete(id);
    this.notifyPending();
    r.conn.pendingReq = null;
    if (r.conn.closed) return true;
    if (!ok) { this.drop(r.conn, why); log.info(`Demande n°${id} (${r.info.name}) refusée`); return true; }
    if (this.players.size >= this.cfg.maxPlayers) { this.drop(r.conn, 'serveur plein'); return true; }
    this.accept(r.conn, r.info);
    return true;
  }

  pendingList(): { req: number; name: string; discord: boolean; ip: string }[] {
    return [...this.pending.values()].map((r) => ({ req: r.id, name: r.info.name, discord: !!r.info.discord, ip: r.info.ip || '' }));
  }

  // les admins en jeu reçoivent les demandes d'entrée (sans les adresses IP)
  notifyPending(): void {
    const list = this.pendingList().map(({ req, name, discord }) => ({ req, name, discord }));
    for (const p of this.players.values()) if (p.admin) this.send(p.conn, { t: 'pend', list });
    this.lobbyDirty = true;
  }

  freeId(): number {
    for (let i = 1; i < 255; i++) if (!this.players.has(i)) return i;
    return 0;
  }

  uniqueName(name: string): string {
    const taken = (n: string) => [...this.players.values()].some((p) => p.name.toLowerCase() === n.toLowerCase());
    if (!taken(name)) return name;
    for (let k = 2; k < 100; k++) {
      const n = `${name.slice(0, 13)} ${k}`;
      if (!taken(n)) return n;
    }
    return `${name.slice(0, 10)}${crypto.randomInt(1000, 9999)}`;
  }

  accept(conn: Conn, info: Pending['info']): void {
    const id = this.freeId();
    if (!id) return this.drop(conn, 'serveur plein');
    const key = crypto.createHash('sha256').update(`${this.cfg.salt}|${info.discord ? `d${info.discord.id}` : `c${info.cid}`}`).digest('hex').slice(0, 16);
    const p = {
      id, conn, key, name: this.uniqueName(info.name), discord: info.discord, cid: info.cid, fp: info.fp, ip: info.ip || '',
      admin: !!info.discord && this.cfg.admins.includes(info.discord.id),
      pref: 'any', car: 'interceptor', role: 'spectator', kind: null, color: null, ping: 0, chat: new ChatGuard(), smuted: false,
      joinedAt: this.now(), inRound: false, alive: false, view: null,
      scBucket: new Bucket(12, 30), hitBucket: new Bucket(30, 60),
      maxHp: 0, hp: 0, st: null, stT: 0, stTs: 0, valid: null, viol: [], tpAllow: null, resetT: -99, bust: 0, bustSent: 0,
      respawnAt: 0, respawnOk: false, bots: [], botsT: 0, score: 0, ppT: 0, turned: false,
      stats: { kills: 0, busts: 0, dmg: 0, spikes: 0, deaths: 0, surv: 0, heists: 0 }, rep: {},
      lastHitBy: null, lastHitT: 0, deadAt: 0, spk: null, simStars: 0, simBust: 0, obj: null,
    } satisfies Player as Player;
    conn.player = p;
    this.players.set(id, p);
    log.ok(`${log.bold(p.name)} a rejoint${p.discord ? ' (Discord)' : ''}${p.admin ? ' [admin]' : ''} — ${conn.ip} (${this.players.size}/${this.cfg.maxPlayers})`);
    this.send(conn, {
      t: 'welcome', id, name: p.name, key, ticketBad: info.ticketBad, admin: p.admin,
      server: { name: this.cfg.name, motd: this.cfg.motd, max: this.cfg.maxPlayers, approval: this.cfg.joinApproval, password: !!this.cfg.password, protocol: PROTOCOL },
      time: this.now(),
    });
    this.sys(`${p.name} a rejoint le serveur`, null);
    if (this.cfg.motd) this.sys(this.cfg.motd, p);
    if (p.admin) this.send(conn, { t: 'pend', list: this.pendingList().map(({ req, name, discord }) => ({ req, name, discord })) });
    this.lobbyDirty = true;
    this.sendLobby(p);
    // une manche est en cours : on la regarde en spectateur
    if (this.round && this.phase !== 'lobby') {
      this.send(conn, this.roundMsg());
      if (this.obj?.active) this.send(conn, this.obj.stateMsg());
    }
    if (this.phase === 'results' && this.lastResults) this.send(conn, this.lastResults);
  }

  // ------------------------------------------------------------------ salon

  lobbyMsg(): Msg {
    const players = [...this.players.values()].map((p) => ({
      id: p.id, n: p.name, d: p.discord ? { id: p.discord.id, av: p.discord.avatar } : null, key: p.key,
      pref: p.pref, car: p.car, role: p.role, ping: Math.round(p.ping || 0),
      sc: p.inRound ? Math.floor(p.score || 0) : 0, best: this.bests.get(p.key)?.score || 0,
      alive: !!(p.inRound && p.alive), hp: p.inRound ? Math.round(p.hp) : 0, max: p.inRound ? p.maxHp : 0,
      col: p.color ?? null, muted: p.smuted, kind: p.kind ?? null, adm: p.admin,
    }));
    let top = null;
    for (const b of this.bests.values()) if (!top || b.score > top.score) top = b;
    return {
      t: 'lobby', phase: this.phase, phaseEnd: this.phaseEnd, settings: this.settings, players,
      top, presets: PRESETS, pending: this.pending.size, sim: !!this.sim,
    };
  }

  sendLobby(to: Player | null = null): void {
    const m = this.lobbyMsg();
    if (to) this.send(to.conn, m); else this.broadcast(m);
    this.lobbyDirty = false;
    this.lobbyT = 0;
  }

  onPref(p: Player, m: Msg): void {
    if (PREFS.includes(m.pref as Pref)) p.pref = m.pref as Pref;
    if (COP_CARS.includes(m.car as CopCar)) p.car = m.car as CopCar;
    this.lobbyDirty = true;
  }

  // ---- actions de l'hôte (terminal, panneau web) et des admins en jeu ----
  hostAction(a: string, o: Msg = {}, by = 'l\'hôte'): string | null {
    const target = typeof o.id === 'number' ? this.players.get(o.id) ?? null : null;
    const why = cleanText(o.why || '', 100);
    switch (a) {
      case 'kick': if (!target) return 'joueur introuvable'; this.kick(target, why, by); break;
      case 'ban': if (!target) return 'joueur introuvable'; this.ban(target, why, by); break;
      case 'mute':
        if (!target) return 'joueur introuvable';
        target.smuted = !target.smuted;
        this.sys(`${target.name} ${target.smuted ? 'ne peut plus écrire' : 'peut de nouveau écrire'} dans le chat`);
        this.lobbyDirty = true;
        break;
      case 'force':
        if (!target || !PREFS.includes(o.pref as Pref)) return 'joueur ou rôle invalide';
        target.pref = o.pref as Pref;
        this.lobbyDirty = true;
        break;
      case 'set': return this.applySettings(o.s && typeof o.s === 'object' ? o.s as Msg : {}, by);
      case 'start': return this.startRound(by);
      case 'stop':
        if (this.phase !== 'playing' && this.phase !== 'countdown') return 'aucune manche en cours';
        this.endRound('none', `Manche arrêtée par ${by}`);
        break;
      case 'approve': if (!this.resolveRequest(Number(o.req), !!o.ok)) return 'demande introuvable'; break;
      case 'say': {
        const x = cleanText(o.text);
        if (!x) return 'message vide';
        this.broadcast({ t: 'chat', sys: true, host: true, x, by: by === 'l\'hôte' ? null : by });
        log.chat(by, x);
        break;
      }
      // réservé à l'hôte (terminal, panneau)
      case 'admin': {
        if (!target) return 'joueur introuvable';
        if (!target.discord) return `${target.name} joue en invité : seul un compte Discord vérifié peut être admin`;
        return this.setAdmin(target.discord.id, !target.admin, target.name);
      }
      case 'adminId': {
        const id = str(o.discord).trim();
        if (!DISCORD_ID_RE.test(id)) return 'identifiant Discord invalide (que des chiffres)';
        return this.setAdmin(id, o.on !== false, null);
      }
      case 'unban': if (!this.bans.remove(String(o.key ?? ''))) return 'bannissement introuvable'; break;
      case 'approval': this.cfg.joinApproval = !!o.on; this.saveConfig(); this.lobbyDirty = true; break;
      case 'password': this.cfg.password = cleanText(o.password || '', 64); this.saveConfig(); break;
      default: return 'action inconnue';
    }
    return null;
  }

  setAdmin(discordId: string, on: boolean, name: string | null): string | null {
    const has = this.cfg.admins.includes(discordId);
    if (on && !has) this.cfg.admins.push(discordId);
    if (!on && has) this.cfg.admins = this.cfg.admins.filter((d) => d !== discordId);
    this.saveConfig();
    for (const p of this.players.values()) {
      if (p.discord?.id !== discordId) continue;
      p.admin = on;
      this.send(p.conn, { t: 'admin', on });
      if (on) this.send(p.conn, { t: 'pend', list: this.pendingList().map(({ req, name: n, discord }) => ({ req, name: n, discord })) });
      this.sys(on ? `${p.name} est maintenant admin du serveur` : `${p.name} n'est plus admin`);
    }
    log.info(`${name || `Discord ${discordId}`} ${on ? 'ajouté aux' : 'retiré des'} admins`);
    this.lobbyDirty = true;
    return null;
  }

  // commande d'un admin en jeu : mêmes actions que l'hôte, sauf la gestion des accès
  onAdmin(p: Player, m: Msg): void {
    if (!p.admin) return;
    const a = str(m.a);
    if (!ADMIN_ACTIONS.has(a)) return;
    const target = typeof m.id === 'number' ? this.players.get(m.id) : null;
    // un admin ne peut pas en sanctionner un autre (l'hôte, si)
    if (target && target !== p && target.admin && (a === 'kick' || a === 'ban' || a === 'mute')) { this.sys('Impossible : c\'est un autre admin.', p); return; }
    if (target === p && (a === 'kick' || a === 'ban')) return;
    log.info(`[admin ${p.name}] ${a}${target ? ` ${target.name}` : ''}`);
    const err = this.hostAction(a, m, p.name);
    this.send(p.conn, { t: 'admres', a, err });
  }

  applySettings(s: Msg, by: string | null): string | null {
    if (this.phase === 'playing' || this.phase === 'countdown') return 'manche en cours : réglages modifiables au salon';
    this.settings = mergeSettings(this.settings, s);
    this.cfg.settings = this.settings;
    this.saveConfig();
    this.lobbyDirty = true;
    if (by) log.info(`Réglages changés par ${by} : ${PRESETS[this.settings.preset].label}`);
    return null;
  }

  kick(p: Player, why: string, by = 'la console'): void {
    log.warn(`${p.name} expulsé par ${by}${why ? ` (${why})` : ''}`);
    this.sys(`${p.name} a été expulsé${why ? ` (${why})` : ''}`);
    this.drop(p.conn, `expulsé par ${by}${why ? ` : ${why}` : ''}`);
  }

  ban(p: Player, why: string, by = 'la console'): void {
    this.bans.add(p, why);
    log.warn(`${p.name} banni par ${by}${why ? ` (${why})` : ''}`);
    this.sys(`${p.name} a été banni${why ? ` (${why})` : ''}`);
    this.drop(p.conn, `banni par ${by}${why ? ` : ${why}` : ''}`);
  }

  // ------------------------------------------------------------------ chat

  onChat(p: Player, raw: unknown): void {
    const text = cleanText(raw);
    if (!text) return;
    if (text.startsWith('/')) return this.onCommand(p, text);
    if (p.smuted) return this.sys('L\'hôte t\'a interdit le chat.', p);
    const no = p.chat.check(text);
    if (no) return this.sys(no, p);
    log.chat(p.name, text);
    this.broadcast({ t: 'chat', id: p.id, n: p.name, x: text, r: p.inRound ? p.role : null });
  }

  onCommand(p: Player, text: string): void {
    const cmd = text.slice(1).split(' ')[0].toLowerCase();
    if (cmd === 'joueurs' || cmd === 'qui') this.sys([...this.players.values()].map((o) => o.name + (o.admin ? ' (admin)' : '')).join(', '), p);
    else this.sys('Commandes : /joueurs', p);
  }

  findPlayer(q: string | undefined): Player | null {
    if (!q) return null;
    const s = String(q).toLowerCase();
    const list = [...this.players.values()];
    return list.find((p) => String(p.id) === s) || list.find((p) => p.name.toLowerCase() === s) || list.find((p) => p.name.toLowerCase().startsWith(s)) || null;
  }

  // ------------------------------------------------------------------ manches

  startRound(by = 'la console'): string | null {
    if (this.phase !== 'lobby' && this.phase !== 'results') return 'une manche est déjà en cours';
    const parts = [...this.players.values()].filter((p) => p.pref !== 'spectate');
    if (!parts.length) return 'personne pour jouer';
    const S = this.settings;
    const n = parts.length;
    const copN = copCountFor(S.cops, n);
    let bots = S.bots;
    if (copN === 0 && bots === 'off') bots = 'normal'; // il faut bien quelqu'un pour poursuivre
    // répartition : ceux qui veulent être flic d'abord, puis « peu importe » au hasard, puis les autres
    const shuffled = parts.map((p) => ({ p, r: Math.random() })).sort((a, b) => a.r - b.r).map((o) => o.p);
    const rank = (p: Player) => (p.pref === 'cop' ? 0 : p.pref === 'any' ? 1 : 2);
    shuffled.sort((a, b) => rank(a) - rank(b));
    const cops = shuffled.slice(0, copN), fugs = shuffled.slice(copN);
    const cars = S.copCars === 'auto' ? allowedCopCars(copN, fugs.length) : S.copCars;
    const spk = SPIKES[S.spikes];
    for (const p of this.players.values()) { p.inRound = false; p.alive = false; p.role = 'spectator'; p.kind = null; p.color = null; p.obj = null; }
    fugs.forEach((p, i) => this.initPlayer(p, 'fugitive', 'fugitive', FUGITIVE_COLORS[i % FUGITIVE_COLORS.length]));
    cops.forEach((p) => {
      this.initPlayer(p, 'cop', cars.includes(p.car) ? p.car : cars[0], null);
      p.spk = { n: spk.max, next: 0 };
    });
    this.spikes.clear();
    const now = this.now();
    // moteur serveur : circulation partagée, police IA calculée par le serveur si demandé
    const policeServer = !!this.sim && S.policeSim === 'server' && bots !== 'off';
    this.round = {
      id: ++this.roundSeq, seed: crypto.randomInt(1, 2 ** 31 - 1), startAt: now + COUNTDOWN,
      endAt: S.timeLimit ? now + COUNTDOWN + S.timeLimit : 0, bots, spikes: S.spikes, cars,
      fugitives: fugs.length, cops: copN,
      // recharge des herses plus lente quand il y a beaucoup de flics
      spikeRecharge: spk.recharge * (1 + 0.2 * Math.max(0, copN - 1)),
      order: [...fugs, ...cops].map((p) => p.id),
      policeSim: policeServer ? 'server' : 'client',
      traffic: this.sim ? S.traffic : 'local',
      objs: !!this.obj,
    };
    if (this.sim) this.sim.startRound({ traffic: S.traffic, policeServer, tuning: botTuning(bots, fugs.length, copN) });
    if (this.obj) this.obj.start(this.round.startAt);
    // placement de départ libre pendant le compte à rebours (+ une seconde)
    for (const p of [...fugs, ...cops]) p.tpAllow = { reason: 'spawn', until: this.round.startAt + 1 };
    this.phase = 'countdown';
    this.phaseEnd = this.round.startAt;
    log.ok(`Manche ${this.round.id} lancée par ${by} : ${fugs.length} fuyard(s), ${copN} flic(s), police IA ${bots}`);
    this.broadcast(this.roundMsg());
    this.lobbyDirty = true;
    return null;
  }

  initPlayer(p: Player, role: 'fugitive' | 'cop', kind: PlayerKind, color: number | null): void {
    Object.assign(p, {
      inRound: true, alive: true, role, kind, color, maxHp: HP[kind], hp: HP[kind],
      st: null, stT: 0, stTs: 0, valid: null, viol: [], tpAllow: null, resetT: -99,
      bust: 0, bustSent: 0, respawnAt: 0, respawnOk: false, bots: [], botsT: 0,
      score: 0, ppT: this.now(), turned: false, stats: { kills: 0, busts: 0, dmg: 0, spikes: 0, deaths: 0, surv: 0, heists: 0 },
      rep: {}, lastHitBy: null, lastHitT: 0, deadAt: 0, spk: null, simStars: 0, simBust: 0, obj: null, bigDwell: 0,
    });
  }

  roundMsg(): Msg {
    const r = this.round!;
    return {
      t: 'round', id: r.id, seed: r.seed, startAt: r.startAt, endAt: r.endAt, now: this.now(), phase: this.phase,
      bots: r.bots, spikes: r.spikes, weather: this.settings.weather, tod: this.settings.tod, policeSim: r.policeSim, traffic: r.traffic,
      deadToCop: this.settings.deadToCop, objs: r.objs,
      fugitives: r.fugitives, cops: r.cops, order: r.order,
      // cu : personnalisation de la voiture (comptes Discord, garage du site), seulement pour les fuyards
      roster: [...this.players.values()].filter((p) => p.inRound).map((p) => ({ id: p.id, n: p.name, role: p.role, kind: p.kind, col: p.color, cu: p.role === 'fugitive' ? p.discord?.custom ?? null : null })),
    };
  }

  checkRoundEnd(): void {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    const fugs = [...this.players.values()].filter((p) => p.inRound && p.role === 'fugitive');
    const alive = fugs.filter((p) => p.alive);
    if (!alive.length) {
      const cops = [...this.players.values()].some((p) => p.inRound && p.role === 'cop');
      this.endRound(cops ? 'cops' : 'none', cops ? 'Tous les fuyards sont tombés : victoire des flics !' : 'Tous les fuyards sont tombés.');
    }
  }

  endRound(winner: 'cops' | 'fugitives' | 'none', text: string): void {
    if ((this.phase !== 'playing' && this.phase !== 'countdown') || !this.round) return;
    const now = this.now();
    const rows = [];
    for (const p of this.players.values()) {
      if (!p.inRound) continue;
      if (p.role === 'fugitive' && p.alive && winner === 'fugitives') p.score += 3000; // survivant
      if (p.role === 'fugitive') p.stats.surv = Math.max(p.stats.surv, (p.alive ? now : p.deadAt) - this.round.startAt);
      const sc = Math.floor(p.score);
      rows.push({ id: p.id, n: p.name, role: p.role, kind: p.kind, col: p.color, sc, alive: p.alive, turned: !!p.turned, ...p.stats, surv: Math.round(p.stats.surv) });
      const b = this.bests.get(p.key);
      if (!b || sc > b.score) this.bests.set(p.key, { name: p.name, score: sc });
    }
    rows.sort((a, b) => b.sc - a.sc);
    let top = null;
    for (const b of this.bests.values()) if (!top || b.score > top.score) top = b;
    this.phase = 'results';
    this.phaseEnd = now + RESULTS_TIME;
    this.lastResults = { t: 'results', winner, text, rows, top, until: this.phaseEnd };
    if (this.sim) this.sim.stopRound();
    if (this.obj) this.obj.stop();
    this.broadcast(this.lastResults);
    this.spikes.clear();
    log.ok(`Fin de la manche ${this.round.id} : ${text}`);
    this.lobbyDirty = true;
  }

  toLobby(): void {
    if (this.sim) this.sim.stopRound();
    if (this.obj) this.obj.stop();
    this.phase = 'lobby';
    this.phaseEnd = 0;
    this.round = null;
    for (const p of this.players.values()) { p.inRound = false; p.alive = false; p.role = 'spectator'; p.st = null; p.bots = []; p.obj = null; }
    this.broadcast({ t: 'tolobby' });
    this.lobbyDirty = true;
  }

  eliminate(p: Player, why: 'busted' | 'wrecked' | 'bots', by: Player | null = null): void {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.deadAt = this.now();
    if (this.sim && this.sim.active && p.st) this.sim.setPlayer(p.id, p.st, p.role, p.kind!, false);
    if (this.obj && p.obj) this.obj.drop(p);
    p.stats.deaths++;
    p.bust = 0;
    const killer = by && by.inRound && by.role === 'cop' && by !== p ? by : null;
    if (p.role === 'fugitive') {
      p.stats.surv = p.deadAt - (this.round?.startAt || p.deadAt);
      if (killer) {
        killer.score += why === 'busted' ? 2000 : 1500;
        killer.stats[why === 'busted' ? 'busts' : 'kills']++;
      }
    } else {
      p.respawnAt = this.now() + COP_RESPAWN;
      p.respawnOk = false;
    }
    this.broadcast({ t: 'dead', id: p.id, why, by: killer ? killer.id : 0, respawn: p.role === 'cop' ? COP_RESPAWN : 0 });
    const txt = p.role === 'fugitive'
      ? `${p.name} ${why === 'busted' ? 'est arrêté' : 'est détruit'}${killer ? ` par ${killer.name}` : why === 'bots' ? ' par la police' : ''}`
      : `${p.name} (flic) est hors service pour ${COP_RESPAWN} s`;
    this.sys(txt);
    this.lobbyDirty = true;
    this.checkRoundEnd();
  }

  // ------------------------------------------------------------------ positions

  onState(p: Player, bytes: Uint8Array): void {
    if (!p.inRound || !p.kind) return;
    const d = decodeEntities(bytes);
    if (!d || d.type !== MSG_STATE || !d.list.length) return;
    const now = this.now();
    const [me, ...bots] = d.list;
    // voiture du joueur
    if (me.kind !== KIND[p.kind]) return;
    if (Math.abs(me.x) > 1600 || Math.abs(me.z) > 1600 || Math.abs(me.y) > 600) return;
    if (p.alive) {
      if (p.tpAllow && now <= p.tpAllow.until) {
        // juste après une téléportation autorisée (départ, touche R, retour en service) : pas de contrôle
        p.valid = { x: me.x, z: me.z, t: now };
      } else {
        p.tpAllow = null;
        if (p.valid) {
          const dt = Math.max(0.06, now - p.valid.t);
          if (hyp(me.x, me.z, p.valid.x, p.valid.z) > MAX_SPEED * dt + 6) {
            // déplacement impossible : on remet la voiture à sa dernière position valable
            p.viol = p.viol.filter((t) => now - t < 30);
            p.viol.push(now);
            if (p.viol.length > 15) return this.kick(p, 'positions impossibles (téléportation)', 'l\'anti-triche');
            this.send(p.conn, { t: 'setpos', x: p.valid.x, z: p.valid.z });
            return;
          }
        }
        p.valid = { x: me.x, z: me.z, t: now };
      }
    }
    p.st = me;
    p.stT = now;
    // heure de la mesure selon le client (horloge synchronisée), bornée : sert seulement à l'affichage
    // fluide chez les autres (chaque position garde sa vraie date au lieu de celle de l'envoi)
    p.stTs = d.time > 0 ? Math.min(now, Math.max(now - 0.5, d.time, p.stTs)) : now;
    if (this.sim && this.sim.active) this.sim.setPlayer(p.id, me, p.role, p.kind, p.alive);
    // police IA du fuyard (affichée chez les autres)
    if (p.role === 'fugitive' && p.alive && this.round?.bots !== 'off') {
      p.bots = bots.slice(0, MAX_BOTS_PER_PLAYER).filter((b) => b.kind >= 1 && b.kind <= 3 && b.id < 32 && hyp(b.x, b.z, me.x, me.z) < 1300);
      p.botsT = now;
    } else p.bots = [];
  }

  // ------------------------------------------------------------------ chocs, dégâts

  onHit(p: Player, m: Msg): void {
    if (!p.inRound || !p.alive || this.phase !== 'playing' || !p.hitBucket.take()) return;
    const imp = num(m.i, 0, 150);
    if (imp === null) return;
    const kind = typeof m.k === 'string' && ['p', 'b', 'w', 'x', 'l'].includes(m.k) ? m.k : 'w';
    const cap = (k: string) => (k === 'x' ? 25 : k === 'l' ? Math.max(0, imp - 11) * 2.4 + 1 : impactDamage(imp) * 2.6 + 1);
    const self = Math.min(num(m.d, 0, 400) ?? 0, cap(kind));
    if (kind === 'p') {
      const o = this.players.get(Number(m.o));
      if (!o || !o.inRound || !o.alive || o === p) return;
      // les deux voitures doivent être proches (avec de la marge pour la latence)
      if (!p.st || !o.st || hyp(p.st.x, p.st.z, o.st.x, o.st.z) > 18) return;
      const other = Math.min(num(m.od, 0, 400) ?? 0, cap('p'));
      // le même choc est signalé par les deux joueurs : on garde le plus fort, sans le compter deux fois
      const now = this.now();
      const key = p.id < o.id ? `${p.id}:${o.id}` : `${o.id}:${p.id}`;
      let ev = this.pairEv.get(key);
      if (!ev || now - ev.t > 0.5) { ev = { t: now, d: { [p.id]: 0, [o.id]: 0 } }; this.pairEv.set(key, ev); }
      const addP = Math.max(0, self - ev.d[p.id]), addO = Math.max(0, other - ev.d[o.id]);
      ev.d[p.id] += addP; ev.d[o.id] += addO;
      this.hurt(p, addP, o);
      this.hurt(o, addO, p);
      return;
    }
    this.hurt(p, self, null, kind === 'b' ? 'bots' : 'wrecked');
  }

  hurt(p: Player, dmg: number, by: Player | null = null, why: 'wrecked' | 'bots' = 'wrecked'): void {
    if (!p.alive || dmg <= 0.01 || !p.kind) return;
    const real = dmg * ARMOR[p.kind];
    p.hp = Math.max(0, p.hp - real);
    if (by) {
      p.lastHitBy = by; p.lastHitT = this.now();
      if (by.role === 'cop' && p.role === 'fugitive') { by.score += real * 10; by.stats.dmg += real; }
    }
    this.lobbyDirty = true;
    this.send(p.conn, { t: 'hp', hp: p.hp });
    if (p.hp <= 0) {
      // détruit juste après le choc d'un flic : c'est lui qui a le mérite
      const credit = by || (p.lastHitBy && this.now() - p.lastHitT < 4 ? p.lastHitBy : null);
      this.eliminate(p, why === 'bots' && !credit ? 'bots' : 'wrecked', credit);
    }
  }

  onRepair(p: Player, m: Msg): void {
    if (!p.inRound || !p.alive || this.phase !== 'playing') return;
    const r = m.r as RepairKind;
    const R = Object.hasOwn(REPAIR, r) ? REPAIR[r] : null;
    if (!R) return;
    // réparations communes et livraisons : c'est le serveur qui soigne (objectifs serveur)
    if (this.round?.objs && r !== 'challenge') return this.send(p.conn, { t: 'hp', hp: p.hp });
    const now = this.now();
    if (now - (p.rep[r] ?? -99) < R.cd) return this.send(p.conn, { t: 'hp', hp: p.hp });
    p.rep[r] = now;
    const a = Math.min(num(m.a, 0, 100) ?? 0, R.max);
    p.hp = Math.min(p.maxHp, p.hp + a);
    if (r === 'deliver') p.stats.heists++;
    this.send(p.conn, { t: 'hp', hp: p.hp });
  }

  // ------------------------------------------------------------------ score (fuyards)

  onScore(p: Player, m: Msg): void {
    if (!p.inRound || p.role !== 'fugitive' || !p.alive || this.phase !== 'playing' || !p.scBucket.take()) return;
    const label = cleanText(m.l || '', 40);
    const base = num(m.b, 0, 1e6), mult = num(m.m, 0, 12);
    if (base === null || mult === null) return;
    // le butin est compté par le serveur quand il gère les objectifs
    if (this.round?.objs && label.startsWith('BUTIN')) return;
    const capKey = Object.keys(CAPS).find((k) => label.startsWith(k));
    const cap = capKey ? CAPS[capKey] : 1500;
    const stars = this.starsOf(p);
    const okMult = MULTS.some((x) => Math.abs(mult - x) < 1e-6 || Math.abs(mult - 2 * x) < 1e-6) && mult <= 2 * multFor(stars) + 1e-6;
    p.score += Math.round(Math.min(base, cap) * (okMult ? mult : 1));
    this.lobbyDirty = true;
  }

  // points de survie / de poursuite, envoyés en cumul toutes les ~2 s
  onPassive(p: Player, m: Msg): void {
    if (!p.inRound || p.role !== 'fugitive' || !p.alive || this.phase !== 'playing') return;
    const now = this.now();
    const dt = Math.min(10, now - p.ppT);
    p.ppT = now;
    const v = num(m.v, 0, 1e5) ?? 0;
    p.score += Math.min(v, 12 * 6 * 2 * dt * 1.15 + 5);
  }

  // ------------------------------------------------------------------ téléportations autorisées

  onTeleport(p: Player, m: Msg): void {
    if (!p.inRound) return;
    const x = num(m.x, -1500, 1500), z = num(m.z, -1500, 1500);
    if (x === null || z === null) return;
    const now = this.now();
    const fugs = [...this.players.values()].filter((o) => o.inRound && o.role === 'fugitive' && o.alive && o.st);
    let ok = false;
    if (m.r === 'spawn') ok = p.tpAllow?.reason === 'spawn' && p.alive;
    else if (m.r === 'reset' && p.alive && this.phase === 'playing') {
      // touche R : pas plus d'une fois toutes les 10 s, pas loin, et pas avec un flic au contact
      const near = p.st ? hyp(x, z, p.st.x, p.st.z) < 260 : false;
      const copNear = [...this.players.values()].some((o) => o.inRound && o.role === 'cop' && o.alive && o.st && p.st && hyp(o.st.x, o.st.z, p.st.x, p.st.z) < 35);
      ok = near && now - p.resetT > 9.5 && p.bust < 0.02 && !(p.role === 'fugitive' && copNear);
      if (ok) p.resetT = now;
    } else if (m.r === 'respawn' && p.role === 'cop' && !p.alive && p.respawnOk) {
      // un flic revient loin des fuyards (mais pas trop)
      ok = fugs.every((f) => hyp(f.st!.x, f.st!.z, x, z) > 180);
      if (ok) {
        p.alive = true;
        p.hp = p.maxHp;
        p.respawnOk = false;
        p.bust = 0;
        this.broadcast({ t: 'alive', id: p.id, hp: p.hp });
        this.lobbyDirty = true;
      }
    }
    const r = str(m.r);
    if (!ok) return this.send(p.conn, { t: 'tpno', r });
    p.tpAllow = { reason: r, until: Math.max(p.tpAllow?.until ?? 0, now + 2.5) };
    this.send(p.conn, { t: 'tpok', r, x, z });
  }

  // ------------------------------------------------------------------ herses (flics joueurs)

  onSpike(p: Player, m: Msg): void {
    if (!p.inRound || p.role !== 'cop' || !p.alive || this.phase !== 'playing' || !p.spk || p.spk.n <= 0 || !this.round) return;
    const x = num(m.x, -1500, 1500), z = num(m.z, -1500, 1500), h = num(m.h, -10, 10), w = num(m.w, 2, 9) ?? 4;
    if (x === null || z === null || h === null || !p.st || hyp(x, z, p.st.x, p.st.z) > 30) return;
    if ([...this.spikes.values()].filter((s) => s.owner === p.id).length >= 2) return this.sys('Déjà deux herses posées.', p);
    p.spk.n--;
    if (!p.spk.next) p.spk.next = this.now() + this.round.spikeRecharge;
    const s = { sid: this.spikeSeq++, x, z, h, w, owner: p.id, until: this.now() + SPIKE_TTL };
    this.spikes.set(s.sid, s);
    this.broadcast({ t: 'spike', ...s, ttl: SPIKE_TTL });
    this.send(p.conn, { t: 'spk', n: p.spk.n, next: p.spk.next ? p.spk.next - this.now() : 0 });
  }

  onSpikeHit(p: Player, m: Msg): void {
    const s = this.spikes.get(Number(m.sid));
    if (!s || !p.inRound || p.role !== 'fugitive' || !p.alive || !p.st || hyp(p.st.x, p.st.z, s.x, s.z) > 22) return;
    this.spikes.delete(s.sid);
    this.broadcast({ t: 'spikedel', sid: s.sid, by: p.id });
    const o = this.players.get(s.owner);
    if (o && o.inRound) { o.score += 400; o.stats.spikes++; this.sys(`${p.name} roule sur la herse de ${o.name} !`); }
    this.lobbyDirty = true;
  }

  // ---- police serveur : événements venus du jeu du fuyard (braquage, témoins, défi « une étoile de moins »)
  squadOf(p: Player) {
    if (!this.sim || this.round?.policeSim !== 'server' || !p.inRound || p.role !== 'fugitive' || !p.alive || this.phase !== 'playing') return null;
    return this.sim.squad(p.id);
  }

  onAlarm(p: Player, m: Msg): void {
    const sq = this.squadOf(p);
    const x = num(m.x, -1500, 1500), z = num(m.z, -1500, 1500);
    if (!sq || x === null || z === null || !p.st || hyp(x, z, p.st.x, p.st.z) > 150) return;
    const now = this.now();
    if (now - (p.alarmT ?? -99) < 15) return;
    p.alarmT = now;
    sq.wanted.alarm(x, z, Math.min(40, num(m.h, 0, 100) ?? 18));
  }

  onHeat(p: Player, m: Msg): void {
    const sq = this.squadOf(p);
    if (!sq) return;
    const now = this.now();
    p.heatWin = (p.heatWin || []).filter(([t]) => now - t < 5);
    const h = Math.min(12, num(m.h, 0, 100) ?? 0);
    if (p.heatWin.reduce((a, [, v]) => a + v, 0) + h > 30) return; // au plus 30 de chaleur par 5 s
    p.heatWin.push([now, h]);
    if (h > 0) sq.wanted.addHeat(h);
    if (m.w) sq.wanted.witness();
  }

  onDropStar(p: Player): void {
    const sq = this.squadOf(p);
    const now = this.now();
    if (!sq || now - (p.dropT ?? -99) < 40) return;
    p.dropT = now;
    sq.wanted.dropStar();
  }

  // fuyard éliminé qui rejoint la police (si l'hôte l'a autorisé) : retour en service dans 8 s
  onBecomeCop(p: Player): void {
    if (!this.settings.deadToCop || !p.inRound || p.role !== 'fugitive' || p.alive || this.phase !== 'playing' || !this.round) return;
    const cars = this.round.cars;
    p.role = 'cop';
    p.kind = cars.includes('police') ? 'police' : cars.includes(p.car) ? p.car : cars[0];
    p.maxHp = HP[p.kind];
    p.color = null;
    p.bots = [];
    p.obj = null;
    p.respawnAt = this.now() + 8;
    p.respawnOk = false;
    const spk = SPIKES[this.round.spikes];
    p.spk = { n: spk.max, next: 0 };
    p.turned = true;
    if (this.sim) this.sim.removePlayer(p.id);
    this.broadcast({ t: 'role', id: p.id, role: 'cop', kind: p.kind, respawn: 8 });
    this.sys(`${p.name} rejoint la police !`);
    this.lobbyDirty = true;
  }

  onBustedByBots(p: Player): void {
    if (!p.inRound || p.role !== 'fugitive' || !p.alive || this.phase !== 'playing' || this.round?.bots === 'off') return;
    this.eliminate(p, 'busted', null);
  }

  // ------------------------------------------------------------------ boucle

  tick(): void {
    const t0 = performance.now();
    this.tickInner();
    this.tickMs = this.tickMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  tickInner(): void {
    const now = this.now();
    const dt = 1 / TICK_HZ;
    if (this.phase === 'countdown' && now >= this.phaseEnd && this.round) {
      this.phase = 'playing';
      this.phaseEnd = this.round.endAt;
      this.broadcast({ t: 'go', endAt: this.round.endAt, now });
      this.lobbyDirty = true;
    }
    if (this.phase === 'playing') this.tickRound(now, dt);
    if (this.phase === 'results' && now >= this.phaseEnd) this.toLobby();
    // purge des herses expirées
    for (const s of this.spikes.values()) if (now > s.until) { this.spikes.delete(s.sid); this.broadcast({ t: 'spikedel', sid: s.sid }); }
    if (this.phase === 'playing' || this.phase === 'countdown') this.snapshot(now);
    this.lobbyT += dt;
    if (this.lobbyDirty ? this.lobbyT > 0.25 : this.lobbyT > 2) this.sendLobby();
  }

  tickRound(now: number, dt: number): void {
    const round = this.round;
    if (!round) return;
    const ps = [...this.players.values()].filter((p) => p.inRound);
    const cops = ps.filter((p) => p.role === 'cop' && p.alive && p.st && now - p.stT < 2);
    for (const p of ps) {
      if (p.role === 'fugitive' && p.alive && p.st) {
        // arrestation par un flic joueur : fuyard (presque) arrêté, flic au contact
        const st = p.st;
        const sp = Math.hypot(st.vx, st.vz);
        let near: Player | null = null;
        if (sp < 2.2) for (const c of cops) if (hyp(c.st!.x, c.st!.z, st.x, st.z) < 7.5 && Math.hypot(c.st!.vx, c.st!.vz) < 6) { near = c; break; }
        p.bust = near ? p.bust + dt / 3.2 : Math.max(0, p.bust - dt * 0.9);
        const shown = Math.max(p.bust, p.simBust || 0);
        if (Math.abs(shown - p.bustSent) > 0.04 || (shown === 0 && p.bustSent > 0)) { p.bustSent = shown; this.send(p.conn, { t: 'bust', p: Math.min(1, shown) }); }
        if (p.bust >= 1) this.eliminate(p, 'busted', near);
      }
      if (p.role === 'cop') {
        if (!p.alive && !p.respawnOk && p.respawnAt && now >= p.respawnAt) {
          p.respawnOk = true;
          const fugs = ps.filter((f) => f.role === 'fugitive' && f.alive && f.st);
          const f = fugs[Math.floor(Math.random() * fugs.length)];
          this.send(p.conn, { t: 'respawn', near: f ? { x: f.st!.x, z: f.st!.z } : null });
        }
        if (p.spk && p.spk.next && now >= p.spk.next) {
          p.spk.n = Math.min(SPIKES[round.spikes].max, p.spk.n + 1);
          p.spk.next = p.spk.n < SPIKES[round.spikes].max ? now + round.spikeRecharge : 0;
          this.send(p.conn, { t: 'spk', n: p.spk.n, next: p.spk.next ? p.spk.next - now : 0 });
        }
      }
    }
    if (this.obj) this.obj.tick(now, dt);
    if (this.phase !== 'playing') return; // la manche a pu se terminer ci-dessus
    if (round.endAt && now >= round.endAt) {
      const alive = ps.filter((p) => p.role === 'fugitive' && p.alive);
      this.endRound(alive.length ? 'fugitives' : 'cops', alive.length ? `Temps écoulé : ${alive.map((p) => p.name).join(', ')} ${alive.length > 1 ? 'ont' : 'a'} tenu jusqu'au bout !` : 'Temps écoulé.');
    }
    for (const [k, ev] of this.pairEv) if (now - ev.t > 2) this.pairEv.delete(k);
  }

  snapN = 0;

  snapshot(now: number): void {
    // un tour sur deux : seulement les voitures des joueurs (celles qu'on percute et qui doivent être précises)
    const full = this.snapN++ % 2 === 0;
    type Out = Entity & { owner: number };
    const ents: Out[] = [];
    for (const p of this.players.values()) {
      if (!p.inRound || !p.st || !p.kind) continue;
      // épave d'un fuyard : visible 25 s, puis disparaît
      if (!p.alive && p.role === 'fugitive' && now - p.deadAt > 25) continue;
      const s = p.st;
      // âge de la mesure : le client du joueur l'a datée ; l'épave immobile n'a pas d'âge
      const age = p.alive ? Math.max(0, now - p.stTs) : 0;
      ents.push({
        ...s, id: p.id, kind: KIND[p.kind], hp: Math.round(p.hp), age,
        flags: (s.flags & ~F.destroyed) | (p.alive ? 0 : F.destroyed), owner: 0,
      });
      if (full && p.alive && p.bots.length && now - p.botsT < 1.5) for (const b of p.bots) ents.push({ ...b, id: botId(p.id, b.id), owner: p.id, age });
    }
    const simAge = Math.max(0, now - this.simAt);
    for (const r of this.players.values()) {
      const view = r.st && r.alive ? r.st : r.view || r.st;
      const list: Entity[] = [];
      const bots: [number, Out][] = [];
      for (const e of ents) {
        if (e.id === r.id || e.owner === r.id) continue;
        if (e.owner) {
          const d = view ? hyp(e.x, e.z, view.x, view.z) : 0;
          if (d < AOI) bots.push([d, e]);
        } else list.push(e);
      }
      bots.sort((a, b) => a[0] - b[0]);
      for (const [, e] of bots.slice(0, 48)) list.push(e);
      // circulation et police du serveur (ses propres polices IA aussi : c'est le serveur qui les fait rouler)
      if (full && this.sim && this.sim.active && view) for (const e of this.sim.entities(view)) if (list.length < 250) { e.age = simAge; list.push(e); }
      this.sendBin(r.conn, encodeEntities(MSG_SNAPSHOT, now, list));
    }
  }

  // ------------------------------------------------------------------ infos (page /info, console)

  info(): Msg {
    return {
      name: this.cfg.name, motd: this.cfg.motd, players: this.players.size, max: this.cfg.maxPlayers,
      password: !!this.cfg.password, approval: this.cfg.joinApproval, protocol: PROTOCOL, phase: this.phase,
      preset: PRESETS[this.settings.preset].label,
    };
  }
}

function clientIp(req: IncomingMessage): string {
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
