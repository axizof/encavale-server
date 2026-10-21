// Protocole En Cavale multijoueur — partagé par le serveur (Node / Bun) et le jeu (navigateur).
// Messages texte : JSON { t: 'type', ...champs }. Positions des voitures : binaire compact
// (26 octets par voiture), envoyé ~15 fois par seconde dans les deux sens.

// 3 : âge de chaque position (interpolation fluide), objectifs et réparations gérés par le serveur,
//     admins en jeu par compte Discord
export const PROTOCOL = 3;

// Types de voiture (octet « kind ») : 0-3 joueurs et police, 4-6 circulation civile
export const KIND = { fugitive: 0, interceptor: 1, police: 2, suv: 3, sedan: 4, hatch: 5, van: 6 } as const;
export type KindName = keyof typeof KIND;
export const KIND_NAME: KindName[] = ['fugitive', 'interceptor', 'police', 'suv', 'sedan', 'hatch', 'van'];
export type CopCar = 'interceptor' | 'police' | 'suv';
export const COP_CARS: CopCar[] = ['interceptor', 'police', 'suv'];
export type PlayerKind = 'fugitive' | CopCar;

// Drapeaux d'état (octet « flags »)
export const F = {
  destroyed: 1, siren: 2, braking: 4, nitro: 8, airborne: 16, handbrake: 32, reverse: 64, tires: 128,
} as const;

// Identifiants : joueurs 1..255 ; voitures de police IA d'un joueur : 256 + joueur * 32 + n (n < 32) ;
// circulation civile (simulée par le serveur) : à partir de 8448
export const TRAFFIC_BASE = 8448;
export const botId = (owner: number, slot: number): number => 256 + owner * 32 + slot;
export const botOwner = (id: number): number => (id >= 256 && id < TRAFFIC_BASE ? (id - 256) >> 5 : 0);
export const isBot = (id: number): boolean => id >= 256 && id < TRAFFIC_BASE;
export const isTraffic = (id: number): boolean => id >= TRAFFIC_BASE;

export const MAX_BOTS_PER_PLAYER = 12;
export const ENTITY_BYTES = 26;
export const MSG_SNAPSHOT = 1; // serveur -> clients
export const MSG_STATE = 2; // client -> serveur
export const AGE_UNIT = 0.004; // octet « âge » : par pas de 4 ms (jusqu'à ~1 s)

// Couleurs des fuyards (une par joueur, pour les reconnaître)
// (pas de bleu : c'est la couleur des flics)
export const FUGITIVE_COLORS = [0xd4141c, 0xf2b705, 0x2f7d4f, 0xe9e9e6, 0xff6a00, 0x8e24aa, 0x15171c, 0xc2185b, 0x7cb342, 0x00897b, 0x6d4c41, 0xffd54f];

/** Une voiture sur le réseau */
export interface Entity {
  id: number;
  kind: number;
  flags: number;
  x: number; z: number; y: number;
  h: number; // cap (radians)
  vx: number; vz: number;
  steer: number; // -1..1
  hp: number;
  extra: number; // étoiles (joueur), couleur (civil)
  age?: number; // secondes écoulées entre la mesure et l'envoi
}

export interface EntityMsg {
  type: number;
  time: number; // heure serveur (s) de l'envoi ; pour MSG_STATE : heure serveur estimée de la mesure
  list: Entity[];
}

const H_SCALE = 32767 / Math.PI;

