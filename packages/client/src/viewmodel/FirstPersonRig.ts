import * as THREE from 'three';
import { AssetManager } from '../render/AssetManager.js';
import {
  RigActionState,
  WEAPON_MOUNT_CONFIGS,
  WeaponMountConfig,
  WeaponViewId,
  normalizeWeaponViewId,
  resolveFirstPersonClip,
} from './FirstPersonRigMath.js';

export interface MountedWeaponParts {
  root: THREE.Group;
  muzzleAnchor: THREE.Object3D;
  slideNode?: THREE.Object3D;
  boltNode?: THREE.Object3D;
  magNode?: THREE.Object3D;
  karambitSpinPivot?: THREE.Group;
}

const _qTemp = new THREE.Quaternion();
const _qOffset = new THREE.Quaternion();
const _eTemp = new THREE.Euler();
const _vTemp = new THREE.Vector3();

/**
 * Manages the unified CC-BY-4.0 skeletal tactical FPS gloved arms rig (/models/fps_arms_tactical.glb)
 * and mounts all 5 CC-BY-4.0 CS2 weapons directly onto hand/weapon sockets so every firearm
 * AND melee weapon is naturally gripped and animated across Draw, Idle, Walk, Fire, Reload & Inspect.
 */
export class FirstPersonRig {
  public readonly container: THREE.Group;
  public isLoaded = false;

  private armsModel: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Map<string, THREE.AnimationAction> = new Map();
  private mountedWeapons: Map<WeaponViewId, MountedWeaponParts> = new Map();
  private activeAction: THREE.AnimationAction | null = null;
  private currentWeaponId: WeaponViewId = 'garam-47';
  private isDisposed = false;

  private oneShotTimer = 0;
  private currentActionState: RigActionState = 'idle';

  constructor() {
    this.container = new THREE.Group();
    this.container.name = 'first-person-skeletal-rig';
    this.container.visible = false;
  }

