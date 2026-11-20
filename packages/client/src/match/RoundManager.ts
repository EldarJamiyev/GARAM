import * as THREE from 'three';
import { ECONOMY, BOMBSITES, MatchSimulation } from '@garam/shared';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { BotEntity } from '../maps/DeCitadelMap.js';
import { settingsStore } from '../core/SettingsStore.js';
import { AssetManager } from '../render/AssetManager.js';

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

const _siteAPos = new THREE.Vector3(BOMBSITES.A.center.x, 0, BOMBSITES.A.center.z);
const _siteBPos = new THREE.Vector3(BOMBSITES.B.center.x, 0, BOMBSITES.B.center.z);
const _flatPlayerPos = new THREE.Vector3();

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

  private disposeBombMesh(): void {
    if (!this.bombMesh) return;
    this.scene.remove(this.bombMesh);
    this.bombMesh.traverse((obj) => {
      if (obj.userData.isSharedGlb) return;
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (!mesh.userData.isSharedGlb) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      }
    });
    this.bombMesh = null;
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

    this.disposeBombMesh();
    this.bombPosition = null;

    this.callbacks.onPhaseChanged(this.phase, this.roundNumber);
    this.callbacks.onResetRound(this.roundNumber);
  }

  public update(
    dt: number,
    playerFeetPos: THREE.Vector3,
    isInteracting: boolean,
    isPlayerCarrier: boolean,
    hasDefuseKit: boolean,
    bots: BotEntity[],
    playerHealth = 100
  ): void {
    if (this.phase === 'MATCH_OVER') return;

    const playerTeam = settingsStore.settings.faction;
    this.phaseTimer -= dt;

    // 1. FREEZE TIME
    if (this.phase === 'FREEZE_TIME') {
      this.callbacks.onTimerTick(Math.max(0, Math.ceil(this.phaseTimer)), false);
      if (this.phaseTimer <= 0) {
        this.phase = 'ROUND_LIVE';
        this.phaseTimer = ECONOMY.roundLiveSec;
        this.callbacks.onPhaseChanged(this.phase, this.roundNumber);
      }
      return;
    }

    // 2. LIVE ROUND CLOCK
    if (this.phase === 'ROUND_LIVE') {
      this.callbacks.onTimerTick(Math.max(0, Math.ceil(this.phaseTimer)), false);

      if (isPlayerCarrier && playerHealth > 0) {
        _flatPlayerPos.set(playerFeetPos.x, 0, playerFeetPos.z);
        const distA = _flatPlayerPos.distanceTo(_siteAPos);
        const distB = _flatPlayerPos.distanceTo(_siteBPos);
        const inSite = distA <= BOMBSITES.A.radius || distB <= BOMBSITES.B.radius;

        if (inSite && isInteracting) {
          this.plantProgress += dt;
          this.callbacks.onPlantProgress(this.plantProgress / ECONOMY.plantTimeSec);

          if (this.plantProgress >= ECONOMY.plantTimeSec) {
            this.armBomb(playerFeetPos, distA <= BOMBSITES.A.radius ? 'A' : 'B');
          }
        } else {
          this.plantProgress = 0;
          this.callbacks.onPlantProgress(0);
        }
      }

      if (this.phaseTimer <= 0) {
        this.endRound('Vanguard', 'Time Expired — Objective Secured');
        return;
      }

      // Check team elimination for BOTH factions (including local player!)
      let livingVanguard = playerTeam === 'Vanguard' && playerHealth > 0 ? 1 : 0;
      let livingSyndicate = playerTeam === 'Syndicate' && playerHealth > 0 ? 1 : 0;
      for (const b of bots) {
        if (!b.isDead) {
          if (b.team === 'Vanguard') livingVanguard++;
          else livingSyndicate++;
        }
      }

      if (livingSyndicate === 0) {
        this.endRound('Vanguard', 'All Syndicate Hostiles Neutralized');
        return;
      }
      if (livingVanguard === 0) {
        this.endRound('Syndicate', 'All Vanguard Defenders Eliminated');
        return;
      }
    }

    // 3. BOMB ARMED (40s Clock with accelerating audio beeps)
    if (this.phase === 'BOMB_ARMED') {
      this.callbacks.onTimerTick(Math.max(0, Math.ceil(this.phaseTimer)), true);

      const now = performance.now();
      let beepInterval = 1000;
      if (this.phaseTimer <= 5) beepInterval = 150;
      else if (this.phaseTimer <= 15) beepInterval = 420;
      else if (this.phaseTimer <= 25) beepInterval = 700;

      if (now - this.lastBeepTime >= beepInterval) {
        this.audio.playBombBeep();
        this.lastBeepTime = now;
      }

      // Vanguard Defuse
      if (this.bombPosition && playerTeam === 'Vanguard' && playerHealth > 0) {
        const distToBomb = Math.hypot(
          playerFeetPos.x - this.bombPosition.x,
          playerFeetPos.z - this.bombPosition.z
        );
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

      // Check Vanguard elimination while bomb is armed
      let livingVanguard = playerTeam === 'Vanguard' && playerHealth > 0 ? 1 : 0;
      for (const b of bots) {
        if (!b.isDead && b.team === 'Vanguard') livingVanguard++;
      }
      if (livingVanguard === 0) {
        this.endRound('Syndicate', 'All Vanguard Defenders Eliminated');
        return;
      }

      if (this.phaseTimer <= 0) {
        this.audio.playGrenadeExplosion();
        this.endRound('Syndicate', 'Pulse Core Detonated');
        return;
      }
    }

    // 4. ROUND END
    if (this.phase === 'ROUND_END') {
      if (this.phaseTimer <= 0) {
        if (this.ctScore >= ECONOMY.roundsToWin || this.tScore >= ECONOMY.roundsToWin) {
          this.phase = 'MATCH_OVER';
          const matchWinner = this.ctScore >= ECONOMY.roundsToWin ? 'Vanguard' : 'Syndicate';
          this.callbacks.onMatchComplete(matchWinner, this.ctScore, this.tScore);
        } else {
          this.roundNumber++;
          if (this.roundNumber === ECONOMY.halfTimeRound + 1) {
            this.ctLossStreak = 0;
            this.tLossStreak = 0;
          }
          this.startRound();
        }
      }
    }
  }

  public armBomb(feetPos: THREE.Vector3, site: 'A' | 'B'): void {
    this.phase = 'BOMB_ARMED';
    this.phaseTimer = ECONOMY.bombTimerSec;
    this.isBombPlanted = true;
    this.bombPlantSite = site;
    const groundedPos = new THREE.Vector3(feetPos.x, Math.max(0, feetPos.y), feetPos.z);
    this.bombPosition = groundedPos;
    this.matchSim.armBomb(site, { x: groundedPos.x, y: groundedPos.y, z: groundedPos.z });
    this.plantProgress = 0;
    this.callbacks.onPlantProgress(0);

    this.disposeBombMesh();

    const bombGroup = new THREE.Group();
    this.bombMesh = bombGroup;
    const coreGeo = new THREE.BoxGeometry(0.35, 0.16, 0.22);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.3, metalness: 0.9 });
    const coreBody = new THREE.Mesh(coreGeo, coreMat);
    coreBody.position.y = 0.08;
    bombGroup.add(coreBody);

    const ledGeo = new THREE.SphereGeometry(0.032, 12, 12);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0, 0.14, 0);
    bombGroup.add(led);

    bombGroup.position.copy(groundedPos);
    this.scene.add(bombGroup);

    // Asynchronously mount CS2 C4 Explosive GLB
    void AssetManager.getInstance()
      .loadModel('/models/c4.glb', {
        targetLength: 0.32,
        centerAtFeet: true,
        envMapIntensity: 1.5,
      })
      .then((c4Model) => {
        if (!c4Model || this.bombMesh !== bombGroup) return;
        c4Model.traverse((child) => {
          child.userData.isSharedGlb = true;
        });
        coreBody.visible = false;
        bombGroup.add(c4Model);
      });

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
