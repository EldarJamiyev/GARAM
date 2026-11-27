import * as THREE from 'three';
import { solveTwoBoneIK, extractYTwistAngle } from '../viewmodel/ArmIKSolver.js';
import { AssetManager } from './AssetManager.js';
import { buildProceduralCS2Weapon } from './ProceduralWeaponBuilder.js';

export interface WorldWeaponSpec {
  id: string;
  modelPath: string;
  /** Optional asset-manifest.json key; if false/absent, renders procedural PBR weapon with zero 404s */
  manifestKey?: string;
  targetLength: number;
  stance: 'rifle' | 'smg' | 'pistol' | 'melee';
  /** Chest-mount offset in character-local meters relative to spine_2 (+X Left, +Y Up, +Z Forward) */
  chestOffset: [number, number, number];
  /** Chest-mount Euler orientation in character-local space [pitchX, yawY, rollZ] */
  chestRotEuler: [number, number, number];
  /** Right hand grip socket inside canonical weapon space (grip = origin, barrel = +Z) */
  gripRLocal: [number, number, number];
  /** Left support hand grip socket inside canonical weapon space (null for 1-hand melee) */
  gripLLocal: [number, number, number] | null;
  /** Fallback muzzle tip if GLB userData doesn't carry muzzleTipLocal */
  muzzleFallback: [number, number, number];
}

export const WORLD_WEAPON_CATALOG: Record<string, WorldWeaponSpec> = {
  'garam-47': {
    id: 'garam-47',
    modelPath: '/models/garam47.glb',
    targetLength: 0.88,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.014, 0.02, 0.22],
    muzzleFallback: [0, 0.06, 0.62],
  },
  'vanguard-m4': {
    id: 'vanguard-m4',
    modelPath: '/models/m4a1s.glb',
    targetLength: 0.94,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.014, 0.03, 0.23],
    muzzleFallback: [0, 0.07, 0.68],
  },
  'm4a4': {
    id: 'm4a4',
    modelPath: '/models/m4a4.glb',
    manifestKey: 'm4a4',
    targetLength: 0.86,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.014, 0.04, 0.23],
    muzzleFallback: [0, 0.084, 0.63],
  },
  'sovereign-awp': {
    id: 'sovereign-awp',
    modelPath: '/models/awp.glb',
    targetLength: 1.08,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.014, 0.02, 0.24],
    muzzleFallback: [0, 0.08, 0.80],
  },
  'mp9': {
    id: 'mp9',
    modelPath: '/models/mp9.glb',
    manifestKey: 'mp9',
    targetLength: 0.50,
    stance: 'smg',
    chestOffset: [-0.08, 0.06, 0.25],
    chestRotEuler: [0.01, 0.05, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.008, -0.01, 0.18],
    muzzleFallback: [0, 0.076, 0.33],
  },
  'desert-eagle': {
    id: 'desert-eagle',
    modelPath: '/models/deagle.glb',
    targetLength: 0.27,
    stance: 'pistol',
    chestOffset: [-0.03, 0.09, 0.38],
    chestRotEuler: [0.0, 0.02, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.028, -0.012, 0.012],
    muzzleFallback: [0, 0.06, 0.24],
  },
  'usp-s': {
    id: 'usp-s',
    modelPath: '/models/usps.glb',
    manifestKey: 'usps',
    targetLength: 0.36,
    stance: 'pistol',
    chestOffset: [-0.03, 0.09, 0.38],
    chestRotEuler: [0.0, 0.02, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.028, -0.012, 0.012],
    muzzleFallback: [0, 0.068, 0.355],
  },
  'glock-18': {
    id: 'glock-18',
    modelPath: '/models/glock18.glb',
    manifestKey: 'glock18',
    targetLength: 0.22,
    stance: 'pistol',
    chestOffset: [-0.03, 0.09, 0.38],
    chestRotEuler: [0.0, 0.02, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.028, -0.012, 0.012],
    muzzleFallback: [0, 0.068, 0.185],
  },
  'garam-karambit': {
    id: 'garam-karambit',
    modelPath: '/models/karambit.glb',
    targetLength: 0.22,
    stance: 'melee',
    chestOffset: [-0.22, -0.02, 0.34],
    chestRotEuler: [0.18, 0.22, -0.25],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: null,
    muzzleFallback: [0, 0.02, 0.14],
  },
  'mp5-navy': {
    id: 'mp5-navy',
    modelPath: '/models/mp5_navy.glb',
    manifestKey: 'mp5_navy',
    targetLength: 0.54,
    stance: 'smg',
    chestOffset: [-0.08, 0.06, 0.24],
    chestRotEuler: [0.01, 0.05, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.010, 0.01, 0.24],
    muzzleFallback: [0, 0.076, 0.42],
  },
  'clarion-famas': {
    id: 'clarion-famas',
    modelPath: '/models/famas.glb',
    manifestKey: 'famas',
    targetLength: 0.66,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.012, 0.02, 0.20],
    muzzleFallback: [0, 0.066, 0.55],
  },
  'defender-galil': {
    id: 'defender-galil',
    modelPath: '/models/galil.glb',
    manifestKey: 'galil',
    targetLength: 0.72,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.014, 0.02, 0.25],
    muzzleFallback: [0, 0.072, 0.59],
  },
  'schmidt-scout': {
    id: 'schmidt-scout',
    modelPath: '/models/scout.glb',
    manifestKey: 'scout',
    targetLength: 0.82,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.014, 0.02, 0.24],
    muzzleFallback: [0, 0.082, 0.68],
  },
  p90: {
    id: 'p90',
    modelPath: '/models/p90.glb',
    manifestKey: 'p90',
    targetLength: 0.48,
    stance: 'smg',
    chestOffset: [-0.08, 0.06, 0.24],
    chestRotEuler: [0.01, 0.05, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.010, 0.01, 0.19],
    muzzleFallback: [0, 0.066, 0.34],
  },
  'leone-m3': {
    id: 'leone-m3',
    modelPath: '/models/m3.glb',
    manifestKey: 'm3',
    targetLength: 0.78,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.014, 0.01, 0.29],
    muzzleFallback: [0, 0.076, 0.62],
  },
  xm1014: {
    id: 'xm1014',
    modelPath: '/models/xm1014.glb',
    manifestKey: 'xm1014',
    targetLength: 0.76,
    stance: 'rifle',
    chestOffset: [-0.09, 0.06, 0.22],
    chestRotEuler: [0.02, 0.06, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: [0.014, 0.01, 0.27],
    muzzleFallback: [0, 0.076, 0.59],
  },
  'dual-elites': {
    id: 'dual-elites',
    modelPath: '/models/dual_elites.glb',
    manifestKey: 'dual_elites',
    targetLength: 0.34,
    stance: 'pistol',
    chestOffset: [-0.02, 0.09, 0.36],
    chestRotEuler: [0.0, 0.0, 0.0],
    gripRLocal: [-0.115, 0.0, 0.0],
    gripLLocal: [0.115, 0.0, 0.0],
    muzzleFallback: [0, 0.060, 0.17],
  },
  'tactical-shield': {
    id: 'tactical-shield',
    modelPath: '/models/tactical_shield.glb',
    manifestKey: 'tactical_shield',
    targetLength: 0.85,
    stance: 'melee',
    chestOffset: [-0.14, 0.02, 0.36],
    chestRotEuler: [0.0, 0.0, 0.0],
    gripRLocal: [0.0, 0.0, 0.0],
    gripLLocal: null,
    muzzleFallback: [0, 0.08, 0.30],
  },
};

