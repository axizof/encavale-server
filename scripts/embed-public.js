// Intègre le jeu compilé (public/) dans src/public-bundle.js, pour un exécutable autonome
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pub = path.join(root, 'public');
const files = {};
const walk = (dir, base = '') => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.')) continue;
    const rel = `${base}/${f.name}`;
    if (f.isDirectory()) walk(path.join(dir, f.name), rel);
    else files[rel] = fs.readFileSync(path.join(dir, f.name)).toString('base64');
  }
};
if (!fs.existsSync(path.join(pub, 'index.html'))) {
  console.error('public/index.html absent : compile d\'abord le jeu (npm run build:mp dans le projet du jeu).');
  process.exit(1);
}
walk(pub);
fs.writeFileSync(path.join(root, 'src', 'public-bundle.js'), `// Généré par scripts/embed-public.js — ne pas modifier\nexport const FILES = ${JSON.stringify(files)};\n`);
console.log(`${Object.keys(files).length} fichiers intégrés (${Math.round(JSON.stringify(files).length / 1024)} Ko)`);
