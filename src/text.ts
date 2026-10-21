// Nettoyage du texte venu des joueurs (chat, pseudos) et anti-flood.
// Le client affiche toujours en textContent (jamais en HTML), mais on filtre quand même ici :
// caractères de contrôle, texte « inversé » (bidi), caractères invisibles, empilements d'accents
// (« zalgo »), longueur.
import { CHAT_MAX, NAME_RE } from './protocol.ts';

// contrôles C0/C1, séparateurs de ligne, marques de direction, caractères invisibles, BOM, « tags »
const STRIP = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]|[\u{E0000}-\u{E007F}]/gu;

export function cleanText(raw: unknown, max = CHAT_MAX): string {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, max * 4).normalize('NFC').replace(STRIP, '');
  // au plus 2 signes diacritiques à la suite (bloque le texte « zalgo » qui déborde de l'écran)
  s = s.replace(/(\p{M}{2})\p{M}+/gu, '$1');
  s = s.replace(/\s+/gu, ' ').trim();
  // coupe en points de code (pas au milieu d'un emoji)
  const cps = [...s];
  if (cps.length > max) s = cps.slice(0, max).join('');
  return s;
}

/** Pseudo : 3 à 16 caractères, lettres / chiffres / espace / _ - . ; null si invalide */
export function cleanName(raw: unknown): string | null {
  const s = cleanText(raw, 16);
  return NAME_RE.test(s) ? s : null;
}

/** Limiteur « seau de jetons » : rate jetons par seconde, burst maximum */
export class Bucket {
  rate: number;
  burst: number;
  tokens: number;
  t: number;
  constructor(rate: number, burst: number) { this.rate = rate; this.burst = burst; this.tokens = burst; this.t = Date.now(); }
  take(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.t) / 1000) * this.rate);
    this.t = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Anti-flood du chat pour un joueur. Retourne null si le message passe, sinon la raison. */
export class ChatGuard {
  bucket: Bucket;
  last: number;
  recent: [string, number][];
  strikes: number;
  mutedUntil: number;
  constructor() {
    this.bucket = new Bucket(0.5, 4); // 4 messages d'affilée, puis 1 toutes les 2 s
    this.last = 0;
    this.recent = []; // [texte normalisé, heure]
    this.strikes = 0;
    this.mutedUntil = 0;
  }

  check(text: string): string | null {
    const now = Date.now();
    if (now < this.mutedUntil) return `Tu es muet encore ${Math.ceil((this.mutedUntil - now) / 1000)} s`;
    const key = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    this.recent = this.recent.filter(([, t]) => now - t < 15000);
    let reason: string | null = null;
    if (now - this.last < 600) reason = 'Doucement !';
    else if (!this.bucket.take()) reason = 'Trop de messages, attends un peu';
    else if (key && this.recent.some(([k]) => k === key)) reason = 'Message déjà envoyé';
    if (reason) {
      // flood insistant : muet 30 s
      if (++this.strikes >= 5) { this.mutedUntil = now + 30000; this.strikes = 0; return 'Flood : muet 30 s'; }
      return reason;
    }
    this.strikes = Math.max(0, this.strikes - 1);
    this.last = now;
    this.recent.push([key, now]);
    return null;
  }
}