export interface ArmIKBindings {
  root: THREE.Object3D;
  spineAnchor: THREE.Object3D;
  armUpperL?: THREE.Object3D;
  armLowerL?: THREE.Object3D;
  handL?: THREE.Object3D;
  armUpperR?: THREE.Object3D;
  armLowerR?: THREE.Object3D;
  handR?: THREE.Object3D;
  armLowerTwistL: THREE.Object3D[];
  armLowerTwistR: THREE.Object3D[];
  fingersL: { bone: THREE.Object3D; baseQuat: THREE.Quaternion }[];
  fingersR: { bone: THREE.Object3D; baseQuat: THREE.Quaternion }[];
}

export interface OperatorIKPoseInput {
  aimPitch: number;
  sprintBlend: number;
  recoilKick: number;
  reloadBlend: number;
  crouchBlend: number;
  lodLevel: 0 | 1 | 2;
}

// Pre-allocated scratch math objects (zero per-frame heap allocations)
const _vGripR = new THREE.Vector3();
const _vGripL = new THREE.Vector3();
const _vPoleR = new THREE.Vector3();
const _vPoleL = new THREE.Vector3();
const _vReloadTarget = new THREE.Vector3();
const _vScale = new THREE.Vector3();
const _qSpineRest = new THREE.Quaternion();
const _qRootRest = new THREE.Quaternion();
const _qDelta = new THREE.Quaternion();
const _qForearmW = new THREE.Quaternion();
const _qHandW = new THREE.Quaternion();
const _qTwistRel = new THREE.Quaternion();
const _qTwistOut = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

