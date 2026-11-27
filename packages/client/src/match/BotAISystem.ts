import * as THREE from 'three';
import {
  MapBlockCollider,
  AABBCollider,
  Vec3,
  SmokeOccluder,
  SpatialGrid,
  hasLineOfSight,
  resolveHorizontalAABB,
  computeSpreadRayDirection,
  KINEMATICS,
  BOMBSITES,
  SPAWN_POINTS,
  DEFAULT_MAP_BOUNDS,
  MapBounds,
  executeTacticalRaycast,
  TargetCollider,
  Ray,
  HitZone,
  SurfaceMaterial,
  CS_OFFICE_NAV_GRAPH,
  CS_OFFICE_BLOCKS,
  DE_DUST2_NAV_GRAPH,
  DE_DUST2_BLOCKS,
  DE_DUST2_BOUNDS,
  DE_DUST2_BOMBSITES,
  DE_DUST2_SPAWN_POINTS,
  DE_NUKE_NAV_GRAPH,
  DE_NUKE_BLOCKS,
  DE_NUKE_BOUNDS,
  DE_NUKE_BOMBSITES,
  DE_NUKE_SPAWN_POINTS,
  DE_INFERNO_NAV_GRAPH,
  DE_INFERNO_BLOCKS,
  DE_INFERNO_BOUNDS,
  DE_INFERNO_BOMBSITES,
  DE_INFERNO_SPAWN_POINTS,
  FY_SNOW_NAV_GRAPH,
  FY_SNOW_BLOCKS,
  FY_SNOW_BOUNDS,
  FY_SNOW_BOMBSITES,
  FY_SNOW_SPAWN_POINTS,
  NavNode,
  findNearestNavNode,
  findPathAStar,
  rollRandomStrategies,
  RoundStrategySelection,
  BotBrain,
  CombatFootworkPhase,
  PerceptionConfig,
  PerceptionResult,
  normalizeAngleRad,
  meshYawToRaycastYaw,
  resolveBotArchetype,
  BotArchetype,
  WEAPONS,
} from '@garam/shared';
import { BotEntity } from '../maps/DeCitadelMap.js';
import type { RadioCommsManager } from './RadioCommsManager.js';

export interface BotMapConfig {
  navGraph: Record<string, NavNode>;
  blocks: MapBlockCollider[];
  bounds: MapBounds;
  bombsites: { A: { center: Vec3; radius: number }; B: { center: Vec3; radius: number } };
  spawnPoints: { VANGUARD_CT: Vec3; OBSIDIAN_T: Vec3 };
  vanguardHolds: readonly string[];
  syndicateExecutes: readonly string[];
  smokeChokes: readonly string[];
  postPlantFallbackNode: string;
}

export type BotDifficulty = 'Recruit' | 'Veteran' | 'Elite' | 'Sovereign';

interface DifficultyConfig {
  reactionTimeMs: number;
  halfFovDeg: number;
  fovealHalfFovDeg: number;
  exposureConfirmMs: number;
  peripheralPenaltyMs: number;
  distancePenaltyMsPer10m: number;
  surprisePenaltyMs: number;
  slewRateDegPerSec: number;
  maxFireErrorDeg: number;
  maxFireSpeed: number;
  trackingTauSec: number;
  burstCount: number;
  burstCooldownMs: number;
  patrolSpeed: number;
  canUseUtility: boolean;
  spreadAngleRad: number;
  hearingScale: number;
}

const DIFFICULTY_PRESETS: Record<BotDifficulty, DifficultyConfig> = {
  Recruit: {
    reactionTimeMs: 540,
    halfFovDeg: 50,
    fovealHalfFovDeg: 30,
    exposureConfirmMs: 110,
    peripheralPenaltyMs: 280,
    distancePenaltyMsPer10m: 55,
    surprisePenaltyMs: 210,
    slewRateDegPerSec: 210,
    maxFireErrorDeg: 6.5,
    maxFireSpeed: 1.1,
    trackingTauSec: 0.16,
    burstCount: 3,
    burstCooldownMs: 1150,
    patrolSpeed: 2.9,
    canUseUtility: false,
    spreadAngleRad: 0.062,
    hearingScale: 0.55,
  },
  Veteran: {
    reactionTimeMs: 350,
    halfFovDeg: 53,
    fovealHalfFovDeg: 32,
    exposureConfirmMs: 90,
    peripheralPenaltyMs: 210,
    distancePenaltyMsPer10m: 42,
    surprisePenaltyMs: 160,
    slewRateDegPerSec: 360,
    maxFireErrorDeg: 5.0,
    maxFireSpeed: 1.05,
    trackingTauSec: 0.115,
    burstCount: 4,
    burstCooldownMs: 880,
    patrolSpeed: 3.3,
    canUseUtility: true,
    spreadAngleRad: 0.036,
    hearingScale: 0.80,
  },
  Elite: {
    reactionTimeMs: 240,
    halfFovDeg: 55,
    fovealHalfFovDeg: 32,
    exposureConfirmMs: 75,
    peripheralPenaltyMs: 155,
    distancePenaltyMsPer10m: 32,
    surprisePenaltyMs: 110,
    slewRateDegPerSec: 520,
    maxFireErrorDeg: 4.0,
    maxFireSpeed: 0.95,
    trackingTauSec: 0.08,
    burstCount: 4,
    burstCooldownMs: 680,
    patrolSpeed: 3.55,
    canUseUtility: true,
    spreadAngleRad: 0.019,
    hearingScale: 0.95,
  },
  Sovereign: {
    reactionTimeMs: 180,
    halfFovDeg: 55,
    fovealHalfFovDeg: 32,
    exposureConfirmMs: 60,
    peripheralPenaltyMs: 110,
    distancePenaltyMsPer10m: 22,
    surprisePenaltyMs: 75,
    slewRateDegPerSec: 680,
    maxFireErrorDeg: 3.2,
    maxFireSpeed: 0.90,
    trackingTauSec: 0.055,
    burstCount: 5,
    burstCooldownMs: 540,
    patrolSpeed: 3.8,
    canUseUtility: true,
    spreadAngleRad: 0.009,
    hearingScale: 1.0,
  },
};

export interface SoundEvent {
  type: 'footstep' | 'gunfire' | 'suppressed_gunfire' | 'reload' | 'bomb';
  pos: THREE.Vector3;
  radius: number;
  team: 'Vanguard' | 'Syndicate';
  timestamp: number;
}

export interface BotAISystemCallbacks {
  onBotShootPlayer: (
    bot: BotEntity,
    dmg: number,
    hitZone: HitZone,
    isHeadshot: boolean,
    penetratedWalls: number,
    armorDamage?: number
  ) => void;
  onBotShootBot: (
    shooter: BotEntity,
    victim: BotEntity,
    dmg: number,
    hitZone: HitZone,
    isHeadshot: boolean,
    penetratedWalls: number,
    armorDamage?: number
  ) => void;
  onEnemySpotted?: (bot: BotEntity) => void;
  onBotSpawnTracer?: (from: THREE.Vector3, to: THREE.Vector3, weaponId?: string) => void;
  onBotSpawnDecal?: (point: THREE.Vector3, normal: THREE.Vector3, material: SurfaceMaterial) => void;
  onBotThrowUtility?: (bot: BotEntity, type: 'smoke' | 'flash' | 'molotov', target: THREE.Vector3) => void;
  onBotRadioCallout?: (bot: BotEntity, message: string) => void;
}

// Pre-allocated scratch objects for zero-GC bot AI hot loop
const _botEye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _aimVec = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _stepNormal = new THREE.Vector3();
const _terminalPoint = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _otherPositionsScratch: Vec3[] = [];

const MAX_FOV_YAW_RAD = (55 * Math.PI) / 180; // ±55° forward visual cone
const MAX_FOV_PITCH_RAD = (38 * Math.PI) / 180; // 38° pitch cone

const VANGUARD_TACTICAL_HOLDS: readonly string[] = [
  'front_hall_mid',
  'sniper_mezz_center',
  'front_hall_west',
  'front_hall_east',
  'long_hall_north',
  'side_hall_west',
  'storage_entry',
  'a_site_center',
  'b_site_paper_center',
  'main_hall_north',
];

const SYNDICATE_TACTICAL_EXECUTES: readonly string[] = [
  'a_site_center',
  'a_site_west_door',
  'b_site_paper_center',
  'b_site_paper_south',
  'main_hall_north',
  'long_hall_mid_n',
  'front_main_door',
  'kitchen_north_door',
  'side_hall_west',
];

const CS_OFFICE_SMOKE_CHOKES: readonly string[] = [
  'front_main_door',
  'long_hall_north',
  'a_site_north_door',
  'b_site_paper_east',
];

export const CS_OFFICE_BOT_MAP_CONFIG: BotMapConfig = {
  navGraph: CS_OFFICE_NAV_GRAPH,
  blocks: CS_OFFICE_BLOCKS,
  bounds: DEFAULT_MAP_BOUNDS,
  bombsites: BOMBSITES,
  spawnPoints: SPAWN_POINTS,
  vanguardHolds: VANGUARD_TACTICAL_HOLDS,
  syndicateExecutes: SYNDICATE_TACTICAL_EXECUTES,
  smokeChokes: CS_OFFICE_SMOKE_CHOKES,
  postPlantFallbackNode: 'a_site_east',
};

/**
 * Minimum horizontal separation (meters) strictly enforced between friendly bots'
 * assigned hold anchors at round start and during mid-round rotations.
 */
export const MIN_FRIENDLY_HOLD_SEPARATION_M = 3.0;

export const DE_DUST2_BOT_MAP_CONFIG: BotMapConfig = {
  navGraph: DE_DUST2_NAV_GRAPH,
  blocks: DE_DUST2_BLOCKS,
  bounds: DE_DUST2_BOUNDS,
  bombsites: DE_DUST2_BOMBSITES,
  spawnPoints: DE_DUST2_SPAWN_POINTS,
  // 5 primary distinct CT defensive zones (A Long, A Site Default, A Short/Catwalk, Goose, A Ramp)
  // followed by well-spaced secondary rotations (all >= 3.0m apart).
  vanguardHolds: [
    'long_corner',
    'default',
    'short_plat',
    'goose',
    'ramp_top',
    'car',
    'site_center',
    'stairs_bot',
    'site_sw',
    'site_e',
    'elbow',
    'pit',
    'ramp_mid',
  ],
  syndicateExecutes: [
    'site_center',
    'default',
    'site_nw',
    'site_n',
    'short_plat',
    'stairs_bot',
    'long_corner',
    'car',
    'elbow',
    'goose',
  ],
  smokeChokes: ['long_corner', 'ramp_top', 'short_plat', 'elbow'],
  postPlantFallbackNode: 'goose',
};

export const DE_NUKE_BOT_MAP_CONFIG: BotMapConfig = {
  navGraph: DE_NUKE_NAV_GRAPH,
  blocks: DE_NUKE_BLOCKS,
  bounds: DE_NUKE_BOUNDS,
  bombsites: DE_NUKE_BOMBSITES,
  spawnPoints: DE_NUKE_SPAWN_POINTS,
  vanguardHolds: ['nuke_a_site', 'nuke_ct_main', 'nuke_ct_ramp', 'nuke_yard_east', 'nuke_b_site'],
  syndicateExecutes: ['nuke_a_site', 'nuke_b_site', 'nuke_hut_door', 'nuke_yard_mid'],
  smokeChokes: ['nuke_yard_mid', 'nuke_ct_main', 'nuke_ct_ramp'],
  postPlantFallbackNode: 'nuke_hut_door',
};

export const DE_INFERNO_BOT_MAP_CONFIG: BotMapConfig = {
  navGraph: DE_INFERNO_NAV_GRAPH,
  blocks: DE_INFERNO_BLOCKS,
  bounds: DE_INFERNO_BOUNDS,
  bombsites: DE_INFERNO_BOMBSITES,
  spawnPoints: DE_INFERNO_SPAWN_POINTS,
  vanguardHolds: ['inf_top_mid', 'inf_a_site', 'inf_pit', 'inf_b_site', 'inf_b_ct_entry'],
  syndicateExecutes: ['inf_a_site', 'inf_b_site', 'inf_banana_mid', 'inf_top_mid'],
  smokeChokes: ['inf_mid', 'inf_banana_mid', 'inf_ct_arch'],
  postPlantFallbackNode: 'inf_pit',
};

