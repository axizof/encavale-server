#!/usr/bin/env node
// En Cavale — serveur multijoueur
//   encavale-server [--port 7777] [--config chemin/config.json]
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { loadConfig, saveConfig, Bans } from './store.js';
import { GameServer } from './server.js';
import { loadFiles, makeHandler } from './http.js';
import { startConsole } from './console.js';
import { PROTOCOL } from './protocol.js';
import { log } from './log.js';
import pkg from '../package.json' with { type: 'json' };

export const VERSION = pkg.version;

// les fichiers (config.json, bans.json) vivent à côté de l'exécutable ; avec node, dans le dossier courant
const exe = path.basename(process.execPath).toLowerCase();
const compiled = !/^(node|bun)(\.exe)?$/.test(exe);
const dataDir = compiled ? path.dirname(process.execPath) : process.cwd();

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const cfgFile = path.resolve(arg('config') || path.join(dataDir, 'config.json'));
const cfg = loadConfig(cfgFile);
const port = Number(arg('port')) || cfg.port;
const save = () => saveConfig(cfgFile, cfg);

const bans = new Bans(path.join(path.dirname(cfgFile), 'bans.json'));
const srv = new GameServer(cfg, { bans, saveConfig: save });
const { files, source } = await loadFiles(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public'));

const httpServer = http.createServer(makeHandler(files, srv));
const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });
wss.on('connection', (ws, req) => srv.onConnection(ws, req));
wss.on('error', () => {}); // déjà signalé par le serveur http (port occupé…)

function banner() {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  log.out('');
  log.out(log.bold(`  EN CAVALE — serveur multijoueur v${VERSION} (protocole ${PROTOCOL})`));
  log.out(`  Nom          : ${cfg.name}`);
  log.out(`  Sur ce PC    : ${log.cyan(`http://localhost:${port}`)}`);
  for (const ip of ips) log.out(`  Réseau local : ${log.cyan(`http://${ip}:${port}`)}`);
  log.out(`  Internet     : http://${log.yellow('TON-IP-PUBLIQUE')}:${port}  (ouvre/redirige le port ${port} TCP sur ta box ou ton VPS)`);
  log.out(`  Mot de passe : ${cfg.password ? 'oui' : 'non'} · approbation des arrivées : ${cfg.joinApproval ? 'oui' : 'non'} · ${cfg.maxPlayers} joueurs max`);
  log.out(`  Code admin   : ${log.yellow(cfg.adminCode)}  (dans le jeu : /admin ${cfg.adminCode})`);
  log.out(`  Jeu servi    : ${files.has('/index.html') ? source : log.yellow('ABSENT (dossier public/ vide)')}`);
  log.out(log.dim(`  Config       : ${cfgFile}`));
  log.out(log.dim('  Tape « aide » pour la liste des commandes.'));
  log.out('');
}

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  log.info('Arrêt du serveur…');
  srv.broadcast({ t: 'kick', why: 'le serveur s\'arrête' });
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

httpServer.on('error', (e) => {
  log.error(e.code === 'EADDRINUSE' ? `Le port ${port} est déjà utilisé : choisis-en un autre (--port 7778 ou config.json).` : e.message);
  process.exit(1);
});
httpServer.listen(port, () => {
  banner();
  startConsole(srv, { banner, shutdown, save });
});
