import * as THREE from 'three';
import {
  MapBlockCollider,
  AABBCollider,
  Vec3,
  SmokeOccluder,
  hasLineOfSight,
  resolveHorizontalAABB,
  KINEMATICS,
  BOMBSITES,
  executeTacticalRaycast,
  TargetCollider,
  Ray,
  HitZone,
  SurfaceMaterial,
  DE_CITADEL_NAV_GRAPH,
  findNearestNavNode,
  findPathAStar,
  rollRandomStrategies,
  RoundStrategySelection,
  SyndicateStrategy,
  VanguardStrategy,
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
    spreadAngleRad: 0.006, // Pinpoint competitive precision
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
  onBotShootPlayer: (bot: BotEntity, dmg: number, hitZone: HitZone, isHeadshot: boolean, penetratedWalls: number) => void;
  onBotShootBot: (shooter: BotEntity, victim: BotEntity, dmg: number, hitZone: HitZone, isHeadshot: boolean, penetratedWalls: number) => void;
  onEnemySpotted?: (bot: BotEntity) => void;
  onBotSpawnTracer?: (from: THREE.Vector3, to: THREE.Vector3, weaponId?: string) => void;
  onBotSpawnDecal?: (point: THREE.Vector3, normal: THREE.Vector3, material: SurfaceMaterial) => void;
  onBotThrowUtility?: (bot: BotEntity, type: 'smoke' | 'flash' | 'molotov', target: THREE.Vector3) => void;
}

// Scratch math objects for zero-GC bot AI hot loop
const _botEye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _stepNormal = new THREE.Vector3();
const _terminalPoint = new THREE.Vector3();

interface BotInternalState {
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
  soundInvestigateTarget: THREE.Vector3 | null;
  soundInvestigateTimer: number;
  hasThrownSmoke: boolean;
  hasThrownFlash: boolean;
  targetYaw: number;
  currentYaw: number;
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

  /**
   * Called at start of round (Freeze Time) to orchestrate team strategies & assign tactical roles
   */
  public startNewRound(roundNumber: number, bots: BotEntity[]): void {
    this.roundStartTime = performance.now();
    this.currentStrategies = rollRandomStrategies();
    this.seePlayerTimes.clear();
    this.seeBotTimes.clear();

    const synBots = bots.filter(b => b.team === 'Syndicate');
    const vgBots = bots.filter(b => b.team === 'Vanguard');

    // Assign Syndicate Roles & Objectives based on selected strategy
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
        // DEFAULT_PICKS_AND_LATE_EXEC
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
        dest
      );

