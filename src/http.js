// Serveur web : sert le jeu (copie compilée dans public/ ou intégrée à l'exécutable) et /info.
// Le jeu est servi par le serveur lui-même : la page et la connexion WebSocket ont la même origine
// (http://IP:port), ce qui évite le blocage « contenu mixte » d'une page https vers ws://.
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/** Charge les fichiers du jeu : bundle intégré (exécutable) sinon dossier public/ */
export async function loadFiles(publicDir) {
  const files = new Map();
  try {
    const mod = await import('./public-bundle.js');
    for (const [k, v] of Object.entries(mod.FILES)) files.set(k, Buffer.from(v, 'base64'));
    if (files.size) return { files, source: 'intégré' };
  } catch { /* pas de bundle : mode développement */ }
  const walk = (dir, base = '') => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.name.startsWith('.')) continue;
      const rel = `${base}/${f.name}`;
      if (f.isDirectory()) walk(path.join(dir, f.name), rel);
      else files.set(rel, fs.readFileSync(path.join(dir, f.name)));
    }
  };
  if (fs.existsSync(publicDir)) walk(publicDir);
  return { files, source: publicDir };
}

export function makeHandler(files, server) {
  // page d'accueil : on signale au jeu qu'il tourne sur un serveur multijoueur
  const rawIndex = files.get('/index.html');
  const index = () => {
    if (!rawIndex) return Buffer.from('<h1>Jeu absent</h1><p>Le dossier public/ est vide : lance « npm run build:mp » dans le projet du jeu.</p>');
    const data = JSON.stringify({ name: server.cfg.name }).replace(/</g, '\\u003c');
    return Buffer.from(rawIndex.toString('utf8').replace('<head>', `<head>\n  <script>window.__CAVALE_MP__ = ${data};</script>`));
  };
  return (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, type, body, extra = {}) => {
      res.writeHead(code, {
        'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', ...extra,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'Méthode non autorisée');
    if (url.pathname === '/info') return send(200, 'application/json', JSON.stringify(server.info()), { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    if (url.pathname === '/' || url.pathname === '/index.html') return send(200, TYPES['.html'], index(), { 'Cache-Control': 'no-cache' });
    // uniquement les fichiers connus (pas de chemin arbitraire sur le disque)
    const f = files.get(url.pathname);
    if (!f) return send(404, 'text/plain; charset=utf-8', 'Introuvable');
    const ext = path.extname(url.pathname).toLowerCase();
    send(200, TYPES[ext] || 'application/octet-stream', f, { 'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  };
}
