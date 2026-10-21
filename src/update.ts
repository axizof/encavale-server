// Vérifie au démarrage (puis toutes les 6 h) si une version plus récente du serveur est publiée sur
// GitHub. Ne bloque jamais : sans Internet, ou si GitHub ne répond pas, on n'affiche rien.
import { execFile } from 'node:child_process';

export const RELEASES_URL = 'https://github.com/axizof/encavale-server/releases/latest';
const API_URL = 'https://api.github.com/repos/axizof/encavale-server/releases/latest';

export interface UpdateInfo { latest: string; url: string }

/** « 1.10.0 » > « 1.9.2 » */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0), pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export async function checkUpdate(current: string): Promise<UpdateInfo | null> {
  try {
    const r = await fetch(API_URL, { headers: { 'User-Agent': 'encavale-server', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json() as { tag_name?: unknown; html_url?: unknown };
    const latest = typeof d.tag_name === 'string' ? d.tag_name.replace(/^v/, '') : '';
    if (!/^\d+\.\d+\.\d+$/.test(latest) || !newer(latest, current)) return null;
    return { latest, url: typeof d.html_url === 'string' && d.html_url.startsWith('https://github.com/') ? d.html_url : RELEASES_URL };
  } catch {
    return null;
  }
}

/** Ouvre une page dans le navigateur de l'hôte (PC avec écran ; sans effet sur un VPS) */
export function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? ['open', [url]] as const
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] as const
      : ['xdg-open', [url]] as const;
  try { execFile(cmd[0], [...cmd[1]], () => {}); } catch { /* pas de navigateur */ }
}