let cachedManifest: Record<string, boolean> | null = null;
let manifestPromise: Promise<Record<string, boolean>> | null = null;

async function getAssetManifest(): Promise<Record<string, boolean>> {
  if (cachedManifest) return cachedManifest;
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        if (typeof fetch !== 'function') return {};
        const res = await fetch('/models/asset-manifest.json');
        if (!res.ok) return {};
        const data = (await res.json()) as Record<string, boolean>;
        cachedManifest = data;
        return data;
      } catch {
        cachedManifest = {};
        return {};
      }
    })();
  }
  return manifestPromise;
}

/**
 * Canonicalizes any loaded weapon Object3D so its barrel ALWAYS points strictly along +Z
 * (away from operator chest in character-local space) with its pistol grip at (0, 0, 0).
 */
export function canonicalizeWorldWeapon(weaponModel: THREE.Object3D): THREE.Group {
  const canonical = new THREE.Group();
  canonical.name = 'canonical_world_weapon';
  canonical.add(weaponModel);

  const axis = weaponModel.userData?.barrelAxisLocal as THREE.Vector3 | undefined;
  if (axis instanceof THREE.Vector3 && axis.lengthSq() > 0.25) {
    // Rotate around Y (or general shortest arc) so barrelAxisLocal aligns strictly with +Z
    const nAxis = axis.clone().normalize();
    if (nAxis.dot(_axisZ) < 0.99) {
      const alignQ = new THREE.Quaternion().setFromUnitVectors(nAxis, _axisZ);
      weaponModel.quaternion.premultiply(alignQ);
      weaponModel.updateMatrixWorld(true);
      if (weaponModel.userData.muzzleTipLocal instanceof THREE.Vector3) {
        weaponModel.userData.muzzleTipLocal = weaponModel.userData.muzzleTipLocal
          .clone()
          .applyQuaternion(alignQ);
      }
      weaponModel.userData.barrelAxisLocal = new THREE.Vector3(0, 0, 1);
    }
  }
  return canonical;
}

/**
 * Deterministic 3rd-Person Weapon Mount & Dual-Arm Analytical 2-Bone IK Controller.
 * Anchors a character-space `chestWeaponMount` directly to `spine_2` (immune to Source2
 * hand bone roll differences between `operator_vanguard.glb` and `operator_syndicate.glb`)
 * and locks BOTH right trigger hand and left support hand onto weapon grip sockets.
 */
export class OperatorArmIK {
  public readonly bindings: ArmIKBindings;
  /** Stabilized character-local frame mounted on spine_2 (1 unit = 1 true meter, +Z = forward) */
  public readonly spineFrame: THREE.Group;
  /** Positioned weapon carrier inside spineFrame */
  public readonly chestWeaponMount: THREE.Group;
  public readonly gripRSocket: THREE.Object3D;
  public readonly gripLSocket: THREE.Object3D;
  public readonly muzzleAnchor: THREE.Object3D;

  private activeWeaponNode: THREE.Object3D | null = null;
  private currentSpec: WorldWeaponSpec = WORLD_WEAPON_CATALOG['garam-47'];
  private baseMountPos = new THREE.Vector3();
  private baseMountQuat = new THREE.Quaternion();

  constructor(bindings: ArmIKBindings) {
    this.bindings = bindings;

    // Build a scale-compensated, character-space frame attached directly to spine_2
    // so (x, y, z) inside spineFrame are ALWAYS true meters (+X Left, +Y Up, +Z Forward)
    bindings.root.updateMatrixWorld(true);
    bindings.spineAnchor.getWorldScale(_vScale);
    const invScale = 1 / Math.max(0.001, _vScale.x);

    bindings.spineAnchor.getWorldQuaternion(_qSpineRest);
    bindings.root.getWorldQuaternion(_qRootRest);

    this.spineFrame = new THREE.Group();
    this.spineFrame.name = 'operator_spine_char_frame';
    this.spineFrame.scale.setScalar(invScale);
    this.spineFrame.quaternion.copy(_qSpineRest).invert().multiply(_qRootRest).normalize();
    bindings.spineAnchor.add(this.spineFrame);

    this.chestWeaponMount = new THREE.Group();
    this.chestWeaponMount.name = 'chest_weapon_mount';
    this.spineFrame.add(this.chestWeaponMount);

    this.gripRSocket = new THREE.Object3D();
    this.gripRSocket.name = 'grip_r_socket';
    this.chestWeaponMount.add(this.gripRSocket);

    this.gripLSocket = new THREE.Object3D();
    this.gripLSocket.name = 'grip_l_socket';
    this.chestWeaponMount.add(this.gripLSocket);

    this.muzzleAnchor = new THREE.Object3D();
    this.muzzleAnchor.name = 'muzzle_anchor';
    this.chestWeaponMount.add(this.muzzleAnchor);

    this.applyWeaponSpec(this.currentSpec);
  }

