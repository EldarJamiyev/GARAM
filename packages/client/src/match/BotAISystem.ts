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
  executeTacticalRaycast,
  TargetCollider,
  Ray,
  HitZone,
  SurfaceMaterial,
  DE_CITADEL_NAV_GRAPH,
  DE_CITADEL_BLOCKS,
  findPathAStar,
  rollRandomStrategies,
  RoundStrategySelection,
  BotBrain,
  resolveBotArchetype,
  BotArchetype,
  WEAPONS,
} from '@garam/shared';
import { BotEntity } from '../maps/DeCitadelMap.js';

export type BotDifficulty = 'Recruit' | 'Veteran' | 'Elite' | 'Sovereign';

interface DifficultyConfig {
  reactionTimeMs: number;
  slewRateDegPerSec: number;
  burstCount: number;
  burstCooldownMs: number;
  patrolSpeed: number;
  canUseUtility: boolean;
  spreadAngleRad: number;
}

const DIFFICULTY_PRESETS: Record<BotDifficulty, DifficultyConfig> = {
  Recruit: {
    reactionTimeMs: 540,
    slewRateDegPerSec: 220,
    burstCount: 3,
    burstCooldownMs: 1100,
    patrolSpeed: 2.8,
    canUseUtility: false,
    spreadAngleRad: 0.055,
  },
  Veteran: {
    reactionTimeMs: 340,
    slewRateDegPerSec: 380,
    burstCount: 4,
    burstCooldownMs: 850,
    patrolSpeed: 3.2,
    canUseUtility: true,
    spreadAngleRad: 0.032,
  },
  Elite: {
    reactionTimeMs: 220,
    slewRateDegPerSec: 540,
    burstCount: 4,
    burstCooldownMs: 650,
    patrolSpeed: 3.5,
    canUseUtility: true,
    spreadAngleRad: 0.016,
  },
  Sovereign: {
    reactionTimeMs: 155,
    slewRateDegPerSec: 720,
    burstCount: 5,
    burstCooldownMs: 500,
    patrolSpeed: 3.8,
    canUseUtility: true,
    spreadAngleRad: 0.006,
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

// Pre-allocated scratch math objects for zero-GC bot AI hot loop
const _botEye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _stepNormal = new THREE.Vector3();
const _terminalPoint = new THREE.Vector3();
const _sepPush = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();

interface BotInternalState {
  team: 'Vanguard' | 'Syndicate';
  archetype: BotArchetype;
  ammo: number;
  isReloading: boolean;
  reloadTimeRemaining: number;
  burstRemaining: number;
  burstTimer: number;
  jiggleTimer: number;
  jiggleDir: number;
  path: Vec3[];
  pathIndex: number;
  role: 'entry' | 'support' | 'lurker' | 'anchor' | 'rotator';
  isLurking: boolean;
  lastDisplacementPos: THREE.Vector3;
  stuckTimer: number;
  unstuckDuration: number;
  unstuckDir: THREE.Vector3;
  consecutiveStuckCount: number;
  soundInvestigateTarget: THREE.Vector3 | null;
  soundInvestigateTimer: number;
  hasThrownSmoke: boolean;
  hasThrownFlash: boolean;
  targetYaw: number;
  currentYaw: number;
  vy: number;
}

export class BotAISystem {
  public difficulty: BotDifficulty = 'Veteran';
  private callbacks: BotAISystemCallbacks;
  private seePlayerTimes: Map<string, number> = new Map();
  private seeBotTimes: Map<string, Map<string, number>> = new Map();
  private botStates: Map<string, BotInternalState> = new Map();
  public currentStrategies: RoundStrategySelection;
  private roundStartTime = performance.now();

  constructor(callbacks: BotAISystemCallbacks, difficulty: BotDifficulty = 'Veteran') {
    this.callbacks = callbacks;
    this.difficulty = difficulty;
    this.currentStrategies = rollRandomStrategies();
  }

  public setDifficulty(diff: BotDifficulty): void {
    this.difficulty = diff;
  }

  public startNewRound(roundNumber: number, bots: BotEntity[], ctLossStreak = 0, tLossStreak = 0): void {
    this.roundStartTime = performance.now();
    this.currentStrategies = rollRandomStrategies();
    this.seePlayerTimes.clear();
    this.seeBotTimes.clear();

    const synBots = bots.filter((b) => b.team === 'Syndicate');
    const vgBots = bots.filter((b) => b.team === 'Vanguard');

    const synBuys = BotBrain.evaluateTeamEconomy(
      synBots.map(() => 4500),
      tLossStreak,
      roundNumber,
      false
    );
    const vgBuys = BotBrain.evaluateTeamEconomy(
      vgBots.map(() => 4500),
      ctLossStreak,
      roundNumber,
      true
    );

    synBots.forEach((bot, idx) => {
      const decision = synBuys[idx];
      bot.armor = decision.buyArmor ? 100 : 0;
      bot.hasHelmet = decision.buyHelmet;
    });

    vgBots.forEach((bot, idx) => {
      const decision = vgBuys[idx];
      bot.armor = decision.buyArmor ? 100 : 0;
      bot.hasHelmet = decision.buyHelmet;
    });

    synBots.forEach((bot, index) => {
      let role: BotInternalState['role'] = 'entry';
      let dest: Vec3 = BOMBSITES.A.center;

      if (this.currentStrategies.syndicate === 'RUSH_A_LONG') {
        role = index === 0 ? 'entry' : index === 4 ? 'lurker' : 'support';
        dest = index === 4 ? DE_CITADEL_NAV_GRAPH['t_mid'].pos : BOMBSITES.A.center;
      } else if (this.currentStrategies.syndicate === 'SPLIT_A_MID') {
        role = index < 2 ? 'entry' : 'rotator';
        dest = index < 2 ? BOMBSITES.A.center : DE_CITADEL_NAV_GRAPH['a_connector_site'].pos;
      } else if (this.currentStrategies.syndicate === 'RUSH_B_TUNNELS') {
        role = index === 0 ? 'entry' : index === 4 ? 'lurker' : 'support';
        dest = index === 4 ? DE_CITADEL_NAV_GRAPH['t_mid'].pos : BOMBSITES.B.center;
      } else if (this.currentStrategies.syndicate === 'MID_TO_B_SPLIT') {
        role = index < 3 ? 'entry' : 'support';
        dest = index < 3 ? DE_CITADEL_NAV_GRAPH['b_connector_site'].pos : BOMBSITES.B.center;
      } else {
        role = index === 0 ? 'entry' : index === 1 ? 'lurker' : 'rotator';
        const spots = [
          DE_CITADEL_NAV_GRAPH['a_long_corner'].pos,
          DE_CITADEL_NAV_GRAPH['t_mid'].pos,
          DE_CITADEL_NAV_GRAPH['b_tunnels_mid'].pos,
          DE_CITADEL_NAV_GRAPH['mid_doors'].pos,
          BOMBSITES.A.center,
        ];
        dest = spots[index % spots.length];
      }

      const path = findPathAStar(
        { x: bot.mesh.position.x, y: bot.mesh.position.y, z: bot.mesh.position.z },
        dest,
        undefined,
        DE_CITADEL_BLOCKS
      );

      this.botStates.set(bot.id, {
        team: bot.team,
        archetype: resolveBotArchetype(bot.id, bot.name, bot.team, this.difficulty),
        ammo: 30,
        isReloading: false,
        reloadTimeRemaining: 0,
        burstRemaining: 0,
        burstTimer: 0,
        jiggleTimer: 0,
        jiggleDir: 1,
        path,
        pathIndex: 0,
        role,
        isLurking: role === 'lurker',
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
        vy: 0,
      });
    });

    vgBots.forEach((bot, index) => {
      let role: BotInternalState['role'] = 'anchor';
      let dest: Vec3 = BOMBSITES.A.center;

      if (this.currentStrategies.vanguard === 'STANDARD_2_1_2') {
        const spots = [
          DE_CITADEL_NAV_GRAPH['a_site_center'].pos,
          DE_CITADEL_NAV_GRAPH['a_heaven_stairs_top'].pos,
          DE_CITADEL_NAV_GRAPH['mid_doors'].pos,
          BOMBSITES.B.center,
        ];
        dest = spots[index % spots.length];
        role = index === 1 ? 'anchor' : 'rotator';
      } else if (this.currentStrategies.vanguard === 'AGGRESSIVE_MID_CONTROL') {
        const spots = [
          DE_CITADEL_NAV_GRAPH['mid_courtyard_n'].pos,
          DE_CITADEL_NAV_GRAPH['mid_doors'].pos,
          BOMBSITES.A.center,
          BOMBSITES.B.center,
        ];
        dest = spots[index % spots.length];
      } else if (this.currentStrategies.vanguard === 'HEAVY_A_STACK') {
        const spots = [
          DE_CITADEL_NAV_GRAPH['a_site_crates'].pos,
          DE_CITADEL_NAV_GRAPH['a_heaven_stairs_top'].pos,
          DE_CITADEL_NAV_GRAPH['a_connector_site'].pos,
          BOMBSITES.B.center,
        ];
        dest = spots[index % spots.length];
      } else {
        const spots = [
          DE_CITADEL_NAV_GRAPH['ct_a_lane'].pos,
          DE_CITADEL_NAV_GRAPH['a_site_center'].pos,
          DE_CITADEL_NAV_GRAPH['ct_b_lane'].pos,
          BOMBSITES.B.center,
        ];
        dest = spots[index % spots.length];
      }

      const path = findPathAStar(
        { x: bot.mesh.position.x, y: bot.mesh.position.y, z: bot.mesh.position.z },
        dest,
        undefined,
        DE_CITADEL_BLOCKS
      );

      this.botStates.set(bot.id, {
        team: bot.team,
        archetype: resolveBotArchetype(bot.id, bot.name, bot.team, this.difficulty),
        ammo: 30,
        isReloading: false,
        reloadTimeRemaining: 0,
        burstRemaining: 0,
        burstTimer: 0,
        jiggleTimer: 0,
        jiggleDir: 1,
        path,
        pathIndex: 0,
        role,
        isLurking: false,
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
        vy: 0,
      });
    });
  }

  public onSoundEvent(event: SoundEvent): void {
    for (const state of this.botStates.values()) {
      // Only investigate hostile team audio events
      if (state.team === event.team) continue;
      const dist = event.pos.distanceTo(state.lastDisplacementPos);
      if (dist <= event.radius) {
        state.soundInvestigateTarget = event.pos.clone();
        state.soundInvestigateTimer = 3.5;
      }
    }
  }

  public onFlashbangExploded(flashPos: THREE.Vector3, bots: BotEntity[]): void {
    if (this.difficulty !== 'Elite' && this.difficulty !== 'Sovereign') return;

    for (const bot of bots) {
      if (bot.isDead) continue;
      const state = this.botStates.get(bot.id);
      if (!state) continue;

      const botPos: Vec3 = { x: bot.mesh.position.x, y: bot.mesh.position.y + 1.6, z: bot.mesh.position.z };
      const flashPosVec: Vec3 = { x: flashPos.x, y: flashPos.y, z: flashPos.z };
      const antiFlash = BotBrain.calculateAntiFlashYaw(state.currentYaw, flashPosVec, botPos);

      if (antiFlash.shouldTurn) {
        state.targetYaw = antiFlash.targetYaw;
        state.currentYaw = antiFlash.targetYaw;
        bot.mesh.rotation.y = antiFlash.targetYaw;
        this.callbacks.onBotRadioCallout?.(bot, 'Flashing! Turning away!');
      }
    }
  }

  private findSupportingFloorY(x: number, y: number, z: number, colliders: AABBCollider[]): number {
    let bestY = 0;
    const r = KINEMATICS.CAPSULE_RADIUS;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) {
        if (b.maxY <= y + 0.25 && b.maxY > bestY) {
          bestY = b.maxY;
        }
      }
    }
    return bestY;
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
    playerHasHelmet = true
  ): void {
    const config = DIFFICULTY_PRESETS[this.difficulty];
    const now = performance.now();
    const roundElapsed = (now - this.roundStartTime) / 1000;
    const botWeapon = WEAPONS['garam-47'];

    for (let bIdx = 0; bIdx < bots.length; bIdx++) {
      const bot = bots[bIdx];

      if (bot.isDead) {
        bot.rig?.update(dt, {
          isMoving: false,
          speed: 0,
          isDead: true,
          healthRatio: 0,
          team: bot.team,
          name: bot.name,
        });
        continue;
      }

      // Freeze Time: bots hold spawn positions and idle cleanly until round goes live
      if (isFreezeTime) {
        bot.vx = 0;
        bot.vz = 0;
        bot.rig?.update(dt, {
          isMoving: false,
          speed: 0,
          isDead: false,
          healthRatio: Math.max(0, bot.health / bot.maxHealth),
          team: bot.team,
          name: bot.name,
        });
        continue;
      }

      let state = this.botStates.get(bot.id);
      if (!state) {
        state = {
          team: bot.team,
          archetype: resolveBotArchetype(bot.id, bot.name, bot.team, this.difficulty),
          ammo: 30,
          isReloading: false,
          reloadTimeRemaining: 0,
          burstRemaining: 0,
          burstTimer: 0,
          jiggleTimer: 0,
          jiggleDir: 1,
          path: [bot.mesh.position.clone()],
          pathIndex: 0,
          role: 'entry',
          isLurking: false,
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
          vy: 0,
        };
        this.botStates.set(bot.id, state);
      }

      const botPos = bot.mesh.position;
      _botEye.set(botPos.x, botPos.y + 1.68, botPos.z);

      if (state.isReloading) {
        state.reloadTimeRemaining -= dt;
        if (state.reloadTimeRemaining <= 0) {
          state.isReloading = false;
          state.ammo = 30;
        }
      }

      if (state.soundInvestigateTimer > 0) {
        state.soundInvestigateTimer -= dt;
        if (state.soundInvestigateTimer <= 0) {
          state.soundInvestigateTarget = null;
        }
      }

      // --- 1. Target Acquisition: Check Player Visibility (if opposing faction) ---
      let canSeePlayer = false;
      const distToPlayer = botPos.distanceTo(playerFeetPos);

      if (bot.team !== playerTeam && playerHealth > 0 && distToPlayer <= 50) {
        canSeePlayer = hasLineOfSight(
          { x: _botEye.x, y: _botEye.y, z: _botEye.z },
          { x: playerEye.x, y: playerEye.y, z: playerEye.z },
          blocks,
          smokeOccluders,
          spatialGrid
        );

        if (canSeePlayer) {
          this.callbacks.onEnemySpotted?.(bot);

          if (!this.seePlayerTimes.has(bot.id)) {
            this.seePlayerTimes.set(bot.id, now);
            this.callbacks.onBotRadioCallout?.(bot, 'Visual contact on hostile!');
          }
          const timeSeen = now - (this.seePlayerTimes.get(bot.id) || now);

          _aimDir.subVectors(playerEye, _botEye).normalize();
          state.targetYaw = Math.atan2(_aimDir.x, _aimDir.z);

          const slewRate = state.archetype ? state.archetype.slewRateDegPerSec : config.slewRateDegPerSec;
          const maxTurn = ((slewRate * Math.PI) / 180) * dt;
          let angleDiff = state.targetYaw - state.currentYaw;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          state.currentYaw += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn);
          bot.mesh.rotation.y = state.currentYaw;

          const canUseUtil = state.archetype ? state.archetype.skill >= 75 : config.canUseUtility;
          if (canUseUtil && !state.hasThrownFlash && distToPlayer > 18 && distToPlayer < 35) {
            state.hasThrownFlash = true;
            this.callbacks.onBotThrowUtility?.(bot, 'flash', playerFeetPos.clone());
            this.callbacks.onBotRadioCallout?.(bot, 'Deploying tactical flash!');
          }

          const reactionWindow = state.archetype ? state.archetype.reactionTimeMs : config.reactionTimeMs;
          if (!state.isReloading && timeSeen >= reactionWindow) {
            if (state.ammo <= 0) {
              state.isReloading = true;
              state.reloadTimeRemaining = 2.4;
            } else if (now - bot.lastShotTime > config.burstCooldownMs || state.burstRemaining > 0) {
              if (state.burstRemaining === 0) {
                state.burstRemaining = config.burstCount;
              }

              state.burstTimer -= dt;
              if (state.burstTimer <= 0) {
                state.burstTimer = 0.11;
                state.burstRemaining--;
                bot.lastShotTime = now;
                state.ammo--;

                // Viewplane-orthonormal spread using shared computeSpreadRayDirection
                const spreadAngle = state.archetype
                  ? Math.max(0.005, (100 - state.archetype.skill) * 0.00045)
                  : config.spreadAngleRad;
                const spreadX = (Math.random() - 0.5) * spreadAngle;
                const spreadY = (Math.random() - 0.5) * spreadAngle;
                const aimYaw = Math.atan2(-_aimDir.x, -_aimDir.z);
                const aimPitch = Math.asin(Math.max(-1, Math.min(1, _aimDir.y)));
                const rayDirVec = computeSpreadRayDirection(aimYaw, aimPitch, spreadX, spreadY);

                const sharedRay: Ray = {
                  origin: { x: _botEye.x, y: _botEye.y, z: _botEye.z },
                  direction: rayDirVec,
                };

                // Accurate ground-referenced player hitboxes (feet Y -> eye Y)
                const isCrouched = playerEye.y - playerFeetPos.y < 1.35;
                const playerTarget: TargetCollider = {
                  id: 'player',
                  name: 'Player',
                  team: playerTeam,
                  center: { x: playerFeetPos.x, y: playerFeetPos.y, z: playerFeetPos.z },
                  hasHelmet: playerHasHelmet,
                  armor: playerArmor,
                  isDead: playerHealth <= 0,
                  isCrouched,
                  hitboxes: {
                    head: { x: playerFeetPos.x, y: playerEye.y + 0.04, z: playerFeetPos.z },
                    chest: { x: playerFeetPos.x, y: playerFeetPos.y + (isCrouched ? 0.82 : 1.25), z: playerFeetPos.z },
                    stomach: { x: playerFeetPos.x, y: playerFeetPos.y + (isCrouched ? 0.62 : 0.95), z: playerFeetPos.z },
                    leftArm: { x: playerFeetPos.x - 0.28, y: playerFeetPos.y + (isCrouched ? 0.80 : 1.20), z: playerFeetPos.z },
                    rightArm: { x: playerFeetPos.x + 0.28, y: playerFeetPos.y + (isCrouched ? 0.80 : 1.20), z: playerFeetPos.z },
                    leftLeg: { x: playerFeetPos.x - 0.16, y: playerFeetPos.y + (isCrouched ? 0.30 : 0.45), z: playerFeetPos.z },
                    rightLeg: { x: playerFeetPos.x + 0.16, y: playerFeetPos.y + (isCrouched ? 0.30 : 0.45), z: playerFeetPos.z },
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
                this.callbacks.onBotSpawnTracer?.(_botEye, _terminalPoint, 'garam-47');
              }
            }
          }

          bot.rig?.update(dt, {
            isMoving: false,
            speed: 0,
            isDead: false,
            healthRatio: Math.max(0, bot.health / bot.maxHealth),
            team: bot.team,
            name: bot.name,
          });
          continue;
        } else {
          this.seePlayerTimes.delete(bot.id);
        }
      }

      // --- 2. Inter-Bot Combat ---
      let engagedBotTarget: BotEntity | null = null;
      const enemyTeam = bot.team === 'Syndicate' ? 'Vanguard' : 'Syndicate';

      for (const other of bots) {
        if (other.team === enemyTeam && !other.isDead) {
          const distToOther = botPos.distanceTo(other.mesh.position);
          if (distToOther <= 42) {
            _targetEye.set(other.mesh.position.x, other.mesh.position.y + 1.68, other.mesh.position.z);
            const los = hasLineOfSight(
              { x: _botEye.x, y: _botEye.y, z: _botEye.z },
              { x: _targetEye.x, y: _targetEye.y, z: _targetEye.z },
              blocks,
              smokeOccluders,
              spatialGrid
            );

            if (los) {
              engagedBotTarget = other;
              _aimDir.subVectors(_targetEye, _botEye).normalize();
              state.targetYaw = Math.atan2(_aimDir.x, _aimDir.z);

              const botSlew = state.archetype ? state.archetype.slewRateDegPerSec : config.slewRateDegPerSec;
              const maxTurn = ((botSlew * Math.PI) / 180) * dt;
              let angleDiff = state.targetYaw - state.currentYaw;
              while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
              while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
              state.currentYaw += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn);
              bot.mesh.rotation.y = state.currentYaw;

              if (!state.isReloading && (now - bot.lastShotTime > config.burstCooldownMs || state.burstRemaining > 0)) {
                if (state.burstRemaining === 0) state.burstRemaining = config.burstCount;
                state.burstTimer -= dt;

                if (state.burstTimer <= 0) {
                  state.burstTimer = 0.11;
                  state.burstRemaining--;
                  bot.lastShotTime = now;
                  state.ammo--;

                  const spreadAngle = state.archetype
                    ? Math.max(0.005, (100 - state.archetype.skill) * 0.00045)
                    : config.spreadAngleRad;
                  const spreadX = (Math.random() - 0.5) * spreadAngle;
                  const spreadY = (Math.random() - 0.5) * spreadAngle;
                  const aimYaw = Math.atan2(-_aimDir.x, -_aimDir.z);
                  const aimPitch = Math.asin(Math.max(-1, Math.min(1, _aimDir.y)));
                  const rayDirVec = computeSpreadRayDirection(aimYaw, aimPitch, spreadX, spreadY);

                  const sharedRay: Ray = {
                    origin: { x: _botEye.x, y: _botEye.y, z: _botEye.z },
                    direction: rayDirVec,
                  };

                  const targetCol: TargetCollider = {
                    id: other.id,
                    name: other.name,
                    team: other.team,
                    center: { x: other.mesh.position.x, y: other.mesh.position.y, z: other.mesh.position.z },
                    armor: other.armor,
                    hasHelmet: other.hasHelmet,
                    isDead: other.isDead,
                    yaw: other.mesh.rotation.y,
                    hitboxes: other.rig?.getWorldHitboxes(),
                  };

                  const hits = executeTacticalRaycast(
                    sharedRay,
                    34,
                    0.75,
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
                    if (hit.targetId === other.id) {
                      other.rig?.triggerFlinch();
                      this.callbacks.onBotShootBot(
                        bot,
                        other,
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
                  this.callbacks.onBotSpawnTracer?.(_botEye, _terminalPoint, 'garam-47');
                }
              }
              break;
            }
          }
        }
      }

      if (engagedBotTarget) {
        bot.rig?.update(dt, {
          isMoving: false,
          speed: 0,
          isDead: false,
          healthRatio: Math.max(0, bot.health / bot.maxHealth),
          team: bot.team,
          name: bot.name,
        });
        continue;
      }

      // --- 3. Sound Investigation Orienting ---
      if (state.soundInvestigateTarget) {
        _toTarget.subVectors(state.soundInvestigateTarget, botPos);
        _toTarget.y = 0;
        state.targetYaw = Math.atan2(_toTarget.x, _toTarget.z);
        const maxTurn = ((config.slewRateDegPerSec * Math.PI) / 180) * dt;
        let angleDiff = state.targetYaw - state.currentYaw;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        state.currentYaw += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn);
        bot.mesh.rotation.y = state.currentYaw;
      }

      // --- 4. Tactical Objective Navigation with A* Nav-Graph ---
      if (isBombArmed) {
        const bombSitePos = bombTargetSite === 'A' ? BOMBSITES.A.center : BOMBSITES.B.center;
        if (bot.team === 'Vanguard') {
          if (state.path.length === 0 || dist3D(state.path[state.path.length - 1], bombSitePos) > 4.0) {
            state.path = findPathAStar(
              { x: botPos.x, y: botPos.y, z: botPos.z },
              bombSitePos,
              undefined,
              blocks
            );
            state.pathIndex = 0;
          }
        } else if (bot.team === 'Syndicate') {
          if (state.path.length === 0) {
            const defenseNodes = Object.values(DE_CITADEL_NAV_GRAPH).filter(
              (n) => dist3D(n.pos, bombSitePos) < 16.0 && n.coverType === 'HIGH'
            );
            const chosen =
              defenseNodes[bIdx % Math.max(1, defenseNodes.length)] || DE_CITADEL_NAV_GRAPH['a_site_crates'];
            state.path = [chosen.pos];
            state.pathIndex = 0;
          }
        }
      }

      let targetWaypoint = state.path[state.pathIndex] || bot.patrolTarget;

      _toTarget.subVectors(targetWaypoint, botPos);
      _toTarget.y = 0;
      let distToWaypoint = _toTarget.length();

      if (distToWaypoint < 1.6) {
        if (state.pathIndex < state.path.length - 1) {
          state.pathIndex++;
          state.consecutiveStuckCount = 0;
          targetWaypoint = state.path[state.pathIndex];
          _toTarget.subVectors(targetWaypoint, botPos);
          _toTarget.y = 0;
          distToWaypoint = _toTarget.length();
        } else if (!isBombArmed) {
          bot.waypointIndex = (bot.waypointIndex + 1) % bot.patrolWaypoints.length;
          const nextTarget = bot.patrolWaypoints[bot.waypointIndex];
          state.path = findPathAStar(
            { x: botPos.x, y: botPos.y, z: botPos.z },
            nextTarget,
            undefined,
            blocks
          );
          state.pathIndex = 0;
          state.consecutiveStuckCount = 0;
          targetWaypoint = state.path[state.pathIndex] || nextTarget;
          _toTarget.subVectors(targetWaypoint, botPos);
          _toTarget.y = 0;
          distToWaypoint = _toTarget.length();
        }
      } else if (state.pathIndex < state.path.length - 1) {
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
              const perpX = (-dirZ / len) * 0.40;
              const perpZ = (dirX / len) * 0.40;
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

      if (distToWaypoint >= 0.4) {
        _toTarget.normalize();

        const isSilentWalk = state.isLurking && roundElapsed > 20;
        let currentSpeed = isSilentWalk ? 2.1 : config.patrolSpeed;

        state.stuckTimer += dt;
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

              state.unstuckDir.set(chosenTanX * 0.7 + nx * 0.5, 0, chosenTanZ * 0.7 + nz * 0.5).normalize();
              state.unstuckDuration = 0.85;
            } else {
              _stepNormal.set(-_toTarget.z, 0, _toTarget.x).multiplyScalar(Math.random() > 0.5 ? 1.0 : -1.0);
              state.unstuckDir.copy(_stepNormal).normalize();
              state.unstuckDuration = 0.6;
            }

            if (state.consecutiveStuckCount >= 2 && state.path.length > 0) {
              const goal = state.path[state.path.length - 1];
              state.path = findPathAStar(
                { x: botPos.x, y: botPos.y, z: botPos.z },
                goal,
                undefined,
                blocks
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
          const probeDist = Math.min(distToWaypoint, 2.5);
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
            state.unstuckDuration -= dt;
            _toTarget.lerp(state.unstuckDir, 0.75).normalize();
          }
        }

        // Zero-allocation bot-to-bot separation with corridor headway yielding
        for (let j = 0; j < bots.length; j++) {
          if (j === bIdx) continue;
          const otherBot = bots[j];
          if (otherBot.isDead) continue;
          const distBetween = botPos.distanceTo(otherBot.mesh.position);
          if (distBetween < 1.8 && distBetween > 0.05) {
            _sepPush.subVectors(botPos, otherBot.mesh.position).setY(0).normalize();
            _toTarget.addScaledVector(_sepPush, (1.8 - distBetween) * 1.0).normalize();

            const toOtherX = otherBot.mesh.position.x - botPos.x;
            const toOtherZ = otherBot.mesh.position.z - botPos.z;
            const dotHeading = (toOtherX * _toTarget.x + toOtherZ * _toTarget.z) / distBetween;
            if (dotHeading > 0.70 && distBetween < 1.6) {
              if (distBetween < 1.0) {
                currentSpeed = 0;
              } else {
                currentSpeed *= Math.max(0.2, (distBetween - 0.9) / 0.7);
              }
            }
          }
        }

        const vx = _toTarget.x * currentSpeed;
        const vz = _toTarget.z * currentSpeed;

        const resolved = resolveHorizontalAABB(
          botPos.x,
          botPos.y,
          botPos.z,
          vx,
          vz,
          dt,
          KINEMATICS.CAPSULE_RADIUS,
          KINEMATICS.CAPSULE_HEIGHT_STAND,
          colliders,
          true,
          KINEMATICS.STEP_HEIGHT
        );

        // Gravity / vertical grounding so bots walking off A Heaven drop smoothly to lower floor
        const floorY = this.findSupportingFloorY(resolved.x, resolved.y, resolved.z, colliders);
        let nextY = resolved.y;
        if (nextY > floorY + 0.02) {
          state.vy -= KINEMATICS.GRAVITY * dt;
          nextY += state.vy * dt;
          if (nextY <= floorY) {
            nextY = floorY;
            state.vy = 0;
          }
        } else {
          nextY = floorY;
          state.vy = 0;
        }

        bot.mesh.position.set(resolved.x, nextY, resolved.z);
        bot.vx = resolved.vx;
        bot.vz = resolved.vz;

        const resolvedSpeed = Math.hypot(resolved.vx, resolved.vz);
        isMoving = resolvedSpeed > 0.15;
        actualSpeed = isMoving ? resolvedSpeed : 0;

        if (!state.soundInvestigateTarget) {
          if (state.unstuckDuration > 0) {
            state.targetYaw = Math.atan2(state.unstuckDir.x, state.unstuckDir.z);
          } else if (resolvedSpeed > 0.3) {
            state.targetYaw = Math.atan2(resolved.vx, resolved.vz);
          } else {
            state.targetYaw = Math.atan2(_toTarget.x, _toTarget.z);
          }
          let angleDiff = state.targetYaw - state.currentYaw;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          state.currentYaw += angleDiff * Math.min(1.0, 14 * dt);
          bot.mesh.rotation.y = state.currentYaw;
        }
      }

      bot.rig?.update(dt, {
        isMoving,
        speed: actualSpeed,
        isDead: false,
        healthRatio: Math.max(0, bot.health / bot.maxHealth),
        team: bot.team,
        name: bot.name,
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
