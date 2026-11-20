import * as THREE from 'three';
import { ECONOMY, getLossBonus, BOMBSITES, Vec3, MatchSimulation } from '@garam/shared';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { BotEntity } from '../maps/DeCitadelMap.js';

export type RoundPhase = 'FREEZE_TIME' | 'ROUND_LIVE' | 'BOMB_ARMED' | 'ROUND_END' | 'MATCH_OVER';

export interface RoundCallbacks {
  onPhaseChanged: (phase: RoundPhase, roundNumber: number) => void;
  onTimerTick: (timeRemaining: number, isBombArmed: boolean) => void;
  onPlantProgress: (progress: number) => void;
  onDefuseProgress: (progress: number) => void;
  onRoundWon: (winner: 'Vanguard' | 'Syndicate', reason: string, ctScore: number, tScore: number) => void;
  onResetRound: (roundNumber: number) => void;
  onMatchComplete: (winner: 'Vanguard' | 'Syndicate', ctScore: number, tScore: number) => void;
}

export class RoundManager {
  public matchSim: MatchSimulation = new MatchSimulation();
  public roundNumber = 1;
  public ctScore = 0;
  public tScore = 0;
  public ctLossStreak = 0;
  public tLossStreak = 0;

  public phase: RoundPhase = 'FREEZE_TIME';
  public phaseTimer = ECONOMY.freezeTimeSec;
  public bombCarrierId: string | null = null;
  public isBombPlanted = false;
  public bombPlantSite: 'A' | 'B' | null = null;
  public bombPosition: THREE.Vector3 | null = null;
  public bombMesh: THREE.Group | null = null;
  public isBombDefused = false;

  // Interaction hold timers (E key)
  public plantProgress = 0;
  public defuseProgress = 0;
  private lastBeepTime = 0;

  private scene: THREE.Scene;
  private audio: ProceduralAudio;
  private callbacks: RoundCallbacks;

  constructor(scene: THREE.Scene, audio: ProceduralAudio, callbacks: RoundCallbacks) {
    this.scene = scene;
    this.audio = audio;
    this.callbacks = callbacks;
  }

  public startMatch(): void {
    this.matchSim.resetMatch();
    this.roundNumber = this.matchSim.round;
    this.ctScore = this.matchSim.ctScore;
    this.tScore = this.matchSim.tScore;
    this.ctLossStreak = this.matchSim.ctLossStreak;
    this.tLossStreak = this.matchSim.tLossStreak;
    this.startRound();
  }

