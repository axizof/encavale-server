// Panneau admin web : http://localhost:port/admin (mot de passe « panelPassword » de config.json).
// C'est le poste de commande de l'hôte (avec le terminal) : réglages de la partie, lancement des
// manches, demandes d'entrée, joueurs (rôle, chat, expulsion, bannissement), statistiques et journal.
// Par défaut, il ne répond qu'au PC du serveur (panelRemote: true pour l'ouvrir au réseau).
// Session par cookie HttpOnly (SameSite=Strict), essais de mot de passe limités.
import crypto from 'node:crypto';
import { log } from './log.js';
import { PRESETS } from './protocol.js';

const LOCAL = new Set(['127.0.0.1', '::1', 'localhost']);

const COOKIE = 'cv_panel';
const SESSION_TTL = 12 * 3600 * 1000;

export function makePanel(srv, metrics, opts) {
  const sessions = new Map(); // jeton -> expiration
  const fails = new Map(); // ip -> { n, until }
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

  const authed = (req) => {
    const m = /(?:^|;\s*)cv_panel=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (!m) return false;
    const exp = sessions.get(m[1]);
    if (!exp || exp < Date.now()) { sessions.delete(m[1]); return false; }
    return true;
  };

  const readBody = (req) => new Promise((res) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 4096) req.destroy(); });
    req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } });
    req.on('error', () => res({}));
  });

  const json = (res, code, obj, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(JSON.stringify(obj));
  };

  const ipOf = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

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
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
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
        const m = /(?:^|;\s*)cv_panel=([a-f0-9]{64})/.exec(req.headers.cookie || '');
        if (m) sessions.delete(m[1]);
        json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0` });
        return true;
      }
    }
    if (!authed(req)) { json(res, 401, { error: 'connexion requise' }); return true; }
    switch (url.pathname) {
      case '/admin/api/stats': {
        const range = ['5m', '1h', '24h'].includes(url.searchParams.get('range')) ? url.searchParams.get('range') : '5m';
        const sim = srv.sim ? { ok: true, buildMs: srv.sim.buildMs, ...srv.sim.stats(), active: srv.sim.active } : { ok: false };
        json(res, 200, {
          now: metrics.last(), avg: metrics.avg(60), history: metrics.history(range), range,
          server: {
            name: srv.cfg.name, version: opts.version, protocol: opts.protocol, uptime: metrics.uptime(), players: srv.players.size, max: srv.cfg.maxPlayers,
            phase: srv.phase, preset: srv.settings.preset, policeSim: srv.settings.policeSim, traffic: srv.settings.traffic, sim,
            password: !!srv.cfg.password, approval: srv.cfg.joinApproval, pending: srv.pending.size,
          },
        });
        return true;
      }
      case '/admin/api/players':
        json(res, 200, [...srv.players.values()].map((p) => ({
          id: p.id, name: p.name, discord: !!p.discord, role: p.inRound ? p.role : 'salon', alive: p.inRound ? p.alive : null, pref: p.pref,
          ping: Math.round(p.ping || 0), ip: p.ip, score: Math.floor(p.score || 0), muted: p.smuted,
        })));
        return true;
      case '/admin/api/game':
        json(res, 200, { phase: srv.phase, settings: srv.settings, presets: PRESETS, pending: srv.pendingList(), sim: !!srv.sim, players: srv.players.size });
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

const PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panneau admin — En Cavale</title>
<style>
:root { --bg:#0b0d12; --panel:#141821; --line:rgba(255,255,255,.1); --text:#eef1f6; --muted:rgba(238,241,246,.55); --red:#ff2d3a; --blue:#3d7bff; --green:#3ee58a; --gold:#ffd23f; --cyan:#29d4ff; }
* { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif }
header { display:flex; justify-content:space-between; align-items:center; padding:14px 22px; border-bottom:1px solid var(--line); background:#0f1219; position:sticky; top:0; z-index:2 }
h1 { font-size:20px; margin:0; letter-spacing:.5px } h1 small { color:var(--muted); font-weight:500; margin-left:8px; font-size:14px }
button { background:#232937; color:var(--text); border:1px solid var(--line); padding:7px 12px; border-radius:6px; cursor:pointer; font:inherit }
button:hover { background:#2d3546 } button.red { border-color:rgba(255,45,58,.6) } button.on { background:var(--blue); border-color:var(--blue) }
main { padding:18px 22px; display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)) }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px }
.card h2 { font-size:13px; letter-spacing:2px; color:var(--muted); margin:0 0 6px; font-weight:600; text-transform:uppercase }
.big { font-size:28px; font-weight:700 } .big small { font-size:14px; color:var(--muted); font-weight:500 }
canvas { width:100%; height:110px; display:block; margin-top:8px }
.wide { grid-column:1/-1 } table { width:100%; border-collapse:collapse } td,th { text-align:left; padding:6px 8px; border-top:1px solid var(--line); font-size:14px } th { color:var(--muted); font-weight:600; font-size:12px; border-top:0 }
.tag { font-size:11px; padding:1px 6px; border-radius:4px; background:#2a3142; margin-left:6px } .tag.r { background:rgba(255,45,58,.3) } .tag.b { background:rgba(61,123,255,.35) }
#log { height:240px; overflow:auto; font:12px/1.45 ui-monospace,Menlo,Consolas,monospace; color:#cfd6e2; background:#0b0e14; padding:8px; border-radius:6px; white-space:pre-wrap }
.row { display:flex; gap:8px; flex-wrap:wrap; align-items:center } input { background:#0e1118; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:8px 10px; font:inherit }
#login { max-width:360px; margin:12vh auto; } #login input { width:100%; margin:10px 0 }
.muted { color:var(--muted) } .err { color:#ff8a8a; min-height:20px }
.lg { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--muted); margin-top:6px } .lg i { display:inline-block; width:10px; height:3px; margin-right:5px; vertical-align:middle; border-radius:2px }
.sets { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; align-items:center; margin-top:12px; font-size:14px } .sets > div:nth-child(odd) { color:var(--muted); font-size:12px; letter-spacing:1px; text-transform:uppercase }
button.go { background:#1f7a46; border-color:#2ea866 } button.sm { padding:4px 9px; font-size:13px } select { background:#0e1118; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:4px 6px; font:inherit; font-size:13px }
#presets button small { display:block; color:var(--muted); font-size:12px } #presets button { text-align:left }
.kv { display:grid; grid-template-columns:auto 1fr; gap:3px 14px; font-size:14px } .kv div:nth-child(odd) { color:var(--muted) }
</style></head><body>
<div id="login" class="card" hidden>
  <h1>Panneau admin</h1><p class="muted" id="lname"></p>
  <input id="pw" type="password" placeholder="Mot de passe du panneau" autocomplete="current-password">
  <button id="go" style="width:100%">Se connecter</button>
  <p class="err" id="lerr"></p>
  <p class="muted" style="font-size:13px">Le mot de passe est « panelPassword » dans config.json (il s'affiche aussi au démarrage du serveur).</p>
</div>
<div id="app" hidden>
<header><h1 id="title">Serveur<small id="sub"></small></h1>
  <div class="row"><span class="muted">Historique</span><button data-r="5m" class="on">5 min</button><button data-r="1h">1 h</button><button data-r="24h">24 h</button><button id="out">Déconnexion</button></div></header>
<main>
  <div class="card"><h2>Processeur</h2><div class="big" id="cpu">–</div><canvas id="c-cpu"></canvas></div>
  <div class="card"><h2>Mémoire</h2><div class="big" id="mem">–</div><canvas id="c-mem"></canvas><div class="lg"><span><i style="background:#29d4ff"></i>totale</span><span><i style="background:#3d7bff"></i>données JS</span></div></div>
  <div class="card"><h2>Temps de calcul</h2><div class="big" id="tick">–</div><canvas id="c-tick"></canvas><div class="lg"><span><i style="background:#ffd23f"></i>simulation (par pas)</span><span><i style="background:#3ee58a"></i>boucle réseau</span><span><i style="background:#ff8a3d"></i>latence</span></div></div>
  <div class="card"><h2>Réseau</h2><div class="big" id="net">–</div><canvas id="c-net"></canvas><div class="lg"><span><i style="background:#3ee58a"></i>envoyé</span><span><i style="background:#3d7bff"></i>reçu</span></div></div>
  <div class="card"><h2>Joueurs et voitures</h2><div class="big" id="cars">–</div><canvas id="c-cars"></canvas><div class="lg"><span><i style="background:#b0b4b8"></i>voitures civiles</span><span><i style="background:#ff2d3a"></i>police IA</span></div></div>
  <div class="card"><h2>Serveur</h2><div class="kv" id="info"></div></div>
  <div class="card wide"><h2>Partie <span id="phase" class="tag"></span></h2>
    <div id="presets" class="row"></div>
    <div id="sets" class="sets"></div>
    <div class="row" style="margin-top:12px"><button id="start" class="go">Lancer la manche</button><button id="stop" class="red">Arrêter la manche</button><span id="gerr" class="err"></span></div></div>
  <div class="card wide" id="pendCard" hidden><h2>Demandes d'entrée</h2><div id="pend"></div></div>
  <div class="card wide"><h2>Joueurs</h2><table id="pl"></table>
    <div class="row" style="margin-top:10px"><input id="say" placeholder="Annonce dans le chat" maxlength="160" style="flex:1"><button id="sayb">Envoyer</button></div></div>
  <div class="card wide"><h2>Journal</h2><div id="log"></div></div>
</main></div>
<script>
const $ = (id) => document.getElementById(id);
const api = async (path, body) => {
  const r = await fetch('/admin/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify(body) } : {});
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { show(false); throw new Error('auth'); }
  if (!r.ok) throw new Error(d.error || ('erreur ' + r.status));
  return d;
};
let range = '5m', timer = null;
function show(on) { $('login').hidden = on; $('app').hidden = !on; clearInterval(timer); if (on) { refresh(); timer = setInterval(refresh, 2000); } else $('pw').focus(); }
async function login() { $('lerr').textContent = ''; try { await api('login', { password: $('pw').value }); $('pw').value = ''; show(true); } catch (e) { $('lerr').textContent = e.message; } }
$('go').onclick = login; $('pw').onkeydown = (e) => { if (e.key === 'Enter') login(); };
$('out').onclick = async () => { await api('logout', {}).catch(() => {}); show(false); };
document.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { range = b.dataset.r; document.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); refresh(); });
$('sayb').onclick = async () => { const t = $('say').value.trim(); if (!t) return; await api('action', { a: 'say', text: t }).catch(alert); $('say').value = ''; };
const act = (o) => api('action', o).then(() => { $('gerr').textContent = ''; refreshGame(); refresh(); }).catch((e) => { $('gerr').textContent = e.message; });
$('start').onclick = () => act({ a: 'start' });
$('stop').onclick = () => { if (confirm('Arrêter la manche en cours ?')) act({ a: 'stop' }); };
const SETS = [
  ['bots', 'Police IA', [['off', 'Aucune'], ['normal', 'Normale'], ['renforce', 'Renforcée']]],
  ['policeSim', 'Police IA calculée par', [['client', 'le joueur poursuivi (réactive)'], ['server', 'le serveur (anti-triche)']], 'sim'],
  ['traffic', 'Circulation', [['off', 'Aucune'], ['light', 'Légère'], ['normal', 'Normale'], ['dense', 'Dense']], 'sim'],
  ['spikes', 'Herses (flics)', [['off', 'Aucune'], ['rare', 'Rares'], ['normal', 'Normales'], ['beaucoup', 'Beaucoup']]],
  ['deadToCop', 'Fuyard éliminé', [[false, 'devient spectateur'], [true, 'peut rejoindre la police']]],
  ['timeLimit', 'Durée', [[0, 'Illimitée'], [300, '5 min'], [600, '10 min'], [900, '15 min'], [1200, '20 min']]],
  ['weather', 'Météo', [['dynamic', 'Variable'], ['clear', 'Beau'], ['rain', 'Pluie'], ['fog', 'Brouillard'], ['storm', 'Orage']]],
  ['tod', 'Heure', [['day', 'Jour'], ['sunset', 'Coucher'], ['night', 'Nuit']]],
];
let gameKey = '';
async function refreshGame() {
  const g = await api('game');
  const key = JSON.stringify([g.phase, g.settings, g.pending]);
  if (key === gameKey) return;
  gameKey = key;
  const S = g.settings, lock = g.phase === 'playing' || g.phase === 'countdown';
  $('phase').textContent = { lobby: 'au salon', countdown: 'départ', playing: 'manche en cours', results: 'résultats' }[g.phase];
  $('start').disabled = lock; $('stop').disabled = !lock;
  const pr = $('presets'); pr.innerHTML = '';
  for (const [k, v] of Object.entries(g.presets)) {
    const b = document.createElement('button'); b.className = S.preset === k ? 'on' : ''; b.disabled = lock;
    b.append(v.label); const sm = document.createElement('small'); sm.textContent = v.desc; b.append(sm);
    b.onclick = () => act({ a: 'set', s: { preset: k } }); pr.append(b);
  }
  const box = $('sets'); box.innerHTML = '';
  const row = (label, opts, cur, onSel) => {
    const l = document.createElement('div'); l.textContent = label;
    const r = document.createElement('div'); r.className = 'row';
    for (const [v, t] of opts) { const b = document.createElement('button'); b.className = 'sm' + (cur === v ? ' on' : ''); b.textContent = t; b.disabled = lock; b.onclick = () => onSel(v); r.append(b); }
    box.append(l, r);
  };
  if (S.preset === 'perso') row('Flics joueurs', [0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => [n, String(n)]), S.cops, (v) => act({ a: 'set', s: { cops: v } }));
  for (const [k, label, opts, need] of SETS) { if (need === 'sim' && !g.sim) continue; row(label, opts, S[k], (v) => act({ a: 'set', s: { [k]: v } })); }
  // demandes d'entrée
  $('pendCard').hidden = !g.pending.length;
  const pd = $('pend'); pd.innerHTML = '';
  for (const r of g.pending) {
    const d = document.createElement('div'); d.className = 'row'; d.style.marginBottom = '6px';
    const t = document.createElement('span'); t.textContent = r.name + (r.discord ? ' (Discord)' : '') + ' — ' + r.ip; t.style.flex = '1';
    const y = document.createElement('button'); y.className = 'go sm'; y.textContent = 'Accepter'; y.onclick = () => act({ a: 'approve', req: r.req, ok: true });
    const n = document.createElement('button'); n.className = 'red sm'; n.textContent = 'Refuser'; n.onclick = () => act({ a: 'approve', req: r.req, ok: false });
    d.append(t, y, n); pd.append(d);
  }
}
const fmtDur = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' h ' + m + ' min' : m + ' min ' + (s % 60) + ' s'; };
function chart(id, series, opts = {}) {
  const c = $(id), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  let max = opts.max || 0; for (const s of series) for (const v of s.data) max = Math.max(max, v);
  max = max * 1.15 || 1;
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = h * i / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.fillStyle = 'rgba(238,241,246,.45)'; g.font = '11px system-ui'; g.fillText(Math.round(max * 10) / 10 + (opts.unit || ''), 4, 12);
  for (const s of series) {
    const n = s.data.length; if (n < 2) continue;
    g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
    s.data.forEach((v, i) => { const x = i / (n - 1) * w, y = h - (v / max) * (h - 4) - 2; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    if (s.fill) { g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fillStyle = s.fill; g.fill(); }
  }
}
async function refresh() {
  try {
    const [st, pl, lg] = await Promise.all([api('stats?range=' + range), api('players'), api('log')]);
    const n = st.now || {}, a = st.avg || {}, H = st.history, S = st.server;
    $('title').firstChild.textContent = S.name;
    $('sub').textContent = ' v' + S.version + ' · en ligne depuis ' + fmtDur(S.uptime);
    $('cpu').innerHTML = (n.cpu ?? 0) + ' % <small>d’un cœur · moy. 1 min ' + (a.cpu ?? 0) + ' %</small>';
    $('mem').innerHTML = (n.rss ?? 0) + ' Mo <small>dont ' + (n.heap ?? 0) + ' Mo de données JS</small>';
    $('tick').innerHTML = (n.sim ?? 0) + ' ms <small>simulation · boucle ' + (n.tick ?? 0) + ' ms · latence ' + (n.lag ?? 0) + ' ms</small>';
    $('net').innerHTML = (n.out ?? 0) + ' Ko/s <small>envoyés · ' + (n.in ?? 0) + ' Ko/s reçus</small>';
    $('cars').innerHTML = (n.players ?? 0) + ' <small>joueurs · ' + (n.traffic ?? 0) + ' civils · ' + (n.police ?? 0) + ' police IA</small>';
    chart('c-cpu', [{ data: H.map((x) => x.cpu), color: '#ff2d3a', fill: 'rgba(255,45,58,.12)' }], { unit: ' %', max: 5 });
    chart('c-mem', [{ data: H.map((x) => x.rss), color: '#29d4ff', fill: 'rgba(41,212,255,.1)' }, { data: H.map((x) => x.heap), color: '#3d7bff' }], { unit: ' Mo' });
    chart('c-tick', [{ data: H.map((x) => x.sim), color: '#ffd23f' }, { data: H.map((x) => x.tick), color: '#3ee58a' }, { data: H.map((x) => x.lag), color: '#ff8a3d' }], { unit: ' ms', max: 2 });
    chart('c-net', [{ data: H.map((x) => x.out), color: '#3ee58a', fill: 'rgba(62,229,138,.1)' }, { data: H.map((x) => x.in), color: '#3d7bff' }], { unit: ' Ko/s', max: 5 });
    chart('c-cars', [{ data: H.map((x) => x.traffic), color: '#b0b4b8' }, { data: H.map((x) => x.police), color: '#ff2d3a' }], { max: 5 });
    const sim = S.sim.ok ? ('prête (carte en ' + S.sim.buildMs + ' ms) · ' + S.sim.vehicles + ' voitures') : 'absente';
    $('info').innerHTML = '';
    for (const [k, v] of [['Phase', { lobby: 'salon', countdown: 'départ', playing: 'manche en cours', results: 'résultats' }[S.phase]], ['Joueurs', S.players + ' / ' + S.max], ['Préréglage', S.preset], ['Police IA', S.policeSim === 'server' ? 'calculée par le serveur' : 'calculée par les joueurs'], ['Circulation', S.traffic], ['Simulation', sim], ['Mot de passe', S.password ? 'oui' : 'non'], ['Accord de l’hôte', S.approval ? 'oui' + (S.pending ? ' (' + S.pending + ' en attente)' : '') : 'non']]) {
      const a1 = document.createElement('div'); a1.textContent = k; const b1 = document.createElement('div'); b1.textContent = v; $('info').append(a1, b1);
    }
    refreshGame().catch(() => {});
    const t = $('pl'); t.innerHTML = '<tr><th>Joueur</th><th>Rôle</th><th>Souhait</th><th>Score</th><th>Ping</th><th>IP</th><th></th></tr>';
    for (const p of pl) {
      const tr = document.createElement('tr');
      const td = (x) => { const c = document.createElement('td'); if (x instanceof Node) c.append(x); else c.textContent = x; return c; };
      const nm = document.createElement('span'); nm.textContent = p.name;
      if (p.discord) { const s = document.createElement('span'); s.className = 'tag b'; s.textContent = 'Discord'; nm.append(s); }
      const acts = document.createElement('div'); acts.className = 'row';
      const btn = (txt, a, cls) => { const b = document.createElement('button'); b.textContent = txt; b.className = 'sm ' + (cls || ''); b.onclick = () => { if (a !== 'mute' && !confirm(txt + ' ' + p.name + ' ?')) return; act({ a, id: p.id }); }; acts.append(b); };
      btn(p.muted ? 'Autoriser le chat' : 'Couper le chat', 'mute'); btn('Expulser', 'kick', 'red'); btn('Bannir', 'ban', 'red');
      const sel = document.createElement('select');
      for (const [v, l] of [['any', 'peu importe'], ['fugitive', 'fuyard'], ['cop', 'flic'], ['spectate', 'spectateur']]) { const o = document.createElement('option'); o.value = v; o.textContent = l; o.selected = p.pref === v; sel.append(o); }
      sel.onchange = () => act({ a: 'force', id: p.id, pref: sel.value });
      const roles = { fugitive: 'fuyard', cop: 'flic', spectator: 'spectateur', salon: 'au salon' };
      tr.append(td(nm), td((roles[p.role] || p.role) + (p.alive === false ? ' (hors jeu)' : '')), td(sel), td(String(p.score)), td(p.ping + ' ms'), td(p.ip), td(acts));
      t.append(tr);
    }
    const L = $('log'), atBottom = L.scrollTop + L.clientHeight >= L.scrollHeight - 20;
    L.textContent = lg.join('\\n');
    if (atBottom) L.scrollTop = L.scrollHeight;
  } catch (e) { if (e.message !== 'auth') console.warn(e); }
}
api('state').then((s) => { $('lname').textContent = s.name; show(s.auth); }).catch(() => show(false));
</script></body></html>`;