  public async load(onReady?: () => void): Promise<boolean> {
    const assetManager = AssetManager.getInstance();
    try {
      // Load without targetLength/targetHeight so Armature (scale=100) * 0.01 = exact 1.0 meter scale
      const res = await assetManager.loadModelWithAnimations('/models/fps_arms_tactical.glb', {
        envMapIntensity: 1.45,
        castShadow: false,
        receiveShadow: false,
      });
      if (!res || this.isDisposed) return false;

      const model = res.model;
      model.scale.setScalar(0.01);
      model.name = 'fps_arms_tactical';
      this.armsModel = model;
      this.container.add(model);

      // Ensure proper bounds for viewmodel skinned mesh
      model.traverse((obj) => {
        if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
          const sm = obj as THREE.SkinnedMesh;
          sm.frustumCulled = false; // Viewmodel always in camera FOV 68°
        }
      });

      const mixer = new THREE.AnimationMixer(model);
      this.mixer = mixer;

      // Register all 22 embedded CC-BY-4.0 animation clips
      for (const clip of res.animations) {
        this.actions.set(clip.name, mixer.clipAction(clip));
      }

      // Generate custom Karambit skeletal AnimationClips on the shared Armature
      const pistolIdle = res.animations.find((c) => c.name === 'Pistol_Idle');
      const pistolWalk = res.animations.find((c) => c.name === 'Pistol_Walk');
      if (pistolIdle) {
        const karambitClips = this.buildKarambitClips(pistolIdle, pistolWalk || pistolIdle);
        for (const kClip of karambitClips) {
          this.actions.set(kClip.name, mixer.clipAction(kClip));
        }
      }

      // Mount all 5 CS2 CC-BY-4.0 weapon GLBs onto their calibrated skeleton sockets
      await this.mountAllWeapons();
      if (this.isDisposed) return false;

      this.isLoaded = true;
      this.container.visible = true;
      this.applyWeaponFraming(this.currentWeaponId);
      this.playState(this.currentWeaponId, 'draw');
      onReady?.();
      return true;
    } catch (err) {
      console.warn('[FirstPersonRig] Failed to load fps_arms_tactical.glb:', err);
      return false;
    }
  }

  private async mountAllWeapons(): Promise<void> {
    if (!this.armsModel) return;
    const assetManager = AssetManager.getInstance();
    const weaponIds: WeaponViewId[] = [
      'garam-47',
      'vanguard-m4',
      'sovereign-awp',
      'desert-eagle',
      'garam-karambit',
    ];

    await Promise.all(
      weaponIds.map(async (weaponId) => {
        const cfg = WEAPON_MOUNT_CONFIGS[weaponId];
        const loaded = await assetManager.loadModel(cfg.modelPath, {
          targetLength: cfg.targetLength,
          centerPivot: weaponId === 'garam-karambit',
          envMapIntensity: 1.85,
          castShadow: false,
          receiveShadow: false,
        });
        if (!loaded || this.isDisposed || !this.armsModel) return;

        const socket =
          this.armsModel.getObjectByName(cfg.socketBone) ||
          this.armsModel.getObjectByName('Hand_R') ||
          this.armsModel;

        const weaponHolder = new THREE.Group();
        weaponHolder.name = `socketed_${weaponId}`;
        weaponHolder.position.set(cfg.localPos[0], cfg.localPos[1], cfg.localPos[2]);
        weaponHolder.rotation.set(cfg.localRot[0], cfg.localRot[1], cfg.localRot[2]);
        weaponHolder.visible = weaponId === this.currentWeaponId;

        let karambitSpinPivot: THREE.Group | undefined;
        if (weaponId === 'garam-karambit') {
          karambitSpinPivot = new THREE.Group();
          karambitSpinPivot.name = 'karambit_ring_pivot';
          karambitSpinPivot.add(loaded);
          weaponHolder.add(karambitSpinPivot);
        } else {
          weaponHolder.add(loaded);
        }

        const muzzleAnchor = new THREE.Object3D();
        muzzleAnchor.name = `muzzle_${weaponId}`;
        muzzleAnchor.position.set(cfg.muzzleLocal[0], cfg.muzzleLocal[1], cfg.muzzleLocal[2]);
        weaponHolder.add(muzzleAnchor);

        const parts: MountedWeaponParts = {
          root: weaponHolder,
          muzzleAnchor,
          karambitSpinPivot,
        };

        // Locate mechanical sub-nodes (slide, bolt, clip/mag) for crisp blowback & empty-reload motion
        loaded.traverse((node) => {
          const n = node.name.toLowerCase();
          if (n.includes('slide')) {
            node.userData.baseZ = node.position.z;
            node.userData.baseX = node.position.x;
            parts.slideNode = node;
          } else if (n.includes('bolt_action') || (n.includes('bolt') && !n.includes('rail'))) {
            node.userData.baseZ = node.position.z;
            node.userData.baseX = node.position.x;
            parts.boltNode = node;
          } else if (n.includes('clip') || n.includes('mag')) {
            node.userData.baseY = node.position.y;
            node.userData.baseZ = node.position.z;
            parts.magNode = node;
          }
        });

        socket.add(weaponHolder);
        this.mountedWeapons.set(weaponId, parts);
      })
    );
  }

  /**
   * Generates bespoke Karambit melee AnimationClips on the shared Armature by taking
   * Pistol_Idle/Walk upper-body & finger grip baselines and adjusting right wrist,
   * off-hand guard, and sweep keyframes cleanly.
   */
  private buildKarambitClips(
    baseIdle: THREE.AnimationClip,
    baseWalk: THREE.AnimationClip
  ): THREE.AnimationClip[] {
    const makeClip = (
      name: string,
      source: THREE.AnimationClip,
      duration: number,
      modifier: (
        boneName: string,
        path: 'translation' | 'rotation' | 'scale',
        times: Float32Array,
        values: Float32Array
      ) => { times: number[]; values: number[] } | null
    ): THREE.AnimationClip => {
      const tracks: THREE.KeyframeTrack[] = [];
      for (const track of source.tracks) {
        const dotIdx = track.name.lastIndexOf('.');
        if (dotIdx < 0) continue;
        const boneName = track.name.slice(0, dotIdx);
        const prop = track.name.slice(dotIdx + 1) as 'translation' | 'rotation' | 'scale' | 'position' | 'quaternion';
        const path = prop === 'position' ? 'translation' : prop === 'quaternion' ? 'rotation' : 'scale';

        const mod = modifier(boneName, path, track.times as Float32Array, track.values as Float32Array);
        if (mod) {
          if (prop === 'position' || prop === 'scale') {
            tracks.push(new THREE.VectorKeyframeTrack(track.name, mod.times, mod.values));
          } else if (prop === 'quaternion') {
            tracks.push(new THREE.QuaternionKeyframeTrack(track.name, mod.times, mod.values));
          }
        } else {
          tracks.push(track.clone());
        }
      }
      const clip = new THREE.AnimationClip(name, duration, tracks);
      clip.resetDuration();
      return clip;
    };

    // Helper: adjust a bone's first-frame rotation with local Euler offset and emit keyframes
    const keyQuatArc = (
      baseValues: Float32Array,
      timesOut: number[],
      offsets: Array<[number, number, number]>
    ): number[] => {
      const baseQ = new THREE.Quaternion(baseValues[0], baseValues[1], baseValues[2], baseValues[3]);
      const out: number[] = [];
      for (let i = 0; i < timesOut.length; i++) {
        const [ex, ey, ez] = offsets[i];
        _eTemp.set(ex, ey, ez, 'XYZ');
        _qOffset.setFromEuler(_eTemp);
        _qTemp.copy(baseQ).multiply(_qOffset).normalize();
        out.push(_qTemp.x, _qTemp.y, _qTemp.z, _qTemp.w);
      }
      return out;
    };

    const keyPosArc = (
      baseValues: Float32Array,
      timesOut: number[],
      offsets: Array<[number, number, number]>
    ): number[] => {
      const out: number[] = [];
      for (let i = 0; i < timesOut.length; i++) {
        out.push(
          baseValues[0] + offsets[i][0],
          baseValues[1] + offsets[i][1],
          baseValues[2] + offsets[i][2]
        );
      }
      return out;
    };

    // Shared idle / left-guard / right-reverse-grip adjustments on top of Pistol_Idle
    const applyKarambitBase = (
      boneName: string,
      path: 'translation' | 'rotation' | 'scale',
      _t: Float32Array,
      v: Float32Array
    ): { times: number[]; values: number[] } | null => {
      // Shift left support hand forward-left into open tactical CS2 guard stance (out of gun cup)
      if (boneName === 'IK_Hand_Cntrl_L' && path === 'translation') {
        return { times: [0, 1.0, 2.0], values: keyPosArc(v, [0, 1.0, 2.0], [[-0.08, -0.02, -0.02], [-0.08, -0.014, -0.02], [-0.08, -0.02, -0.02]]) };
      }
      if (boneName === 'Hand_L' && path === 'rotation') {
        return { times: [0, 1.0, 2.0], values: keyQuatArc(v, [0, 1.0, 2.0], [[0.22, -0.35, 0.25], [0.24, -0.34, 0.26], [0.22, -0.35, 0.25]]) };
      }
      // Slight subtle breathing + reverse-grip tilt on right hand holding Karambit
      if (boneName === 'IK_Hand_Cntrl_R' && path === 'translation') {
        return { times: [0, 1.0, 2.0], values: keyPosArc(v, [0, 1.0, 2.0], [[0.03, -0.01, -0.015], [0.03, -0.004, -0.015], [0.03, -0.01, -0.015]]) };
      }
      if (boneName === 'Hand_R' && path === 'rotation') {
        return { times: [0, 1.0, 2.0], values: keyQuatArc(v, [0, 1.0, 2.0], [[0.18, 0.25, -0.35], [0.20, 0.26, -0.33], [0.18, 0.25, -0.35]]) };
      }
      // Curl right-hand fingers tightly around Karambit G10 handle
      if (boneName.startsWith('Bone_R.') && path === 'rotation') {
        return { times: [0, 2.0], values: keyQuatArc(v, [0, 2.0], [[0.0, 0.0, 0.28], [0.0, 0.0, 0.28]]) };
      }
      return null;
    };

    const kIdle = makeClip('Karambit_Idle', baseIdle, 2.0, applyKarambitBase);
    const kWalk = makeClip('Karambit_Walk', baseWalk, baseWalk.duration, (b, p, t, v) => {
      if (b === 'IK_Hand_Cntrl_L' && p === 'translation') {
        return { times: [0], values: keyPosArc(v, [0], [[-0.08, -0.02, -0.02]]) };
      }
      if (b === 'Hand_R' && p === 'rotation') {
        return { times: [0], values: keyQuatArc(v, [0], [[0.18, 0.25, -0.35]]) };
      }
      if (b.startsWith('Bone_R.') && p === 'rotation') {
        return { times: [0], values: keyQuatArc(v, [0], [[0, 0, 0.28]]) };
      }
      return null;
    });

    const kDraw = makeClip('Karambit_Draw', baseIdle, 0.42, (b, p, t, v) => {
      if (b === 'IK_Hand_Cntrl_R' && p === 'translation') {
        return {
          times: [0, 0.18, 0.42],
          values: keyPosArc(v, [0, 0.18, 0.42], [
            [0.08, -0.20, -0.05],
            [0.01, -0.03, 0.01],
            [0.03, -0.01, -0.015],
          ]),
        };
      }
      if (b === 'Hand_R' && p === 'rotation') {
        return {
          times: [0, 0.22, 0.42],
          values: keyQuatArc(v, [0, 0.22, 0.42], [
            [-0.45, -0.30, 0.55],
            [0.32, 0.42, -0.15],
            [0.18, 0.25, -0.35],
          ]),
        };
      }
      return applyKarambitBase(b, p, t, v);
    });

    const buildSlash = (name: string, dir: 1 | -1) =>
      makeClip(name, baseIdle, 0.34, (b, p, t, v) => {
        if (b === 'IK_Hand_Cntrl_R' && p === 'translation') {
          return {
            times: [0, 0.09, 0.20, 0.34],
            values: keyPosArc(v, [0, 0.09, 0.20, 0.34], [
              [0.03, -0.01, -0.015],
              [0.03 + dir * 0.10, 0.03, -0.02],
              [0.03 - dir * 0.16, -0.04, 0.07],
              [0.03, -0.01, -0.015],
            ]),
          };
        }
        if (b === 'Hand_R' && p === 'rotation') {
          return {
            times: [0, 0.09, 0.20, 0.34],
            values: keyQuatArc(v, [0, 0.09, 0.20, 0.34], [
              [0.18, 0.25, -0.35],
              [0.18 + dir * 0.35, 0.25 - dir * 0.45, -0.35 + dir * 0.35],
              [0.18 - dir * 0.55, 0.25 + dir * 0.65, -0.35 - dir * 0.45],
              [0.18, 0.25, -0.35],
            ]),
          };
        }
        return applyKarambitBase(b, p, t, v);
      });

    const kSlashL = buildSlash('Karambit_Slash_L', 1);
    const kSlashR = buildSlash('Karambit_Slash_R', -1);

    const kStab = makeClip('Karambit_Stab', baseIdle, 0.46, (b, p, t, v) => {
      if (b === 'IK_Hand_Cntrl_R' && p === 'translation') {
        return {
          times: [0, 0.10, 0.22, 0.46],
          values: keyPosArc(v, [0, 0.10, 0.22, 0.46], [
            [0.03, -0.01, -0.015],
            [0.06, 0.03, -0.06],
            [-0.04, 0.01, 0.14],
            [0.03, -0.01, -0.015],
          ]),
        };
      }
      if (b === 'Hand_R' && p === 'rotation') {
        return {
          times: [0, 0.10, 0.22, 0.46],
          values: keyQuatArc(v, [0, 0.10, 0.22, 0.46], [
            [0.18, 0.25, -0.35],
            [0.42, 0.45, -0.15],
            [-0.45, -0.15, -0.55],
            [0.18, 0.25, -0.35],
          ]),
        };
      }
      return applyKarambitBase(b, p, t, v);
    });

    const kInspect = makeClip('Karambit_Inspect', baseIdle, 2.2, (b, p, t, v) => {
      if (b === 'IK_Hand_Cntrl_R' && p === 'translation') {
        return {
          times: [0, 0.45, 1.1, 1.75, 2.2],
          values: keyPosArc(v, [0, 0.45, 1.1, 1.75, 2.2], [
            [0.03, -0.01, -0.015],
            [-0.01, 0.03, 0.03],
            [-0.02, 0.04, 0.035],
            [0.0, 0.02, 0.01],
            [0.03, -0.01, -0.015],
          ]),
        };
      }
      if (b === 'Hand_R' && p === 'rotation') {
        return {
          times: [0, 0.45, 1.1, 1.75, 2.2],
          values: keyQuatArc(v, [0, 0.45, 1.1, 1.75, 2.2], [
            [0.18, 0.25, -0.35],
            [0.35, -0.15, 0.12],
            [0.25, -0.35, 0.25],
            [0.32, 0.05, -0.10],
            [0.18, 0.25, -0.35],
          ]),
        };
      }
      return applyKarambitBase(b, p, t, v);
    });

    return [kIdle, kWalk, kDraw, kSlashL, kSlashR, kStab, kInspect];
  }

  public setWeapon(rawWeaponId: string): void {
    const weaponId = normalizeWeaponViewId(rawWeaponId);
    this.currentWeaponId = weaponId;

    this.mountedWeapons.forEach((parts, id) => {
      parts.root.visible = id === weaponId;
    });

    if (this.isLoaded) {
      this.applyWeaponFraming(weaponId);
      this.playState(weaponId, 'draw');
    }
  }

  private applyWeaponFraming(weaponId: WeaponViewId): void {
    const cfg: WeaponMountConfig = WEAPON_MOUNT_CONFIGS[weaponId];
    this.container.position.set(cfg.rigOffset[0], cfg.rigOffset[1], cfg.rigOffset[2]);
    this.container.rotation.set(cfg.rigRot[0], cfg.rigRot[1], cfg.rigRot[2]);
  }

  public playState(rawWeaponId: string, actionState: RigActionState): void {
    if (!this.isLoaded || !this.mixer) return;
    const weaponId = normalizeWeaponViewId(rawWeaponId);
    const sel = resolveFirstPersonClip(weaponId, actionState);
    const nextAction = this.actions.get(sel.clipName);
    if (!nextAction) return;

    this.currentActionState = actionState;
    if (sel.loop) {
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
      nextAction.clampWhenFinished = false;
      this.oneShotTimer = 0;
    } else {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
      this.oneShotTimer = nextAction.getClip().duration / Math.max(0.1, sel.timeScale);
    }

    nextAction.enabled = true;
    nextAction.setEffectiveWeight(1.0);
    nextAction.setEffectiveTimeScale(sel.timeScale);
    nextAction.time = sel.startTime;

    if (this.activeAction && this.activeAction !== nextAction) {
      // Smooth short crossFade without dipping weight toward T-pose
      this.activeAction.crossFadeTo(nextAction.reset().play(), actionState === 'fire' ? 0.04 : 0.12, false);
    } else {
      nextAction.reset().play();
    }

    this.activeAction = nextAction;
    this.mixer.update(0.001);
  }

  public update(dt: number, isWalking: boolean, isReloading: boolean, slideKick: number, boltKick: number, karambitSpinRad: number): void {
    if (!this.isLoaded || !this.mixer) return;

    if (this.oneShotTimer > 0) {
      this.oneShotTimer -= dt;
      if (this.oneShotTimer <= 0 && !isReloading) {
        this.oneShotTimer = 0;
        this.playState(this.currentWeaponId, isWalking ? 'walk' : 'idle');
      }
    } else if (!isReloading && (this.currentActionState === 'idle' || this.currentActionState === 'walk')) {
      const desired: RigActionState = isWalking ? 'walk' : 'idle';
      if (desired !== this.currentActionState) {
        this.playState(this.currentWeaponId, desired);
      }
    }

    this.mixer.update(dt);

    // Sync weapon mechanical sub-parts (Deagle slide blowback, AWP bolt handle, Karambit ring spin)
    const parts = this.mountedWeapons.get(this.currentWeaponId);
    if (parts) {
      if (parts.slideNode && typeof parts.slideNode.userData.baseZ === 'number') {
        parts.slideNode.position.z = parts.slideNode.userData.baseZ + slideKick;
      }
      if (parts.boltNode && typeof parts.boltNode.userData.baseZ === 'number') {
        parts.boltNode.position.z = parts.boltNode.userData.baseZ + boltKick;
      }
      if (parts.karambitSpinPivot) {
        parts.karambitSpinPivot.rotation.z = karambitSpinRad;
      }
    }
  }

  /**
   * Computes world position of the active weapon's barrel muzzle inside viewmodelScene,
   * so muzzle flash lights, fireball sprites, and rising gunsmoke wisps stay pinned to the barrel.
   */
  public getMuzzlePositionInParent(parentObj: THREE.Object3D, out: THREE.Vector3): boolean {
    const parts = this.mountedWeapons.get(this.currentWeaponId);
    if (!this.isLoaded || !parts) return false;
    parts.muzzleAnchor.updateWorldMatrix(true, false);
    parts.muzzleAnchor.getWorldPosition(_vTemp);
    parentObj.worldToLocal(_vTemp);
    out.copy(_vTemp);
    return true;
  }

  public getMountedWeapon(weaponId: WeaponViewId): MountedWeaponParts | undefined {
    return this.mountedWeapons.get(weaponId);
  }

  public dispose(): void {
    this.isDisposed = true;
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.actions.clear();
    if (this.armsModel) {
      AssetManager.disposeObject3D(this.armsModel);
      this.armsModel = null;
    }
    this.mountedWeapons.forEach((p) => AssetManager.disposeObject3D(p.root));
    this.mountedWeapons.clear();
  }
}
