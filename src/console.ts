// Console de l'hôte : commandes tapées dans le terminal du serveur
import readline from 'node:readline';
import { PRESETS } from './protocol.ts';
import { log } from './log.ts';
import type { GameServer } from './server.ts';

export interface ConsoleExtra { banner: () => void; shutdown: () => void; save: () => void; update: () => void }

const HELP = `
Commandes (l'administration se fait ici, dans le panneau web, ou en jeu par les admins Discord) :
  joueurs                  liste des joueurs connectés
  lancer / stop            lancer / arrêter une manche
  preset <nom>             ${Object.keys(PRESETS).join(', ')}
  set <réglage> <valeur>   bots (off|normal|renforce), herses (off|rare|normal|beaucoup),
                           flics (nombre, preset perso), temps (minutes, 0 = illimité),
                           meteo (dynamic|clear|rain|fog|storm), heure (day|sunset|night),
                           circulation (off|light|normal|dense), police (client|server),
                           renfort (on|off : un fuyard éliminé peut rejoindre la police),
                           groscoups (on|off : braquages communs à tous les fuyards)
  kick <joueur> [raison]   expulser          ban <joueur> [raison]   bannir
  bans / unban <n°|nom>    liste / retirer un bannissement
  muet <joueur>            empêcher / autoriser d'écrire dans le chat
  role <joueur> <rôle>     forcer : any, fugitive, cop, spectate
  admin <joueur>           donner / retirer les commandes en jeu (compte Discord connecté)
  admins                   liste des admins ; admin+ <id Discord> / admin- <id Discord>
  dire <message>           message dans le chat
  accepter <n°> / refuser <n°>   demandes d'entrée (si l'approbation est activée)
  approbation on|off       demander l'accord de l'hôte pour chaque arrivée
  motdepasse <mdp|off>     changer le mot de passe du serveur
  stats                    processeur, mémoire, réseau, voitures (moyennes 1 min et 1 h)
  panneau [mdp]            afficher / changer le mot de passe du panneau web (/admin)
  infos                    adresse et réglages
  maj                      ouvrir la page de téléchargement de la dernière version
  quitter                  arrêter le serveur
`;

const SET_KEYS: Record<string, string> = {
  bots: 'bots', herses: 'spikes', flics: 'cops', temps: 'timeLimit', meteo: 'weather', heure: 'tod',
  circulation: 'traffic', police: 'policeSim', renfort: 'deadToCop', groscoups: 'bigHeists',
};

export function startConsole(srv: GameServer, extra: ConsoleExtra): void {
  if (!process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  log.setHook((line) => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(line);
    rl.prompt(true);
  });
  rl.prompt();
  rl.on('line', (line) => {
    try { run(srv, line.trim(), extra); } catch (e) { log.error((e as Error).message); }
    rl.prompt();
  });
  rl.on('close', () => extra.shutdown());
}

