// Le serveur de jeu : salon, manches, autorité sur la vie / les morts / les scores, chat, admin.
//
// Répartition des rôles :
//  - chaque client simule SA voiture (et, pour un fuyard, SES voitures de police IA) et envoie leur
//    position ~15 fois par seconde ; le serveur vérifie la vitesse (pas de téléportation) ;
//  - la vie de chaque voiture appartient au serveur : un client ne peut pas se soigner, il signale
//    ses chocs et ses réparations, que le serveur plafonne et valide ;
//  - les chocs entre deux joueurs sont signalés par les deux : le serveur garde le plus fort
//    (on ne peut pas éviter les dégâts d'un flic en mentant) ;
//  - les arrestations par un flic joueur sont calculées ici, à partir des positions.
import crypto from 'node:crypto';
import {
  PROTOCOL, KIND, KIND_NAME, COP_CARS, F, botId, MAX_BOTS_PER_PLAYER, MSG_SNAPSHOT, MSG_STATE,
  FUGITIVE_COLORS, PRESETS, copCountFor, allowedCopCars, SPIKES, SPIKE_TTL, COP_RESPAWN, HP, ARMOR,
  impactDamage, encodeEntities, decodeEntities,
} from './protocol.js';
import { cleanText, cleanName, Bucket, ChatGuard } from './text.js';
import { verifyTicket } from './identity.js';
import { log } from './log.js';

const TICK_HZ = 15;
const MAX_SPEED = 115; // m/s entre deux positions (vitesse de pointe ≈ 80 m/s + glisse / chocs)
const AOI = 950; // portée d'envoi des voitures de police IA des autres
const RESULTS_TIME = 14;
const COUNTDOWN = 5;

// plafonds de points par événement (comme le classement en ligne)
const CAPS = {
  'DÉRAPAGE': 30000, 'GROS SAUT': 3000, 'SAUT': 3000, 'FRÔLÉ UN FLIC': 180, 'FRÔLÉ': 120, 'FLIC NEUTRALISÉ': 500,
  'SEMÉS': 600, 'BUTIN ENCAISSÉ': 11000, 'DÉFI RÉUSSI': 250, 'BONUS DÉFI': 2800, 'PASSÉ DEVANT LE TRAIN': 1600,
  'FLASHÉ': 2600, 'CARNAGE': 6000,
};
const MULTS = [1, 1.5, 2, 3, 4, 6];
const REPAIR = { pickup: { max: 40, cd: 12 }, deliver: { max: 25, cd: 18 }, challenge: { max: 35, cd: 20 } };

const DEFAULT_SETTINGS = { preset: 'classique', cops: 0, bots: 'normal', spikes: 'off', timeLimit: 0, copCars: 'auto', weather: 'dynamic', tod: 'sunset' };
const BOTS = ['off', 'normal', 'renforce'];
const WEATHERS = ['dynamic', 'clear', 'cloudy', 'rain', 'storm', 'fog'];
const TODS = ['day', 'sunset', 'night'];

export function normalizeSettings(s = {}) {
  const o = { ...DEFAULT_SETTINGS };
  if (PRESETS[s.preset]) o.preset = s.preset;
  const p = PRESETS[o.preset];
  o.cops = o.preset === 'perso' ? Math.max(0, Math.min(19, Math.floor(Number(s.cops ?? p.cops) || 0))) : p.cops;
  o.bots = BOTS.includes(s.bots) ? s.bots : p.bots;
  o.spikes = SPIKES[s.spikes] ? s.spikes : p.spikes;
  const tl = Number(s.timeLimit ?? p.timeLimit);
  o.timeLimit = tl === 0 ? 0 : Math.max(120, Math.min(1800, Math.round(tl / 60) * 60 || p.timeLimit));
  o.copCars = s.copCars === 'auto' || !Array.isArray(s.copCars) ? 'auto' : s.copCars.filter((c) => COP_CARS.includes(c));
  if (Array.isArray(o.copCars) && !o.copCars.length) o.copCars = 'auto';
  o.weather = WEATHERS.includes(s.weather) ? s.weather : DEFAULT_SETTINGS.weather;
  o.tod = TODS.includes(s.tod) ? s.tod : DEFAULT_SETTINGS.tod;
  return o;
}