/** Encode une liste de voitures. */
export function encodeEntities(type: number, time: number, list: Entity[]): Uint8Array {
  const n = Math.min(255, list.length);
  const buf = new ArrayBuffer(6 + n * ENTITY_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, type);
  dv.setUint8(1, n);
  dv.setFloat32(2, time, true);
  let o = 6;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    let h = e.h % (2 * Math.PI);
    if (h > Math.PI) h -= 2 * Math.PI; else if (h < -Math.PI) h += 2 * Math.PI;
    dv.setUint16(o, e.id, true);
    dv.setUint8(o + 2, e.kind);
    dv.setUint8(o + 3, e.flags & 255);
    dv.setFloat32(o + 4, e.x, true);
    dv.setFloat32(o + 8, e.z, true);
    dv.setFloat32(o + 12, e.y, true);
    dv.setInt16(o + 16, Math.round(h * H_SCALE), true);
    dv.setInt16(o + 18, clamp16(e.vx * 100), true);
    dv.setInt16(o + 20, clamp16(e.vz * 100), true);
    dv.setInt8(o + 22, Math.max(-127, Math.min(127, Math.round((e.steer || 0) * 127))));
    dv.setUint8(o + 23, Math.max(0, Math.min(255, Math.round(e.hp || 0))));
    dv.setUint8(o + 24, (e.extra || 0) & 255);
    dv.setUint8(o + 25, Math.max(0, Math.min(255, Math.round((e.age || 0) / AGE_UNIT))));
    o += ENTITY_BYTES;
  }
  return new Uint8Array(buf);
}

/** Décode un message binaire. Retourne null s'il est mal formé. */
export function decodeEntities(bytes: Uint8Array): EntityMsg | null {
  if (!bytes || bytes.byteLength < 6) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = dv.getUint8(0), n = dv.getUint8(1);
  if (bytes.byteLength !== 6 + n * ENTITY_BYTES) return null;
  const time = dv.getFloat32(2, true);
  if (!Number.isFinite(time)) return null;
  const list: Entity[] = [];
  let o = 6;
  for (let i = 0; i < n; i++) {
    const e: Entity = {
      id: dv.getUint16(o, true),
      kind: dv.getUint8(o + 2),
      flags: dv.getUint8(o + 3),
      x: dv.getFloat32(o + 4, true),
      z: dv.getFloat32(o + 8, true),
      y: dv.getFloat32(o + 12, true),
      h: dv.getInt16(o + 16, true) / H_SCALE,
      vx: dv.getInt16(o + 18, true) / 100,
      vz: dv.getInt16(o + 20, true) / 100,
      steer: dv.getInt8(o + 22) / 127,
      hp: dv.getUint8(o + 23),
      extra: dv.getUint8(o + 24),
      age: dv.getUint8(o + 25) * AGE_UNIT,
    };
    o += ENTITY_BYTES;
    if (!Number.isFinite(e.x + e.z + e.y)) return null;
    list.push(e);
  }
  return { type, time, list };
}

function clamp16(v: number): number { return Math.max(-32767, Math.min(32767, Math.round(v || 0))); }

// --- Règles de jeu partagées (le serveur fait foi, le client affiche) ---

export type CopsRule = number | 'third' | 'half' | 'allButOne';
export type BotsLevel = 'off' | 'normal' | 'renforce';
export type SpikesLevel = 'off' | 'rare' | 'normal' | 'beaucoup';
export type PresetName = 'classique' | 'renfort' | 'equipes' | 'chasse' | 'perso';
export interface Preset { label: string; desc: string; cops: CopsRule; bots: BotsLevel; spikes: SpikesLevel; timeLimit: number }

// Préréglages de partie : répartition des rôles selon le nombre de joueurs
export const PRESETS: Record<PresetName, Preset> = {
  classique: { label: 'Classique', desc: 'Tout le monde en fuite, police IA aux trousses', cops: 0, bots: 'normal', spikes: 'off', timeLimit: 0 },
  renfort: { label: 'Flics + IA', desc: '1 joueur sur 3 en flic, la police IA en renfort', cops: 'third', bots: 'normal', spikes: 'rare', timeLimit: 600 },
  equipes: { label: 'Gendarmes et voleurs', desc: 'Moitié flics, moitié fuyards, sans IA', cops: 'half', bots: 'off', spikes: 'rare', timeLimit: 480 },
  chasse: { label: 'Chasse à l\'homme', desc: 'Un seul fuyard contre tous les autres', cops: 'allButOne', bots: 'off', spikes: 'normal', timeLimit: 300 },
  perso: { label: 'Personnalisé', desc: 'Tu choisis le nombre de flics et le reste', cops: 1, bots: 'normal', spikes: 'rare', timeLimit: 600 },
};

