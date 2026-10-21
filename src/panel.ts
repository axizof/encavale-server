// Panneau admin web : http://localhost:port/admin (mot de passe « panelPassword » de config.json).
// C'est le poste de commande de l'hôte (avec le terminal) : réglages de la partie, lancement des
// manches, demandes d'entrée, joueurs, accès (mot de passe, admins Discord, bannis), statistiques, journal.
// Par défaut, il ne répond qu'au PC du serveur (panelRemote: true pour l'ouvrir au réseau).
// Session par cookie HttpOnly (SameSite=Strict), essais de mot de passe limités.
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { log } from './log.ts';
import { PRESETS, copCountFor, allowedCopCars } from './protocol.ts';
import { PAGE } from './panel-page.ts';
import type { GameServer } from './server.ts';
import type { Metrics } from './metrics.ts';
import type { PanelHandler } from './http.ts';

const LOCAL = new Set(['127.0.0.1', '::1', 'localhost']);

const COOKIE = 'cv_panel';
const SESSION_TTL = 12 * 3600 * 1000;

export function makePanel(srv: GameServer, metrics: Metrics, opts: { version: string; protocol: number; port: number }): PanelHandler {
  const sessions = new Map<string, number>(); // jeton -> expiration
  const fails = new Map<string, { n: number; until: number }>(); // ip -> essais ratés
  const hash = (s: unknown) => crypto.createHash('sha256').update(String(s)).digest();
  const tokenOf = (req: IncomingMessage) => /(?:^|;\s*)cv_panel=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1] ?? null;

  const authed = (req: IncomingMessage): boolean => {
    const tok = tokenOf(req);
    if (!tok) return false;
    const exp = sessions.get(tok);
    if (!exp || exp < Date.now()) { sessions.delete(tok); return false; }
    return true;
  };

  const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((res) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 4096) req.destroy(); });
    req.on('end', () => { try { const o = JSON.parse(s || '{}'); res(o && typeof o === 'object' ? o : {}); } catch { res({}); } });
    req.on('error', () => res({}));
  });

  const json = (res: ServerResponse, code: number, obj: unknown, extra: Record<string, string> = {}): void => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(JSON.stringify(obj));
  };

  const ipOf = (req: IncomingMessage) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

  // résumé de la répartition avec les joueurs actuels (comme dans le salon du jeu)
  const summary = () => {
    const S = srv.settings;
    const playing = [...srv.players.values()].filter((p) => p.pref !== 'spectate').length;
    const cops = copCountFor(S.cops, playing);
    const cars = S.copCars === 'auto' ? allowedCopCars(cops, Math.max(1, playing - cops)) : S.copCars;
    return { playing, cops, fugitives: Math.max(0, playing - cops), cars };
  };

  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/admin')) return false;
    if (!srv.cfg.panelRemote && !LOCAL.has(ipOf(req))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Panneau admin accessible seulement depuis le PC du serveur (http://localhost:port/admin).\nPour l\'ouvrir au réseau : "panelRemote": true dans config.json.');
      return true;
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: https://cdn.discordapp.com; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
      });
      res.end(PAGE);
      return true;
    }
    // les requêtes qui modifient quelque chose doivent venir du panneau (en-tête maison : pas de formulaire piégé)
    const post = req.method === 'POST';
    if (post && req.headers['x-panel'] !== '1') { json(res, 403, { error: 'requête refusée' }); return true; }
    const ip = ipOf(req);
    switch (url.pathname) {
      case '/admin/api/state': json(res, 200, { auth: authed(req), name: srv.cfg.name }); return true;
      case '/admin/api/login': {
        if (!post) break;
        const f = fails.get(ip) || { n: 0, until: 0 };
        if (f.until > Date.now()) { json(res, 429, { error: `Trop d'essais : réessaie dans ${Math.ceil((f.until - Date.now()) / 60000)} min` }); return true; }
        const body = await readBody(req);
        if (!crypto.timingSafeEqual(hash(body.password || ''), hash(srv.cfg.panelPassword))) {
          f.n++;
          if (f.n >= 5) { f.until = Date.now() + 5 * 60000; f.n = 0; log.warn(`Panneau admin : trop d'essais depuis ${ip}, bloqué 5 min`); }
          fails.set(ip, f);
          json(res, 401, { error: 'Mot de passe incorrect' });
          return true;
        }
        fails.delete(ip);
        const tok = crypto.randomBytes(32).toString('hex');
        sessions.set(tok, Date.now() + SESSION_TTL);
        log.info(`Panneau admin : connexion depuis ${ip}`);
        json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${tok}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${SESSION_TTL / 1000}` });
        return true;
      }
      case '/admin/api/logout': {
        const tok = tokenOf(req);
        if (tok) sessions.delete(tok);
        json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0` });
        return true;
      }
    }
    if (!authed(req)) { json(res, 401, { error: 'connexion requise' }); return true; }
    switch (url.pathname) {
      case '/admin/api/stats': {
        const r = url.searchParams.get('range');
        const range = r === '1h' || r === '24h' ? r : '5m';
        const sim = srv.sim ? { ok: true, buildMs: srv.sim.buildMs, ...srv.sim.stats(), active: srv.sim.active } : { ok: false };
        json(res, 200, {
          now: metrics.last(), avg: metrics.avg(60), history: metrics.history(range), range,
          server: {
            name: srv.cfg.name, version: opts.version, protocol: opts.protocol, uptime: metrics.uptime(), players: srv.players.size, max: srv.cfg.maxPlayers,
            phase: srv.phase, preset: srv.settings.preset, policeSim: srv.settings.policeSim, traffic: srv.settings.traffic, sim,
            password: !!srv.cfg.password, approval: srv.cfg.joinApproval, pending: srv.pending.size, port: opts.port,
          },
        });
        return true;
      }
      case '/admin/api/players':
        json(res, 200, [...srv.players.values()].map((p) => ({
          id: p.id, name: p.name, discord: !!p.discord, admin: p.admin, av: p.discord?.avatar ? `https://cdn.discordapp.com/avatars/${p.discord.id}/${p.discord.avatar}.png?size=64` : null,
          role: p.inRound ? p.role : 'salon', alive: p.inRound ? p.alive : null, pref: p.pref, col: p.color,
          ping: Math.round(p.ping || 0), ip: p.ip, score: Math.floor(p.score || 0), muted: p.smuted,
          hp: p.inRound ? Math.round(p.hp) : null, max: p.inRound ? p.maxHp : null,
        })));
        return true;
      case '/admin/api/game':
        json(res, 200, {
          phase: srv.phase, phaseEnd: srv.phaseEnd, now: srv.now(), startAt: srv.round?.startAt ?? 0, endAt: srv.round?.endAt ?? 0,
          settings: srv.settings, presets: PRESETS, pending: srv.pendingList(), sim: !!srv.sim, players: srv.players.size, summary: summary(),
        });
        return true;
      case '/admin/api/access':
        json(res, 200, {
          password: !!srv.cfg.password, approval: srv.cfg.joinApproval, remote: srv.cfg.panelRemote,
          admins: srv.cfg.admins.map((id) => {
            const p = [...srv.players.values()].find((q) => q.discord?.id === id);
            return { id, name: p?.name ?? null, online: !!p };
          }),
          bans: srv.bans.list.map((b, i) => ({ n: i + 1, name: b.name, discord: !!b.discord, reason: b.reason, at: b.at.slice(0, 10) })),
        });
        return true;
      case '/admin/api/log': json(res, 200, log.recent().slice(-150)); return true;
      case '/admin/api/action': {
        if (!post) break;
        const b = await readBody(req);
        const err = srv.hostAction(String(b.a || ''), b, 'l\'hôte');
        if (err) json(res, 400, { error: err }); else json(res, 200, { ok: true });
        return true;
      }
    }
    json(res, 404, { error: 'introuvable' });
    return true;
  };
}