  public getWeaponSpec(): WorldWeaponSpec {
    return this.currentSpec;
  }

  public applyWeaponSpec(spec: WorldWeaponSpec): void {
    this.currentSpec = spec;
    this.baseMountPos.set(...spec.chestOffset);
    _euler.set(...spec.chestRotEuler, 'XYZ');
    this.baseMountQuat.setFromEuler(_euler);

    this.chestWeaponMount.position.copy(this.baseMountPos);
    this.chestWeaponMount.quaternion.copy(this.baseMountQuat);

    this.gripRSocket.position.set(...spec.gripRLocal);
    if (spec.gripLLocal) {
      this.gripLSocket.position.set(...spec.gripLLocal);
    }
    this.muzzleAnchor.position.set(...spec.muzzleFallback);
  }

  public attachWeaponObject(weaponObj: THREE.Object3D, weaponId: string): void {
    const spec = WORLD_WEAPON_CATALOG[weaponId] || WORLD_WEAPON_CATALOG['garam-47'];
    this.applyWeaponSpec(spec);

    if (this.activeWeaponNode) {
      this.chestWeaponMount.remove(this.activeWeaponNode);
    }

    const canonical = canonicalizeWorldWeapon(weaponObj);
    this.activeWeaponNode = canonical;
    this.chestWeaponMount.add(canonical);

    const tip = weaponObj.userData?.muzzleTipLocal;
    if (tip instanceof THREE.Vector3) {
      this.muzzleAnchor.position.copy(tip);
    } else {
      this.muzzleAnchor.position.set(...spec.muzzleFallback);
    }
  }

  public async loadAndAttachWeapon(weaponId: string): Promise<boolean> {
    const spec = WORLD_WEAPON_CATALOG[weaponId] || WORLD_WEAPON_CATALOG['garam-47'];
    this.applyWeaponSpec(spec);

    let model: THREE.Object3D | null = null;
    let shouldTryGlb = true;
    if (spec.manifestKey) {
      const manifest = await getAssetManifest();
      shouldTryGlb = !!manifest[spec.manifestKey];
    }

    if (shouldTryGlb) {
      model = await AssetManager.getInstance().loadModel(spec.modelPath, {
        targetLength: spec.targetLength,
        anchorBoneName: spec.stance === 'melee' ? undefined : 'weapon_hand_r',
        centerPivot: spec.stance === 'melee',
        envMapIntensity: 1.5,
        castShadow: true,
        receiveShadow: true,
      });
    }

    if (!model) {
      model = buildProceduralCS2Weapon(spec.id);
    }

    this.attachWeaponObject(model, spec.id);
    return true;
  }

  /**
   * Computes barrel forward unit direction in world space (for tests & tracer origin validation).
   */
  public getWorldBarrelDirection(out = new THREE.Vector3()): THREE.Vector3 {
    this.chestWeaponMount.updateWorldMatrix(true, false);
    const q = new THREE.Quaternion();
    this.chestWeaponMount.getWorldQuaternion(q);
    return out.set(0, 0, 1).applyQuaternion(q).normalize();
  }

