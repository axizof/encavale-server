// Réglages de partie choisis par l'hôte (terminal, panneau web) ou un admin en jeu
import { PRESETS, SPIKES, COP_CARS } from './protocol.ts';
import type { PresetName, CopsRule, BotsLevel, SpikesLevel, CopCar } from './protocol.ts';

export type Weather = 'dynamic' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type TrafficLevel = 'off' | 'light' | 'normal' | 'dense';
export type PoliceSim = 'client' | 'server';

export interface Settings {
  preset: PresetName;
  cops: CopsRule;
  bots: BotsLevel;
  spikes: SpikesLevel;
  timeLimit: number; // secondes, 0 = illimité
  copCars: 'auto' | CopCar[];
  weather: Weather;
  tod: TimeOfDay;
  policeSim: PoliceSim;
  traffic: TrafficLevel;
  deadToCop: boolean;
  bigHeists: boolean; // « gros coups » communs à tous les fuyards
}

export const DEFAULT_SETTINGS: Settings = {
  preset: 'classique', cops: 0, bots: 'normal', spikes: 'off', timeLimit: 0, copCars: 'auto', weather: 'dynamic',
  tod: 'sunset', policeSim: 'client', traffic: 'normal', deadToCop: false, bigHeists: true,
};
const TRAFFIC: TrafficLevel[] = ['off', 'light', 'normal', 'dense'];
const BOTS: BotsLevel[] = ['off', 'normal', 'renforce'];
const WEATHERS: Weather[] = ['dynamic', 'clear', 'cloudy', 'rain', 'storm', 'fog'];
const TODS: TimeOfDay[] = ['day', 'sunset', 'night'];

const isPreset = (v: unknown): v is PresetName => typeof v === 'string' && Object.hasOwn(PRESETS, v);
const oneOf = <T extends string>(list: readonly T[], v: unknown, dflt: T): T => (list.includes(v as T) ? v as T : dflt);
const bool = (v: unknown, dflt: boolean): boolean => (v === true || v === 'on' ? true : v === false || v === 'off' ? false : dflt);

/** Réglages valides à partir de n'importe quel objet (config.json, panneau, admin en jeu) */
export function normalizeSettings(s: Record<string, unknown> = {}): Settings {
  const preset: PresetName = isPreset(s.preset) ? s.preset : DEFAULT_SETTINGS.preset;
  const p = PRESETS[preset];
  const tl = Number(s.timeLimit ?? p.timeLimit);
  let copCars: Settings['copCars'] = 'auto';
  if (Array.isArray(s.copCars)) {
    const list = s.copCars.filter((c): c is CopCar => COP_CARS.includes(c));
    if (list.length) copCars = list;
  }
  return {
    preset,
    cops: preset === 'perso' ? Math.max(0, Math.min(19, Math.floor(Number(s.cops ?? p.cops) || 0))) : p.cops,
    bots: oneOf(BOTS, s.bots, p.bots),
    spikes: typeof s.spikes === 'string' && Object.hasOwn(SPIKES, s.spikes) ? s.spikes as SpikesLevel : p.spikes,
    timeLimit: tl === 0 ? 0 : Math.max(120, Math.min(1800, Math.round(tl / 60) * 60 || p.timeLimit)),
    copCars,
    weather: oneOf(WEATHERS, s.weather, DEFAULT_SETTINGS.weather),
    tod: oneOf(TODS, s.tod, DEFAULT_SETTINGS.tod),
    // police IA calculée par le joueur poursuivi (« réactive ») ou par le serveur (anti-triche)
    policeSim: s.policeSim === 'server' ? 'server' : 'client',
    traffic: oneOf(TRAFFIC, s.traffic, DEFAULT_SETTINGS.traffic),
    // un fuyard éliminé peut rejoindre la police
    deadToCop: bool(s.deadToCop, false),
    bigHeists: bool(s.bigHeists, true),
  };
}

/**
 * Nouveaux réglages à partir des actuels et d'une demande. Un nouveau préréglage apporte ses valeurs
 * (répartition, police, herses, durée) sans perdre l'ambiance ni les choix du serveur.
 */
export function mergeSettings(cur: Settings, req: Record<string, unknown>): Settings {
  const { preset, ...rest } = req;
  if (isPreset(preset) && preset !== cur.preset) {
    const keep = { weather: cur.weather, tod: cur.tod, policeSim: cur.policeSim, traffic: cur.traffic, deadToCop: cur.deadToCop, bigHeists: cur.bigHeists };
    return normalizeSettings({ ...PRESETS[preset], preset, ...keep, ...rest });
  }
  return normalizeSettings({ ...cur, ...rest });
}
