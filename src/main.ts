#!/usr/bin/env node
// En Cavale — serveur multijoueur
//   encavale-server [--port 7777] [--config chemin/config.json]
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { loadConfig, saveConfig, Bans } from './store.ts';
import { GameServer } from './server.ts';
import { loadFiles, makeHandler } from './http.ts';
import { startConsole } from './console.ts';
import { PROTOCOL } from './protocol.ts';
import { log } from './log.ts';
import { Metrics } from './metrics.ts';
import { makePanel } from './panel.ts';
import pkg from '../package.json' with { type: 'json' };

export const VERSION = pkg.version;

// les fichiers (config.json, bans.json) vivent à côté de l'exécutable ; avec node, dans le dossier courant
const exe = path.basename(process.execPath).toLowerCase();
const compiled = !/^(node|bun)(\.exe)?$/.test(exe);
const dataDir = compiled ? path.dirname(process.execPath) : process.cwd();

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const cfgFile = path.resolve(arg('config') || path.join(dataDir, 'config.json'));
const cfg = loadConfig(cfgFile);
const port = Number(arg('port')) || cfg.port;
const save = () => saveConfig(cfgFile, cfg);

const bans = new Bans(path.join(path.dirname(cfgFile), 'bans.json'));
const srv = new GameServer(cfg, { bans, saveConfig: save });
const { files, source } = await loadFiles(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public'));

// moteur de simulation (circulation partagée, police IA calculée par le serveur)
let simInfo = 'absent (circulation propre à chaque joueur)';
try {
  const { ServerSim } = await import('../sim/sim.js');
  const sim = await ServerSim.create();
  srv.attachSim(sim);
  simInfo = `prêt (carte construite en ${sim.buildMs} ms)`;
} catch (e) {
  simInfo = `absent (${(e as Error).message.slice(0, 80)}) : circulation propre à chaque joueur`;
}

const metrics = new Metrics(srv);
srv.metrics = metrics;
const panel = makePanel(srv, metrics, { version: VERSION, protocol: PROTOCOL, port });
const httpServer = http.createServer(makeHandler(files, srv, panel));
const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });
wss.on('connection', (ws, req) => srv.onConnection(ws, req));
wss.on('error', () => {}); // déjà signalé par le serveur http (port occupé…)

function banner(): void {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
  log.plain('');
  log.plain(log.bold(`  EN CAVALE — serveur multijoueur v${VERSION} (protocole ${PROTOCOL})`));
  log.plain(`  Nom          : ${cfg.name}`);
  log.plain(`  Sur ce PC    : ${log.cyan(`http://localhost:${port}`)}`);
  for (const ip of ips) log.plain(`  Réseau local : ${log.cyan(`http://${ip}:${port}`)}`);
  log.plain(`  Internet     : http://${log.yellow('TON-IP-PUBLIQUE')}:${port}  (ouvre/redirige le port ${port} TCP sur ta box ou ton VPS)`);
  log.plain(`  Mot de passe : ${cfg.password ? 'oui' : 'non'} · approbation des arrivées : ${cfg.joinApproval ? 'oui' : 'non'} · ${cfg.maxPlayers} joueurs max`);
  log.plain(`  Panneau web  : ${log.cyan(`http://localhost:${port}/admin`)}  mot de passe : ${log.yellow(cfg.panelPassword)}  ${log.dim(cfg.panelRemote ? '(accessible aussi depuis le réseau)' : '(seulement depuis ce PC)')}`);
  log.plain(`  Admins en jeu : ${cfg.admins.length ? `${cfg.admins.length} compte(s) Discord` : 'aucun'} ${log.dim('(« admin <joueur> » pour en désigner un)')}`);
  log.plain(`  Jeu servi    : ${files.has('/index.html') ? source : log.yellow('ABSENT (dossier public/ vide)')}`);
  log.plain(`  Simulation   : ${simInfo}`);
  log.plain(log.dim(`  Config       : ${cfgFile}`));
  log.plain(log.dim('  Tape « aide » pour la liste des commandes.'));
  log.plain('');
}

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  log.info('Arrêt du serveur…');
  srv.broadcast({ t: 'kick', why: 'le serveur s\'arrête' });
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

httpServer.on('error', (e: NodeJS.ErrnoException) => {
  log.error(e.code === 'EADDRINUSE' ? `Le port ${port} est déjà utilisé : choisis-en un autre (--port 7778 ou config.json).` : e.message);
  process.exit(1);
});
httpServer.listen(port, () => {
  banner();
  startConsole(srv, { banner, shutdown, save });
});