export const FY_SNOW_BOT_MAP_CONFIG: BotMapConfig = {
  navGraph: FY_SNOW_NAV_GRAPH,
  blocks: FY_SNOW_BLOCKS,
  bounds: FY_SNOW_BOUNDS,
  bombsites: FY_SNOW_BOMBSITES,
  spawnPoints: FY_SNOW_SPAWN_POINTS,
  vanguardHolds: ['snow_w_lane', 'snow_mid', 'snow_e_lane'],
  syndicateExecutes: ['snow_w_lane', 'snow_mid', 'snow_e_lane'],
  smokeChokes: ['snow_mid'],
  postPlantFallbackNode: 'snow_mid',
};

interface BotInternalState {
  botId: string;
  botName: string;
  team: 'Vanguard' | 'Syndicate';
  archetype: BotArchetype;
  weaponId: string;
  ammo: number;
  isReloading: boolean;
  reloadTimeRemaining: number;
  burstRemaining: number;
  burstShotIndex: number;
  burstTimer: number;
  // Human perception & zero-prefire tracking (staggered 20Hz LOS)
  perceptionTimer: number;
  cachedPlayerLos: boolean;
  cachedBotLos: Map<string, boolean>;
  reactionJitterMs: number;
  playerVisibleMs: number;
  playerLostSec: number;
  announcedPlayerContact: boolean;
  trackedPlayerPos: THREE.Vector3;
  hasTrackedPlayer: boolean;
  botVisibleMs: Map<string, number>;
  trackedBotPos: THREE.Vector3;
  trackedBotId: string | null;
  // Combat footwork & cover
  combatPhase: CombatFootworkPhase;
  combatPhaseTimer: number;
  strafeSign: number;
  isCrouching: boolean;
  // Flashbang blindness & anti-flash dodge
  blindTimer: number;
  antiFlashTurnTimer: number;
  antiFlashYaw: number;
  // Navigation & tactical angle-holding
  path: Vec3[];
  pathIndex: number;
  assignedHoldPos: Vec3 | null;
  role: 'entry' | 'support' | 'lurker' | 'anchor' | 'rotator';
  isLurking: boolean;
  holdAngleTimer: number;
  holdWatchYaw: number;
  hasCommittedPostPlant: boolean;
  swayPhase: number;
  // Unstuck steering
  lastDisplacementPos: THREE.Vector3;
  stuckTimer: number;
  unstuckDuration: number;
  unstuckDir: THREE.Vector3;
  consecutiveStuckCount: number;
  // Audio investigation
  soundInvestigateTarget: THREE.Vector3 | null;
  soundInvestigateTimer: number;
  hasThrownSmoke: boolean;
  hasThrownFlash: boolean;
  // Orientation & kinematics
  targetYaw: number;
  currentYaw: number;
  currentPitch: number;
  vy: number;
}

export class BotAISystem {
  public difficulty: BotDifficulty = 'Veteran';
  private callbacks: BotAISystemCallbacks;
  private botStates: Map<string, BotInternalState> = new Map();
  public currentStrategies: RoundStrategySelection;
  private roundStartTime = performance.now();
  private lastSmokeOccluders: SmokeOccluder[] = [];
  private lastSpatialGrid?: SpatialGrid;
  private lastPlayerFeet = new THREE.Vector3();
  private hasLastPlayerFeet = false;
  private playerVelX = 0;
  private playerVelZ = 0;
  private mapConfig: BotMapConfig;

  constructor(
    callbacks: BotAISystemCallbacks,
    difficulty: BotDifficulty = 'Veteran',
    mapConfig: BotMapConfig = CS_OFFICE_BOT_MAP_CONFIG
  ) {
    this.callbacks = callbacks;
    this.difficulty = difficulty;
    this.mapConfig = mapConfig;
    this.currentStrategies = rollRandomStrategies();
  }

  public setDifficulty(diff: BotDifficulty): void {
    this.difficulty = diff;
    for (const state of this.botStates.values()) {
      state.archetype = resolveBotArchetype(state.botId, state.botName, state.team, diff);
      // Reset active reaction timers so switching difficulty immediately applies fair reaction windows
      state.playerVisibleMs = 0;
      state.botVisibleMs.clear();
    }
  }

  public setMapConfig(mapConfig: BotMapConfig): void {
    this.mapConfig = mapConfig;
    this.botStates.clear();
  }

  private createBotState(
    bot: BotEntity,
    path: Vec3[],
    role: BotInternalState['role'],
    indexSeed: number,
    weaponId: string
  ): BotInternalState {
    const weaponStats = WEAPONS[weaponId] ?? WEAPONS[bot.team === 'Vanguard' ? 'vanguard-m4' : 'garam-47'];
    return {
      botId: bot.id,
      botName: bot.name,
      team: bot.team,
      archetype: resolveBotArchetype(bot.id, bot.name, bot.team, this.difficulty),
      weaponId: weaponStats.id,
      ammo: weaponStats.magCapacity,
      isReloading: false,
      reloadTimeRemaining: 0,
      burstRemaining: 0,
      burstShotIndex: 0,
      burstTimer: 0,
      perceptionTimer: 0, // Evaluate immediately on first active tick, then stagger at 20Hz
      cachedPlayerLos: false,
      cachedBotLos: new Map(),
      reactionJitterMs: BotBrain.computeGaussianJitterMs(indexSeed * 17.3 + 3.1),
      playerVisibleMs: 0,
      playerLostSec: 10,
      announcedPlayerContact: false,
      trackedPlayerPos: new THREE.Vector3(),
      hasTrackedPlayer: false,
      botVisibleMs: new Map(),
      trackedBotPos: new THREE.Vector3(),
      trackedBotId: null,
      combatPhase: 'HOLD_FIRE',
      combatPhaseTimer: 0.45,
      strafeSign: indexSeed % 2 === 0 ? 1 : -1,
      isCrouching: false,
      blindTimer: 0,
      antiFlashTurnTimer: 0,
      antiFlashYaw: bot.mesh.rotation.y,
      path,
      pathIndex: 0,
      assignedHoldPos: path.length > 0 ? { ...path[path.length - 1] } : null,
      role,
      isLurking: role === 'lurker',
      holdAngleTimer: 0,
      holdWatchYaw: bot.mesh.rotation.y,
      hasCommittedPostPlant: false,
      swayPhase: indexSeed * 1.37,
      lastDisplacementPos: bot.mesh.position.clone(),
      stuckTimer: 0,
      unstuckDuration: 0,
      unstuckDir: new THREE.Vector3(),
      consecutiveStuckCount: 0,
      soundInvestigateTarget: null,
      soundInvestigateTimer: 0,
      hasThrownSmoke: false,
      hasThrownFlash: false,
      targetYaw: bot.mesh.rotation.y,
      currentYaw: bot.mesh.rotation.y,
      currentPitch: 0,
      vy: 0,
    };
  }

  public startNewRound(roundNumber: number, bots: BotEntity[], ctLossStreak = 0, tLossStreak = 0): void {
    this.roundStartTime = performance.now();
    this.currentStrategies = rollRandomStrategies();
    this.botStates.clear();
    this.hasLastPlayerFeet = false;
    this.playerVelX = 0;
    this.playerVelZ = 0;

    const synBots = bots.filter((b) => b.team === 'Syndicate');
    const vgBots = bots.filter((b) => b.team === 'Vanguard');

    const defaultCash = roundNumber === 1 || roundNumber === 13 ? 800 : 4800;
    const synBuys = BotBrain.evaluateTeamEconomy(
      synBots.map(() => defaultCash),
      tLossStreak,
      roundNumber,
      false
    );
    const vgBuys = BotBrain.evaluateTeamEconomy(
      vgBots.map(() => defaultCash),
      ctLossStreak,
      roundNumber,
      true
    );

    const { navGraph, blocks: mapBlocks, bombsites, vanguardHolds, syndicateExecutes } = this.mapConfig;
    const nodePos = (id: string, fallback: Vec3): Vec3 => navGraph[id]?.pos ?? fallback;

    const pickSeparatedHoldNode = (
      candidates: readonly string[],
      startIdx: number,
      usedIds: Set<string>,
      usedPositions: Vec3[],
      fallback: Vec3
    ): Vec3 => {
      const isFarEnough = (pos: Vec3, minDist: number): boolean =>
        usedPositions.every((other) => Math.hypot(pos.x - other.x, pos.z - other.z) >= minDist);

      // Pass 1: unique candidate strictly >= MIN_FRIENDLY_HOLD_SEPARATION_M from all teammates' holds
      for (let offset = 0; offset < candidates.length; offset++) {
        const id = candidates[(startIdx + offset) % candidates.length];
        const node = navGraph[id];
        if (!node || usedIds.has(id)) continue;
        if (isFarEnough(node.pos, MIN_FRIENDLY_HOLD_SEPARATION_M)) {
          usedIds.add(id);
          usedPositions.push(node.pos);
          return node.pos;
        }
      }

      // Pass 2: scan full navGraph for any well-separated hold node if the pool is small
      for (const id of Object.keys(navGraph)) {
        if (usedIds.has(id)) continue;
        const pos = navGraph[id].pos;
        if (isFarEnough(pos, MIN_FRIENDLY_HOLD_SEPARATION_M)) {
          usedIds.add(id);
          usedPositions.push(pos);
          return pos;
        }
      }

      const id = candidates[startIdx % Math.max(1, candidates.length)];
      const chosen = nodePos(id, fallback);
      usedIds.add(id);
      usedPositions.push(chosen);
      return chosen;
    };

    const usedSynNodes = new Set<string>();
    const usedSynPositions: Vec3[] = [];
    synBots.forEach((bot, index) => {
      const decision = synBuys[index];
      bot.armor = decision.buyArmor ? 100 : 0;
      bot.hasHelmet = decision.buyHelmet;
      const weaponId = decision.primaryWeaponId;
      bot.rig?.setWeapon(weaponId);

      let role: BotInternalState['role'] = 'entry';
      let dest: Vec3 = bombsites.A.center;

      if (this.currentStrategies.syndicate === 'RUSH_A_LONG') {
        role = index === 0 ? 'entry' : index === 4 ? 'lurker' : 'support';
        dest = pickSeparatedHoldNode(syndicateExecutes, index, usedSynNodes, usedSynPositions, bombsites.A.center);
      } else if (this.currentStrategies.syndicate === 'SPLIT_A_MID') {
        role = index < 2 ? 'entry' : 'rotator';
        dest = pickSeparatedHoldNode(syndicateExecutes, index + 2, usedSynNodes, usedSynPositions, bombsites.A.center);
      } else if (this.currentStrategies.syndicate === 'RUSH_B_TUNNELS') {
        role = index === 0 ? 'entry' : index === 4 ? 'lurker' : 'support';
        dest = pickSeparatedHoldNode(syndicateExecutes, index + 4, usedSynNodes, usedSynPositions, bombsites.B.center);
      } else if (this.currentStrategies.syndicate === 'MID_TO_B_SPLIT') {
        role = index < 3 ? 'entry' : 'support';
        dest = pickSeparatedHoldNode(syndicateExecutes, index + 1, usedSynNodes, usedSynPositions, bombsites.B.center);
      } else {
        role = index === 0 ? 'entry' : index === 1 ? 'lurker' : 'rotator';
        dest = pickSeparatedHoldNode(syndicateExecutes, index, usedSynNodes, usedSynPositions, bombsites.A.center);
      }

      const path = findPathAStar(
        { x: bot.mesh.position.x, y: bot.mesh.position.y, z: bot.mesh.position.z },
        dest,
        undefined,
        mapBlocks,
        navGraph
      );

      const st = this.createBotState(bot, path, role, index, weaponId);
      st.assignedHoldPos = { ...dest };
      this.botStates.set(bot.id, st);
    });

    const usedVgNodes = new Set<string>();
    const usedVgPositions: Vec3[] = [];
    vgBots.forEach((bot, index) => {
      const decision = vgBuys[index];
      bot.armor = decision.buyArmor ? 100 : 0;
      bot.hasHelmet = decision.buyHelmet;
      const weaponId = decision.primaryWeaponId;
      bot.rig?.setWeapon(weaponId);

      let role: BotInternalState['role'] = 'anchor';
      let dest: Vec3 = bombsites.A.center;

      if (this.currentStrategies.vanguard === 'STANDARD_2_1_2') {
        dest = pickSeparatedHoldNode(vanguardHolds, index, usedVgNodes, usedVgPositions, bombsites.A.center);
        role = index === 1 || index === 3 ? 'anchor' : 'rotator';
      } else if (this.currentStrategies.vanguard === 'AGGRESSIVE_MID_CONTROL') {
        dest = pickSeparatedHoldNode(vanguardHolds, index, usedVgNodes, usedVgPositions, bombsites.A.center);
        role = index < 2 ? 'rotator' : 'anchor';
      } else if (this.currentStrategies.vanguard === 'HEAVY_A_STACK') {
        dest = pickSeparatedHoldNode(vanguardHolds, index, usedVgNodes, usedVgPositions, bombsites.A.center);
        role = 'anchor';
      } else {
        dest = pickSeparatedHoldNode(vanguardHolds, index, usedVgNodes, usedVgPositions, bombsites.A.center);
        role = index % 2 === 0 ? 'rotator' : 'anchor';
      }

      const path = findPathAStar(
        { x: bot.mesh.position.x, y: bot.mesh.position.y, z: bot.mesh.position.z },
        dest,
        undefined,
        mapBlocks,
        navGraph
      );

      const st = this.createBotState(bot, path, role, index + 5, weaponId);
      st.assignedHoldPos = { ...dest };
      this.botStates.set(bot.id, st);
    });
  }