const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
const safeEq = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest(), hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export class GameServer {
  constructor(cfg, { bans, saveConfig }) {
    this.cfg = cfg;
    this.bans = bans;
    this.saveConfig = saveConfig;
    this.players = new Map(); // id -> joueur accepté
    this.pending = new Map(); // demandes d'entrée en attente (approbation)
    this.conns = new Set();
    this.reqSeq = 1;
    this.phase = 'lobby';
    this.phaseEnd = 0;
    this.settings = normalizeSettings(cfg.settings || {});
    this.round = null;
    this.roundSeq = 0;
    this.spikes = new Map();
    this.spikeSeq = 1;
    this.bests = new Map(); // clé d'identité -> { name, score }
    this.authFails = new Map(); // ip -> { n, until }
    this.t0 = Date.now();
    this.lobbyDirty = true;
    this.lobbyT = 0;
    this.lastResults = null;
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  now() { return (Date.now() - this.t0) / 1000; }

  // ------------------------------------------------------------------ connexions

  onConnection(ws, req) {
    const ip = clientIp(req);
    const perIp = [...this.conns].filter((c) => c.ip === ip).length;
    if (this.conns.size >= this.cfg.maxPlayers + 8 || perIp >= 10) {
      ws.close(1013, 'trop de connexions');
      return;
    }
    const conn = {
      ws, ip, host: String(req.headers.host || '').toLowerCase().slice(0, 120), player: null, pendingReq: null,
      bucket: new Bucket(80, 160), // messages texte
      binBucket: new Bucket(40, 80), // positions
      closed: false, over: 0,
    };
    this.conns.add(conn);
    conn.helloTimer = setTimeout(() => { if (!conn.player && !conn.pendingReq) this.drop(conn, 'délai dépassé'); }, 15000);
    ws.on('message', (data, isBinary) => {
      try { this.onMessage(conn, data, isBinary); } catch (e) { log.error(`message de ${conn.player?.name || conn.ip} : ${e.message}`); }
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => {});
  }

  send(conn, msg) {
    if (!conn || conn.closed || conn.ws.readyState !== 1) return;
    conn.ws.send(JSON.stringify(msg));
  }

  sendBin(conn, bytes) {
    if (!conn || conn.closed || conn.ws.readyState !== 1) return;
    // file d'attente pleine (connexion lente) : on saute une image plutôt que d'accumuler du retard
    if (conn.ws.bufferedAmount > 256 * 1024) return;
    conn.ws.send(bytes, { binary: true });
  }

  broadcast(msg, except = null) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.conn.ws.readyState === 1) p.conn.ws.send(s);
  }

  sys(text, to = null) {
    const m = { t: 'chat', sys: true, x: text };
    if (to) this.send(to.conn, m); else this.broadcast(m);
  }

  drop(conn, why) {
    if (conn.closed) return;
    this.send(conn, { t: 'kick', why });
    try { conn.ws.close(4000, why.slice(0, 100)); } catch { /* déjà fermé */ }
  }

  onClose(conn) {
    if (conn.closed) return;
    conn.closed = true;
    clearTimeout(conn.helloTimer);
    this.conns.delete(conn);
    if (conn.pendingReq) {
      const r = this.pending.get(conn.pendingReq);
      if (r) { clearTimeout(r.timer); this.pending.delete(conn.pendingReq); this.notifyAdmins({ t: 'joinreq', req: r.id, gone: true }); }
    }
    const p = conn.player;
    if (!p) return;
    this.players.delete(p.id);
    log.info(`${log.bold(p.name)} est parti (${this.players.size}/${this.cfg.maxPlayers})`);
    this.sys(`${p.name} a quitté le serveur`);
    if (p.inRound && p.alive && p.role === 'fugitive') this.checkRoundEnd();
    if (!this.players.size && this.phase !== 'lobby') this.toLobby();
    this.lobbyDirty = true;
  }

  // ------------------------------------------------------------------ messages

  onMessage(conn, data, isBinary) {
    if (conn.closed) return;
    if (isBinary) {
      if (!conn.player || !conn.binBucket.take()) return;
      const bytes = data instanceof Buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
      return this.onState(conn.player, bytes);
    }
    if (!conn.bucket.take()) {
      // inondation de messages : on coupe
      if (++conn.over > 200) this.drop(conn, 'trop de messages');
      return;
    }
    if (data.length > 4096) return;
    let m;
    try { m = JSON.parse(data.toString('utf8')); } catch { return; }
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
      case 'adm': this.onAdminCode(p, m.code); break;
      case 'hit': this.onHit(p, m); break;
      case 'rep': this.onRepair(p, m); break;
      case 'sc': this.onScore(p, m); break;
      case 'pp': this.onPassive(p, m); break;
      case 'tp': this.onTeleport(p, m); break;
      case 'spk': this.onSpike(p, m); break;
      case 'spkhit': this.onSpikeHit(p, m); break;
      case 'busted': this.onBustedByBots(p); break;
      case 'view': p.view = { x: num(m.x, -3000, 3000) ?? 0, z: num(m.z, -3000, 3000) ?? 0 }; break;
      default:
        if (p.admin) this.onAdmin(p, m);
    }
  }

  // ------------------------------------------------------------------ arrivée d'un joueur

  onHello(conn, m) {
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
    let name = discord ? cleanName(discord.name) || cleanName(discord.name.replace(/[^\p{L}\p{N} _.\-]/gu, '').slice(0, 16)) || `Joueur${discord.id.slice(-4)}` : cleanName(m.name);
    if (!name) return this.drop(conn, 'pseudo invalide (3 à 16 caractères : lettres, chiffres, espace, - _ .)');
    const info = { name, discord, cid, fp, ip: conn.ip, ticketBad: !!m.ticket && !discord };
    const ban = this.bans.match(info);
    if (ban) return this.drop(conn, `banni de ce serveur${ban.reason ? ` : ${ban.reason}` : ''}`);
    // mot de passe
    if (this.cfg.password && !safeEq(m.pass || '', this.cfg.password)) {
      const f = this.authFails.get(conn.ip) || { n: 0, until: 0 };
      f.n++;
      if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; }
      this.authFails.set(conn.ip, f);
      return this.drop(conn, 'mot de passe incorrect');
    }
    if (this.players.size >= this.cfg.maxPlayers) return this.drop(conn, 'serveur plein');
    // déjà connecté avec le même compte / navigateur : l'ancienne connexion est fermée
    for (const o of this.players.values()) if ((discord && o.discord?.id === discord.id) || o.cid === cid) this.drop(o.conn, 'connecté ailleurs');
    info.admin = typeof m.admin === 'string' && m.admin.length > 0 && safeEq(m.admin, this.cfg.adminCode);
    if (this.cfg.joinApproval && !info.admin) return this.askApproval(conn, info);
    this.accept(conn, info);
  }

  askApproval(conn, info) {
    const id = this.reqSeq++;
    conn.pendingReq = id;
    const r = { id, conn, info, timer: setTimeout(() => this.resolveRequest(id, false, 'personne n\'a répondu'), 120000) };
    this.pending.set(id, r);
    this.send(conn, { t: 'pending' });
    log.warn(`Demande d'entrée n°${id} : ${log.bold(info.name)}${info.discord ? ' (Discord)' : ''} — tape « accepter ${id} » ou « refuser ${id} »`);
    this.notifyAdmins({ t: 'joinreq', req: id, n: info.name, d: !!info.discord });
  }

  resolveRequest(id, ok, why = 'refusé par l\'hôte') {
    const r = this.pending.get(id);
    if (!r) return false;
    clearTimeout(r.timer);
    this.pending.delete(id);
    r.conn.pendingReq = null;
    this.notifyAdmins({ t: 'joinreq', req: id, gone: true });
    if (r.conn.closed) return true;
    if (!ok) { this.drop(r.conn, why); log.info(`Demande n°${id} (${r.info.name}) refusée`); return true; }
    if (this.players.size >= this.cfg.maxPlayers) { this.drop(r.conn, 'serveur plein'); return true; }
    this.accept(r.conn, r.info);
    return true;
  }

  notifyAdmins(msg) {
    for (const p of this.players.values()) if (p.admin) this.send(p.conn, msg);
  }

  freeId() {
    for (let i = 1; i < 255; i++) if (!this.players.has(i)) return i;
    return 0;
  }

  uniqueName(name) {
    const taken = (n) => [...this.players.values()].some((p) => p.name.toLowerCase() === n.toLowerCase());
    if (!taken(name)) return name;
    for (let k = 2; k < 100; k++) {
      const n = `${name.slice(0, 13)} ${k}`;
      if (!taken(n)) return n;
    }
    return `${name.slice(0, 10)}${crypto.randomInt(1000, 9999)}`;
  }

  accept(conn, info) {
    const id = this.freeId();
    if (!id) return this.drop(conn, 'serveur plein');
    const key = crypto.createHash('sha256').update(`${this.cfg.salt}|${info.discord ? `d${info.discord.id}` : `c${info.cid}`}`).digest('hex').slice(0, 16);
    const p = {
      id, conn, key, name: this.uniqueName(info.name), discord: info.discord, cid: info.cid, fp: info.fp, ip: info.ip,
      admin: !!info.admin, pref: 'any', car: 'interceptor', role: 'spectator', ping: 0, chat: new ChatGuard(), smuted: false,
      joinedAt: this.now(), inRound: false, alive: false, view: null,
      scBucket: new Bucket(12, 30), hitBucket: new Bucket(30, 60),
    };
    conn.player = p;
    this.players.set(id, p);
    log.ok(`${log.bold(p.name)} a rejoint${p.discord ? ' (Discord)' : ''}${p.admin ? ' [admin]' : ''} — ${conn.ip} (${this.players.size}/${this.cfg.maxPlayers})`);
    this.send(conn, {
      t: 'welcome', id, name: p.name, key, admin: p.admin, ticketBad: info.ticketBad,
      server: { name: this.cfg.name, motd: this.cfg.motd, max: this.cfg.maxPlayers, approval: this.cfg.joinApproval, password: !!this.cfg.password, protocol: PROTOCOL },
      time: this.now(),
    });
    this.sys(`${p.name} a rejoint le serveur`, null);
    if (this.cfg.motd) this.sys(this.cfg.motd, p);
    this.notifyAdmins({ t: 'notify', x: `${p.name} a rejoint` });
    this.lobbyDirty = true;
    this.sendLobby(p);
    // une manche est en cours : on la regarde en spectateur
    if (this.round && this.phase !== 'lobby') this.send(conn, this.roundMsg());
    if (this.phase === 'results' && this.lastResults) this.send(conn, this.lastResults);
  }

  // ------------------------------------------------------------------ salon

  lobbyMsg() {
    const players = [...this.players.values()].map((p) => ({
      id: p.id, n: p.name, d: p.discord ? { id: p.discord.id, av: p.discord.avatar } : null, key: p.key,
      adm: p.admin, pref: p.pref, car: p.car, role: p.role, ping: Math.round(p.ping || 0),
      sc: p.inRound ? Math.floor(p.score || 0) : 0, best: this.bests.get(p.key)?.score || 0,
      alive: !!(p.inRound && p.alive), hp: p.inRound ? Math.round(p.hp) : 0, max: p.inRound ? p.maxHp : 0,
      col: p.color ?? null, muted: p.smuted, kind: p.kind ?? null,
    }));
    let top = null;
    for (const b of this.bests.values()) if (!top || b.score > top.score) top = b;
    return {
      t: 'lobby', phase: this.phase, phaseEnd: this.phaseEnd, settings: this.settings, players,
      top, presets: PRESETS, pending: this.pending.size,
    };
  }

  sendLobby(to = null) {
    const m = this.lobbyMsg();
    if (to) this.send(to.conn, m); else this.broadcast(m);
    this.lobbyDirty = false;
    this.lobbyT = 0;
  }

  onPref(p, m) {
    if (m.pref && ['any', 'fugitive', 'cop', 'spectate'].includes(m.pref)) p.pref = m.pref;
    if (m.car && COP_CARS.includes(m.car)) p.car = m.car;
    this.lobbyDirty = true;
  }

  onAdminCode(p, code) {
    if (typeof code !== 'string' || !code) return;
    if (safeEq(code, this.cfg.adminCode)) {
      p.admin = true;
      this.sys('Tu es maintenant admin du serveur.', p);
      log.ok(`${p.name} est admin`);
      this.lobbyDirty = true;
      this.send(p.conn, { t: 'admin', on: true });
      for (const r of this.pending.values()) this.send(p.conn, { t: 'joinreq', req: r.id, n: r.info.name, d: !!r.info.discord });
    } else {
      const f = this.authFails.get(p.ip) || { n: 0, until: 0 };
      if (++f.n >= 5) { this.drop(p.conn, 'trop d\'essais de code admin'); f.n = 0; f.until = Date.now() + 60000; }
      this.authFails.set(p.ip, f);
      this.sys('Code admin incorrect.', p);
    }
  }

  onAdmin(p, m) {
    const target = typeof m.id === 'number' ? this.players.get(m.id) : null;
    switch (m.t) {
      case 'kick': if (target && target !== p) this.kick(target, cleanText(m.why || '', 100), p.name); break;
      case 'ban': if (target && target !== p) this.ban(target, cleanText(m.why || '', 100), p.name); break;
      case 'smute': if (target) { target.smuted = !target.smuted; this.sys(`${target.name} ${target.smuted ? 'ne peut plus écrire' : 'peut de nouveau écrire'} dans le chat`); this.lobbyDirty = true; } break;
      case 'force': if (target && ['any', 'fugitive', 'cop', 'spectate'].includes(m.pref)) { target.pref = m.pref; this.lobbyDirty = true; } break;
      case 'set': this.applySettings(m.s || {}, p.name); break;
      case 'start': this.startRound(p.name); break;
      case 'stop': if (this.phase === 'playing' || this.phase === 'countdown') this.endRound('none', `Manche arrêtée par ${p.name}`); break;
      case 'approve': this.resolveRequest(Number(m.req), !!m.ok); break;
    }
  }

  applySettings(s, by) {
    if (this.phase === 'playing' || this.phase === 'countdown') return;
    const merged = s.preset && s.preset !== this.settings.preset ? { ...PRESETS[s.preset], preset: s.preset, weather: this.settings.weather, tod: this.settings.tod } : { ...this.settings, ...s };
    this.settings = normalizeSettings(merged);
    this.cfg.settings = this.settings;
    this.saveConfig(this.cfg);
    this.lobbyDirty = true;
    if (by) log.info(`Réglages changés par ${by} : ${PRESETS[this.settings.preset].label}`);
  }

  kick(p, why, by = 'la console') {
    log.warn(`${p.name} expulsé par ${by}${why ? ` (${why})` : ''}`);
    this.sys(`${p.name} a été expulsé${why ? ` (${why})` : ''}`);
    this.drop(p.conn, `expulsé par ${by}${why ? ` : ${why}` : ''}`);
  }

  ban(p, why, by = 'la console') {
    this.bans.add(p, why);
    log.warn(`${p.name} banni par ${by}${why ? ` (${why})` : ''}`);
    this.sys(`${p.name} a été banni${why ? ` (${why})` : ''}`);
    this.drop(p.conn, `banni par ${by}${why ? ` : ${why}` : ''}`);
  }

  // ------------------------------------------------------------------ chat

  onChat(p, raw) {
    const text = cleanText(raw);
    if (!text) return;
    if (text.startsWith('/')) return this.onCommand(p, text);
    if (p.smuted) return this.sys('Un admin t\'a rendu muet.', p);
    const no = p.chat.check(text);
    if (no) return this.sys(no, p);
    log.chat(p.name, text);
    this.broadcast({ t: 'chat', id: p.id, n: p.name, x: text, r: p.inRound ? p.role : null });
  }

  onCommand(p, text) {
    const [cmd, ...rest] = text.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    const find = () => this.findPlayer(arg);
    switch (cmd.toLowerCase()) {
      case 'aide': case 'help':
        this.sys(`Commandes : /joueurs${p.admin ? ', /kick nom, /ban nom, /muet nom, /lancer, /stop' : ', /admin CODE'}`, p); break;
      case 'joueurs': case 'qui':
        this.sys([...this.players.values()].map((o) => o.name).join(', '), p); break;
      case 'admin': this.onAdminCode(p, arg); break;
      case 'kick': if (p.admin) { const t = find(); if (t && t !== p) this.kick(t, '', p.name); else this.sys('Joueur introuvable', p); } break;
      case 'ban': if (p.admin) { const t = find(); if (t && t !== p) this.ban(t, '', p.name); else this.sys('Joueur introuvable', p); } break;
      case 'muet': case 'mute': if (p.admin) { const t = find(); if (t) this.onAdmin(p, { t: 'smute', id: t.id }); } break;
      case 'lancer': case 'start': if (p.admin) this.startRound(p.name); break;
      case 'stop': if (p.admin) this.onAdmin(p, { t: 'stop' }); break;
      default: this.sys('Commande inconnue (/aide)', p);
    }
  }

  findPlayer(q) {
    if (!q) return null;
    const s = String(q).toLowerCase();
    const list = [...this.players.values()];
    return list.find((p) => String(p.id) === s) || list.find((p) => p.name.toLowerCase() === s) || list.find((p) => p.name.toLowerCase().startsWith(s)) || null;
  }

  // ------------------------------------------------------------------ manches

  startRound(by = 'la console') {
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
    const rank = (p) => (p.pref === 'cop' ? 0 : p.pref === 'any' ? 1 : 2);
    shuffled.sort((a, b) => rank(a) - rank(b));
    const cops = shuffled.slice(0, copN), fugs = shuffled.slice(copN);
    const cars = S.copCars === 'auto' ? allowedCopCars(copN, fugs.length) : S.copCars;
    const spk = SPIKES[S.spikes];
    for (const p of this.players.values()) { p.inRound = false; p.alive = false; p.role = 'spectator'; p.kind = null; p.color = null; }
    fugs.forEach((p, i) => this.initPlayer(p, 'fugitive', 'fugitive', FUGITIVE_COLORS[i % FUGITIVE_COLORS.length]));
    cops.forEach((p) => {
      this.initPlayer(p, 'cop', cars.includes(p.car) ? p.car : cars[0], null);
      p.spk = { n: spk.max, next: 0 };
    });
    this.spikes.clear();
    const now = this.now();
    this.round = {
      id: ++this.roundSeq, seed: crypto.randomInt(1, 2 ** 31 - 1), startAt: now + COUNTDOWN,
      endAt: S.timeLimit ? now + COUNTDOWN + S.timeLimit : 0, bots, spikes: S.spikes, cars,
      fugitives: fugs.length, cops: copN,
      // recharge des herses plus lente quand il y a beaucoup de flics
      spikeRecharge: spk.recharge * (1 + 0.2 * Math.max(0, copN - 1)),
      order: [...fugs, ...cops].map((p) => p.id),
    };
    // placement de départ libre pendant le compte à rebours (+ quelques secondes)
    for (const p of [...fugs, ...cops]) p.tpAllow = { reason: 'spawn', until: this.round.startAt + 1 };
    this.phase = 'countdown';
    this.phaseEnd = this.round.startAt;
    log.ok(`Manche ${this.round.id} lancée par ${by} : ${fugs.length} fuyard(s), ${copN} flic(s), police IA ${bots}`);
    this.broadcast(this.roundMsg());
    this.lobbyDirty = true;
    return null;
  }

  initPlayer(p, role, kind, color) {
    Object.assign(p, {
      inRound: true, alive: true, role, kind, color, maxHp: HP[kind], hp: HP[kind],
      st: null, stT: 0, valid: null, viol: [], tpAllow: null, resetT: -99,
      bust: 0, bustSent: 0, respawnAt: 0, respawnOk: false, bots: [], botsT: 0,
      score: 0, ppT: this.now(), stats: { kills: 0, busts: 0, dmg: 0, spikes: 0, deaths: 0, surv: 0, heists: 0 },
      rep: {}, lastHitBy: null, lastHitT: 0, pairs: new Map(), deadAt: 0,
    });
  }

  roundMsg() {
    const r = this.round;
    return {
      t: 'round', id: r.id, seed: r.seed, startAt: r.startAt, endAt: r.endAt, now: this.now(), phase: this.phase,
      bots: r.bots, spikes: r.spikes, weather: this.settings.weather, tod: this.settings.tod,
      fugitives: r.fugitives, cops: r.cops, order: r.order,
      roster: [...this.players.values()].filter((p) => p.inRound).map((p) => ({ id: p.id, n: p.name, role: p.role, kind: p.kind, col: p.color })),
    };
  }

  checkRoundEnd() {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    const fugs = [...this.players.values()].filter((p) => p.inRound && p.role === 'fugitive');
    const alive = fugs.filter((p) => p.alive);
    if (!alive.length) {
      const cops = [...this.players.values()].some((p) => p.inRound && p.role === 'cop');
      this.endRound(cops ? 'cops' : 'none', cops ? 'Tous les fuyards sont tombés : victoire des flics !' : 'Tous les fuyards sont tombés.');
    }
  }

  endRound(winner, text) {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    const now = this.now();
    const rows = [];
    for (const p of this.players.values()) {
      if (!p.inRound) continue;
      if (p.role === 'fugitive' && p.alive && winner === 'fugitives') p.score += 3000; // survivant
      if (p.role === 'fugitive') p.stats.surv = Math.max(p.stats.surv, (p.alive ? now : p.deadAt) - this.round.startAt);
      const sc = Math.floor(p.score);
      rows.push({ id: p.id, n: p.name, role: p.role, kind: p.kind, col: p.color, sc, alive: p.alive, ...p.stats, surv: Math.round(p.stats.surv) });
      const b = this.bests.get(p.key);
      if (!b || sc > b.score) this.bests.set(p.key, { name: p.name, score: sc });
    }
    rows.sort((a, b) => b.sc - a.sc);
    let top = null;
    for (const b of this.bests.values()) if (!top || b.score > top.score) top = b;
    this.phase = 'results';
    this.phaseEnd = now + RESULTS_TIME;
    this.lastResults = { t: 'results', winner, text, rows, top, until: this.phaseEnd };
    this.broadcast(this.lastResults);
    this.spikes.clear();
    log.ok(`Fin de la manche ${this.round.id} : ${text}`);
    this.lobbyDirty = true;
  }

  toLobby() {
    this.phase = 'lobby';
    this.phaseEnd = 0;
    this.round = null;
    for (const p of this.players.values()) { p.inRound = false; p.alive = false; p.role = 'spectator'; p.st = null; p.bots = []; }
    this.broadcast({ t: 'tolobby' });
    this.lobbyDirty = true;
  }

  eliminate(p, why, by = null) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.deadAt = this.now();
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

  onState(p, bytes) {
    if (!p.inRound) return;
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
    // police IA du fuyard (affichée chez les autres)
    if (p.role === 'fugitive' && p.alive && this.round?.bots !== 'off') {
      p.bots = bots.slice(0, MAX_BOTS_PER_PLAYER).filter((b) => b.kind >= 1 && b.kind <= 3 && b.id < 32 && hyp(b.x, b.z, me.x, me.z) < 1300);
      p.botsT = now;
    } else p.bots = [];
  }

  // ------------------------------------------------------------------ chocs, dégâts

  onHit(p, m) {
    if (!p.inRound || !p.alive || this.phase !== 'playing' || !p.hitBucket.take()) return;
    const imp = num(m.i, 0, 150);
    if (imp === null) return;
    const kind = ['p', 'b', 'w', 'x', 'l'].includes(m.k) ? m.k : 'w';
    const cap = (k) => (k === 'x' ? 25 : k === 'l' ? Math.max(0, imp - 11) * 2.4 + 1 : impactDamage(imp) * 2.6 + 1);
    const self = Math.min(num(m.d, 0, 400) ?? 0, cap(kind));
    if (kind === 'p') {
      const o = this.players.get(m.o);
      if (!o || !o.inRound || !o.alive || o === p) return;
      // les deux voitures doivent être proches (avec de la marge pour la latence)
      if (!p.st || !o.st || hyp(p.st.x, p.st.z, o.st.x, o.st.z) > 18) return;
      const other = Math.min(num(m.od, 0, 400) ?? 0, cap('p'));
      // le même choc est signalé par les deux joueurs : on garde le plus fort, sans le compter deux fois
      const now = this.now();
      const key = p.id < o.id ? `${p.id}:${o.id}` : `${o.id}:${p.id}`;
      let ev = this.pairEv?.get(key);
      if (!this.pairEv) this.pairEv = new Map();
      if (!ev || now - ev.t > 0.5) { ev = { t: now, d: { [p.id]: 0, [o.id]: 0 } }; this.pairEv.set(key, ev); }
      const addP = Math.max(0, self - ev.d[p.id]), addO = Math.max(0, other - ev.d[o.id]);
      ev.d[p.id] += addP; ev.d[o.id] += addO;
      this.hurt(p, addP, o);
      this.hurt(o, addO, p);
      return;
    }
    this.hurt(p, self, null, kind === 'b' ? 'bots' : 'wrecked');
  }

  hurt(p, dmg, by = null, why = 'wrecked') {
    if (!p.alive || dmg <= 0.01) return;
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

  onRepair(p, m) {
    if (!p.inRound || !p.alive || this.phase !== 'playing') return;
    const R = REPAIR[m.r];
    if (!R) return;
    const now = this.now();
    if (now - (p.rep[m.r] ?? -99) < R.cd) return this.send(p.conn, { t: 'hp', hp: p.hp });
    p.rep[m.r] = now;
    const a = Math.min(num(m.a, 0, 100) ?? 0, R.max);
    p.hp = Math.min(p.maxHp, p.hp + a);
    if (m.r === 'deliver') p.stats.heists++;
    this.send(p.conn, { t: 'hp', hp: p.hp });
  }

  // ------------------------------------------------------------------ score (fuyards)

  onScore(p, m) {
    if (!p.inRound || p.role !== 'fugitive' || !p.alive || this.phase !== 'playing' || !p.scBucket.take()) return;
    const label = cleanText(m.l || '', 40);
    const base = num(m.b, 0, 1e6), mult = num(m.m, 0, 12);
    if (base === null || mult === null) return;
    const capKey = Object.keys(CAPS).find((k) => label.startsWith(k));
    const cap = capKey ? CAPS[capKey] : 1500;
    const stars = p.st ? Math.min(6, p.st.extra) : 0;
    const okMult = MULTS.some((x) => Math.abs(mult - x) < 1e-6 || Math.abs(mult - 2 * x) < 1e-6) && mult <= 2 * MULTS[Math.max(0, stars - 1)] + 1e-6;
    p.score += Math.round(Math.min(base, cap) * (okMult ? mult : 1));
    this.lobbyDirty = true;
  }

  // points de survie / de poursuite, envoyés en cumul toutes les ~2 s
  onPassive(p, m) {
    if (!p.inRound || p.role !== 'fugitive' || !p.alive || this.phase !== 'playing') return;
    const now = this.now();
    const dt = Math.min(10, now - p.ppT);
    p.ppT = now;
    const v = num(m.v, 0, 1e5) ?? 0;
    p.score += Math.min(v, 12 * 6 * 2 * dt * 1.15 + 5);
  }

  // ------------------------------------------------------------------ téléportations autorisées

  onTeleport(p, m) {
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
      ok = fugs.every((f) => hyp(f.st.x, f.st.z, x, z) > 180);
      if (ok) {
        p.alive = true;
        p.hp = p.maxHp;
        p.respawnOk = false;
        p.bust = 0;
        this.broadcast({ t: 'alive', id: p.id, hp: p.hp });
        this.lobbyDirty = true;
      }
    }
    if (!ok) return this.send(p.conn, { t: 'tpno', r: m.r });
    p.tpAllow = { reason: m.r, until: Math.max(p.tpAllow?.until ?? 0, now + 2.5) };
    this.send(p.conn, { t: 'tpok', r: m.r, x, z });
  }

  // ------------------------------------------------------------------ herses (flics joueurs)

  onSpike(p, m) {
    if (!p.inRound || p.role !== 'cop' || !p.alive || this.phase !== 'playing' || !p.spk || p.spk.n <= 0) return;
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

  onSpikeHit(p, m) {
    const s = this.spikes.get(m.sid);
    if (!s || !p.inRound || p.role !== 'fugitive' || !p.alive || !p.st || hyp(p.st.x, p.st.z, s.x, s.z) > 22) return;
    this.spikes.delete(s.sid);
    this.broadcast({ t: 'spikedel', sid: s.sid, by: p.id });
    const o = this.players.get(s.owner);
    if (o && o.inRound) { o.score += 400; o.stats.spikes++; this.sys(`${p.name} roule sur la herse de ${o.name} !`); }
    this.lobbyDirty = true;
  }

  onBustedByBots(p) {
    if (!p.inRound || p.role !== 'fugitive' || !p.alive || this.phase !== 'playing' || this.round?.bots === 'off') return;
    this.eliminate(p, 'busted', null);
  }

  // ------------------------------------------------------------------ boucle

  tick() {
    const now = this.now();
    const dt = 1 / TICK_HZ;
    if (this.phase === 'countdown' && now >= this.phaseEnd) {
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

  tickRound(now, dt) {
    const ps = [...this.players.values()].filter((p) => p.inRound);
    const cops = ps.filter((p) => p.role === 'cop' && p.alive && p.st && now - p.stT < 2);
    for (const p of ps) {
      if (p.role === 'fugitive' && p.alive && p.st) {
        // arrestation par un flic joueur : fuyard (presque) arrêté, flic au contact
        const sp = Math.hypot(p.st.vx, p.st.vz);
        let near = null;
        if (sp < 2.2) for (const c of cops) if (hyp(c.st.x, c.st.z, p.st.x, p.st.z) < 7.5 && Math.hypot(c.st.vx, c.st.vz) < 6) { near = c; break; }
        p.bust = near ? p.bust + dt / 3.2 : Math.max(0, p.bust - dt * 0.9);
        if (Math.abs(p.bust - p.bustSent) > 0.04 || (p.bust === 0 && p.bustSent > 0)) { p.bustSent = p.bust; this.send(p.conn, { t: 'bust', p: Math.min(1, p.bust) }); }
        if (p.bust >= 1) this.eliminate(p, 'busted', near);
      }
      if (p.role === 'cop') {
        if (!p.alive && !p.respawnOk && p.respawnAt && now >= p.respawnAt) {
          p.respawnOk = true;
          const fugs = ps.filter((f) => f.role === 'fugitive' && f.alive && f.st);
          const f = fugs[Math.floor(Math.random() * fugs.length)];
          this.send(p.conn, { t: 'respawn', near: f ? { x: f.st.x, z: f.st.z } : null });
        }
        if (p.spk && p.spk.next && now >= p.spk.next) {
          p.spk.n = Math.min(SPIKES[this.round.spikes].max, p.spk.n + 1);
          p.spk.next = p.spk.n < SPIKES[this.round.spikes].max ? now + this.round.spikeRecharge : 0;
          this.send(p.conn, { t: 'spk', n: p.spk.n, next: p.spk.next ? p.spk.next - now : 0 });
        }
      }
    }
    if (this.round.endAt && now >= this.round.endAt) {
      const alive = ps.filter((p) => p.role === 'fugitive' && p.alive);
      this.endRound(alive.length ? 'fugitives' : 'cops', alive.length ? `Temps écoulé : ${alive.map((p) => p.name).join(', ')} ${alive.length > 1 ? 'ont' : 'a'} tenu jusqu'au bout !` : 'Temps écoulé.');
    }
    if (this.pairEv) for (const [k, ev] of this.pairEv) if (now - ev.t > 2) this.pairEv.delete(k);
  }

  snapshot(now) {
    const ents = [];
    for (const p of this.players.values()) {
      if (!p.inRound || !p.st) continue;
      // épave d'un fuyard : visible 25 s, puis disparaît
      if (!p.alive && p.role === 'fugitive' && now - p.deadAt > 25) continue;
      const s = p.st;
      ents.push({
        ...s, id: p.id, kind: KIND[p.kind], hp: Math.round(p.hp),
        flags: (s.flags & ~F.destroyed) | (p.alive ? 0 : F.destroyed), owner: 0,
      });
      if (p.alive && p.bots.length && now - p.botsT < 1.5) for (const b of p.bots) ents.push({ ...b, id: botId(p.id, b.id), owner: p.id });
    }
    for (const r of this.players.values()) {
      const view = r.st && r.alive ? r.st : r.view || r.st;
      const list = [];
      const bots = [];
      for (const e of ents) {
        if (e.id === r.id || e.owner === r.id) continue;
        if (e.owner) {
          const d = view ? hyp(e.x, e.z, view.x, view.z) : 0;
          if (d < AOI) bots.push([d, e]);
        } else list.push(e);
      }
      bots.sort((a, b) => a[0] - b[0]);
      for (const [, e] of bots.slice(0, 48)) list.push(e);
      this.sendBin(r.conn, encodeEntities(MSG_SNAPSHOT, now, list));
    }
  }

  // ------------------------------------------------------------------ infos (page /info, console)

  info() {
    return {
      name: this.cfg.name, motd: this.cfg.motd, players: this.players.size, max: this.cfg.maxPlayers,
      password: !!this.cfg.password, approval: this.cfg.joinApproval, protocol: PROTOCOL, phase: this.phase,
      preset: PRESETS[this.settings.preset].label,
    };
  }
}

function clientIp(req) {
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

export { KIND_NAME };
