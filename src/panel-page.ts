// Page du panneau admin (HTML, CSS et JS dans un seul fichier : rien à servir à part elle).
// Tout texte venu des joueurs est inséré avec textContent (jamais en HTML).
export const PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panneau admin — En Cavale</title>
<style>
:root { --bg:#0a0c11; --panel:#12161e; --panel2:#171c26; --line:rgba(255,255,255,.08); --line2:rgba(255,255,255,.14); --text:#eef1f6; --muted:rgba(238,241,246,.55); --dim:rgba(238,241,246,.35);
  --red:#ff3b47; --blue:#3d7bff; --green:#34d880; --gold:#ffd23f; --cyan:#29d4ff; --orange:#ff8a3d; }
* { box-sizing:border-box }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif }
button { background:#212837; color:var(--text); border:1px solid var(--line2); padding:7px 12px; border-radius:7px; cursor:pointer; font:inherit; white-space:nowrap }
button:hover:not(:disabled) { background:#2a3245 } button:disabled { opacity:.4; cursor:default }
button.sm { padding:4px 9px; font-size:12.5px; border-radius:6px }
button.red { border-color:rgba(255,59,71,.55); color:#ffb3b8 } button.red:hover:not(:disabled) { background:rgba(255,59,71,.18) }
button.green { background:#1c7a48; border-color:#2fb36b } button.green:hover:not(:disabled) { background:#22915a }
button.on { background:var(--blue); border-color:var(--blue); color:#fff }
button.big { padding:11px 20px; font-size:15px; font-weight:700; letter-spacing:.3px; border-radius:9px }
input, select { background:#0c0f15; color:var(--text); border:1px solid var(--line2); border-radius:7px; padding:7px 10px; font:inherit }
select.sm { padding:4px 6px; font-size:12.5px }
header { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px 22px; border-bottom:1px solid var(--line); background:#0d1016; position:sticky; top:0; z-index:5 }
.brand { font-weight:800; letter-spacing:2px; font-size:12px; color:var(--red) }
h1 { font-size:19px; margin:0; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap } h1 small { color:var(--muted); font-weight:500; font-size:13px }
main { padding:18px 22px 40px; display:flex; flex-direction:column; gap:16px; max-width:1500px; margin:0 auto }
.card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; min-width:0 }
.card > .hd { display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap }
.card > .hd h2 { font-size:12px; letter-spacing:2px; color:var(--muted); margin:0; font-weight:700; text-transform:uppercase }
.card > .hd .sp { flex:1 }
.row { display:flex; gap:8px; flex-wrap:wrap; align-items:center }
.muted { color:var(--muted) } .dim { color:var(--dim) } .err { color:#ff9aa0; min-height:18px; font-size:13px }
.chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:3px 10px; border-radius:99px; background:#232a39; color:var(--text) }
.chip.live { background:rgba(52,216,128,.16); color:var(--green) } .chip.live::before { content:''; width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 8px var(--green) }
.chip.warn { background:rgba(255,210,63,.14); color:var(--gold) }
.tag { font-size:10.5px; font-weight:700; letter-spacing:.6px; padding:1px 6px; border-radius:4px; background:#2a3142; color:var(--muted) }
.tag.b { background:rgba(88,101,242,.3); color:#c7ccff } .tag.a { background:rgba(255,210,63,.2); color:var(--gold) } .tag.m { background:rgba(255,59,71,.2); color:#ffb3b8 }
/* --- surveillance --- */
.stats { display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)) }
.stat .v { font-size:24px; font-weight:700 } .stat .v small { font-size:12.5px; color:var(--muted); font-weight:500 }
canvas { width:100%; height:84px; display:block; margin-top:6px }
.lg { display:flex; gap:10px; flex-wrap:wrap; font-size:11.5px; color:var(--muted); margin-top:4px } .lg i { display:inline-block; width:10px; height:3px; margin-right:5px; vertical-align:middle; border-radius:2px }
.kv { display:grid; grid-template-columns:auto 1fr; gap:3px 12px; font-size:13px } .kv div:nth-child(odd) { color:var(--muted) }
/* --- partie --- */
.cols { display:grid; gap:16px; grid-template-columns:minmax(0,1.45fr) minmax(0,1fr); align-items:start }
@media (max-width: 1050px) { .cols { grid-template-columns:1fr } }
.summary { background:var(--panel2); border:1px solid var(--line); border-radius:9px; padding:10px 12px; font-size:13.5px; margin-bottom:14px }
.summary b { color:var(--text) }
.presets { display:grid; gap:8px; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); margin-bottom:16px }
.presets button { text-align:left; padding:10px 12px; white-space:normal; display:flex; flex-direction:column; gap:2px; border-radius:9px; background:var(--panel2) }
.presets button b { font-size:14px } .presets button small { color:var(--muted); font-size:12px; line-height:1.3 }
.presets button.on { background:rgba(61,123,255,.18); border-color:var(--blue) } .presets button.on small { color:#c9d8ff }
.groups { display:grid; gap:14px; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)) }
.group h3 { margin:0 0 8px; font-size:11px; letter-spacing:1.6px; color:var(--dim); text-transform:uppercase }
.set { margin-bottom:10px } .set > div:first-child { font-size:12.5px; color:var(--muted); margin-bottom:4px }
.seg { display:inline-flex; flex-wrap:wrap; gap:0; border:1px solid var(--line2); border-radius:8px; overflow:hidden }
.seg button { border:0; border-radius:0; padding:5px 10px; font-size:12.5px; background:transparent; border-right:1px solid var(--line) }
.seg button:last-child { border-right:0 } .seg button.on { background:var(--blue) }
.lock { font-size:12.5px; color:var(--gold); margin:0 0 10px }
/* --- joueurs --- */
.pend { background:rgba(255,210,63,.08); border:1px solid rgba(255,210,63,.35); border-radius:9px; padding:8px 10px; margin-bottom:12px }
.pend .r { display:flex; align-items:center; gap:8px; padding:4px 0 } .pend .r span { flex:1 }
.pl { display:flex; flex-direction:column; gap:6px }
.p { display:grid; grid-template-columns:36px 1fr auto; gap:4px 10px; align-items:center; padding:8px 10px; border-radius:9px; background:var(--panel2); border:1px solid var(--line) }
.p .av { width:36px; height:36px; border-radius:50%; background:#2a3142; display:grid; place-items:center; font-weight:700; overflow:hidden; border:2px solid transparent; grid-row:span 2 }
.p .av img { width:100%; height:100% }
.p .nm { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-weight:600 }
.p .sub { font-size:12px; color:var(--muted) } .p .sc { text-align:right; font-weight:700 } .p .sc small { display:block; font-weight:500; color:var(--muted); font-size:11.5px }
.p .acts { grid-column:2 / -1; display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:4px }
.hp { display:inline-block; width:60px; height:5px; background:#2a3142; border-radius:3px; overflow:hidden; vertical-align:middle; margin-left:6px } .hp i { display:block; height:100%; background:var(--green) }
.empty { color:var(--dim); font-size:13px; padding:8px 2px }
/* --- accès, journal --- */
.acc { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)) }
.acc h3 { margin:0 0 6px; font-size:11px; letter-spacing:1.6px; color:var(--dim); text-transform:uppercase }
.li { display:flex; align-items:center; gap:8px; padding:5px 0; border-top:1px solid var(--line); font-size:13px } .li span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis }
.toggle { display:inline-flex; align-items:center; gap:8px; cursor:pointer } .toggle input { width:auto }
#log { height:260px; overflow:auto; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; color:#cfd6e2; background:#080a0e; padding:10px; border-radius:8px; white-space:pre-wrap; border:1px solid var(--line) }
#login { max-width:380px; margin:12vh auto } #login input { width:100%; margin:10px 0 }
.upd { background:rgba(255,138,61,.12); border:1px solid rgba(255,138,61,.55); color:#ffd2b3; border-radius:12px; padding:12px 16px; font-size:14px }
.upd b { color:#fff } .upd a { color:#ffb37a; font-weight:700 }
#toast { position:fixed; bottom:18px; left:50%; transform:translateX(-50%); background:#2a1218; border:1px solid rgba(255,59,71,.5); color:#ffd0d3; padding:9px 16px; border-radius:9px; font-size:13.5px; display:none; z-index:9 }
</style></head><body>
<div id="login" class="card" hidden>
  <div class="brand">EN CAVALE</div>
  <h1 style="margin:6px 0 2px">Panneau admin</h1><p class="muted" id="lname"></p>
  <input id="pw" type="password" placeholder="Mot de passe du panneau" autocomplete="current-password">
  <button id="go" class="green" style="width:100%">Se connecter</button>
  <p class="err" id="lerr"></p>
  <p class="muted" style="font-size:12.5px">Le mot de passe est « panelPassword » dans config.json (il s'affiche aussi au démarrage du serveur).</p>
</div>
<div id="app" hidden>
<header>
  <div><div class="brand">EN CAVALE · SERVEUR</div><h1 id="title">Serveur<small id="sub"></small></h1></div>
  <div class="row"><span id="hdrPhase" class="chip"></span><button id="out" class="sm">Déconnexion</button></div>
</header>
<main>
  <div id="upd" class="upd" hidden></div>
  <section class="card">
    <div class="hd"><h2>Surveillance</h2><span class="sp"></span><span class="muted" style="font-size:12.5px">Historique</span>
      <div class="seg"><button data-r="5m" class="on">5 min</button><button data-r="1h">1 h</button><button data-r="24h">24 h</button></div></div>
    <div class="stats">
      <div class="stat"><div class="muted">Processeur</div><div class="v" id="cpu">–</div><canvas id="c-cpu"></canvas></div>
      <div class="stat"><div class="muted">Mémoire</div><div class="v" id="mem">–</div><canvas id="c-mem"></canvas><div class="lg"><span><i style="background:#29d4ff"></i>totale</span><span><i style="background:#3d7bff"></i>données JS</span></div></div>
      <div class="stat"><div class="muted">Temps de calcul</div><div class="v" id="tick">–</div><canvas id="c-tick"></canvas><div class="lg"><span><i style="background:#ffd23f"></i>simulation</span><span><i style="background:#34d880"></i>boucle réseau</span><span><i style="background:#ff8a3d"></i>latence</span></div></div>
      <div class="stat"><div class="muted">Réseau</div><div class="v" id="net">–</div><canvas id="c-net"></canvas><div class="lg"><span><i style="background:#34d880"></i>envoyé</span><span><i style="background:#3d7bff"></i>reçu</span></div></div>
      <div class="stat"><div class="muted">Voitures</div><div class="v" id="cars">–</div><canvas id="c-cars"></canvas><div class="lg"><span><i style="background:#b0b4b8"></i>civiles</span><span><i style="background:#ff3b47"></i>police IA</span></div></div>
      <div class="stat"><div class="muted">Serveur</div><div class="kv" id="info" style="margin-top:6px"></div></div>
    </div>
  </section>
  <div class="cols">
    <section class="card" id="gameCard">
      <div class="hd"><h2>Partie</h2><span id="phase" class="chip"></span><span id="clock" class="muted"></span><span class="sp"></span>
        <button id="start" class="green big">▶ Lancer la manche</button><button id="stop" class="red big" hidden>■ Arrêter la manche</button></div>
      <div class="summary" id="summary"></div>
      <p class="lock" id="lock" hidden>Manche en cours : les réglages se changent au salon (arrête la manche ou attends la fin).</p>
      <div class="set"><div>Mode de jeu</div></div>
      <div class="presets" id="presets"></div>
      <div class="groups" id="groups"></div>
      <div class="err" id="gerr"></div>
    </section>
    <section class="card">
      <div class="hd"><h2>Joueurs</h2><span id="pcount" class="chip"></span></div>
      <div class="pend" id="pend" hidden></div>
      <div class="pl" id="pl"></div>
      <div class="row" style="margin-top:12px"><input id="say" placeholder="Annonce dans le chat (signée « Hôte »)" maxlength="160" style="flex:1;min-width:0"><button id="sayb">Envoyer</button></div>
    </section>
  </div>
  <div class="cols">
    <section class="card">
      <div class="hd"><h2>Accès</h2></div>
      <div class="acc">
        <div>
          <h3>Entrée sur le serveur</h3>
          <label class="toggle"><input type="checkbox" id="appr"> Accepter chaque arrivée à la main</label>
          <div class="row" style="margin-top:10px"><input id="spw" type="text" placeholder="Mot de passe du serveur" maxlength="64" style="flex:1;min-width:0"><button id="spwb" class="sm">Changer</button><button id="spwx" class="sm">Retirer</button></div>
          <div class="muted" id="spwState" style="font-size:12.5px;margin-top:4px"></div>
        </div>
        <div>
          <h3>Admins en jeu (comptes Discord)</h3>
          <div class="muted" style="font-size:12.5px;margin-bottom:6px">Ils ont les commandes dans le salon et en partie (lancer, arrêter, réglages, expulser…). Seulement des comptes Discord vérifiés : rien à deviner, pas de code.</div>
          <div id="admins"></div>
          <div class="row" style="margin-top:8px"><input id="aid" placeholder="Identifiant Discord (chiffres)" inputmode="numeric" style="flex:1;min-width:0"><button id="aidb" class="sm">Ajouter</button></div>
        </div>
        <div>
          <h3>Bannis</h3>
          <div id="bans"></div>
        </div>
      </div>
      <div class="err" id="aerr"></div>
    </section>
    <section class="card"><div class="hd"><h2>Journal</h2></div><div id="log"></div></section>
  </div>
</main></div>
<div id="toast"></div>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, cls, fn) => { const b = el('button', cls, text); b.onclick = fn; return b; };
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, 4000); };
const api = async (path, body) => {
  const r = await fetch('/admin/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify(body) } : {});
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { show(false); throw new Error('auth'); }
  if (!r.ok) throw new Error(d.error || ('erreur ' + r.status));
  return d;
};
const act = (o) => api('action', o).then(() => { refreshAll(); return true; }).catch((e) => { if (e.message !== 'auth') toast(e.message); return false; });
let range = '5m', timer = null, tick = 0;
function show(on) { $('login').hidden = on; $('app').hidden = !on; clearInterval(timer); if (on) { refreshAll(); timer = setInterval(() => { tick++; refreshAll(tick % 3 !== 0); }, 2000); } else $('pw').focus(); }
async function login() { $('lerr').textContent = ''; try { await api('login', { password: $('pw').value }); $('pw').value = ''; show(true); } catch (e) { $('lerr').textContent = e.message; } }
$('go').onclick = login; $('pw').onkeydown = (e) => { if (e.key === 'Enter') login(); };
$('out').onclick = async () => { await api('logout', {}).catch(() => {}); show(false); };
document.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { range = b.dataset.r; document.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); refreshStats(); });
const say = async () => { const t = $('say').value.trim(); if (!t) return; if (await act({ a: 'say', text: t })) $('say').value = ''; };
$('sayb').onclick = say; $('say').onkeydown = (e) => { if (e.key === 'Enter') say(); };
$('start').onclick = () => act({ a: 'start' });
$('stop').onclick = () => { if (confirm('Arrêter la manche en cours ? Tout le monde revient au salon.')) act({ a: 'stop' }); };
$('appr').onchange = () => act({ a: 'approval', on: $('appr').checked });
$('spwb').onclick = async () => { const v = $('spw').value.trim(); if (!v) return toast('Tape un mot de passe'); if (await act({ a: 'password', password: v })) $('spw').value = ''; };
$('spwx').onclick = () => { if (confirm('Retirer le mot de passe ? Tout le monde pourra entrer.')) act({ a: 'password', password: '' }); };
$('aidb').onclick = async () => { const v = $('aid').value.trim(); if (await act({ a: 'adminId', discord: v, on: true })) $('aid').value = ''; };

const PHASE = { lobby: 'Au salon', countdown: 'Départ…', playing: 'Manche en cours', results: 'Résultats' };
const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const GROUPS = [
  ['Police', [
    ['bots', 'Police IA', [['off', 'Aucune'], ['normal', 'Normale'], ['renforce', 'Renforcée']]],
    ['policeSim', 'Police IA calculée par', [['client', 'Le joueur poursuivi'], ['server', 'Le serveur']], 'sim'],
    ['spikes', 'Herses des flics joueurs', [['off', 'Aucune'], ['rare', 'Rares'], ['normal', 'Normales'], ['beaucoup', 'Beaucoup']]],
  ]],
  ['Règles', [
    ['timeLimit', 'Durée', [[0, 'Illimitée'], [300, '5 min'], [600, '10 min'], [900, '15 min'], [1200, '20 min']]],
    ['deadToCop', 'Fuyard éliminé', [[false, 'Spectateur'], [true, 'Peut devenir flic']]],
    ['bigHeists', 'Gros coups (communs)', [[true, 'Oui'], [false, 'Non']], 'sim'],
  ]],
  ['Ambiance', [
    ['weather', 'Météo', [['dynamic', 'Variable'], ['clear', 'Beau'], ['rain', 'Pluie'], ['fog', 'Brouillard'], ['storm', 'Orage']]],
    ['tod', 'Heure', [['day', 'Jour'], ['sunset', 'Coucher'], ['night', 'Nuit']]],
    ['traffic', 'Circulation', [['off', 'Aucune'], ['light', 'Légère'], ['normal', 'Normale'], ['dense', 'Dense']], 'sim'],
  ]],
];
const CARS = { interceptor: 'Intercepteur', police: 'Berline', suv: 'SUV' };
let gameKey = '', game = null;
function renderGame(g) {
  game = g;
  const S = g.settings, lock = g.phase === 'playing' || g.phase === 'countdown';
  $('phase').textContent = PHASE[g.phase]; $('phase').className = 'chip' + (lock ? ' live' : '');
  $('hdrPhase').textContent = PHASE[g.phase] + ' · ' + g.players + ' joueur' + (g.players > 1 ? 's' : ''); $('hdrPhase').className = 'chip' + (lock ? ' live' : '');
  $('start').hidden = lock; $('stop').hidden = !lock; $('lock').hidden = !lock;
  $('start').disabled = !g.summary.playing;
  const m = g.summary, sm = $('summary'); sm.replaceChildren();
  if (!m.playing) sm.append('Personne de prêt à jouer : il faut au moins un joueur qui ne soit pas spectateur.');
  else {
    sm.append('Avec ', el('b', null, m.playing + ' joueur' + (m.playing > 1 ? 's' : '')), ' : ', el('b', null, m.fugitives + ' fuyard' + (m.fugitives > 1 ? 's' : '')), ', ', el('b', null, m.cops + ' flic' + (m.cops > 1 ? 's' : '')));
    const bots = m.cops === 0 && S.bots === 'off' ? 'normal' : S.bots;
    sm.append(' · police IA ' + (bots === 'off' ? 'désactivée' : bots === 'renforce' ? 'renforcée' : 'normale') + ' · ' + (S.timeLimit ? (S.timeLimit / 60) + ' min' : 'sans limite de temps'));
    if (m.cops) sm.append(' · voitures de flic : ' + m.cars.map((c) => CARS[c]).join(', '));
  }
  const key = JSON.stringify([g.phase, S, g.sim]);
  if (key === gameKey) return;
  gameKey = key;
  const pr = $('presets');
  pr.replaceChildren(...Object.entries(g.presets).map(([k, v]) => {
    const b = el('button', S.preset === k ? 'on' : ''); b.disabled = lock;
    b.append(el('b', null, v.label), el('small', null, v.desc));
    b.onclick = () => act({ a: 'set', s: { preset: k } });
    return b;
  }));
  const box = $('groups'); box.replaceChildren();
  for (const [title, sets] of GROUPS) {
    const grp = el('div', 'group'); grp.append(el('h3', null, title));
    const rows = sets.filter(([, , , need]) => need !== 'sim' || g.sim);
    if (title === 'Police' && S.preset === 'perso') rows.unshift(['cops', 'Flics joueurs', [0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => [n, String(n)])]);
    for (const [k, label, opts] of rows) {
      const st = el('div', 'set'); st.append(el('div', null, label));
      const seg = el('div', 'seg');
      for (const [v, t] of opts) { const b = el('button', S[k] === v ? 'on' : '', t); b.disabled = lock; b.onclick = () => act({ a: 'set', s: { [k]: v } }); seg.append(b); }
      st.append(seg); grp.append(st);
    }
    box.append(grp);
  }
}
function clock() {
  const g = game; if (!g) return;
  const now = g.now + (Date.now() - g.at) / 1000;
  $('clock').textContent = g.phase === 'playing' ? (g.endAt ? 'reste ' + fmt(Math.max(0, g.endAt - now)) : 'depuis ' + fmt(Math.max(0, now - g.startAt))) : g.phase === 'countdown' ? 'départ dans ' + Math.max(0, Math.ceil(g.startAt - now)) + ' s' : g.phase === 'results' ? 'retour au salon dans ' + Math.max(0, Math.ceil(g.phaseEnd - now)) + ' s' : '';
}
setInterval(clock, 500);
let plKey = '';
function renderPlayers(pl, pending) {
  $('pcount').textContent = pl.length + ' connecté' + (pl.length > 1 ? 's' : '');
  const key = JSON.stringify([pl, pending]);
  if (key === plKey) return;
  plKey = key;
  const pd = $('pend'); pd.hidden = !pending.length; pd.replaceChildren();
  if (pending.length) pd.append(el('div', 'muted', 'Demandes d’entrée'));
  for (const r of pending) {
    const d = el('div', 'r'); d.append(el('span', null, r.name + (r.discord ? ' (Discord)' : ' (invité)') + ' — ' + r.ip));
    d.append(btn('Accepter', 'green sm', () => act({ a: 'approve', req: r.req, ok: true })), btn('Refuser', 'red sm', () => act({ a: 'approve', req: r.req, ok: false })));
    pd.append(d);
  }
  const box = $('pl'); box.replaceChildren();
  if (!pl.length) box.append(el('div', 'empty', 'Personne pour l’instant. Les joueurs rejoignent avec l’adresse du serveur (http://ton-ip:port).'));
  const ROLE = { fugitive: 'fuyard', cop: 'flic', spectator: 'spectateur', salon: 'au salon' };
  for (const p of pl) {
    const row = el('div', 'p');
    const av = el('div', 'av');
    if (p.av) { const i = el('img'); i.src = p.av; i.alt = ''; av.append(i); } else av.textContent = p.name.charAt(0).toUpperCase();
    av.style.borderColor = p.role === 'cop' ? '#3d7bff' : p.col != null ? '#' + p.col.toString(16).padStart(6, '0') : 'transparent';
    const nm = el('div', 'nm', p.name);
    if (p.discord) nm.append(el('span', 'tag b', 'DISCORD'));
    if (p.admin) nm.append(el('span', 'tag a', 'ADMIN'));
    if (p.muted) nm.append(el('span', 'tag m', 'MUET'));
    const sc = el('div', 'sc', p.score.toLocaleString('fr-FR')); sc.append(el('small', null, p.ping + ' ms'));
    const sub = el('div', 'sub', (ROLE[p.role] || p.role) + (p.alive === false ? (p.role === 'cop' ? ' · hors service' : ' · éliminé') : '') + ' · ' + p.ip);
    if (p.hp != null && p.alive) { const h = el('span', 'hp'); const i = el('i'); i.style.width = Math.round(100 * p.hp / p.max) + '%'; h.append(i); sub.append(h); }
    const acts = el('div', 'acts');
    const sel = el('select', 'sm'); sel.title = 'Rôle souhaité pour la prochaine manche';
    for (const [v, l] of [['any', 'Rôle : peu importe'], ['fugitive', 'Rôle : fuyard'], ['cop', 'Rôle : flic'], ['spectate', 'Spectateur']]) { const o = el('option', null, l); o.value = v; o.selected = p.pref === v; sel.append(o); }
    sel.onchange = () => act({ a: 'force', id: p.id, pref: sel.value });
    acts.append(sel);
    if (p.discord) acts.append(btn(p.admin ? '★ Retirer admin' : '☆ Admin', 'sm' + (p.admin ? ' on' : ''), () => act({ a: 'admin', id: p.id })));
    acts.append(btn(p.muted ? 'Rendre le chat' : 'Couper le chat', 'sm', () => act({ a: 'mute', id: p.id })));
    acts.append(btn('Expulser', 'red sm', () => { if (confirm('Expulser ' + p.name + ' ?')) act({ a: 'kick', id: p.id }); }));
    acts.append(btn('Bannir', 'red sm', () => { if (confirm('Bannir ' + p.name + ' ? (compte, navigateur et adresse)')) act({ a: 'ban', id: p.id }); }));
    row.append(av, nm, sc, sub, acts);
    box.append(row);
  }
}
let accKey = '';
function renderAccess(a) {
  const key = JSON.stringify(a);
  if (key === accKey) return;
  accKey = key;
  $('appr').checked = a.approval;
  $('spwState').textContent = a.password ? 'Serveur protégé par un mot de passe.' : 'Serveur ouvert (sans mot de passe).';
  $('spwx').disabled = !a.password;
  const ad = $('admins'); ad.replaceChildren();
  if (!a.admins.length) ad.append(el('div', 'empty', 'Aucun admin. Clique « ☆ Admin » sur un joueur connecté avec Discord.'));
  for (const x of a.admins) {
    const li = el('div', 'li'); li.append(el('span', null, (x.name ? x.name + ' · ' : '') + x.id + (x.online ? ' (connecté)' : '')));
    li.append(btn('Retirer', 'sm red', () => act({ a: 'adminId', discord: x.id, on: false })));
    ad.append(li);
  }
  const bn = $('bans'); bn.replaceChildren();
  if (!a.bans.length) bn.append(el('div', 'empty', 'Aucun banni.'));
  for (const b of a.bans) {
    const li = el('div', 'li'); li.append(el('span', null, b.name + (b.discord ? ' (Discord)' : '') + (b.reason ? ' — ' + b.reason : '') + ' · ' + b.at));
    li.append(btn('Débannir', 'sm', () => { if (confirm('Débannir ' + b.name + ' ?')) act({ a: 'unban', key: String(b.n) }); }));
    bn.append(li);
  }
}
const fmtDur = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' h ' + m + ' min' : m + ' min ' + (s % 60) + ' s'; };
function chart(id, series, opts = {}) {
  const c = $(id), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  let max = opts.max || 0; for (const s of series) for (const v of s.data) max = Math.max(max, v);
  max = max * 1.15 || 1;
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = h * i / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.fillStyle = 'rgba(238,241,246,.4)'; g.font = '10.5px system-ui'; g.fillText(Math.round(max * 10) / 10 + (opts.unit || ''), 4, 11);
  for (const s of series) {
    const n = s.data.length; if (n < 2) continue;
    g.strokeStyle = s.color; g.lineWidth = 1.5; g.beginPath();
    s.data.forEach((v, i) => { const x = i / (n - 1) * w, y = h - (v / max) * (h - 4) - 2; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    if (s.fill) { g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fillStyle = s.fill; g.fill(); }
  }
}
async function refreshStats() {
  const st = await api('stats?range=' + range);
  const n = st.now || {}, a = st.avg || {}, H = st.history, S = st.server;
  $('title').firstChild.textContent = S.name;
  $('sub').textContent = 'v' + S.version + ' · port ' + S.port + ' · en ligne depuis ' + fmtDur(S.uptime);
  const up = $('upd'); up.hidden = !S.update;
  if (S.update && up.dataset.v !== S.update.latest) {
    up.dataset.v = S.update.latest; up.replaceChildren();
    const a = el('a', null, 'Télécharger la v' + S.update.latest); a.href = S.update.url; a.target = '_blank'; a.rel = 'noopener';
    up.append(el('b', null, '⚠ Nouvelle version du serveur disponible. '), 'Ce serveur est en v' + S.version + '. Mets-le à jour pour éviter les problèmes (garde ton config.json) : ', a);
  }
  $('cpu').innerHTML = (n.cpu ?? 0) + ' % <small>d’un cœur · moy. ' + (a.cpu ?? 0) + ' %</small>';
  $('mem').innerHTML = (n.rss ?? 0) + ' Mo <small>dont ' + (n.heap ?? 0) + ' Mo JS</small>';
  $('tick').innerHTML = (n.sim ?? 0) + ' ms <small>simu · boucle ' + (n.tick ?? 0) + ' ms</small>';
  $('net').innerHTML = (n.out ?? 0) + ' Ko/s <small>envoyés · ' + (n.in ?? 0) + ' reçus</small>';
  $('cars').innerHTML = (n.traffic ?? 0) + (n.police ?? 0) + ' <small>' + (n.traffic ?? 0) + ' civiles · ' + (n.police ?? 0) + ' police</small>';
  chart('c-cpu', [{ data: H.map((x) => x.cpu), color: '#ff3b47', fill: 'rgba(255,59,71,.12)' }], { unit: ' %', max: 5 });
  chart('c-mem', [{ data: H.map((x) => x.rss), color: '#29d4ff', fill: 'rgba(41,212,255,.1)' }, { data: H.map((x) => x.heap), color: '#3d7bff' }], { unit: ' Mo' });
  chart('c-tick', [{ data: H.map((x) => x.sim), color: '#ffd23f' }, { data: H.map((x) => x.tick), color: '#34d880' }, { data: H.map((x) => x.lag), color: '#ff8a3d' }], { unit: ' ms', max: 2 });
  chart('c-net', [{ data: H.map((x) => x.out), color: '#34d880', fill: 'rgba(52,216,128,.1)' }, { data: H.map((x) => x.in), color: '#3d7bff' }], { unit: ' Ko/s', max: 5 });
  chart('c-cars', [{ data: H.map((x) => x.traffic), color: '#b0b4b8' }, { data: H.map((x) => x.police), color: '#ff3b47' }], { max: 5 });
  const sim = S.sim.ok ? 'prête · ' + S.sim.vehicles + ' voitures' : 'absente';
  $('info').replaceChildren();
  for (const [k, v] of [['Joueurs', S.players + ' / ' + S.max], ['Police IA', S.policeSim === 'server' ? 'serveur' : 'joueurs'], ['Simulation', sim], ['Protocole', String(S.protocol)]]) $('info').append(el('div', null, k), el('div', null, v));
}
async function refreshAll(light) {
  try {
    const [g, pl, lg] = await Promise.all([api('game'), api('players'), api('log')]);
    g.at = Date.now();
    renderGame(g); clock();
    renderPlayers(pl, g.pending);
    const L = $('log'), atBottom = L.scrollTop + L.clientHeight >= L.scrollHeight - 20;
    L.textContent = lg.join('\\n');
    if (atBottom) L.scrollTop = L.scrollHeight;
    refreshStats().catch(() => {});
    if (!light) renderAccess(await api('access'));
  } catch (e) { if (e.message !== 'auth') console.warn(e); }
}
api('state').then((s) => { $('lname').textContent = s.name; show(s.auth); }).catch(() => show(false));
</script></body></html>`;
