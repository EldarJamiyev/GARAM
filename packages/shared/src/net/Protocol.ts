import { PlayerInput } from '../physics/KinematicPlayerController.js';

export interface NetOperatorState {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  health: number;
  armor: number;
  activeWeapon: string;
  currentAmmo: number;
  reserveAmmo: number;
  isScoped: boolean;
  isReloading: boolean;
  isCrouching: boolean;
  isDead: boolean;
  ping: number;
  kills: number;
  deaths: number;
}

export interface NetBombState {
  isPlanted: boolean;
  site: 'A' | 'B' | null;
  x: number;
  y: number;
  z: number;
  plantProgress: number;
  defuseProgress: number;
  timeRemaining: number;
}

// Client -> Server Packets
export type ClientPacket =
  | { type: 'join'; callsign: string; faction: 'Vanguard' | 'Syndicate' }
  | { type: 'input'; seq: number; timestamp: number; input: PlayerInput; weaponId: string }
  | { type: 'fire'; clientTimestamp: number; origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number }; weaponId: string }
  | { type: 'reload' }
  | { type: 'buy'; item: string }
  | { type: 'utility_throw'; utilityType: string; mode: 'long' | 'medium' | 'short'; origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }
  | { type: 'plant_defuse'; action: 'plant' | 'defuse' | 'cancel' }
  | { type: 'ping'; timestamp: number };

// Server -> Client Packets
export type ServerPacket =
  | { type: 'welcome'; playerId: string; team: 'Vanguard' | 'Syndicate'; tickRate: number }
  | { type: 'snapshot'; tick: number; serverTimestamp: number; lastAckSeq: number; players: NetOperatorState[]; bomb: NetBombState; roundPhase: string; roundTime: number; ctScore: number; tScore: number }
  | { type: 'hit_confirm'; targetId: string; damage: number; isHeadshot: boolean; victimHealth: number }
  | { type: 'kill_event'; killerId: string; killerName: string; victimId: string; victimName: string; weaponName: string; headshot: boolean; reward: number }
  | { type: 'utility_event'; id: string; utilityType: string; origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }
  | { type: 'round_event'; phase: string; round: number; winner?: string; reason?: string; ctScore: number; tScore: number }
  | { type: 'pong'; clientTimestamp: number; serverTimestamp: number };
