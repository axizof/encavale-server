// Types du moteur de simulation (sim.js est généré depuis le jeu par « npm run build:mp »)
import type { Entity, BotTuning } from '../src/protocol.ts';

export interface SimEvent {
  t: 'msg' | 'tires' | 'pts' | 'busted' | 'wanted' | 'spike' | 'spikedel';
  to?: number;
  [k: string]: unknown;
}

export interface SimSpot { name: string; place: string; x: number; z: number; value: [number, number]; noDropNear: boolean }
export interface SimHideout { name: string; place: string; x: number; z: number }

export interface Wanted {
  alarm(x: number, z: number, heat: number): void;
  addHeat(h: number): void;
  witness(): void;
  dropStar(): void;
  stars: number;
}

export interface Squad { wanted: Wanted }

export interface PlayerState { x: number; z: number; y: number; h: number; vx: number; vz: number; flags: number }

export declare class ServerSim {
  static create(): Promise<ServerSim>;
  buildMs: number;
  active: boolean;
  startRound(o: { traffic: string; policeServer: boolean; tuning: BotTuning | null }): void;
  stopRound(): void;
  setPlayer(id: number, s: PlayerState, role: string, kind: string, alive: boolean): void;
  removePlayer(id: number): void;
  squad(id: number): Squad | null;
  step(dt: number): void;
  drain(): SimEvent[];
  entities(view: { x: number; z: number } | null): Entity[];
  stats(): { traffic: number; police: number; squads: number; stepMs: number; vehicles: number };
  seenByAnyone(x: number, z: number, r?: number): boolean;
  heistSpots(): SimSpot[];
  hideouts(): SimHideout[];
  routeLength(ax: number, az: number, bx: number, bz: number): number;
  roadPoint(x: number, z: number, maxD?: number): { x: number; z: number } | null;
  groundAt(x: number, z: number): number;
}
