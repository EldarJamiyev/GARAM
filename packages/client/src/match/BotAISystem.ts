import * as THREE from 'three';
import {
  MapBlockCollider,
  AABBCollider,
  Vec3,
  SmokeOccluder,
  hasLineOfSight,
  resolveHorizontalAABB,
  KINEMATICS,
  BOMBSITES
} from '@garam/shared';
import { BotEntity } from '../maps/DeCitadelMap.js';

export type BotDifficulty = 'Recruit' | 'Veteran' | 'Elite' | 'Sovereign';

interface DifficultyConfig {
  reactionTimeMs: number;
  accuracy: number;
  sprayBurst: number;
  fireCooldownMs: number;
  patrolSpeed: number;
}

const DIFFICULTY_PRESETS: Record<BotDifficulty, DifficultyConfig> = {
  Recruit: {
    reactionTimeMs: 700,
    accuracy: 0.25,
    sprayBurst: 3,
    fireCooldownMs: 1100,
    patrolSpeed: 2.8,
  },
  Veteran: {
    reactionTimeMs: 440,
    accuracy: 0.45,
    sprayBurst: 5,
    fireCooldownMs: 900,
    patrolSpeed: 3.2,
  },
  Elite: {
    reactionTimeMs: 270,
    accuracy: 0.72,
    sprayBurst: 7,
    fireCooldownMs: 750,
    patrolSpeed: 3.5,
  },
  Sovereign: {
    reactionTimeMs: 150,
    accuracy: 0.92,
    sprayBurst: 10,
    fireCooldownMs: 600,
    patrolSpeed: 3.8,
  },
};

export interface BotAISystemCallbacks {
  onBotShootPlayer: (bot: BotEntity, dmg: number) => void;
  onBotShootBot: (shooter: BotEntity, victim: BotEntity, dmg: number) => void;
  onEnemySpotted?: (bot: BotEntity) => void;
}

export class BotAISystem {
  public difficulty: BotDifficulty = 'Veteran';
  private callbacks: BotAISystemCallbacks;
  private seePlayerTimes: Map<string, number> = new Map();

  constructor(callbacks: BotAISystemCallbacks, difficulty: BotDifficulty = 'Veteran') {
    this.callbacks = callbacks;
    this.difficulty = difficulty;
  }

  public setDifficulty(diff: BotDifficulty): void {
    this.difficulty = diff;
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
    bombTargetSite: 'A' | 'B' | null = null
  ): void {
    const config = DIFFICULTY_PRESETS[this.difficulty];
    const now = performance.now();

    for (const bot of bots) {
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

      const botPos = bot.mesh.position;
      const botEye = botPos.clone().add(new THREE.Vector3(0, 1.68, 0));

      // 1. Check Line of Sight against Player
      let canSeePlayer = false;
      const distToPlayer = botPos.distanceTo(playerPos);

      if (bot.team === 'Syndicate' && distToPlayer <= 42) {
        canSeePlayer = hasLineOfSight(
          { x: botEye.x, y: botEye.y, z: botEye.z },
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

          // Aim towards player
          bot.mesh.lookAt(playerPos.x, botPos.y, playerPos.z);

          // Fire if reaction time elapsed and cooldown ready
          if (timeSeen >= config.reactionTimeMs && now - bot.lastShotTime > config.fireCooldownMs) {
            bot.lastShotTime = now;
            // Roll accuracy
            if (Math.random() < config.accuracy) {
              const baseDmg = 24 + Math.floor(Math.random() * 8);
              this.callbacks.onBotShootPlayer(bot, baseDmg);
            }
          }

          // In combat engagement: counter-strafe or halt
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

      // 2. Inter-Bot Combat: Syndicate vs Vanguard Allies
      let engagedBotTarget: BotEntity | null = null;
      const enemyTeam = bot.team === 'Syndicate' ? 'Vanguard' : 'Syndicate';

      for (const other of bots) {
        if (other.team === enemyTeam && !other.isDead) {
          const distToOther = botPos.distanceTo(other.mesh.position);
          if (distToOther <= 34) {
            const otherEye = other.mesh.position.clone().add(new THREE.Vector3(0, 1.68, 0));
            const los = hasLineOfSight(
              { x: botEye.x, y: botEye.y, z: botEye.z },
              { x: otherEye.x, y: otherEye.y, z: otherEye.z },
              blocks,
              smokeOccluders
            );

            if (los) {
              engagedBotTarget = other;
              bot.mesh.lookAt(other.mesh.position.x, botPos.y, other.mesh.position.z);

              if (now - bot.lastShotTime > config.fireCooldownMs) {
                bot.lastShotTime = now;
                if (Math.random() < config.accuracy) {
                  const dmg = 25 + Math.floor(Math.random() * 8);
                  other.rig?.triggerFlinch();
                  this.callbacks.onBotShootBot(bot, other, dmg);
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

      // 3. Dynamic Tactical Waypoint Navigation (Retake vs Patrol)
      let currentTarget = bot.patrolTarget;

      // Retake objective: if bomb is planted, Vanguard bots redirect towards the active bomb site!
      if (isBombArmed && bot.team === 'Vanguard' && bombTargetSite) {
        const sitePos = bombTargetSite === 'A' ? BOMBSITES.A.center : BOMBSITES.B.center;
        currentTarget = new THREE.Vector3(sitePos.x, sitePos.y, sitePos.z);
      }

      const toTarget = new THREE.Vector3().subVectors(currentTarget, botPos);
      toTarget.y = 0;
      const distToTarget = toTarget.length();
      let isMoving = false;
      let actualSpeed = 0;

      if (distToTarget < 1.4) {
        if (!isBombArmed) {
          bot.waypointIndex = (bot.waypointIndex + 1) % bot.patrolWaypoints.length;
          bot.patrolTarget = bot.patrolWaypoints[bot.waypointIndex];
        }
      } else {
        toTarget.normalize();
        const patrolSpeed = config.patrolSpeed;
        const vx = toTarget.x * patrolSpeed;
        const vz = toTarget.z * patrolSpeed;

        // Strict AABB Wall sliding so bots NEVER pass through walls
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
        bot.mesh.lookAt(currentTarget.x, botPos.y, currentTarget.z);
        isMoving = true;
        actualSpeed = patrolSpeed;
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