      this.botStates.set(bot.id, {
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
        soundInvestigateTarget: null,
        soundInvestigateTimer: 0,
        hasThrownSmoke: false,
        hasThrownFlash: false,
        targetYaw: bot.mesh.rotation.y,
        currentYaw: bot.mesh.rotation.y,
      });
    });

    // Assign Vanguard Roles & Defensive Setups
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
        // RETAKE_ANCHOR
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
        dest
      );

      this.botStates.set(bot.id, {
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
        soundInvestigateTarget: null,
        soundInvestigateTimer: 0,
        hasThrownSmoke: false,
        hasThrownFlash: false,
        targetYaw: bot.mesh.rotation.y,
        currentYaw: bot.mesh.rotation.y,
      });
    });
  }

  /**
   * Sound Event Listener: notifies bots within hearing radius to investigate or turn
   */
  public onSoundEvent(event: SoundEvent): void {
    const now = performance.now();
    for (const [botId, state] of this.botStates.entries()) {
      const dist = event.pos.distanceTo(state.lastDisplacementPos);
      if (dist <= event.radius) {
        state.soundInvestigateTarget = event.pos.clone();
        state.soundInvestigateTimer = 3.5; // investigate for 3.5s
      }
    }
  }

  public update(
    bots: BotEntity[],
    dt: number,
    colliders: AABBCollider[],
    blocks: MapBlockCollider[],
    playerPos: THREE.Vector3,
    playerEye: THREE.Vector3,
    smokeOccluders: SmokeOccluder[] = [],
    isBombArmed = false,
    bombTargetSite: 'A' | 'B' | null = null,
    playerHealth = 100,
    playerArmor = 100
  ): void {
    const config = DIFFICULTY_PRESETS[this.difficulty];
    const now = performance.now();
    const roundElapsed = (now - this.roundStartTime) / 1000;

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

      let state = this.botStates.get(bot.id);
      if (!state) {
        state = {
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
          soundInvestigateTarget: null,
          soundInvestigateTimer: 0,
          hasThrownSmoke: false,
          hasThrownFlash: false,
          targetYaw: bot.mesh.rotation.y,
          currentYaw: bot.mesh.rotation.y,
        };
        this.botStates.set(bot.id, state);
      }

      const botPos = bot.mesh.position;
      _botEye.set(botPos.x, botPos.y + 1.68, botPos.z);

      // --- Reload State Machine ---
      if (state.isReloading) {
        state.reloadTimeRemaining -= dt;
        if (state.reloadTimeRemaining <= 0) {
          state.isReloading = false;
          state.ammo = 30;
        }
      }

      // --- Sound Investigation Decay ---
      if (state.soundInvestigateTimer > 0) {
        state.soundInvestigateTimer -= dt;
        if (state.soundInvestigateTimer <= 0) {
          state.soundInvestigateTarget = null;
        }
      }

      // --- 1. Target Acquisition: Check Player Visibility (if Syndicate vs Player) ---
      let canSeePlayer = false;
      const distToPlayer = botPos.distanceTo(playerPos);

      if (bot.team === 'Syndicate' && playerHealth > 0 && distToPlayer <= 50) {
        canSeePlayer = hasLineOfSight(
          { x: _botEye.x, y: _botEye.y, z: _botEye.z },
          { x: playerEye.x, y: playerEye.y, z: playerEye.z },
          blocks,
          smokeOccluders
        );

        if (canSeePlayer) {
          this.callbacks.onEnemySpotted?.(bot);

          if (!this.seePlayerTimes.has(bot.id)) {
            this.seePlayerTimes.set(bot.id, now);
          }
          const timeSeen = now - (this.seePlayerTimes.get(bot.id) || now);

          // Smooth Angular Slew toward Player
          _aimDir.subVectors(playerEye, _botEye).normalize();
          state.targetYaw = Math.atan2(_aimDir.x, _aimDir.z);

          // Slew aim smoothly
          const maxTurn = (config.slewRateDegPerSec * Math.PI / 180) * dt;
          let angleDiff = state.targetYaw - state.currentYaw;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          state.currentYaw += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn);
          bot.mesh.rotation.y = state.currentYaw;

          // Utility deployment before commitment (Flash or Smoke)
          if (config.canUseUtility && !state.hasThrownFlash && distToPlayer > 18 && distToPlayer < 35) {
            state.hasThrownFlash = true;
            this.callbacks.onBotThrowUtility?.(bot, 'flash', playerPos.clone());
          }

          // Combat Firing Cycle: Counter-strafe & Real Ballistic Raycast
          if (!state.isReloading && timeSeen >= config.reactionTimeMs) {
            if (state.ammo <= 0) {
              state.isReloading = true;
              state.reloadTimeRemaining = 2.4;
            } else if (now - bot.lastShotTime > config.burstCooldownMs || state.burstRemaining > 0) {
              if (state.burstRemaining === 0) {
                state.burstRemaining = config.burstCount;
              }

              state.burstTimer -= dt;
              if (state.burstTimer <= 0) {
                state.burstTimer = 0.11; // 545 RPM burst rate
                state.burstRemaining--;
                bot.lastShotTime = now;
                state.ammo--;

                // Execute deterministic ballistic raycast!
                const spreadX = (Math.random() - 0.5) * config.spreadAngleRad;
                const spreadY = (Math.random() - 0.5) * config.spreadAngleRad;

                const rayDir = _aimDir.clone().add(new THREE.Vector3(spreadX, spreadY, 0)).normalize();
                const sharedRay: Ray = {
                  origin: { x: _botEye.x, y: _botEye.y, z: _botEye.z },
                  direction: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
                };

                // Player target with accurate 5-zone hitboxes
                const playerTarget: TargetCollider = {
                  id: 'player',
                  name: 'Eldar Garamov',
                  team: 'Vanguard',
                  center: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
                  hasHelmet: true,
                  armor: playerArmor,
                  isDead: playerHealth <= 0,
                  hitboxes: {
                    head: { x: playerPos.x, y: playerEye.y + 0.05, z: playerPos.z },
                    chest: { x: playerPos.x, y: playerPos.y + 1.25, z: playerPos.z },
                    stomach: { x: playerPos.x, y: playerPos.y + 0.95, z: playerPos.z },
                    leftArm: { x: playerPos.x - 0.28, y: playerPos.y + 1.2, z: playerPos.z },
                    rightArm: { x: playerPos.x + 0.28, y: playerPos.y + 1.2, z: playerPos.z },
                    leftLeg: { x: playerPos.x - 0.16, y: playerPos.y + 0.45, z: playerPos.z },
                    rightLeg: { x: playerPos.x + 0.16, y: playerPos.y + 0.45, z: playerPos.z },
                  },
                };

                const hits = executeTacticalRaycast(
                  sharedRay,
                  36, // Garam-47 base damage
                  0.775,
                  2.0,
                  200,
                  blocks,
                  [playerTarget],
                  0.98
                );

                _terminalPoint.copy(_botEye).addScaledVector(rayDir, 80);
                if (hits.length > 0) {
                  const firstHit = hits[0];
                  _terminalPoint.set(firstHit.point.x, firstHit.point.y, firstHit.point.z);

                  if (firstHit.targetId === 'player') {
                    this.callbacks.onBotShootPlayer(
                      bot,
                      firstHit.awardedDamage,
                      firstHit.hitZone || 'CHEST',
                      firstHit.isHeadshot || false,
                      firstHit.penetratedWalls
                    );
                  } else if (firstHit.material) {
                    this.callbacks.onBotSpawnDecal?.(
                      _terminalPoint,
                      new THREE.Vector3(firstHit.normal.x, firstHit.normal.y, firstHit.normal.z),
                      firstHit.material
                    );
                  }
                }

                this.callbacks.onBotSpawnTracer?.(_botEye, _terminalPoint, 'garam-47');
              }
            }
          }

          // Counter-strafe in place while firing
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

      // --- 2. Inter-Bot Combat: Real Ballistic Raycast between Bot Teams ---
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
              smokeOccluders
            );

            if (los) {
              engagedBotTarget = other;
              _aimDir.subVectors(_targetEye, _botEye).normalize();
              state.targetYaw = Math.atan2(_aimDir.x, _aimDir.z);

              // Slew towards other bot
              const maxTurn = (config.slewRateDegPerSec * Math.PI / 180) * dt;
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

                  const spreadX = (Math.random() - 0.5) * config.spreadAngleRad;
                  const spreadY = (Math.random() - 0.5) * config.spreadAngleRad;
                  const rayDir = _aimDir.clone().add(new THREE.Vector3(spreadX, spreadY, 0)).normalize();

                  const sharedRay: Ray = {
                    origin: { x: _botEye.x, y: _botEye.y, z: _botEye.z },
                    direction: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
                  };

                  const targetCol: TargetCollider = {
                    id: other.id,
                    name: other.name,
                    team: other.team,
                    center: { x: other.mesh.position.x, y: other.mesh.position.y, z: other.mesh.position.z },
                    armor: other.armor,
                    hasHelmet: other.hasHelmet,
                    isDead: other.isDead,
                    hitboxes: other.rig?.getWorldHitboxes(),
                  };

                  const hits = executeTacticalRaycast(
                    sharedRay,
                    34,
                    0.75,
                    2.0,
                    180,
                    blocks,
                    [targetCol],
                    0.98
                  );

                  _terminalPoint.copy(_botEye).addScaledVector(rayDir, 70);
                  if (hits.length > 0) {
                    const hit = hits[0];
                    _terminalPoint.set(hit.point.x, hit.point.y, hit.point.z);
                    if (hit.targetId === other.id) {
                      other.rig?.triggerFlinch();
                      this.callbacks.onBotShootBot(
                        bot,
                        other,
                        hit.awardedDamage,
                        hit.hitZone || 'CHEST',
                        hit.isHeadshot || false,
                        hit.penetratedWalls
                      );
                    }
                  }
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
        const maxTurn = (config.slewRateDegPerSec * Math.PI / 180) * dt;
        let angleDiff = state.targetYaw - state.currentYaw;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        state.currentYaw += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn);
        bot.mesh.rotation.y = state.currentYaw;
      }

      // --- 4. Tactical Objective Navigation with A* Nav-Graph ---
      // Post-Plant & Retake Logic:
      if (isBombArmed) {
        const bombSitePos = bombTargetSite === 'A' ? BOMBSITES.A.center : BOMBSITES.B.center;
        if (bot.team === 'Vanguard') {
          // All surviving Vanguard bots converge on planted site!
          if (state.path.length === 0 || dist3D(state.path[state.path.length - 1], bombSitePos) > 4.0) {
            state.path = findPathAStar(
              { x: botPos.x, y: botPos.y, z: botPos.z },
              bombSitePos
            );
            state.pathIndex = 0;
          }
        } else if (bot.team === 'Syndicate') {
          // Syndicate bots hold crossfire off-angles around bomb site
          if (state.path.length === 0) {
            const defenseNodes = Object.values(DE_CITADEL_NAV_GRAPH).filter(n =>
              dist3D(n.pos, bombSitePos) < 16.0 && n.coverType === 'HIGH'
            );
            const chosen = defenseNodes[bIdx % Math.max(1, defenseNodes.length)] || DE_CITADEL_NAV_GRAPH['a_site_crates'];
            state.path = [chosen.pos];
            state.pathIndex = 0;
          }
        }
      }

      // Progress along path waypoints
      let targetWaypoint = state.path[state.pathIndex] || bot.patrolTarget;

      _toTarget.subVectors(targetWaypoint, botPos);
      _toTarget.y = 0;
      const distToWaypoint = _toTarget.length();

      if (distToWaypoint < 1.4) {
        if (state.pathIndex < state.path.length - 1) {
          state.pathIndex++;
        } else if (!isBombArmed) {
          // Reached destination: repath to another strategic point
          bot.waypointIndex = (bot.waypointIndex + 1) % bot.patrolWaypoints.length;
          const nextTarget = bot.patrolWaypoints[bot.waypointIndex];
          state.path = findPathAStar(
            { x: botPos.x, y: botPos.y, z: botPos.z },
            nextTarget
          );
          state.pathIndex = 0;
        }
      }

      let isMoving = false;
      let actualSpeed = 0;

      if (distToWaypoint >= 0.5) {
        _toTarget.normalize();

        // Lurker bot takes silent slow walk after 20s
        const isSilentWalk = state.isLurking && roundElapsed > 20;
        const currentSpeed = isSilentWalk ? 2.1 : config.patrolSpeed;

        // Anti-Stuck Displacement Monitor (0.6s / 0.25m check)
        state.stuckTimer += dt;
        if (state.stuckTimer >= 0.6) {
          const displacement = botPos.distanceTo(state.lastDisplacementPos);
          if (displacement < 0.25) {
            // Bot stuck on crate corner or door pillar: apply perpendicular sidestep vector
            _stepNormal.set(-_toTarget.z, 0, _toTarget.x).multiplyScalar(Math.random() > 0.5 ? 1.4 : -1.4);
            _toTarget.add(_stepNormal).normalize();

            // Repath to destination from nearest unobstructed node
            if (state.path.length > 0) {
              const goal = state.path[state.path.length - 1];
              state.path = findPathAStar({ x: botPos.x, y: botPos.y, z: botPos.z }, goal);
              state.pathIndex = 0;
            }
          }
          state.lastDisplacementPos.copy(botPos);
          state.stuckTimer = 0;
        }

        // Bot-to-bot separation force (radius 1.1m)
        for (let j = 0; j < bots.length; j++) {
          if (j === bIdx) continue;
          const otherBot = bots[j];
          if (otherBot.isDead) continue;
          const distBetween = botPos.distanceTo(otherBot.mesh.position);
          if (distBetween < 1.1 && distBetween > 0.05) {
            const push = new THREE.Vector3().subVectors(botPos, otherBot.mesh.position).normalize();
            _toTarget.addScaledVector(push, (1.1 - distBetween) * 1.5).normalize();
          }
        }

        const vx = _toTarget.x * currentSpeed;
        const vz = _toTarget.z * currentSpeed;

        // Strict AABB Wall sliding so bots never pass through geometry
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

        bot.mesh.position.set(resolved.x, resolved.y, resolved.z);

        if (!state.soundInvestigateTarget) {
          state.targetYaw = Math.atan2(_toTarget.x, _toTarget.z);
          state.currentYaw += (state.targetYaw - state.currentYaw) * Math.min(1.0, 14 * dt);
          bot.mesh.rotation.y = state.currentYaw;
        }

        isMoving = true;
        actualSpeed = currentSpeed;
      }

      // Update operator rig animation
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
