// Exécutables autonomes (Windows, macOS, Linux) avec Bun : un seul fichier, le jeu inclus.
//   node scripts/embed-public.js && node scripts/build.js [cible…]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const TARGETS = {
  'linux-x64': 'bun-linux-x64', 'linux-arm64': 'bun-linux-arm64',
  'windows-x64': 'bun-windows-x64', 'macos-x64': 'bun-darwin-x64', 'macos-arm64': 'bun-darwin-arm64',
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
for (const name of wanted) {
  const out = path.join('dist', `encavale-server-${version}-${name}${name.startsWith('windows') ? '.exe' : ''}`);
  console.log(`→ ${out}`);
  execSync(`bun build src/main.js --compile --minify --target=${TARGETS[name]} --outfile ${out}`, { cwd: root, stdio: 'inherit' });
}
