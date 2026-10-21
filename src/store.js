// Fichiers du serveur à côté de l'exécutable : config.json (réglages) et bans.json (bannis).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from './log.js';

const DEFAULTS = {
  name: 'Serveur En Cavale',
  port: 7777,
  password: '',
  maxPlayers: 12,
  adminCode: '',
  joinApproval: false,
  motd: 'Bienvenue ! Tape /aide dans le chat.',
  publicHost: [],
  settings: null,
};

const COMMENT = {
  _aide: [
    'name : nom du serveur affiché aux joueurs',
    'port : port TCP (ouvrir / rediriger ce port sur la box ou le VPS)',
    'password : mot de passe pour rejoindre (vide = serveur ouvert)',
    'maxPlayers : 2 à 20',
    'adminCode : code admin ; dans le jeu, tape /admin CODE dans le chat (ou mets-le en rejoignant)',
    'joinApproval : true = chaque arrivée doit être acceptée par un admin (notification)',
    'panelPassword : mot de passe du panneau admin web (http://IP:port/admin)',
    'publicHost : adresses par lesquelles les joueurs te rejoignent (ex. "mon-serveur.fr:7777"), seulement si tu es derrière un proxy',
  ],
};

export function loadConfig(file, overrides = {}) {
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { log.error(`config.json illisible (${e.message}) : valeurs par défaut utilisées`); }
  }
  const created = !fs.existsSync(file);
  cfg = { ...DEFAULTS, ...cfg };
  if (!cfg.adminCode) cfg.adminCode = crypto.randomBytes(4).toString('hex');
  if (!cfg.salt) cfg.salt = crypto.randomBytes(12).toString('hex'); // sert à anonymiser l'identité des joueurs
  if (!cfg.panelPassword) cfg.panelPassword = crypto.randomBytes(9).toString('base64url'); // panneau admin web
  cfg.maxPlayers = Math.max(2, Math.min(20, Math.floor(Number(cfg.maxPlayers) || 12)));
  cfg.port = Math.max(1, Math.min(65535, Math.floor(Number(cfg.port) || 7777)));
  cfg.name = String(cfg.name || DEFAULTS.name).slice(0, 40);
  cfg.motd = String(cfg.motd || '').slice(0, 200);
  if (!Array.isArray(cfg.publicHost)) cfg.publicHost = cfg.publicHost ? [String(cfg.publicHost)] : [];
  Object.assign(cfg, overrides);
  saveConfig(file, cfg);
  if (created) log.info(`config.json créé (${file}) : modifie-le puis relance le serveur si besoin.`);
  return cfg;
}

export function saveConfig(file, cfg) {
  const out = { ...COMMENT, ...cfg };
  try { fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n'); } catch (e) { log.error(`impossible d'écrire ${file} : ${e.message}`); }
}

/** Bannissements : par compte Discord, identifiant de navigateur, empreinte et/ou adresse IP. */
export class Bans {
  constructor(file) {
    this.file = file;
    this.list = [];
    try { if (fs.existsSync(file)) this.list = JSON.parse(fs.readFileSync(file, 'utf8')).bans || []; } catch { this.list = []; }
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify({ bans: this.list }, null, 2) + '\n'); } catch (e) { log.error(`bans.json : ${e.message}`); }
  }

  /** p : { name, discord?, cid, fp, ip } */
  add(p, reason = '') {
    this.list.push({ name: p.name, discord: p.discord?.id || null, cid: p.cid || null, fp: p.fp || null, ip: p.ip || null, reason: String(reason).slice(0, 120), at: new Date().toISOString() });
    this.save();
  }

  match(p) {
    return this.list.find((b) => (b.discord && p.discord && b.discord === p.discord.id) || (b.cid && b.cid === p.cid) || (b.fp && b.fp === p.fp) || (b.ip && b.ip === p.ip)) || null;
  }

  /** retire par pseudo ou numéro dans la liste ; retourne le nombre retiré */
  remove(key) {
    const n = this.list.length;
    if (/^\d+$/.test(key) && this.list[+key - 1]) this.list.splice(+key - 1, 1);
    else this.list = this.list.filter((b) => b.name.toLowerCase() !== String(key).toLowerCase());
    this.save();
    return n - this.list.length;
  }
}