  public onSoundEvent(event: SoundEvent): void {
    const config = DIFFICULTY_PRESETS[this.difficulty];
    const effectiveRadius = event.radius * config.hearingScale;

    for (const state of this.botStates.values()) {
      if (state.team === event.team) continue;
      // Recruit bots ignore quiet footsteps unless very close
      if (this.difficulty === 'Recruit' && event.type === 'footstep') {
        const dist = event.pos.distanceTo(state.lastDisplacementPos);
        if (dist > 6.5) continue;
      }
      const dist = event.pos.distanceTo(state.lastDisplacementPos);
      if (dist <= effectiveRadius) {
        state.soundInvestigateTarget = event.pos.clone();
        state.soundInvestigateTimer = event.type === 'gunfire' || event.type === 'bomb' ? 4.2 : 2.6;
        // Hearing a sound alerts the bot to turn & check, never to prefire through walls
        if (state.holdAngleTimer > 0) {
          const dx = event.pos.x - state.lastDisplacementPos.x;
          const dz = event.pos.z - state.lastDisplacementPos.z;
          state.holdWatchYaw = Math.atan2(dx, dz);
        }
      }
    }
  }

  public onFlashbangExploded(flashPos: THREE.Vector3, bots: BotEntity[]): void {
    for (const bot of bots) {
      if (bot.isDead) continue;
      const state = this.botStates.get(bot.id);
      if (!state) continue;

      const botEye: Vec3 = { x: bot.mesh.position.x, y: bot.mesh.position.y + 1.68, z: bot.mesh.position.z };
      const flashVec: Vec3 = { x: flashPos.x, y: flashPos.y, z: flashPos.z };
      const dist = dist3D(botEye, flashVec);
      if (dist > 26) continue;

      // Always pass active smoke occluders + spatialGrid to preserve the deterministic smoke LOS invariant
      const hasFlashLos = hasLineOfSight(
        botEye,
        flashVec,
        this.mapConfig.blocks,
        this.lastSmokeOccluders,
        this.lastSpatialGrid
      );
      if (!hasFlashLos) continue;

      // Convert +Z meshYaw into -Z convention expected by BotBrain.calculateAntiFlashYaw
      const rayYaw = meshYawToRaycastYaw(state.currentYaw);
      const antiFlash = BotBrain.calculateAntiFlashYaw(rayYaw, flashVec, botEye);

      if (antiFlash.shouldTurn) {
        const canDodge = this.difficulty === 'Elite' || this.difficulty === 'Sovereign';
        if (canDodge && dist > 6.5) {
          // Smooth human turn-away (NO robotic instant 180° teleport) + brief partial flash
          state.antiFlashYaw = normalizeAngleRad(antiFlash.targetYaw + Math.PI);
          state.antiFlashTurnTimer = 0.45;
          state.blindTimer = Math.max(state.blindTimer, 0.55);
          this.callbacks.onBotRadioCallout?.(bot, 'Flashing! Turning away!');
        } else {
          // Full tactical flash blindness: bot cannot shoot and retreats toward cover
          const distFactor = Math.max(0.4, 1 - dist / 26);
          state.blindTimer = Math.max(state.blindTimer, 1.4 + distFactor * 1.4);
          state.playerVisibleMs = 0;
          state.botVisibleMs.clear();
          this.callbacks.onBotRadioCallout?.(bot, 'Blinded!');
        }
      } else if (dist < 7.5) {
        // Very close flashbang behind still causes brief stun/daze
        state.blindTimer = Math.max(state.blindTimer, 0.65);
      }
    }
  }

  /**
   * 3-point human visual LOS confirmation (head, upper chest, right shoulder)
   * always passing live smoke occluders and SpatialGrid.
   */
  private hasThreePointVisualLOS(
    botEye: Vec3,
    targetFeet: Vec3,
    targetEye: Vec3,
    blocks: MapBlockCollider[],
    smokeOccluders: SmokeOccluder[],
    spatialGrid?: SpatialGrid
  ): boolean {
    if (hasLineOfSight(botEye, targetEye, blocks, smokeOccluders, spatialGrid)) {
      return true;
    }
    const chestY = targetFeet.y + Math.max(0.75, (targetEye.y - targetFeet.y) * 0.74);
    if (hasLineOfSight(botEye, { x: targetFeet.x, y: chestY, z: targetFeet.z }, blocks, smokeOccluders, spatialGrid)) {
      return true;
    }
    // Check perpendicular shoulder offset so bots notice players peeking half-body around doorframes
    const dx = targetFeet.x - botEye.x;
    const dz = targetFeet.z - botEye.z;
    const len = Math.hypot(dx, dz) || 1;
    const perpX = (-dz / len) * 0.24;
    const perpZ = (dx / len) * 0.24;
    return hasLineOfSight(
      botEye,
      { x: targetFeet.x + perpX, y: chestY + 0.1, z: targetFeet.z + perpZ },
      blocks,
      smokeOccluders,
      spatialGrid
    );
  }