  public startRound(): void {
    this.matchSim.startRound();
    this.phase = 'FREEZE_TIME';
    this.phaseTimer = ECONOMY.freezeTimeSec;
    this.isBombPlanted = false;
    this.isBombDefused = false;
    this.bombPlantSite = null;
    this.plantProgress = 0;
    this.defuseProgress = 0;

    if (this.bombMesh) {
      this.scene.remove(this.bombMesh);
      this.bombMesh = null;
    }
    this.bombPosition = null;

    this.callbacks.onPhaseChanged(this.phase, this.roundNumber);
    this.callbacks.onResetRound(this.roundNumber);
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    isInteracting: boolean,
    isPlayerCarrier: boolean,
    hasDefuseKit: boolean,
    bots: BotEntity[]
  ): void {
    if (this.phase === 'MATCH_OVER') return;

    this.phaseTimer -= dt;

    // 1. FREEZE TIME
    if (this.phase === 'FREEZE_TIME') {
      this.callbacks.onTimerTick(Math.max(0, Math.ceil(this.phaseTimer)), false);
      if (this.phaseTimer <= 0) {
        this.phase = 'ROUND_LIVE';
        this.phaseTimer = ECONOMY.roundLiveSec; // 115s (01:55)
        this.callbacks.onPhaseChanged(this.phase, this.roundNumber);
      }
      return;
    }

    // 2. LIVE ROUND CLOCK
    if (this.phase === 'ROUND_LIVE') {
      this.callbacks.onTimerTick(Math.max(0, Math.ceil(this.phaseTimer)), false);

      // Check Bomb Planting in Bombsite A or B
      if (isPlayerCarrier) {
        const distA = playerPos.distanceTo(new THREE.Vector3(BOMBSITES.A.center.x, 0, BOMBSITES.A.center.z));
        const distB = playerPos.distanceTo(new THREE.Vector3(BOMBSITES.B.center.x, 0, BOMBSITES.B.center.z));
        const inSite = distA <= BOMBSITES.A.radius || distB <= BOMBSITES.B.radius;

        if (inSite && isInteracting) {
          this.plantProgress += dt;
          this.callbacks.onPlantProgress(this.plantProgress / ECONOMY.plantTimeSec);

          if (this.plantProgress >= ECONOMY.plantTimeSec) {
            this.armBomb(playerPos, distA <= BOMBSITES.A.radius ? 'A' : 'B');
          }
        } else {
          this.plantProgress = 0;
          this.callbacks.onPlantProgress(0);
        }
      }

      // Time expiration without bomb planted = Vanguard Victory
      if (this.phaseTimer <= 0) {
        this.endRound('Vanguard', 'Time Expired — Objective Secured');
        return;
      }

      // Check living count
      const livingSyndicate = bots.filter(b => b.team === 'Syndicate' && !b.isDead).length;
      if (livingSyndicate === 0) {
        this.endRound('Vanguard', 'All Syndicate Hostiles Neutralized');
        return;
      }
    }

    // 3. BOMB ARMED (40s Clock with accelerating audio beeps)
    if (this.phase === 'BOMB_ARMED') {
      this.callbacks.onTimerTick(Math.max(0, Math.ceil(this.phaseTimer)), true);

      // Accelerating beep rate
      const now = performance.now();
      let beepInterval = 1000;
      if (this.phaseTimer <= 5) beepInterval = 150;
      else if (this.phaseTimer <= 15) beepInterval = 420;
      else if (this.phaseTimer <= 25) beepInterval = 700;

      if (now - this.lastBeepTime >= beepInterval) {
        this.audio.playBombBeep();
        this.lastBeepTime = now;
      }

      // Check Vanguard Defuse
      if (this.bombPosition) {
        const distToBomb = playerPos.distanceTo(this.bombPosition);
        if (distToBomb <= 2.6 && isInteracting) {
          const reqTime = hasDefuseKit ? ECONOMY.defuseTimeSecKit : ECONOMY.defuseTimeSecNormal;
          this.defuseProgress += dt;
          this.callbacks.onDefuseProgress(this.defuseProgress / reqTime);

          if (this.defuseProgress >= reqTime) {
            this.isBombDefused = true;
            this.endRound('Vanguard', 'Pulse Core Defused');
            return;
          }
        } else {
          this.defuseProgress = 0;
          this.callbacks.onDefuseProgress(0);
        }
      }

      // Bomb Detonation
      if (this.phaseTimer <= 0) {
        this.audio.playGrenadeExplosion();
        this.endRound('Syndicate', 'Pulse Core Detonated');
        return;
      }
    }

    // 4. ROUND END (5s Celebration & Payouts before next round)
    if (this.phase === 'ROUND_END') {
      if (this.phaseTimer <= 0) {
        if (this.ctScore >= ECONOMY.roundsToWin || this.tScore >= ECONOMY.roundsToWin) {
          this.phase = 'MATCH_OVER';
          const matchWinner = this.ctScore >= ECONOMY.roundsToWin ? 'Vanguard' : 'Syndicate';
          this.callbacks.onMatchComplete(matchWinner, this.ctScore, this.tScore);
        } else {
          this.roundNumber++;
          // Halftime side swap
          if (this.roundNumber === ECONOMY.halfTimeRound + 1) {
            this.ctLossStreak = 0;
            this.tLossStreak = 0;
          }
          this.startRound();
        }
      }
    }
  }

  public armBomb(pos: THREE.Vector3, site: 'A' | 'B'): void {
    this.phase = 'BOMB_ARMED';
    this.phaseTimer = ECONOMY.bombTimerSec;
    this.isBombPlanted = true;
    this.bombPlantSite = site;
    this.bombPosition = pos.clone();
    this.plantProgress = 0;
    this.callbacks.onPlantProgress(0);

    // Spawn 3D glowing Pulse Core Device on floor
    this.bombMesh = new THREE.Group();
    const coreGeo = new THREE.BoxGeometry(0.35, 0.16, 0.22);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.3, metalness: 0.9 });
    const coreBody = new THREE.Mesh(coreGeo, coreMat);
    coreBody.position.y = 0.08;
    this.bombMesh.add(coreBody);

    const ledGeo = new THREE.SphereGeometry(0.04, 12, 12);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0, 0.17, 0);
    this.bombMesh.add(led);

    this.bombMesh.position.copy(pos);
    this.scene.add(this.bombMesh);

    this.callbacks.onPhaseChanged(this.phase, this.roundNumber);
  }

  public endRound(winner: 'Vanguard' | 'Syndicate', reason: string): void {
    this.phase = 'ROUND_END';
    this.phaseTimer = ECONOMY.roundEndSec;

    const res = this.matchSim.endRound(winner, reason);
    this.ctScore = res.ctScore;
    this.tScore = res.tScore;
    this.ctLossStreak = this.matchSim.ctLossStreak;
    this.tLossStreak = this.matchSim.tLossStreak;

    this.callbacks.onRoundWon(winner, reason, this.ctScore, this.tScore);
  }
}