  /**
   * Solves BOTH right trigger hand and left support hand onto the chest-mounted weapon's
   * grip sockets with natural tactical elbows, sprint low-ready cant, recoil kickback,
   * reload left-hand magazine dip, finger grip curl, and forearm twist distribution.
   * Zero per-frame heap allocations.
   */
  public solve(input: OperatorIKPoseInput): { rightGap: number; leftGap: number } {
    const { bindings, currentSpec } = this;

    // 1. Update chestWeaponMount with dynamic aim pitch, recoil kick, and low-ready sprint cant
    const sprintCant = input.sprintBlend * (currentSpec.stance === 'pistol' ? 0.14 : 0.24);
    const recoilBack = input.recoilKick * (currentSpec.stance === 'pistol' ? 0.025 : 0.038);
    const recoilPitch = -input.recoilKick * 0.09;

    this.chestWeaponMount.position.set(
      this.baseMountPos.x + input.sprintBlend * 0.03,
      this.baseMountPos.y - input.sprintBlend * 0.04,
      this.baseMountPos.z - recoilBack - input.sprintBlend * 0.02
    );

    _euler.set(
      currentSpec.chestRotEuler[0] - input.aimPitch * 0.52 + sprintCant + recoilPitch,
      currentSpec.chestRotEuler[1] + input.sprintBlend * 0.26,
      currentSpec.chestRotEuler[2] - input.sprintBlend * 0.14,
      'XYZ'
    );
    this.chestWeaponMount.quaternion.setFromEuler(_euler);

    if (input.lodLevel === 2) {
      return { rightGap: 0, leftGap: 0 };
    }

    bindings.root.updateMatrixWorld(true);

    // 2. Right Trigger Arm 2-Bone Analytical IK -> grip_r_socket
    let rightGap = 0;
    if (bindings.armUpperR && bindings.armLowerR && bindings.handR) {
      this.gripRSocket.getWorldPosition(_vGripR);
      // Right elbow pole: outward right (-X), downward (-Y), slightly back (-Z) in character space
      _vPoleR
        .set(-0.68, 0.72 - input.crouchBlend * 0.34, -0.18)
        .applyMatrix4(bindings.root.matrixWorld);

      rightGap = solveTwoBoneIK(
        bindings.armUpperR,
        bindings.armLowerR,
        bindings.handR,
        _vGripR,
        _vPoleR,
        false
      );
    }

    // 3. Left Support Arm 2-Bone Analytical IK -> grip_l_socket (or chest mag pouch during reload)
    let leftGap = 0;
    if (bindings.armUpperL && bindings.armLowerL && bindings.handL) {
      if (currentSpec.gripLLocal) {
        this.gripLSocket.getWorldPosition(_vGripL);
        if (input.reloadBlend > 0.01) {
          _vReloadTarget
            .set(0.06, 1.05 - input.crouchBlend * 0.34, 0.22)
            .applyMatrix4(bindings.root.matrixWorld);
          _vGripL.lerp(_vReloadTarget, input.reloadBlend);
        }
      } else {
        // Melee CQC athletic left-hand guard
        _vGripL
          .set(0.24, 1.18 - input.crouchBlend * 0.34, 0.26)
          .applyMatrix4(bindings.root.matrixWorld);
      }

      // Left elbow pole: outward left (+X), downward (-Y), slightly forward (+Z)
      _vPoleL
        .set(0.72, 0.68 - input.crouchBlend * 0.34, 0.12)
        .applyMatrix4(bindings.root.matrixWorld);

      leftGap = solveTwoBoneIK(
        bindings.armUpperL,
        bindings.armLowerL,
        bindings.handL,
        _vGripL,
        _vPoleL,
        false
      );
    }

    // 4. LOD0 Detail Pass: Forearm twist distribution & tactical finger grip curl
    if (input.lodLevel === 0) {
      this.applyForearmTwist(bindings.armLowerR, bindings.handR, bindings.armLowerTwistR);
      this.applyForearmTwist(bindings.armLowerL, bindings.handL, bindings.armLowerTwistL);
      this.applyFingerCurl(bindings.fingersR, 0.68);
      this.applyFingerCurl(bindings.fingersL, currentSpec.gripLLocal ? 0.58 : 0.35);
    }

    return { rightGap, leftGap };
  }

  private applyForearmTwist(
    forearm: THREE.Object3D | undefined,
    hand: THREE.Object3D | undefined,
    twists: THREE.Object3D[]
  ): void {
    if (!forearm || !hand || twists.length === 0) return;
    forearm.getWorldQuaternion(_qForearmW);
    hand.getWorldQuaternion(_qHandW);
    _qTwistRel.copy(_qForearmW).invert().multiply(_qHandW).normalize();
    const angle = Math.max(-1.4, Math.min(1.4, extractYTwistAngle(_qTwistRel)));
    for (let i = 0; i < twists.length; i++) {
      const w = twists.length === 1 ? 0.5 : (i + 1) / (twists.length + 1);
      _qTwistOut.setFromAxisAngle(_axisY, angle * w);
      twists[i].quaternion.copy(_qTwistOut);
    }
  }

  private applyFingerCurl(
    fingers: { bone: THREE.Object3D; baseQuat: THREE.Quaternion }[],
    curlRad: number
  ): void {
    if (fingers.length === 0) return;
    _qDelta.setFromAxisAngle(_axisX, curlRad);
    for (let i = 0; i < fingers.length; i++) {
      fingers[i].bone.quaternion.copy(fingers[i].baseQuat).multiply(_qDelta);
    }
  }

  public dispose(): void {
    if (this.activeWeaponNode) {
      this.chestWeaponMount.remove(this.activeWeaponNode);
      this.activeWeaponNode = null;
    }
    this.spineFrame.removeFromParent();
  }
}
