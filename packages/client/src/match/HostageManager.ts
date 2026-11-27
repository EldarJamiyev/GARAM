import * as THREE from 'three';
import {
  HostageEntityState,
  HostageSpawnSpec,
  RescueZoneSpec,
  isPointInRescueZone,
  evaluateHostageWinCondition,
  ECONOMY,
  AABBCollider,
  resolveHorizontalAABB,
  KINEMATICS,
  MapBounds,
} from '@garam/shared';
import { HostageRig } from '../render/HostageRig.js';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { HUDManager } from '../ui/HUDManager.js';

interface HostageRuntime extends HostageEntityState {
  rig: HostageRig;
}

export class HostageManager {
  public enabled = false;
  public hostages: HostageRuntime[] = [];
  private rescueZones: readonly RescueZoneSpec[] = [];
  private scene: THREE.Scene;
  private audio: ProceduralAudio;
  private hud: HUDManager;
  private rescueZoneMesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, audio: ProceduralAudio, hud: HUDManager) {
    this.scene = scene;
    this.audio = audio;
    this.hud = hud;
  }

  public configure(
    enabled: boolean,
    spawns: readonly HostageSpawnSpec[],
    rescueZones: readonly RescueZoneSpec[]
  ): void {
    this.dispose();
    this.enabled = enabled;
    this.rescueZones = rescueZones;
    if (!enabled || spawns.length === 0) return;

    for (const s of spawns) {
      const rig = new HostageRig(s.id);
      rig.root.position.set(s.pos.x, s.pos.y, s.pos.z);
      rig.root.rotation.y = s.yaw;
      this.scene.add(rig.root);
      this.hostages.push({
        id: s.id,
        name: s.name,
        pos: { ...s.pos },
        yaw: s.yaw,
        health: 100,
        state: 'IDLE',
        escortId: null,
        rig,
      });
    }

    if (rescueZones.length > 0) {
      const rz = rescueZones[0];
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext('2d')!;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 10;
      ctx.setLineDash([20, 12]);
      ctx.strokeRect(16, 16, 224, 224);
      ctx.fillStyle = '#10b981';
      ctx.font = '900 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RESCUE ZONE', 128, 134);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(rz.maxX - rz.minX, rz.maxZ - rz.minZ),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set((rz.minX + rz.maxX) * 0.5, 0.04, (rz.minZ + rz.maxZ) * 0.5);
      this.scene.add(m);
      this.rescueZoneMesh = m;
    }
  }

  public tryInteract(
    actorId: string,
    actorTeam: 'Vanguard' | 'Syndicate',
    actorPos: THREE.Vector3,
    onCashAward: (amount: number) => void
  ): boolean {
    if (!this.enabled || actorTeam !== 'Vanguard') return false;
    for (const h of this.hostages) {
      if (h.state === 'RESCUED' || h.state === 'DEAD') continue;
      const d = Math.hypot(h.pos.x - actorPos.x, h.pos.z - actorPos.z);
      if (d <= 2.4 && Math.abs(h.pos.y - actorPos.y) < 1.8) {
        if (h.state === 'IDLE') {
          h.state = 'FOLLOWING';
          h.escortId = actorId;
          onCashAward(ECONOMY.hostageInteractBonus);
          this.hud.addRadioMessage(`${h.name}: "Okay, let's get out of here!" (+$${ECONOMY.hostageInteractBonus})`);
          this.audio.playRadioClick?.('Okay, let us get out of here!', 1.05);
        } else {
          h.state = 'IDLE';
          h.escortId = null;
          this.hud.addRadioMessage(`${h.name}: "Wait right here? Okay."`);
        }
        return true;
      }
    }
    return false;
  }

  public update(
    dt: number,
    playerFeet: THREE.Vector3,
    playerTeam: 'Vanguard' | 'Syndicate',
    colliders: AABBCollider[],
    bounds: MapBounds,
    onCashAward: (amount: number) => void,
    onAllRescued: (reason: string) => void
  ): void {
    if (!this.enabled) return;

    for (const h of this.hostages) {
      if (h.state === 'RESCUED' || h.state === 'DEAD') {
        h.rig.root.visible = false;
        continue;
      }
      let moveSpeed = 0;
      if (h.state === 'FOLLOWING' && h.escortId === 'local' && playerTeam === 'Vanguard') {
        const dx = playerFeet.x - h.pos.x;
        const dz = playerFeet.z - h.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1.85) {
          const speed = Math.min(4.6, dist * 2.4);
          moveSpeed = speed;
          const res = resolveHorizontalAABB(
            h.pos.x,
            h.pos.y,
            h.pos.z,
            (dx / dist) * speed,
            (dz / dist) * speed,
            dt,
            KINEMATICS.CAPSULE_RADIUS * 0.9,
            KINEMATICS.CAPSULE_HEIGHT_STAND,
            colliders,
            true,
            KINEMATICS.STEP_HEIGHT,
            bounds
          );
          h.pos.x = res.x;
          h.pos.y = res.y;
          h.pos.z = res.z;
          h.yaw = Math.atan2(dx, dz);
        }

        if (isPointInRescueZone(h.pos, this.rescueZones)) {
          h.state = 'RESCUED';
          h.escortId = null;
          h.rig.root.visible = false;
          onCashAward(ECONOMY.hostageRescueBonus);
          this.hud.showCenterBanner('HOSTAGE RESCUED!', `${h.name} reached safety (+$${ECONOMY.hostageRescueBonus})`, 2200);
          this.audio.playRadioClick?.('Hostage has been rescued!', 1.0);
          const win = evaluateHostageWinCondition(this.hostages);
          if (win.isRoundOver && win.reason) {
            onAllRescued(win.reason);
          }
        }
      }
      h.rig.root.position.set(h.pos.x, h.pos.y, h.pos.z);
      h.rig.root.rotation.y = h.yaw;
      h.rig.update(dt, h.state === 'FOLLOWING', moveSpeed);
    }
  }

  public resetRound(spawns: readonly HostageSpawnSpec[]): void {
    if (!this.enabled) return;
    for (let i = 0; i < this.hostages.length && i < spawns.length; i++) {
      const h = this.hostages[i];
      const s = spawns[i];
      h.pos = { ...s.pos };
      h.yaw = s.yaw;
      h.health = 100;
      h.state = 'IDLE';
      h.escortId = null;
      h.rig.root.visible = true;
      h.rig.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    }
  }

  public dispose(): void {
    for (const h of this.hostages) {
      this.scene.remove(h.rig.root);
      h.rig.dispose();
    }
    this.hostages = [];
    if (this.rescueZoneMesh) {
      this.scene.remove(this.rescueZoneMesh);
      this.rescueZoneMesh.geometry.dispose();
      const mat = this.rescueZoneMesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      this.rescueZoneMesh = null;
    }
  }
}