function run(srv: GameServer, line: string, extra: ConsoleExtra): void {
  if (!line) return;
  const [cmd, a1, ...rest] = line.split(/\s+/);
  const restTxt = [a1, ...rest].filter(Boolean).join(' ');
  const who = () => { const p = srv.findPlayer(a1); if (!p) log.warn('Joueur introuvable'); return p; };
  const act = (a: string, o: Record<string, unknown> = {}) => { const e = srv.hostAction(a, o, 'l\'hôte'); if (e) log.warn(e); return !e; };
  switch (cmd.toLowerCase()) {
    case 'aide': case 'help': case '?': log.out(HELP); break;
    case 'joueurs': case 'list': {
      const ps = [...srv.players.values()];
      if (!ps.length) log.info('Personne pour l\'instant.');
      for (const p of ps) log.out(`  ${String(p.id).padStart(3)}  ${p.name.padEnd(16)} ${p.discord ? 'Discord ' : 'invité  '}${p.admin ? 'admin ' : '      '} ${p.inRound ? `${p.role}${p.alive ? '' : ' (hors jeu)'}` : 'salon'}  ${Math.round(p.ping)} ms  ${p.ip}`);
      break;
    }
    case 'lancer': case 'start': act('start'); break;
    case 'stop': act('stop'); break;
    case 'preset':
      if (!a1 || !Object.hasOwn(PRESETS, a1)) { log.warn(`Préréglages : ${Object.keys(PRESETS).join(', ')}`); break; }
      act('set', { s: { preset: a1 } }); break;
    case 'set': {
      const key = SET_KEYS[a1 ?? ''];
      if (!key) { log.warn(`Réglages : ${Object.keys(SET_KEYS).join(', ')}`); break; }
      let v: unknown = rest[0];
      if (key === 'timeLimit') v = Number(v) * 60;
      if (key === 'cops') { act('set', { s: { preset: 'perso' } }); v = Number(v); }
      if (act('set', { s: { [key]: v } })) log.info(JSON.stringify(srv.settings));
      break;
    }
    case 'kick': { const p = who(); if (p) act('kick', { id: p.id, why: rest.join(' ') }); break; }
    case 'ban': { const p = who(); if (p) act('ban', { id: p.id, why: rest.join(' ') }); break; }
    case 'bans':
      srv.bans.list.forEach((b, i) => log.out(`  ${i + 1}. ${b.name} ${b.discord ? `(Discord ${b.discord})` : ''} ${b.reason ? `— ${b.reason}` : ''} ${b.at.slice(0, 10)}`));
      if (!srv.bans.list.length) log.info('Aucun banni.');
      break;
    case 'unban': log.info(`${srv.bans.remove(a1 ?? '')} bannissement(s) retiré(s)`); break;
    case 'muet': case 'mute': { const p = who(); if (p && act('mute', { id: p.id })) log.info(`${p.name} ${p.smuted ? 'muet' : 'peut écrire'}`); break; }
    case 'role': { const p = who(); if (p) act('force', { id: p.id, pref: rest[0] }); break; }
    case 'admin': { const p = who(); if (p) act('admin', { id: p.id }); break; }
    case 'admin+': act('adminId', { discord: a1, on: true }); break;
    case 'admin-': act('adminId', { discord: a1, on: false }); break;
    case 'admins': {
      if (!srv.cfg.admins.length) { log.info('Aucun admin (tape « admin <joueur> » pour un joueur connecté avec Discord).'); break; }
      for (const id of srv.cfg.admins) {
        const p = [...srv.players.values()].find((q) => q.discord?.id === id);
        log.out(`  ${id}${p ? `  ${p.name} (connecté)` : ''}`);
      }
      break;
    }
    case 'dire': case 'say': if (restTxt) act('say', { text: restTxt }); break;
    case 'accepter': case 'accept': if (!srv.resolveRequest(Number(a1), true)) log.warn('Demande introuvable'); break;
    case 'refuser': case 'deny': if (!srv.resolveRequest(Number(a1), false)) log.warn('Demande introuvable'); break;
    case 'approbation':
      act('approval', { on: a1 === 'on' });
      log.info(`Approbation des arrivées : ${srv.cfg.joinApproval ? 'activée' : 'désactivée'}`);
      break;
    case 'motdepasse': case 'password':
      srv.cfg.password = !a1 || a1 === 'off' ? '' : restTxt;
      extra.save();
      log.info(srv.cfg.password ? 'Mot de passe changé.' : 'Serveur sans mot de passe.');
      break;
    case 'infos': case 'info': extra.banner(); break;
    case 'maj': case 'update': extra.update(); break;
    case 'stats': {
      const m = srv.metrics;
      const n = m?.last(), avg1 = m?.avg(60), avg60 = m?.avg(3600);
      if (!m || !n || !avg1 || !avg60) { log.info('Mesures disponibles dans une seconde.'); break; }
      const sim = srv.sim ? srv.sim.stats() : null;
      log.out(`  Processeur  : ${n.cpu} % d'un cœur (moy. 1 min ${avg1.cpu} %, 1 h ${avg60.cpu} %)`);
      log.out(`  Mémoire     : ${n.rss} Mo (données JS ${n.heap} Mo)`);
      log.out(`  Calcul      : simulation ${n.sim} ms · boucle ${n.tick} ms · latence ${n.lag} ms (max ${n.lagMax} ms)`);
      log.out(`  Réseau      : ${n.out} Ko/s envoyés, ${n.in} Ko/s reçus (moy. 1 min ${avg1.out} / ${avg1.in})`);
      log.out(`  Voitures    : ${n.traffic} civiles, ${n.police} police IA · ${n.players} joueur(s)${sim ? ` · moteur ${sim.vehicles} voitures` : ' · moteur absent'}`);
      log.out(`  En ligne    : ${Math.floor(m.uptime() / 60)} min`);
      break;
    }
    case 'panneau': case 'panel':
      if (a1) { srv.cfg.panelPassword = restTxt; extra.save(); log.info('Mot de passe du panneau changé (les sessions ouvertes restent valides 12 h).'); }
      else log.plain(`  Panneau : http://localhost:${srv.cfg.port}/admin — mot de passe : ${srv.cfg.panelPassword}`);
      break;
    case 'quitter': case 'exit': case 'quit': extra.shutdown(); break;
    default: log.warn('Commande inconnue (tape « aide »)');
  }
}