  private findSupportingFloorY(
    x: number,
    y: number,
    z: number,
    colliders: AABBCollider[],
    prevY = y,
    stepTolerance = KINEMATICS.STEP_HEIGHT
  ): number {
    let bestY = 0;
    const r = KINEMATICS.CAPSULE_RADIUS;
    const rSq = r * r;
    const maxAcceptY = Math.max(y, prevY) + stepTolerance;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (b.maxY > maxAcceptY || b.maxY <= bestY) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz <= rSq) {
        bestY = b.maxY;
      }
    }
    return bestY;
  }

  private buildPerceptionConfig(
    config: DifficultyConfig,
    arch: BotArchetype,
    reactionJitterMs: number
  ): PerceptionConfig {
    // Enforce human-realistic floor: no difficulty tier ever produces sub-human 0ms/100ms prefires
    const baseReactionMs =
      this.difficulty === 'Sovereign'
        ? Math.max(165, Math.min(config.reactionTimeMs, arch.reactionTimeMs + 25))
        : Math.max(config.reactionTimeMs, arch.reactionTimeMs);

    return {
      halfFovDeg: config.halfFovDeg,
      fovealHalfFovDeg: config.fovealHalfFovDeg,
      baseReactionMs,
      peripheralPenaltyMs: config.peripheralPenaltyMs,
      distancePenaltyMsPer10m: config.distancePenaltyMsPer10m,
      surprisePenaltyMs: config.surprisePenaltyMs,
      exposureConfirmMs: config.exposureConfirmMs,
      reactionJitterMs,
    };
  }

  private computeThreatWatchYaw(
    botPos: Vec3,
    team: 'Vanguard' | 'Syndicate',
    isBombArmed: boolean,
    bombTargetSite: 'A' | 'B' | null,
    blocks: MapBlockCollider[]
  ): number {
    // Primary expected threat origin: bomb site if armed, else opposing spawn direction
    const { navGraph, bombsites, spawnPoints } = this.mapConfig;
    const threatAnchor: Vec3 = isBombArmed
      ? bombTargetSite === 'A'
        ? bombsites.A.center
        : bombsites.B.center
      : team === 'Vanguard'
        ? spawnPoints.OBSIDIAN_T
        : spawnPoints.VANGUARD_CT;

    const currentNode = findNearestNavNode(botPos, undefined, blocks, navGraph);
    const threatYaw = Math.atan2(threatAnchor.x - botPos.x, threatAnchor.z - botPos.z);
    const eye: Vec3 = { x: botPos.x, y: botPos.y + 1.48, z: botPos.z };

    const isSightlineOpen = (meshYaw: number, probeDist = 3.0): boolean => {
      const probe: Vec3 = {
        x: eye.x + Math.sin(meshYaw) * probeDist,
        y: eye.y,
        z: eye.z + Math.cos(meshYaw) * probeDist,
      };
      return hasLineOfSight(eye, probe, blocks, this.lastSmokeOccluders, this.lastSpatialGrid);
    };

    // 1. Prefer pre-computed doorway watchAngles that have >= 3.0m clear LOS (never stare at walls)
    if (currentNode.watchAngles && currentNode.watchAngles.length > 0) {
      let bestOpenYaw: number | null = null;
      let smallestDelta = Infinity;
      for (const rawWatch of currentNode.watchAngles) {
        const meshWatchYaw = normalizeAngleRad(rawWatch + Math.PI);
        if (!isSightlineOpen(meshWatchYaw, 3.0)) continue;
        const delta = Math.abs(normalizeAngleRad(meshWatchYaw - threatYaw));
        if (delta < smallestDelta) {
          smallestDelta = delta;
          bestOpenYaw = meshWatchYaw;
        }
      }
      if (bestOpenYaw !== null) return bestOpenYaw;
    }

    // 2. Otherwise inspect open corridor neighbors toward the expected threat
    let bestNeighborYaw: number | null = null;
    let bestScore = Infinity;

    for (const neighborId of currentNode.neighbors) {
      const neighbor = navGraph[neighborId];
      if (!neighbor) continue;
      const candYaw = Math.atan2(neighbor.pos.x - botPos.x, neighbor.pos.z - botPos.z);
      if (!isSightlineOpen(candYaw, 3.0)) continue;
      const dToThreat = dist3D(neighbor.pos, threatAnchor);
      if (dToThreat < bestScore) {
        bestScore = dToThreat;
        bestNeighborYaw = candYaw;
      }
    }
    if (bestNeighborYaw !== null) return bestNeighborYaw;

    // 3. Radial fallback: pick the closest open >= 3.0m sightline to threatYaw so bots never face walls
    if (isSightlineOpen(threatYaw, 3.0)) return threatYaw;
    let bestRadialYaw = threatYaw;
    let bestRadialDelta = Infinity;
    for (let i = 0; i < 12; i++) {
      const candYaw = normalizeAngleRad(threatYaw + (i * Math.PI * 2) / 12);
      if (!isSightlineOpen(candYaw, 3.0)) continue;
      const delta = Math.abs(normalizeAngleRad(candYaw - threatYaw));
      if (delta < bestRadialDelta) {
        bestRadialDelta = delta;
        bestRadialYaw = candYaw;
      }
    }
    return bestRadialYaw;
  }

  private findNearbyCoverPos(botPos: Vec3, enemyPos: Vec3): Vec3 | null {
    const { navGraph } = this.mapConfig;
    const toEnemyX = enemyPos.x - botPos.x;
    const toEnemyZ = enemyPos.z - botPos.z;
    const enemyDist = Math.hypot(toEnemyX, toEnemyZ) || 1;
    const enemyDirX = toEnemyX / enemyDist;
    const enemyDirZ = toEnemyZ / enemyDist;

    // 1. Prioritize pre-computed retreatNodeIds from current nav node
    const currentNode = findNearestNavNode(botPos, undefined, undefined, navGraph);
    if (currentNode.retreatNodeIds && currentNode.retreatNodeIds.length > 0) {
      let bestRetreat: Vec3 | null = null;
      let bestRetreatScore = Infinity;
      for (const retreatId of currentNode.retreatNodeIds) {
        const rNode = navGraph[retreatId];
        if (!rNode || Math.abs(rNode.pos.y - botPos.y) > 1.3) continue;
        const dx = rNode.pos.x - botPos.x;
        const dz = rNode.pos.z - botPos.z;
        const dist = Math.hypot(dx, dz);
        const dotTowardEnemy = dist > 0.2 ? (dx * enemyDirX + dz * enemyDirZ) / dist : 0;
        const score = dist + Math.max(0, dotTowardEnemy) * 10.0;
        if (score < bestRetreatScore) {
          bestRetreatScore = score;
          bestRetreat = rNode.pos;
        }
      }
      if (bestRetreat) return bestRetreat;
    }

    // 2. Fallback scan across HIGH cover nav nodes
    let bestPos: Vec3 | null = null;
    let bestScore = Infinity;

    for (const key of Object.keys(navGraph)) {
      const node = navGraph[key];
      if (node.coverType !== 'HIGH') continue;
      const dx = node.pos.x - botPos.x;
      const dz = node.pos.z - botPos.z;
      const dy = Math.abs(node.pos.y - botPos.y);
      if (dy > 1.2) continue;
      const dist = Math.hypot(dx, dz);
      if (dist > 14.5) continue;

      const dotTowardEnemy = dist > 0.2 ? (dx * enemyDirX + dz * enemyDirZ) / dist : 0;
      const score = dist + Math.max(0, dotTowardEnemy) * 8.0;
      if (score < bestScore) {
        bestScore = score;
        bestPos = node.pos;
      }
    }

    return bestPos;
  }

  private applyHorizontalMovement(
    bot: BotEntity,
    state: BotInternalState,
    dirX: number,
    dirZ: number,
    desiredSpeed: number,
    dt: number,
    colliders: AABBCollider[]
  ): { speed: number; isMoving: boolean } {
    const botPos = bot.mesh.position;

    // Smooth acceleration/counter-strafe braking (CS2 crisp stop)
    const targetVx = dirX * desiredSpeed;
    const targetVz = dirZ * desiredSpeed;
    const accelRate = desiredSpeed < 0.1 ? 26.0 : 16.0;
    const blend = 1 - Math.exp(-accelRate * dt);
    const nextVx = bot.vx + (targetVx - bot.vx) * blend;
    const nextVz = bot.vz + (targetVz - bot.vz) * blend;

    const resolved = resolveHorizontalAABB(
      botPos.x,
      botPos.y,
      botPos.z,
      nextVx,
      nextVz,
      dt,
      KINEMATICS.CAPSULE_RADIUS,
      state.isCrouching ? KINEMATICS.CAPSULE_HEIGHT_CROUCH : KINEMATICS.CAPSULE_HEIGHT_STAND,
      colliders,
      true,
      KINEMATICS.STEP_HEIGHT,
      this.mapConfig.bounds
    );

    const prevY = resolved.y;
    const floorY = this.findSupportingFloorY(resolved.x, prevY, resolved.z, colliders, prevY, KINEMATICS.STEP_HEIGHT);
    let nextY = prevY;
    if (nextY > floorY + 0.02) {
      if (nextY - floorY <= KINEMATICS.STEP_HEIGHT && state.vy <= 0) {
        // Source-style smooth step-down on ramps/stairs so bots stay grounded
        nextY = floorY;
        state.vy = 0;
      } else {
        state.vy -= KINEMATICS.GRAVITY * dt;
        const proposedY = nextY + state.vy * dt;
        // Swept check ensures falling bots never tunnel through thin 0.125m floor slabs
        const sweptFloorY = this.findSupportingFloorY(resolved.x, prevY, resolved.z, colliders, prevY, 0.25);
        const landY = Math.max(floorY, sweptFloorY);
        if (proposedY <= landY) {
          nextY = landY;
          state.vy = 0;
        } else {
          nextY = proposedY;
        }
      }
    } else {
      nextY = floorY;
      state.vy = 0;
    }

    bot.mesh.position.set(resolved.x, nextY, resolved.z);
    bot.vx = desiredSpeed < 0.1 && Math.hypot(resolved.vx, resolved.vz) < 0.25 ? 0 : resolved.vx;
    bot.vz = desiredSpeed < 0.1 && Math.hypot(resolved.vx, resolved.vz) < 0.25 ? 0 : resolved.vz;

    const resolvedSpeed = Math.hypot(bot.vx, bot.vz);
    return {
      speed: resolvedSpeed > 0.12 ? resolvedSpeed : 0,
      isMoving: resolvedSpeed > 0.12,
    };
  }

  private computeBotShotSpread(
    config: DifficultyConfig,
    skill: number,
    burstShotIndex: number,
    horizontalSpeed: number,
    isCrouching: boolean
  ): number {
    const skillSpread = Math.max(0.008, (100 - skill) * 0.00072);
    let spread = Math.max(config.spreadAngleRad * 0.85, skillSpread);
    // Progressive burst bloom (realistic recoil rise across shots 2-5)
    spread += Math.min(4, burstShotIndex) * 0.0065;
    // Movement inaccuracy penalty if firing during CQB emergency strafe
    if (horizontalSpeed > KINEMATICS.PINPOINT_ACCURACY_THRESHOLD) {
      spread += Math.min(0.045, horizontalSpeed * 0.012);
    }
    if (isCrouching) {
      spread *= 0.82;
    }
    return spread;
  }

  public update(
    bots: BotEntity[],
    dt: number,
    colliders: AABBCollider[],
    blocks: MapBlockCollider[],
    playerFeetPos: THREE.Vector3,
    playerEye: THREE.Vector3,
    smokeOccluders: SmokeOccluder[] = [],
    isBombArmed = false,
    bombTargetSite: 'A' | 'B' | null = null,
    playerHealth = 100,
    playerArmor = 100,
    playerTeam: 'Vanguard' | 'Syndicate' = 'Vanguard',
    isFreezeTime = false,
    spatialGrid?: SpatialGrid,
    playerHasHelmet = true,
    cameraForward?: THREE.Vector3,
    radioComms?: RadioCommsManager
  ): void {
    const clampedDt = Math.min(0.05, Math.max(0.0001, dt));
    const config = DIFFICULTY_PRESETS[this.difficulty];
    const now = performance.now();
    const roundElapsed = (now - this.roundStartTime) / 1000;
    this.lastSmokeOccluders = smokeOccluders;
    this.lastSpatialGrid = spatialGrid;

    // Estimate player horizontal velocity for realistic human moving-target tracking lag
    if (this.hasLastPlayerFeet) {
      const invDt = 1 / clampedDt;
      const rawVx = (playerFeetPos.x - this.lastPlayerFeet.x) * invDt;
      const rawVz = (playerFeetPos.z - this.lastPlayerFeet.z) * invDt;
      const vBlend = 1 - Math.exp(-12 * clampedDt);
      this.playerVelX += (Math.max(-9, Math.min(9, rawVx)) - this.playerVelX) * vBlend;
      this.playerVelZ += (Math.max(-9, Math.min(9, rawVz)) - this.playerVelZ) * vBlend;
    }
    this.lastPlayerFeet.copy(playerFeetPos);
    this.hasLastPlayerFeet = true;

    for (let bIdx = 0; bIdx < bots.length; bIdx++) {
      const bot = bots[bIdx];
      const dxCam = bot.mesh.position.x - playerEye.x;
      const dyCam = bot.mesh.position.y + 1.0 - playerEye.y;
      const dzCam = bot.mesh.position.z - playerEye.z;
      const camDist = Math.hypot(dxCam, dyCam - 1.0, dzCam);
      const isBehindCamera = cameraForward
        ? dxCam * cameraForward.x + dyCam * cameraForward.y + dzCam * cameraForward.z < -2.0
        : false;

      if (bot.isDead) {
        bot.vx = 0;
        bot.vz = 0;
        bot.rig?.update(clampedDt, {
          isMoving: false,
          speed: 0,
          isDead: true,
          healthRatio: 0,
          team: bot.team,
          name: bot.name,
          cameraDistance: camDist,
          isBehindCamera,
        });
        continue;
      }

      if (isFreezeTime) {
        bot.vx = 0;
        bot.vz = 0;
        bot.rig?.update(clampedDt, {
          isMoving: false,
          speed: 0,
          isDead: false,
          healthRatio: Math.max(0, bot.health / bot.maxHealth),
          team: bot.team,
          name: bot.name,
          cameraDistance: camDist,
          isBehindCamera,
        });
        continue;
      }

      let state = this.botStates.get(bot.id);
      if (!state) {
        const fallbackWp = bot.team === 'Vanguard' ? 'vanguard-m4' : 'garam-47';
        state = this.createBotState(bot, [bot.mesh.position.clone()], 'entry', bIdx, fallbackWp);
        this.botStates.set(bot.id, state);
      }

      const botWeapon = WEAPONS[state.weaponId] ?? WEAPONS[bot.team === 'Vanguard' ? 'vanguard-m4' : 'garam-47'];
      const shotIntervalSec = Math.max(0.068, 60 / Math.max(60, botWeapon.fireRateRpm));

      state.swayPhase += clampedDt;
      state.perceptionTimer -= clampedDt;
      const doPerceptionTick = state.perceptionTimer <= 0;
      if (doPerceptionTick) {
        // Staggered 20Hz perception cadence (0.05s + small per-bot phase spread)
        state.perceptionTimer = 0.05 + (bIdx % 3) * 0.004;
      }

      const botPos = bot.mesh.position;
      const eyeHeight = state.isCrouching ? 1.24 : 1.68;
      _botEye.set(botPos.x, botPos.y + eyeHeight, botPos.z);

      // Update reload, flash blindness, anti-flash dodge, and audio investigation timers
      if (state.isReloading) {
        state.reloadTimeRemaining -= clampedDt;
        if (state.reloadTimeRemaining <= 0) {
          state.isReloading = false;
          state.ammo = botWeapon.magCapacity;
          state.burstRemaining = 0;
          state.burstShotIndex = 0;
        }
      }

      if (state.blindTimer > 0) {
        state.blindTimer = Math.max(0, state.blindTimer - clampedDt);
      }

      if (state.antiFlashTurnTimer > 0) {
        state.antiFlashTurnTimer = Math.max(0, state.antiFlashTurnTimer - clampedDt);
        const turnRes = BotBrain.stepHumanAim({
          currentYaw: state.currentYaw,
          currentPitch: state.currentPitch,
          desiredYaw: state.antiFlashYaw,
          desiredPitch: 0,
          dt: clampedDt,
          slewRateDegPerSec: state.archetype.slewRateDegPerSec * 1.15,
        });
        state.currentYaw = turnRes.nextYaw;
        state.currentPitch = turnRes.nextPitch;
        bot.mesh.rotation.y = state.currentYaw;
      }

      if (state.soundInvestigateTimer > 0) {
        state.soundInvestigateTimer -= clampedDt;
        if (state.soundInvestigateTimer <= 0) {
          state.soundInvestigateTarget = null;
        }
      }

      const perceptionCfg = this.buildPerceptionConfig(config, state.archetype, state.reactionJitterMs);
      const currentHozSpeed = Math.hypot(bot.vx, bot.vz);

      // --- 1. Human-Perception Player Engagement (ZERO Prefires, 3-Point LOS @ 20Hz) ---
      let engagedPlayer = false;
      const distToPlayer = botPos.distanceTo(playerFeetPos);

      if (bot.team !== playerTeam && playerHealth > 0 && distToPlayer <= 52 && state.blindTimer <= 0.15) {
        // 1. Hard unbypassable angular check (yaw ±55°, pitch ±38°) BEFORE LOS or reaction accumulation
        const pDx = playerEye.x - _botEye.x;
        const pDy = playerEye.y - _botEye.y;
        const pDz = playerEye.z - _botEye.z;
        const pHozDist = Math.hypot(pDx, pDz);
        const angleToPlayer = Math.atan2(pDx, pDz);
        const yawDeltaToPlayer = Math.abs(normalizeAngleRad(angleToPlayer - state.currentYaw));
        const pitchToPlayer = Math.atan2(pDy, Math.max(0.001, pHozDist));
        const pitchDeltaToPlayer = Math.abs(pitchToPlayer - state.currentPitch);

        const isPlayerInCone = yawDeltaToPlayer <= MAX_FOV_YAW_RAD && pitchDeltaToPlayer <= MAX_FOV_PITCH_RAD;

        if (!isPlayerInCone) {
          state.playerVisibleMs = Math.max(0, state.playerVisibleMs - clampedDt * 1500);
          state.playerLostSec += clampedDt;
          state.cachedPlayerLos = false;
        } else {
          if (doPerceptionTick) {
            state.cachedPlayerLos = this.hasThreePointVisualLOS(
              { x: _botEye.x, y: _botEye.y, z: _botEye.z },
              { x: playerFeetPos.x, y: playerFeetPos.y, z: playerFeetPos.z },
              { x: playerEye.x, y: playerEye.y, z: playerEye.z },
              blocks,
              smokeOccluders,
              spatialGrid
            );
          }

          if (!state.cachedPlayerLos) {
            state.playerVisibleMs = Math.max(0, state.playerVisibleMs - clampedDt * 1500);
            state.playerLostSec += clampedDt;
          } else {
            const wasMovingOrSurprised = currentHozSpeed > 1.2 || state.playerLostSec > 0.35;
            const perception = BotBrain.evaluateVisualPerception(
              state.currentYaw,
              { x: _botEye.x, y: _botEye.y, z: _botEye.z },
              { x: playerEye.x, y: playerEye.y, z: playerEye.z },
              state.cachedPlayerLos,
              perceptionCfg,
              wasMovingOrSurprised
            );

        if (perception.spotted) {
          engagedPlayer = true;
          this.callbacks.onEnemySpotted?.(bot);

          if (!state.announcedPlayerContact) {
            state.announcedPlayerContact = true;
            this.callbacks.onBotRadioCallout?.(bot, 'Visual contact on hostile!');
          }

          state.playerLostSec = 0;
          state.playerVisibleMs += clampedDt * 1000;
          state.holdAngleTimer = 0;

          // Select realistic chest/upper-torso/head target point (never 100% forehead lock)
          const isPlayerCrouched = playerEye.y - playerFeetPos.y < 1.35;
          const aimRoll = Math.abs(Math.sin(state.swayPhase * 3.1 + bIdx * 1.7 + state.burstShotIndex * 2.3));
          const desiredAimPt = BotBrain.selectAimTargetPoint(
            { x: playerFeetPos.x, y: playerFeetPos.y, z: playerFeetPos.z },
            { x: playerEye.x, y: playerEye.y, z: playerEye.z },
            isPlayerCrouched,
            state.archetype.skill,
            state.burstShotIndex,
            aimRoll
          );

          // Apply realistic human visual tracking inertia so fast-peeking players aren't glued on frame 0
          if (!state.hasTrackedPlayer) {
            const lagSec = config.trackingTauSec * 0.85;
            state.trackedPlayerPos.set(
              desiredAimPt.x - this.playerVelX * lagSec,
              desiredAimPt.y,
              desiredAimPt.z - this.playerVelZ * lagSec
            );
            state.hasTrackedPlayer = true;
          } else {
            const trackBlend = 1 - Math.exp(-clampedDt / config.trackingTauSec);
            state.trackedPlayerPos.x += (desiredAimPt.x - state.trackedPlayerPos.x) * trackBlend;
            state.trackedPlayerPos.y += (desiredAimPt.y - state.trackedPlayerPos.y) * trackBlend;
            state.trackedPlayerPos.z += (desiredAimPt.z - state.trackedPlayerPos.z) * trackBlend;
          }

          _aimVec.subVectors(state.trackedPlayerPos, _botEye);
          const aimDist = _aimVec.length() || 1;
          const desiredYaw = Math.atan2(_aimVec.x, _aimVec.z);
          const desiredPitch = Math.asin(Math.max(-0.98, Math.min(0.98, _aimVec.y / aimDist)));

          // Subtle natural human micro-sway scaled inversely with skill
          const swayAmp = ((100 - state.archetype.skill) / 100) * 0.018;
          const aimRes = BotBrain.stepHumanAim({
            currentYaw: state.currentYaw,
            currentPitch: state.currentPitch,
            desiredYaw,
            desiredPitch,
            dt: clampedDt,
            slewRateDegPerSec: state.archetype.slewRateDegPerSec,
            swayYawRad: Math.sin(state.swayPhase * 4.3) * swayAmp,
            swayPitchRad: Math.cos(state.swayPhase * 3.7) * swayAmp * 0.65,
          });
          state.currentYaw = aimRes.nextYaw;
          state.currentPitch = aimRes.nextPitch;
          state.targetYaw = desiredYaw;
          bot.mesh.rotation.y = state.currentYaw;

          // Tactical combat footwork: counter-strafe burst -> lateral strafe -> cover on reload/low HP
          const nearbyCover = this.findNearbyCoverPos(
            { x: botPos.x, y: botPos.y, z: botPos.z },
            { x: playerFeetPos.x, y: playerFeetPos.y, z: playerFeetPos.z }
          );
          const footwork = BotBrain.evaluateCombatFootwork({
            botPos: { x: botPos.x, y: botPos.y, z: botPos.z },
            enemyPos: { x: playerFeetPos.x, y: playerFeetPos.y, z: playerFeetPos.z },
            healthRatio: Math.max(0, bot.health / bot.maxHealth),
            isReloading: state.isReloading,
            isBlinded: state.blindTimer > 0.15,
            skill: state.archetype.skill,
            aggression: state.archetype.aggression,
            phaseTimer: state.combatPhaseTimer,
            currentPhase: state.combatPhase,
            strafeSign: state.strafeSign,
            nearbyCoverPos: nearbyCover,
            dt: clampedDt,
          });
          state.combatPhase = footwork.nextPhase;
          state.combatPhaseTimer = footwork.nextPhaseTimer;
          state.strafeSign = footwork.nextStrafeSign;
          state.isCrouching = footwork.shouldCrouch;

          const moveRes = this.applyHorizontalMovement(
            bot,
            state,
            footwork.moveDirX,
            footwork.moveDirZ,
            footwork.desiredSpeed,
            clampedDt,
            colliders
          );

          // Tactical utility throw at mid-long range (when already aware)
          const canUseUtil = config.canUseUtility && state.archetype.skill >= 75;
          if (
            canUseUtil &&
            !state.hasThrownFlash &&
            state.playerVisibleMs > perception.effectiveReactionMs * 0.8 &&
            distToPlayer > 18 &&
            distToPlayer < 34
          ) {
            state.hasThrownFlash = true;
            this.callbacks.onBotThrowUtility?.(bot, 'flash', playerFeetPos.clone());
            this.callbacks.onBotRadioCallout?.(bot, 'Deploying tactical flash!');
          }

          if (!state.isReloading && state.ammo <= 0) {
            state.isReloading = true;
            state.reloadTimeRemaining = botWeapon.reloadTime || 2.4;
          }

          // Strict anti-prefire fire gate: must have LOS + FOV + full reaction time + aligned crosshair + counter-strafed
          const minReactionMs =
            this.difficulty === 'Recruit' ? 480 : this.difficulty === 'Veteran' ? 310 : this.difficulty === 'Elite' ? 220 : 175;
          const fireThresholdDeg = state.weaponId === 'sovereign-awp' ? Math.min(config.maxFireErrorDeg, 2.5) : config.maxFireErrorDeg;
          const permittedToFire = BotBrain.canBotFire({
            spotted: true,
            isReloading: state.isReloading,
            ammo: state.ammo,
            blindTimerSec: state.blindTimer,
            visibleDurationMs: state.playerVisibleMs,
            effectiveReactionMs: Math.max(minReactionMs, perception.effectiveReactionMs),
            aimErrorDeg: aimRes.totalErrorDeg,
            maxFireErrorDeg: fireThresholdDeg,
            horizontalSpeed: moveRes.speed,
            maxFireSpeed: config.maxFireSpeed,
            targetDistance: distToPlayer,
          });

          if (permittedToFire && (now - bot.lastShotTime > config.burstCooldownMs || state.burstRemaining > 0)) {
            if (state.burstRemaining === 0) {
              state.burstRemaining = botWeapon.fireMode === 'semi' ? 1 : config.burstCount;
              state.burstShotIndex = 0;
              state.burstTimer = 0;
            }

            state.burstTimer -= clampedDt;
            if (state.burstTimer <= 0) {
              state.burstTimer = shotIntervalSec;
              state.burstRemaining--;
              bot.lastShotTime = now;
              state.ammo--;

              const spreadAngle = this.computeBotShotSpread(
                config,
                state.archetype.skill,
                state.burstShotIndex,
                moveRes.speed,
                state.isCrouching
              );
              state.burstShotIndex++;

              const spreadX = (Math.random() - 0.5) * 2 * spreadAngle;
              const spreadY = (Math.random() - 0.5) * 2 * spreadAngle;

              // CRITICAL: Fire strictly along the bot's ACTUAL slewed crosshair (currentYaw, currentPitch)
              const rayYaw = meshYawToRaycastYaw(state.currentYaw);
              const rayDirVec = computeSpreadRayDirection(rayYaw, state.currentPitch, spreadX, spreadY);

              const sharedRay: Ray = {
                origin: { x: _botEye.x, y: _botEye.y, z: _botEye.z },
                direction: rayDirVec,
              };

              const playerTarget: TargetCollider = {
                id: 'player',
                name: 'Player',
                team: playerTeam,
                center: { x: playerFeetPos.x, y: playerFeetPos.y, z: playerFeetPos.z },
                hasHelmet: playerHasHelmet,
                armor: playerArmor,
                isDead: playerHealth <= 0,
                isCrouched: isPlayerCrouched,
                hitboxes: {
                  head: { x: playerFeetPos.x, y: playerEye.y + 0.04, z: playerFeetPos.z },
                  chest: { x: playerFeetPos.x, y: playerFeetPos.y + (isPlayerCrouched ? 0.82 : 1.25), z: playerFeetPos.z },
                  stomach: { x: playerFeetPos.x, y: playerFeetPos.y + (isPlayerCrouched ? 0.62 : 0.95), z: playerFeetPos.z },
                  leftArm: { x: playerFeetPos.x - 0.28, y: playerFeetPos.y + (isPlayerCrouched ? 0.80 : 1.20), z: playerFeetPos.z },
                  rightArm: { x: playerFeetPos.x + 0.28, y: playerFeetPos.y + (isPlayerCrouched ? 0.80 : 1.20), z: playerFeetPos.z },
                  leftLeg: { x: playerFeetPos.x - 0.16, y: playerFeetPos.y + (isPlayerCrouched ? 0.30 : 0.45), z: playerFeetPos.z },
                  rightLeg: { x: playerFeetPos.x + 0.16, y: playerFeetPos.y + (isPlayerCrouched ? 0.30 : 0.45), z: playerFeetPos.z },
                },
              };

              const hits = executeTacticalRaycast(
                sharedRay,
                botWeapon.damage,
                botWeapon.armorPenetration,
                botWeapon.penetrationPower,
                200,
                blocks,
                [playerTarget],
                botWeapon.damageDropoffPer10m,
                spatialGrid,
                botWeapon.headDamageMultiplier
              );

              _terminalPoint.set(
                _botEye.x + rayDirVec.x * 80,
                _botEye.y + rayDirVec.y * 80,
                _botEye.z + rayDirVec.z * 80
              );

              for (const hit of hits) {
                _hitPoint.set(hit.point.x, hit.point.y, hit.point.z);
                _terminalPoint.copy(_hitPoint);

                if (hit.targetId === 'player') {
                  this.callbacks.onBotShootPlayer(
                    bot,
                    hit.awardedDamage,
                    hit.hitZone || 'CHEST',
                    hit.isHeadshot || false,
                    hit.penetratedWalls,
                    hit.armorDamage
                  );
                  break;
                } else if (hit.material) {
                  _hitNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
                  this.callbacks.onBotSpawnDecal?.(_hitPoint, _hitNormal, hit.material);
                }
              }

              bot.rig?.triggerMuzzleFlash();
              this.callbacks.onBotSpawnTracer?.(_botEye, _terminalPoint, state.weaponId);
            }
          }

          bot.rig?.update(clampedDt, {
            isMoving: moveRes.isMoving,
            speed: moveRes.speed,
            isDead: false,
            healthRatio: Math.max(0, bot.health / bot.maxHealth),
            team: bot.team,
            name: bot.name,
            isCrouching: state.isCrouching,
            isReloading: state.isReloading,
            pitch: state.currentPitch,
            yawOffset: normalizeAngleRad(desiredYaw - state.currentYaw),
            cameraDistance: camDist,
            isBehindCamera,
            velocity: { x: bot.vx, z: bot.vz },
          });
          continue;
        }
          }
        }
      }

      // Target not currently spotted: decay visual confirmation so re-peeks NEVER trigger instant prefires
      if (!engagedPlayer) {
        state.playerLostSec += clampedDt;
        state.playerVisibleMs = Math.max(0, state.playerVisibleMs - clampedDt * 1500);
        if (state.playerLostSec > 0.12) {
          // Cap residual alertness below 40% of base reaction so re-peeking requires real visual re-acquisition
          state.playerVisibleMs = Math.min(state.playerVisibleMs, perceptionCfg.baseReactionMs * 0.40);
        }
        if (state.playerLostSec > 1.2) {
          state.hasTrackedPlayer = false;
          state.announcedPlayerContact = false;
          state.burstRemaining = 0;
          state.burstShotIndex = 0;
          state.reactionJitterMs = BotBrain.computeGaussianJitterMs(state.swayPhase * 13.7 + bIdx * 5.3);
        }
      }

      // --- 2. Human-Perception Inter-Bot Combat (FOV + Reaction + Counter-Strafe @ 20Hz LOS) ---
      let engagedBotTarget: BotEntity | null = null;
      let engagedBotPerception: PerceptionResult | null = null;
      const enemyTeam = bot.team === 'Syndicate' ? 'Vanguard' : 'Syndicate';

      if (state.blindTimer <= 0.15) {
        let bestEnemyDist = Infinity;
        for (const other of bots) {
          if (other.team !== enemyTeam || other.isDead) {
            state.botVisibleMs.delete(other.id);
            state.cachedBotLos.delete(other.id);
            continue;
          }
          const distToOther = botPos.distanceTo(other.mesh.position);
          if (distToOther > 44) {
            state.botVisibleMs.set(other.id, Math.max(0, (state.botVisibleMs.get(other.id) ?? 0) - clampedDt * 1500));
            state.cachedBotLos.set(other.id, false);
            continue;
          }

          // Hard unbypassable angular check (yaw ±55°, pitch ±38°) BEFORE LOS or reaction accumulation
          const bDx = other.mesh.position.x - _botEye.x;
          const bDy = (other.mesh.position.y + 1.68) - _botEye.y;
          const bDz = other.mesh.position.z - _botEye.z;
          const bHozDist = Math.hypot(bDx, bDz);
          const angleToOther = Math.atan2(bDx, bDz);
          const yawDeltaToOther = Math.abs(normalizeAngleRad(angleToOther - state.currentYaw));
          const pitchToOther = Math.atan2(bDy, Math.max(0.001, bHozDist));
          const pitchDeltaToOther = Math.abs(pitchToOther - state.currentPitch);

          if (yawDeltaToOther > MAX_FOV_YAW_RAD || pitchDeltaToOther > MAX_FOV_PITCH_RAD) {
            state.botVisibleMs.set(other.id, Math.max(0, (state.botVisibleMs.get(other.id) ?? 0) - clampedDt * 1500));
            state.cachedBotLos.set(other.id, false);
            continue;
          }

          _targetEye.set(other.mesh.position.x, other.mesh.position.y + 1.68, other.mesh.position.z);
          let los = state.cachedBotLos.get(other.id) ?? false;
          if (doPerceptionTick) {
            los = this.hasThreePointVisualLOS(
              { x: _botEye.x, y: _botEye.y, z: _botEye.z },
              { x: other.mesh.position.x, y: other.mesh.position.y, z: other.mesh.position.z },
              { x: _targetEye.x, y: _targetEye.y, z: _targetEye.z },
              blocks,
              smokeOccluders,
              spatialGrid
            );
            state.cachedBotLos.set(other.id, los);
          }

          const p = BotBrain.evaluateVisualPerception(
            state.currentYaw,
            { x: _botEye.x, y: _botEye.y, z: _botEye.z },
            { x: _targetEye.x, y: _targetEye.y, z: _targetEye.z },
            los,
            perceptionCfg,
            currentHozSpeed > 1.2
          );

          if (p.spotted) {
            const prevMs = state.botVisibleMs.get(other.id) ?? 0;
            state.botVisibleMs.set(other.id, prevMs + clampedDt * 1000);
            if (distToOther < bestEnemyDist) {
              bestEnemyDist = distToOther;
              engagedBotTarget = other;
              engagedBotPerception = p;
            }
          } else {
            const prevMs = state.botVisibleMs.get(other.id) ?? 0;
            state.botVisibleMs.set(other.id, Math.max(0, prevMs - clampedDt * 1500));
          }
        }
      }

      if (engagedBotTarget && engagedBotPerception) {
        state.holdAngleTimer = 0;
        const aimRoll = Math.abs(Math.sin(state.swayPhase * 2.9 + bIdx * 1.1 + state.burstShotIndex * 1.9));
        const desiredBotAimPt = BotBrain.selectAimTargetPoint(
          { x: engagedBotTarget.mesh.position.x, y: engagedBotTarget.mesh.position.y, z: engagedBotTarget.mesh.position.z },
          { x: engagedBotTarget.mesh.position.x, y: engagedBotTarget.mesh.position.y + 1.68, z: engagedBotTarget.mesh.position.z },
          false,
          state.archetype.skill,
          state.burstShotIndex,
          aimRoll
        );

        if (state.trackedBotId !== engagedBotTarget.id) {
          state.trackedBotId = engagedBotTarget.id;
          state.trackedBotPos.set(desiredBotAimPt.x, desiredBotAimPt.y, desiredBotAimPt.z);
        } else {
          const trackBlend = 1 - Math.exp(-clampedDt / config.trackingTauSec);
          state.trackedBotPos.x += (desiredBotAimPt.x - state.trackedBotPos.x) * trackBlend;
          state.trackedBotPos.y += (desiredBotAimPt.y - state.trackedBotPos.y) * trackBlend;
          state.trackedBotPos.z += (desiredBotAimPt.z - state.trackedBotPos.z) * trackBlend;
        }

        _aimVec.subVectors(state.trackedBotPos, _botEye);
        const aimDist = _aimVec.length() || 1;
        const desiredYaw = Math.atan2(_aimVec.x, _aimVec.z);
        const desiredPitch = Math.asin(Math.max(-0.98, Math.min(0.98, _aimVec.y / aimDist)));

        const aimRes = BotBrain.stepHumanAim({
          currentYaw: state.currentYaw,
          currentPitch: state.currentPitch,
          desiredYaw,
          desiredPitch,
          dt: clampedDt,
          slewRateDegPerSec: state.archetype.slewRateDegPerSec,
        });
        state.currentYaw = aimRes.nextYaw;
        state.currentPitch = aimRes.nextPitch;
        state.targetYaw = desiredYaw;
        bot.mesh.rotation.y = state.currentYaw;

        const nearbyCover = this.findNearbyCoverPos(
          { x: botPos.x, y: botPos.y, z: botPos.z },
          { x: engagedBotTarget.mesh.position.x, y: engagedBotTarget.mesh.position.y, z: engagedBotTarget.mesh.position.z }
        );
        const footwork = BotBrain.evaluateCombatFootwork({
          botPos: { x: botPos.x, y: botPos.y, z: botPos.z },
          enemyPos: { x: engagedBotTarget.mesh.position.x, y: engagedBotTarget.mesh.position.y, z: engagedBotTarget.mesh.position.z },
          healthRatio: Math.max(0, bot.health / bot.maxHealth),
          isReloading: state.isReloading,
          isBlinded: state.blindTimer > 0.15,
          skill: state.archetype.skill,
          aggression: state.archetype.aggression,
          phaseTimer: state.combatPhaseTimer,
          currentPhase: state.combatPhase,
          strafeSign: state.strafeSign,
          nearbyCoverPos: nearbyCover,
          dt: clampedDt,
        });
        state.combatPhase = footwork.nextPhase;
        state.combatPhaseTimer = footwork.nextPhaseTimer;
        state.strafeSign = footwork.nextStrafeSign;
        state.isCrouching = footwork.shouldCrouch;

        const moveRes = this.applyHorizontalMovement(
          bot,
          state,
          footwork.moveDirX,
          footwork.moveDirZ,
          footwork.desiredSpeed,
          clampedDt,
          colliders
        );

        if (!state.isReloading && state.ammo <= 0) {
          state.isReloading = true;
          state.reloadTimeRemaining = botWeapon.reloadTime || 2.4;
        }

        const visibleBotMs = state.botVisibleMs.get(engagedBotTarget.id) ?? 0;
        const minBotReactionMs =
          this.difficulty === 'Recruit' ? 480 : this.difficulty === 'Veteran' ? 310 : this.difficulty === 'Elite' ? 220 : 175;
        const botFireThresholdDeg = state.weaponId === 'sovereign-awp' ? Math.min(config.maxFireErrorDeg, 2.5) : config.maxFireErrorDeg;
        const permittedToFire = BotBrain.canBotFire({
          spotted: true,
          isReloading: state.isReloading,
          ammo: state.ammo,
          blindTimerSec: state.blindTimer,
          visibleDurationMs: visibleBotMs,
          effectiveReactionMs: Math.max(minBotReactionMs, engagedBotPerception.effectiveReactionMs),
          aimErrorDeg: aimRes.totalErrorDeg,
          maxFireErrorDeg: botFireThresholdDeg,
          horizontalSpeed: moveRes.speed,
          maxFireSpeed: config.maxFireSpeed,
          targetDistance: engagedBotPerception.distance,
        });

        if (permittedToFire && (now - bot.lastShotTime > config.burstCooldownMs || state.burstRemaining > 0)) {
          if (state.burstRemaining === 0) {
            state.burstRemaining = botWeapon.fireMode === 'semi' ? 1 : config.burstCount;
            state.burstShotIndex = 0;
            state.burstTimer = 0;
          }
          state.burstTimer -= clampedDt;

          if (state.burstTimer <= 0) {
            state.burstTimer = shotIntervalSec;
            state.burstRemaining--;
            bot.lastShotTime = now;
            state.ammo--;

            const spreadAngle = this.computeBotShotSpread(
              config,
              state.archetype.skill,
              state.burstShotIndex,
              moveRes.speed,
              state.isCrouching
            );
            state.burstShotIndex++;

            const spreadX = (Math.random() - 0.5) * 2 * spreadAngle;
            const spreadY = (Math.random() - 0.5) * 2 * spreadAngle;
            const rayYaw = meshYawToRaycastYaw(state.currentYaw);
            const rayDirVec = computeSpreadRayDirection(rayYaw, state.currentPitch, spreadX, spreadY);

            const sharedRay: Ray = {
              origin: { x: _botEye.x, y: _botEye.y, z: _botEye.z },
              direction: rayDirVec,
            };

            const targetCol: TargetCollider = {
              id: engagedBotTarget.id,
              name: engagedBotTarget.name,
              team: engagedBotTarget.team,
              center: {
                x: engagedBotTarget.mesh.position.x,
                y: engagedBotTarget.mesh.position.y,
                z: engagedBotTarget.mesh.position.z,
              },
              armor: engagedBotTarget.armor,
              hasHelmet: engagedBotTarget.hasHelmet,
              isDead: engagedBotTarget.isDead,
              yaw: engagedBotTarget.mesh.rotation.y,
              hitboxes: engagedBotTarget.rig?.getWorldHitboxes(),
            };

            const hits = executeTacticalRaycast(
              sharedRay,
              botWeapon.damage,
              botWeapon.armorPenetration,
              botWeapon.penetrationPower,
              180,
              blocks,
              [targetCol],
              botWeapon.damageDropoffPer10m,
              spatialGrid,
              botWeapon.headDamageMultiplier
            );

            _terminalPoint.set(
              _botEye.x + rayDirVec.x * 70,
              _botEye.y + rayDirVec.y * 70,
              _botEye.z + rayDirVec.z * 70
            );

            for (const hit of hits) {
              _hitPoint.set(hit.point.x, hit.point.y, hit.point.z);
              _terminalPoint.copy(_hitPoint);
              if (hit.targetId === engagedBotTarget.id) {
                engagedBotTarget.rig?.triggerFlinch();
                this.callbacks.onBotShootBot(
                  bot,
                  engagedBotTarget,
                  hit.awardedDamage,
                  hit.hitZone || 'CHEST',
                  hit.isHeadshot || false,
                  hit.penetratedWalls,
                  hit.armorDamage
                );
                break;
              }
            }

            bot.rig?.triggerMuzzleFlash();
            this.callbacks.onBotSpawnTracer?.(_botEye, _terminalPoint, state.weaponId);
          }
        }

        bot.rig?.update(clampedDt, {
          isMoving: moveRes.isMoving,
          speed: moveRes.speed,
          isDead: false,
          healthRatio: Math.max(0, bot.health / bot.maxHealth),
          team: bot.team,
          name: bot.name,
          isCrouching: state.isCrouching,
          isReloading: state.isReloading,
          pitch: state.currentPitch,
          yawOffset: normalizeAngleRad(desiredYaw - state.currentYaw),
          cameraDistance: camDist,
          isBehindCamera,
          velocity: { x: bot.vx, z: bot.vz },
        });
        continue;
      }

      // Not currently in an active duel: smoothly level pitch and stand up
      state.isCrouching = false;
      state.trackedBotId = null;
      state.currentPitch += (0 - state.currentPitch) * Math.min(1, 8 * clampedDt);

      // --- 3. Tactical Objective Navigation, Choke Smokes & Angle-Holding ---
      if (
        config.canUseUtility &&
        !state.hasThrownSmoke &&
        roundElapsed > 7.5 &&
        roundElapsed < 32 &&
        state.role === 'support'
      ) {
        const chokeKey = this.mapConfig.smokeChokes[bIdx % this.mapConfig.smokeChokes.length];
        const chokeNode = this.mapConfig.navGraph[chokeKey];
        if (chokeNode) {
          const distChoke = dist3D({ x: botPos.x, y: botPos.y, z: botPos.z }, chokeNode.pos);
          if (distChoke > 9 && distChoke < 24) {
            state.hasThrownSmoke = true;
            this.callbacks.onBotThrowUtility?.(
              bot,
              'smoke',
              new THREE.Vector3(chokeNode.pos.x, chokeNode.pos.y, chokeNode.pos.z)
            );
            this.callbacks.onBotRadioCallout?.(bot, `Smoking ${chokeNode.callout}!`);
          }
        }
      }

      if (isBombArmed) {
        const bombSitePos =
          bombTargetSite === 'A' ? this.mapConfig.bombsites.A.center : this.mapConfig.bombsites.B.center;
        if (bot.team === 'Vanguard') {
          if (state.path.length === 0 || dist3D(state.path[state.path.length - 1], bombSitePos) > 4.0) {
            state.path = findPathAStar(
              { x: botPos.x, y: botPos.y, z: botPos.z },
              bombSitePos,
              undefined,
              blocks,
              this.mapConfig.navGraph
            );
            state.pathIndex = 0;
            state.holdAngleTimer = 0;
          }
        } else if (bot.team === 'Syndicate' && !state.hasCommittedPostPlant) {
          state.hasCommittedPostPlant = true;
          const defenseNodes = Object.values(this.mapConfig.navGraph).filter(
            (n) => dist3D(n.pos, bombSitePos) < 16.5 && n.coverType === 'HIGH'
          );
          const chosen =
            defenseNodes[bIdx % Math.max(1, defenseNodes.length)] ||
            this.mapConfig.navGraph[this.mapConfig.postPlantFallbackNode] ||
            Object.values(this.mapConfig.navGraph)[0];
          state.path = findPathAStar(
            { x: botPos.x, y: botPos.y, z: botPos.z },
            chosen.pos,
            undefined,
            blocks,
            this.mapConfig.navGraph
          );
          state.pathIndex = 0;
          state.holdAngleTimer = 0;
        }
      } else {
        state.hasCommittedPostPlant = false;
      }

      // CS 1.6 Radio Command obedience for friendly bots (Follow Me / Hold Position / Need Backup)
      if (radioComms && bot.team === playerTeam && playerHealth > 0) {
        if (radioComms.escortBotId === bot.id) {
          const distPlayer = Math.hypot(botPos.x - playerFeetPos.x, botPos.z - playerFeetPos.z);
          if (distPlayer <= 2.4) {
            state.holdAngleTimer = Math.max(state.holdAngleTimer, 0.35);
          } else {
            state.holdAngleTimer = 0;
            const pathEnd = state.path[state.path.length - 1];
            if (!pathEnd || dist3D(pathEnd, playerFeetPos) > 2.8) {
              state.path = findPathAStar(
                { x: botPos.x, y: botPos.y, z: botPos.z },
                { x: playerFeetPos.x, y: playerFeetPos.y, z: playerFeetPos.z },
                undefined,
                blocks,
                this.mapConfig.navGraph
              );
              state.pathIndex = 0;
            }
          }
        } else if (radioComms.holdBotIds.has(bot.id)) {
          state.holdAngleTimer = Math.max(state.holdAngleTimer, 1.5);
        } else if (
          radioComms.assistTargetPos &&
          now < radioComms.assistExpireAt &&
          (state.role === 'rotator' || state.role === 'support')
        ) {
          const assistPos = radioComms.assistTargetPos;
          const pathEnd = state.path[state.path.length - 1];
          if (!pathEnd || dist3D(pathEnd, assistPos) > 3.5) {
            state.path = findPathAStar(
              { x: botPos.x, y: botPos.y, z: botPos.z },
              { x: assistPos.x, y: assistPos.y, z: assistPos.z },
              undefined,
              blocks,
              this.mapConfig.navGraph
            );
            state.pathIndex = 0;
            state.holdAngleTimer = 0;
          }
        }
      }

      // If blinded out of combat, retreat carefully toward nearest cover instead of marching forward
      if (state.blindTimer > 0.15) {
        const cover = this.findNearbyCoverPos(
          { x: botPos.x, y: botPos.y, z: botPos.z },
          {
            x: botPos.x + Math.sin(state.currentYaw) * 10,
            y: botPos.y,
            z: botPos.z + Math.cos(state.currentYaw) * 10,
          }
        );
        const moveX = cover ? cover.x - botPos.x : -Math.sin(state.currentYaw);
        const moveZ = cover ? cover.z - botPos.z : -Math.cos(state.currentYaw);
        const len = Math.hypot(moveX, moveZ) || 1;
        const moveRes = this.applyHorizontalMovement(bot, state, moveX / len, moveZ / len, 2.4, clampedDt, colliders);
        bot.rig?.update(clampedDt, {
          isMoving: moveRes.isMoving,
          speed: moveRes.speed,
          isDead: false,
          healthRatio: Math.max(0, bot.health / bot.maxHealth),
          team: bot.team,
          name: bot.name,
          isReloading: state.isReloading,
          cameraDistance: camDist,
          isBehindCamera,
          velocity: { x: bot.vx, z: bot.vz },
        });
        continue;
      }

      // Tactical angle-holding at arrived choke/site position (with personal-space anti-clump)
      if (state.holdAngleTimer > 0) {
        state.holdAngleTimer -= clampedDt;
        _otherPositionsScratch.length = 0;
        let tooClose = false;
        for (let j = 0; j < bots.length; j++) {
          if (j === bIdx || bots[j].isDead) continue;
          const op = bots[j].mesh.position;
          const d = Math.hypot(botPos.x - op.x, botPos.z - op.z);
          if (d < 2.0) tooClose = true;
          _otherPositionsScratch.push({ x: op.x, y: op.y, z: op.z });
        }
        let holdDirX = 0;
        let holdDirZ = 0;
        let holdSpeed = 0;
        if (tooClose) {
          const sep = BotBrain.computeCorridorSeparation(
            { x: botPos.x, y: botPos.y, z: botPos.z },
            0,
            0,
            bIdx,
            _otherPositionsScratch
          );
          holdDirX = sep.dirX;
          holdDirZ = sep.dirZ;
          holdSpeed = 1.8;
        }
        const moveRes = this.applyHorizontalMovement(
          bot,
          state,
          holdDirX,
          holdDirZ,
          holdSpeed,
          clampedDt,
          colliders
        );

        let watchYaw = state.holdWatchYaw;
        if (state.soundInvestigateTarget) {
          watchYaw = Math.atan2(
            state.soundInvestigateTarget.x - botPos.x,
            state.soundInvestigateTarget.z - botPos.z
          );
        } else {
          // Subtle human angle check (±10° gentle sweep watching the threat lane)
          watchYaw = normalizeAngleRad(state.holdWatchYaw + Math.sin(state.swayPhase * 0.75) * 0.18);
        }

        const aimRes = BotBrain.stepHumanAim({
          currentYaw: state.currentYaw,
          currentPitch: state.currentPitch,
          desiredYaw: watchYaw,
          desiredPitch: 0,
          dt: clampedDt,
          slewRateDegPerSec: state.archetype.slewRateDegPerSec * 0.65,
        });
        state.currentYaw = aimRes.nextYaw;
        state.currentPitch = aimRes.nextPitch;
        bot.mesh.rotation.y = state.currentYaw;

        bot.rig?.update(clampedDt, {
          isMoving: moveRes.isMoving,
          speed: moveRes.speed,
          isDead: false,
          healthRatio: Math.max(0, bot.health / bot.maxHealth),
          team: bot.team,
          name: bot.name,
          isReloading: state.isReloading,
          cameraDistance: camDist,
          isBehindCamera,
          velocity: { x: bot.vx, z: bot.vz },
        });
        continue;
      }

      let targetWaypoint = state.path[state.pathIndex] || bot.patrolTarget;

      _toTarget.subVectors(targetWaypoint, botPos);
      _toTarget.y = 0;
      let distToWaypoint = _toTarget.length();

      if (distToWaypoint < 1.55) {
        if (state.pathIndex < state.path.length - 1) {
          state.pathIndex++;
          state.consecutiveStuckCount = 0;
          targetWaypoint = state.path[state.pathIndex];
          _toTarget.subVectors(targetWaypoint, botPos);
          _toTarget.y = 0;
          distToWaypoint = _toTarget.length();
        } else {
          // Arrived at tactical destination! Hold the threat angle before rotating or executing.
          state.holdWatchYaw = this.computeThreatWatchYaw(
            { x: botPos.x, y: botPos.y, z: botPos.z },
            bot.team,
            isBombArmed,
            bombTargetSite,
            blocks
          );

          if (isBombArmed && bot.team === 'Syndicate') {
            // Post-plant Syndicate defenders hold their crossfire angle watching the planted bomb
            state.holdAngleTimer = 2.5;
          } else {
            // Vanguard CT defenders hold their assigned zone angles until contact/plant; T entries rotate faster
            const holdBase = state.archetype.tacticalPatienceSec;
            const roleMul = state.role === 'anchor' ? 1.15 : state.role === 'lurker' ? 1.0 : 0.55;
            state.holdAngleTimer =
              bot.team === 'Vanguard' && !isBombArmed
                ? Math.max(10.0, holdBase * roleMul * 2.5)
                : Math.max(1.4, holdBase * roleMul);

            // Pre-plan next meaningful tactical rotation node strictly >= 3.0m away from all friendly bots' holds & positions
            const pool =
              bot.team === 'Vanguard' ? this.mapConfig.vanguardHolds : this.mapConfig.syndicateExecutes;
            const friendlyAnchors: Vec3[] = [];
            for (let j = 0; j < bots.length; j++) {
              const mate = bots[j];
              if (j === bIdx || mate.isDead || mate.team !== bot.team) continue;
              friendlyAnchors.push({ x: mate.mesh.position.x, y: mate.mesh.position.y, z: mate.mesh.position.z });
              const mateState = this.botStates.get(mate.id);
              if (mateState?.assignedHoldPos) {
                friendlyAnchors.push(mateState.assignedHoldPos);
              }
            }
            const baseIdx = (bIdx + Math.floor(roundElapsed / 6) + bot.waypointIndex) % pool.length;
            let chosenDest: Vec3 | null = null;
            for (let offset = 0; offset < pool.length; offset++) {
              const candKey = pool[(baseIdx + offset) % pool.length];
              const candPos = this.mapConfig.navGraph[candKey]?.pos;
              if (!candPos) continue;
              const separated = friendlyAnchors.every(
                (other) => Math.hypot(candPos.x - other.x, candPos.z - other.z) >= MIN_FRIENDLY_HOLD_SEPARATION_M
              );
              if (separated) {
                chosenDest = candPos;
                break;
              }
            }
            const nextDest =
              chosenDest ??
              this.mapConfig.navGraph[pool[baseIdx]]?.pos ??
              bot.patrolTarget;
            bot.waypointIndex = (bot.waypointIndex + 1) % pool.length;
            state.assignedHoldPos = { ...nextDest };
            state.path = findPathAStar(
              { x: botPos.x, y: botPos.y, z: botPos.z },
              nextDest,
              undefined,
              blocks,
              this.mapConfig.navGraph
            );
            state.pathIndex = 0;
            state.consecutiveStuckCount = 0;
          }

          const moveRes = this.applyHorizontalMovement(bot, state, 0, 0, 0, clampedDt, colliders);
          bot.rig?.update(clampedDt, {
            isMoving: moveRes.isMoving,
            speed: moveRes.speed,
            isDead: false,
            healthRatio: Math.max(0, bot.health / bot.maxHealth),
            team: bot.team,
            name: bot.name,
            isReloading: state.isReloading,
            cameraDistance: camDist,
            isBehindCamera,
            velocity: { x: bot.vx, z: bot.vz },
          });
          continue;
        }
      } else if (state.pathIndex < state.path.length - 1) {
        // Smooth corner-cutting when both shoulder rays clear solid geometry + active smoke
        const nextNext = state.path[state.pathIndex + 1];
        if (nextNext && Math.abs(nextNext.y - botPos.y) < 0.5) {
          const eyeA = { x: botPos.x, y: botPos.y + 1.2, z: botPos.z };
          const eyeB = { x: nextNext.x, y: nextNext.y + 1.2, z: nextNext.z };
          const losCenter = hasLineOfSight(eyeA, eyeB, blocks, smokeOccluders, spatialGrid);
          if (losCenter) {
            const dirX = nextNext.x - botPos.x;
            const dirZ = nextNext.z - botPos.z;
            const len = Math.hypot(dirX, dirZ);
            let canCutCorner = true;
            if (len > 0.001) {
              const perpX = (-dirZ / len) * 0.42;
              const perpZ = (dirX / len) * 0.42;
              const losLeft = hasLineOfSight(
                { x: eyeA.x + perpX, y: eyeA.y, z: eyeA.z + perpZ },
                { x: eyeB.x + perpX, y: eyeB.y, z: eyeB.z + perpZ },
                blocks,
                smokeOccluders,
                spatialGrid
              );
              const losRight = hasLineOfSight(
                { x: eyeA.x - perpX, y: eyeA.y, z: eyeA.z - perpZ },
                { x: eyeB.x - perpX, y: eyeB.y, z: eyeB.z - perpZ },
                blocks,
                smokeOccluders,
                spatialGrid
              );
              canCutCorner = losLeft && losRight;
            }
            if (canCutCorner) {
              state.pathIndex++;
              targetWaypoint = nextNext;
              _toTarget.subVectors(targetWaypoint, botPos);
              _toTarget.y = 0;
              distToWaypoint = _toTarget.length();
            }
          }
        }
      }

      let isMoving = false;
      let actualSpeed = 0;

      if (distToWaypoint >= 0.35) {
        _toTarget.normalize();

        const isSilentWalk = state.isLurking && roundElapsed > 18 && !isBombArmed;
        let currentSpeed = isSilentWalk ? 2.15 : config.patrolSpeed;

        // Wall-tangent unstuck steering (smooth, without spinning the bot's face into walls)
        state.stuckTimer += clampedDt;
        if (state.stuckTimer >= 0.4) {
          const displacement = botPos.distanceTo(state.lastDisplacementPos);
          if (displacement < 0.16) {
            state.consecutiveStuckCount++;

            let nearestCollider: AABBCollider | null = null;
            let minDistToWall = Infinity;
            for (const col of colliders) {
              const cx = Math.max(col.minX, Math.min(botPos.x, col.maxX));
              const cz = Math.max(col.minZ, Math.min(botPos.z, col.maxZ));
              const d = Math.hypot(botPos.x - cx, botPos.z - cz);
              if (d < minDistToWall) {
                minDistToWall = d;
                nearestCollider = col;
              }
            }

            if (nearestCollider && minDistToWall < KINEMATICS.CAPSULE_RADIUS + 0.35) {
              const cx = Math.max(nearestCollider.minX, Math.min(botPos.x, nearestCollider.maxX));
              const cz = Math.max(nearestCollider.minZ, Math.min(botPos.z, nearestCollider.maxZ));
              let nx = botPos.x - cx;
              let nz = botPos.z - cz;
              const len = Math.hypot(nx, nz);
              if (len > 0.001) {
                nx /= len;
                nz /= len;
              } else {
                nx = 0;
                nz = 1;
              }

              const tan1X = -nz;
              const tan1Z = nx;
              const tan2X = nz;
              const tan2Z = -nx;
              const dot1 = tan1X * _toTarget.x + tan1Z * _toTarget.z;
              const chosenTanX = dot1 >= 0 ? tan1X : tan2X;
              const chosenTanZ = dot1 >= 0 ? tan1Z : tan2Z;

              state.unstuckDir.set(chosenTanX * 0.72 + nx * 0.48, 0, chosenTanZ * 0.72 + nz * 0.48).normalize();
              state.unstuckDuration = 0.75;
            } else {
              _stepNormal.set(-_toTarget.z, 0, _toTarget.x).multiplyScalar(bIdx % 2 === 0 ? 1.0 : -1.0);
              state.unstuckDir.copy(_stepNormal).normalize();
              state.unstuckDuration = 0.55;
            }

            if (state.consecutiveStuckCount >= 2 && state.path.length > 0) {
              const goal = state.path[state.path.length - 1];
              state.path = findPathAStar(
                { x: botPos.x, y: botPos.y, z: botPos.z },
                goal,
                undefined,
                blocks,
                this.mapConfig.navGraph
              );
              state.pathIndex = 0;
            }
          } else {
            state.consecutiveStuckCount = 0;
          }
          state.lastDisplacementPos.copy(botPos);
          state.stuckTimer = 0;
        }

        if (state.unstuckDuration > 0) {
          const probeDist = Math.min(distToWaypoint, 2.4);
          const probeTargetX = botPos.x + _toTarget.x * probeDist;
          const probeTargetZ = botPos.z + _toTarget.z * probeDist;
          const eyeA = { x: botPos.x, y: botPos.y + 1.2, z: botPos.z };
          const perpX = -_toTarget.z * 0.35;
          const perpZ = _toTarget.x * 0.35;
          const clearL = hasLineOfSight(
            { x: eyeA.x + perpX, y: eyeA.y, z: eyeA.z + perpZ },
            { x: probeTargetX + perpX, y: eyeA.y, z: probeTargetZ + perpZ },
            blocks,
            smokeOccluders,
            spatialGrid
          );
          const clearR = hasLineOfSight(
            { x: eyeA.x - perpX, y: eyeA.y, z: eyeA.z - perpZ },
            { x: probeTargetX - perpX, y: eyeA.y, z: probeTargetZ - perpZ },
            blocks,
            smokeOccluders,
            spatialGrid
          );
          if (clearL && clearR) {
            state.unstuckDuration = 0;
          } else {
            state.unstuckDuration -= clampedDt;
            _toTarget.lerp(state.unstuckDir, 0.72).normalize();
          }
        }

        // Smooth non-deadlocking lateral corridor separation (never stalls to speed 0)
        _otherPositionsScratch.length = 0;
        for (let j = 0; j < bots.length; j++) {
          if (j === bIdx || bots[j].isDead) continue;
          const op = bots[j].mesh.position;
          _otherPositionsScratch.push({ x: op.x, y: op.y, z: op.z });
        }
        const sep = BotBrain.computeCorridorSeparation(
          { x: botPos.x, y: botPos.y, z: botPos.z },
          _toTarget.x,
          _toTarget.z,
          bIdx,
          _otherPositionsScratch
        );
        currentSpeed *= sep.speedMultiplier;

        const moveRes = this.applyHorizontalMovement(
          bot,
          state,
          sep.dirX,
          sep.dirZ,
          currentSpeed,
          clampedDt,
          colliders
        );
        isMoving = moveRes.isMoving;
        actualSpeed = moveRes.speed;

        // Tactical crosshair placement while moving:
        // 1. If investigating a sound cue, look smoothly toward the sound.
        // 2. Otherwise slice the upcoming corner (pre-aim next corridor node when approaching a turn).
        let lookYaw: number;
        if (state.soundInvestigateTarget) {
          lookYaw = Math.atan2(
            state.soundInvestigateTarget.x - botPos.x,
            state.soundInvestigateTarget.z - botPos.z
          );
        } else if (distToWaypoint < 3.8 && state.pathIndex < state.path.length - 1) {
          const nextCorner = state.path[state.pathIndex + 1];
          lookYaw = Math.atan2(nextCorner.x - botPos.x, nextCorner.z - botPos.z);
        } else {
          lookYaw = Math.atan2(targetWaypoint.x - botPos.x, targetWaypoint.z - botPos.z);
        }

        if (state.antiFlashTurnTimer <= 0) {
          const aimRes = BotBrain.stepHumanAim({
            currentYaw: state.currentYaw,
            currentPitch: state.currentPitch,
            desiredYaw: lookYaw,
            desiredPitch: 0,
            dt: clampedDt,
            slewRateDegPerSec: Math.max(260, state.archetype.slewRateDegPerSec * 0.72),
          });
          state.currentYaw = aimRes.nextYaw;
          state.currentPitch = aimRes.nextPitch;
          state.targetYaw = lookYaw;
          bot.mesh.rotation.y = state.currentYaw;
        }
      }

      bot.rig?.update(clampedDt, {
        isMoving,
        speed: actualSpeed,
        isDead: false,
        healthRatio: Math.max(0, bot.health / bot.maxHealth),
        team: bot.team,
        name: bot.name,
        isCrouching: false,
        isReloading: state.isReloading,
        pitch: state.currentPitch,
        cameraDistance: camDist,
        isBehindCamera,
        velocity: { x: bot.vx, z: bot.vz },
      });
    }
  }
}

function dist3D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
