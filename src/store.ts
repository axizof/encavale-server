// Fichiers du serveur à côté de l'exécutable : config.json (réglages) et bans.json (bannis).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { log } from './log.ts';
import type { Settings } from './settings.ts';
import type { DiscordIdentity } from './identity.ts';

export interface Config {
  name: string;
  port: number;
  password: string;
  maxPlayers: number;
  joinApproval: boolean;
  motd: string;
  publicHost: string[];
  panelPassword: string;
  panelRemote: boolean;
  admins: string[]; // identifiants Discord des admins en jeu
  salt: string;
  settings: Partial<Settings> | null;
  ticketPublicKey?: string;
}

const DEFAULTS = {
  name: 'Serveur En Cavale',
  port: 7777,
  password: '',
  maxPlayers: 12,
  joinApproval: false,
  motd: 'Bienvenue ! Tape /aide dans le chat.',
  publicHost: [] as string[],
  panelRemote: false,
  admins: [] as string[],
  settings: null,
};

const COMMENT = {
  _aide: [
    'name : nom du serveur affiché aux joueurs',
    'port : port TCP (ouvrir / rediriger ce port sur la box ou le VPS)',
    'password : mot de passe pour rejoindre (vide = serveur ouvert)',
    'maxPlayers : 2 à 20',
    'joinApproval : true = chaque arrivée doit être acceptée par l\'hôte ou un admin',
    'panelPassword : mot de passe du panneau admin web (http://localhost:port/admin)',
    'panelRemote : false = panneau utilisable seulement depuis le PC du serveur ; true = aussi depuis le réseau (mot de passe en clair en http)',
    'admins : identifiants Discord des joueurs qui ont les commandes en jeu (commande « admin <joueur> » ou panneau web)',
    'publicHost : adresses par lesquelles les joueurs te rejoignent (ex. "mon-serveur.fr:7777"), seulement si tu es derrière un proxy',
  ],
};

/** Identifiant Discord : 17 à 20 chiffres en pratique (on accepte 5 à 25 comme le ticket) */
export const DISCORD_ID_RE = /^\d{5,25}$/;

export function loadConfig(file: string): Config {
  let raw: Record<string, unknown> = {};
  const created = !fs.existsSync(file);
  if (!created) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { log.error(`config.json illisible (${(e as Error).message}) : valeurs par défaut utilisées`); }
  }
  delete raw._aide;
  delete raw.adminCode; // ancienne version : plus de code admin en jeu
  const merged = { ...DEFAULTS, ...raw } as Record<string, unknown>;
  const cfg: Config = {
    name: String(merged.name || DEFAULTS.name).slice(0, 40),
    port: Math.max(1, Math.min(65535, Math.floor(Number(merged.port) || 7777))),
    password: typeof merged.password === 'string' ? merged.password : '',
    maxPlayers: Math.max(2, Math.min(20, Math.floor(Number(merged.maxPlayers) || 12))),
    joinApproval: merged.joinApproval === true,
    motd: String(merged.motd || '').slice(0, 200),
    publicHost: Array.isArray(merged.publicHost) ? merged.publicHost.map(String) : merged.publicHost ? [String(merged.publicHost)] : [],
    // panneau admin web
    panelPassword: typeof merged.panelPassword === 'string' && merged.panelPassword ? merged.panelPassword : crypto.randomBytes(9).toString('base64url'),
    panelRemote: merged.panelRemote === true,
    admins: Array.isArray(merged.admins) ? [...new Set(merged.admins.map(String).filter((s) => DISCORD_ID_RE.test(s)))] : [],
    // sert à anonymiser l'identité des joueurs
    salt: typeof merged.salt === 'string' && merged.salt ? merged.salt : crypto.randomBytes(12).toString('hex'),
    settings: merged.settings && typeof merged.settings === 'object' ? merged.settings as Partial<Settings> : null,
  };
  if (typeof merged.ticketPublicKey === 'string' && merged.ticketPublicKey) cfg.ticketPublicKey = merged.ticketPublicKey;
  saveConfig(file, cfg);
  if (created) log.info(`config.json créé (${file}) : modifie-le puis relance le serveur si besoin.`);
  return cfg;
}

export function saveConfig(file: string, cfg: Config): void {
  const out = { ...COMMENT, ...cfg };
  try { fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n'); } catch (e) { log.error(`impossible d'écrire ${file} : ${(e as Error).message}`); }
}

export interface Ban { name: string; discord: string | null; cid: string | null; fp: string | null; ip: string | null; reason: string; at: string }
export interface Identity { name: string; discord: DiscordIdentity | null; cid: string | null; fp: string | null; ip: string | null }

/** Bannissements : par compte Discord, identifiant de navigateur, empreinte et/ou adresse IP. */
export class Bans {
  file: string;
  list: Ban[];
  constructor(file: string) {
    this.file = file;
    this.list = [];
    try { if (fs.existsSync(file)) this.list = JSON.parse(fs.readFileSync(file, 'utf8')).bans || []; } catch { this.list = []; }
  }

  save(): void {
    try { fs.writeFileSync(this.file, JSON.stringify({ bans: this.list }, null, 2) + '\n'); } catch (e) { log.error(`bans.json : ${(e as Error).message}`); }
  }

  add(p: Identity, reason = ''): void {
    this.list.push({ name: p.name, discord: p.discord?.id || null, cid: p.cid || null, fp: p.fp || null, ip: p.ip || null, reason: String(reason).slice(0, 120), at: new Date().toISOString() });
    this.save();
  }

  match(p: Identity): Ban | null {
    return this.list.find((b) => (b.discord && p.discord && b.discord === p.discord.id) || (b.cid && b.cid === p.cid) || (b.fp && b.fp === p.fp) || (b.ip && b.ip === p.ip)) || null;
  }

  /** retire par pseudo ou numéro dans la liste ; retourne le nombre retiré */
  remove(key: string): number {
    const n = this.list.length;
    if (/^\d+$/.test(key) && this.list[+key - 1]) this.list.splice(+key - 1, 1);
    else this.list = this.list.filter((b) => b.name.toLowerCase() !== String(key).toLowerCase());
    this.save();
    return n - this.list.length;
  }
}