/** Nombre de flics joueurs pour un préréglage et un nombre de joueurs */
export function copCountFor(cops: CopsRule, n: number): number {
  if (n < 2) return 0;
  let c: number;
  if (cops === 'third') c = Math.round(n / 3);
  else if (cops === 'half') c = Math.floor(n / 2);
  else if (cops === 'allButOne') c = n - 1;
  else c = Math.floor(Number(cops) || 0);
  return Math.max(0, Math.min(n - 1, c)); // toujours au moins un fuyard
}

/** Voitures de police autorisées selon le rapport flics / fuyards (plus de flics = voitures moins fortes) */
export function allowedCopCars(cops: number, fugitives: number): CopCar[] {
  const r = cops / Math.max(1, fugitives);
  if (r <= 0.5) return ['interceptor', 'suv', 'police'];
  if (r <= 1.5) return ['suv', 'police'];
  return ['police'];
}

// Herses des flics joueurs : charges max et recharge (secondes) selon le réglage
export const SPIKES: Record<SpikesLevel, { max: number; recharge: number }> = {
  off: { max: 0, recharge: 0 },
  rare: { max: 1, recharge: 120 },
  normal: { max: 2, recharge: 60 },
  beaucoup: { max: 3, recharge: 35 },
};
export const SPIKE_TTL = 30; // durée de vie d'une herse posée

export const COP_RESPAWN = 40; // secondes avant qu'un flic joueur détruit reparte
export const HP: Record<KindName, number> = { fugitive: 100, interceptor: 110, police: 100, suv: 170, sedan: 90, hatch: 80, van: 140 };
export const ARMOR: Record<PlayerKind, number> = { fugitive: 1, interceptor: 0.95, police: 1, suv: 0.7 };

// Dégâts d'un choc (identique à vehicles/physics.js) : sert de plafond côté serveur
export function impactDamage(impact: number): number {
  if (impact < 4) return 0;
  return 0.38 * Math.pow(impact - 4, 1.35);
}

export interface BotTuning { extraCops: number; aggr: number; speed: number; roadblockK: number; heat: number }

// Police IA en multi : plus il y a de fuyards, plus elle est nombreuse et agressive
// (même calcul chez le client en mode « réactive » et dans le serveur en mode « serveur »)
export function botTuning(bots: BotsLevel, fugitives: number, cops: number): BotTuning | null {
  if (bots === 'off') return null;
  const n = Math.max(1, fugitives), lvl = bots === 'renforce' ? 1 : 0;
  return {
    extraCops: Math.max(0, Math.min(5, lvl * 2 + Math.ceil((n - 1) / 2) - (cops > 0 ? 1 : 0))),
    aggr: Math.min(0.3, 0.1 * lvl + 0.03 * (n - 1)),
    speed: Math.min(0.06, 0.025 * lvl + 0.01 * (n - 1)),
    roadblockK: lvl ? 0.75 : 0.9,
    heat: Math.min(1.8, 1 + 0.25 * lvl + 0.06 * (n - 1)),
  };
}

// --- Objectifs (braquages) et réparations : choisis par le serveur, communs à tous ---
export const ROB_TIME = 3.5; // secondes dans la zone du braquage
export const DROP_TIME = 2.2; // déchargement chez le receleur
export const ROB_R = 16; // rayon de la zone de braquage
export const DROP_R = 20; // rayon de la zone du receleur
export const PICKUP_R = 3.2; // ramasser une réparation
export const PICKUP_HEAL = 40;
export const BIG_LOOT = 3; // gros coup : butin ×3

/** Réparations présentes sur la carte selon le nombre de fuyards encore en jeu (1 pour 2, de 1 à 6) */
export function pickupTarget(fugitivesAlive: number): number {
  if (fugitivesAlive <= 0) return 0;
  return Math.max(1, Math.min(6, Math.ceil(fugitivesAlive / 2)));
}

/** Multiplicateur des points selon les étoiles (comme en solo) */
export const MULTS = [1, 1.5, 2, 3, 4, 6];
export const multFor = (stars: number): number => MULTS[Math.max(0, Math.min(MULTS.length - 1, stars - 1))];

export const CHAT_MAX = 160;
export const NAME_RE = /^[\p{L}\p{N} _.\-]{3,16}$/u;
