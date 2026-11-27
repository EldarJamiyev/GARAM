import * as THREE from 'three';
import { AssetManager } from '../render/AssetManager.js';
import { buildProceduralCS2Weapon } from '../render/ProceduralWeaponBuilder.js';
import { ArmIKSolver } from './ArmIKSolver.js';
import {
  CS2_ARMS_MODEL_PATH,
  WEAPON_SOCKET_CONFIGS,
  WeaponSocketConfig,
  computeKarambitInspectSpinAngle,
  computeNarrowAspectOffsetX,
  getWeaponSocketConfig,
  resolveWeaponClipName,
  captureBindPose,
  restoreBindPose,
  buildCS2AnimationClips,
  buildKarambitAnimationClips,
  patchM4IdleClip,
  BoneTransformSnapshot,
} from './ViewmodelRig.js';

const _muzzleWorld = new THREE.Vector3();
const _muzzleLocal = new THREE.Vector3();
const _mat4Inv = new THREE.Matrix4();
const _mat4Rel = new THREE.Matrix4();
const _mat3Lin = new THREE.Matrix3();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vD = new THREE.Vector3();
const _euler = new THREE.Euler();
const _qDelta = new THREE.Quaternion();

/**
 * Computes the local translation vector in `part.parent` space that produces exactly
 * 1.0 meter of displacement along `rearAxisWrapper` in `wrapper` space.
 * Automatically compensates for both `AssetManager` normalizationScale and Source2
 * inch-scale / rotated bone hierarchies so blowback never explodes or moves sideways.
 */
export function computeRecoilStepPerMeter(
  wrapper: THREE.Object3D,
  part: THREE.Object3D,
  rearAxisWrapper: THREE.Vector3
): THREE.Vector3 {
  wrapper.updateMatrixWorld(true);
  if (part.parent) {
    _mat4Inv.copy(wrapper.matrixWorld).invert();
    _mat4Rel.multiplyMatrices(_mat4Inv, part.parent.matrixWorld);
    _mat3Lin.setFromMatrix4(_mat4Rel);
    if (Math.abs(_mat3Lin.determinant()) > 1e-10) {
      _mat3Lin.invert();
      return rearAxisWrapper.clone().applyMatrix3(_mat3Lin);
    }
  }
  const normScale =
    typeof wrapper.userData.normalizationScale === 'number' &&
    wrapper.userData.normalizationScale > 1e-4
      ? wrapper.userData.normalizationScale
      : 1.0;
  return rearAxisWrapper.clone().divideScalar(normScale);
}

const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikC = new THREE.Vector3();
const _ikD = new THREE.Vector3();
const _ikE = new THREE.Vector3();
const _ikF = new THREE.Vector3();
const _ikG = new THREE.Vector3();
const _ikQ1 = new THREE.Quaternion();
const _ikQ2 = new THREE.Quaternion();

/**
 * Applies faction-specific tactical glove tinting (Vanguard CT navy-slate vs.
 * Syndicate T crimson-obsidian) to either the unified CS2 arms GLB or procedural
 * fallback gloves while keeping bare tattooed forearm skin (modelsweaponsv_modelsarmst)
 * at natural untinted white (0xffffff).
 */
export function applyFactionGloveTint(
  root: THREE.Object3D,
  faction: 'Vanguard' | 'Syndicate'
): number {
  const isSyndicate = faction === 'Syndicate';
  const glbGloveTintHex = isSyndicate ? 0xb85a64 : 0x5c84b4;
  const procFabricHex = isSyndicate ? 0x3b1d22 : 0x243447;
  const procCuffHex = isSyndicate ? 0x4d252b : 0x33475e;
  let tintedCount = 0;

  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      const std = m as THREE.MeshStandardMaterial;
      const matName = (std.name || '').toLowerCase();
      const role = (std.userData?.gloveRole as string | undefined) || '';

      if (matName.includes('armst') || matName.includes('skin') || matName.includes('tattoo')) {
        std.color.setHex(0xffffff);
        std.needsUpdate = true;
      } else if (matName.includes('armsv') || matName.includes('glove')) {
        std.color.setHex(glbGloveTintHex);
        std.needsUpdate = true;
        tintedCount++;
      } else if (role === 'fabric') {
        std.color.setHex(procFabricHex);
        std.needsUpdate = true;
        tintedCount++;
      } else if (role === 'cuff') {
        std.color.setHex(procCuffHex);
        std.needsUpdate = true;
        tintedCount++;
      }
    }
  });

  return tintedCount;
}

const _fingerQ = new THREE.Quaternion();
const _restV1 = new THREE.Vector3();
const _restV2 = new THREE.Vector3();
const _restV3 = new THREE.Vector3();
const _restV4 = new THREE.Vector3();
const _restV5 = new THREE.Vector3();
const _restFwd = new THREE.Vector3();
const _restAcross = new THREE.Vector3();
const _restPalmar = new THREE.Vector3();
const _restThumbDir = new THREE.Vector3();
const _restBendLocal = new THREE.Vector3();
const _restUpY = new THREE.Vector3(0, 1, 0);
const _restInvQ = new THREE.Quaternion();

const DEG2RAD = Math.PI / 180;

export type CS2FingerName = 'index' | 'middle' | 'ring' | 'pinky' | 'thumb';

export const CS2_FINGER_BONE_CHAINS: Record<
  'L' | 'R',
  {
    hand: string;
    palms: readonly string[];
    fingers: Record<CS2FingerName, readonly [string, string, string]>;
  }
> = {
  L: {
    hand: 'DEF-handL_233',
    palms: [
      'ORG-palm01L_174',
      'ORG-palm02L_193',
      'ORG-palm03L_212',
      'ORG-palm04L_231',
      'DEF-palm01L_153',
      'DEF-palm02L_182',
      'DEF-palm03L_201',
      'DEF-palm04L_220',
    ],
    fingers: {
      index: ['DEF-f_index01L_147', 'DEF-f_index02L_146', 'DEF-f_index03L_145'],
      middle: ['DEF-f_middle01L_180', 'DEF-f_middle02L_179', 'DEF-f_middle03L_178'],
      ring: ['DEF-f_ring01L_199', 'DEF-f_ring02L_198', 'DEF-f_ring03L_197'],
      pinky: ['DEF-f_pinky01L_218', 'DEF-f_pinky02L_217', 'DEF-f_pinky03L_216'],
      thumb: ['DEF-thumb01L_151', 'DEF-thumb02L_150', 'DEF-thumb03L_149'],
    },
  },
  R: {
    hand: 'DEF-handR_357',
    palms: [
      'ORG-palm01R_298',
      'ORG-palm02R_317',
      'ORG-palm03R_336',
      'ORG-palm04R_355',
      'DEF-palm01R_277',
      'DEF-palm02R_306',
      'DEF-palm03R_325',
      'DEF-palm04R_344',
    ],
    fingers: {
      index: ['DEF-f_index01R_271', 'DEF-f_index02R_270', 'DEF-f_index03R_269'],
      middle: ['DEF-f_middle01R_304', 'DEF-f_middle02R_303', 'DEF-f_middle03R_302'],
      ring: ['DEF-f_ring01R_323', 'DEF-f_ring02R_322', 'DEF-f_ring03R_321'],
      pinky: ['DEF-f_pinky01R_342', 'DEF-f_pinky02R_341', 'DEF-f_pinky03R_340'],
      thumb: ['DEF-thumb01R_275', 'DEF-thumb02R_274', 'DEF-thumb03R_273'],
    },
  },
};

export interface CS2FingerBoneRest {
  bone: THREE.Object3D;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  restScale: THREE.Vector3;
  flexAxis: THREE.Vector3;
}

export interface CS2PalmBoneRest {
  bone: THREE.Object3D;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  restScale: THREE.Vector3;
}

export interface CS2FingerRestRig {
  palms: CS2PalmBoneRest[];
  handScales: Array<{ bone: THREE.Object3D; restScale: THREE.Vector3 }>;
  bones: Map<string, CS2FingerBoneRest>;
  palmCenterLocal: Record<'L' | 'R', THREE.Vector3>;
}

const cs2FingerRestCache = new WeakMap<THREE.Object3D, CS2FingerRestRig>();

/**
 * Captures bind-pose rest transforms (position, quaternion, scale) for all left/right
 * palm and finger phalanx bones and computes each bone's exact local flexion axis
 * (`cross(+Y, localPalmarDir)`) so positive curl angles bend fingertips straight into the
 * palm with zero sideways splay and zero cumulative drift.
 */
export function initCS2FingerRestRig(
  armsRoot: THREE.Object3D,
  bindPoseSnapshot?: Map<THREE.Object3D, BoneTransformSnapshot>
): CS2FingerRestRig {
  const existing = cs2FingerRestCache.get(armsRoot);
  if (existing) return existing;

  // If caller provided a bind-pose snapshot, temporarily apply it to hand/palm/finger bones
  // so world-space palmar axes are derived strictly from the clean bind pose.
  const tempPrev = new Map<
    THREE.Object3D,
    { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }
  >();
  if (bindPoseSnapshot) {
    for (const side of ['L', 'R'] as const) {
      const sideCfg = CS2_FINGER_BONE_CHAINS[side];
      const names: string[] = [sideCfg.hand, ...sideCfg.palms];
      for (const fName of ['index', 'middle', 'ring', 'pinky', 'thumb'] as const) {
        names.push(...sideCfg.fingers[fName]);
      }
      for (const name of names) {
        const b = armsRoot.getObjectByName(name);
        const snap = b ? bindPoseSnapshot.get(b) : undefined;
        if (b && snap) {
          tempPrev.set(b, {
            pos: b.position.clone(),
            quat: b.quaternion.clone(),
            scale: b.scale.clone(),
          });
          b.position.copy(snap.position);
          b.quaternion.copy(snap.quaternion);
          b.scale.copy(snap.scale);
        }
      }
    }
  }

  armsRoot.updateMatrixWorld(true);

  const palms: CS2PalmBoneRest[] = [];
  const handScales: Array<{ bone: THREE.Object3D; restScale: THREE.Vector3 }> = [];
  const bones = new Map<string, CS2FingerBoneRest>();
  const palmCenterLocal: Record<'L' | 'R', THREE.Vector3> = {
    L: new THREE.Vector3(),
    R: new THREE.Vector3(),
  };

  for (const side of ['L', 'R'] as const) {
    const sideCfg = CS2_FINGER_BONE_CHAINS[side];
    const handNode = armsRoot.getObjectByName(sideCfg.hand);
    if (handNode) {
      handScales.push({ bone: handNode, restScale: handNode.scale.clone() });
    }
    for (const pName of sideCfg.palms) {
      const pBone = armsRoot.getObjectByName(pName);
      if (pBone) {
        palms.push({
          bone: pBone,
          restPos: pBone.position.clone(),
          restQuat: pBone.quaternion.clone(),
          restScale: pBone.scale.clone(),
        });
      }
    }

    const hand = armsRoot.getObjectByName(sideCfg.hand);
    const idx01 = armsRoot.getObjectByName(sideCfg.fingers.index[0]);
    const mid01 = armsRoot.getObjectByName(sideCfg.fingers.middle[0]);
    const pnk01 = armsRoot.getObjectByName(sideCfg.fingers.pinky[0]);
    const thm01 = armsRoot.getObjectByName(sideCfg.fingers.thumb[0]);

    if (hand && idx01 && mid01 && pnk01 && thm01) {
      hand.getWorldPosition(_restV1);
      idx01.getWorldPosition(_restV2);
      mid01.getWorldPosition(_restV3);
      pnk01.getWorldPosition(_restV4);
      thm01.getWorldPosition(_restV5);

      _restFwd.subVectors(_restV3, _restV1).normalize();
      _restAcross.subVectors(_restV4, _restV2).normalize();
      _restPalmar.crossVectors(_restFwd, _restAcross).normalize();
      if (_restPalmar.dot(_restV5.sub(_restV3)) < 0) {
        _restPalmar.negate();
      }
      _restThumbDir
        .copy(_restPalmar)
        .multiplyScalar(0.25)
        .addScaledVector(_restAcross, 0.85)
        .addScaledVector(_restFwd, 0.45)
        .normalize();

      // Store anatomical palm center in hand-local space for regression & grip checks
      _restV2.copy(_restV1).lerp(_restV3, 0.55).addScaledVector(_restPalmar, 0.025);
      hand.worldToLocal(_restV2);
      palmCenterLocal[side].copy(_restV2);
    } else {
      _restPalmar.set(side === 'L' ? -1 : 1, 0, 0);
      _restThumbDir.set(side === 'L' ? -0.4 : 0.4, -0.3, -0.85).normalize();
    }

    for (const fName of ['index', 'middle', 'ring', 'pinky', 'thumb'] as const) {
      const targetDir = fName === 'thumb' ? _restThumbDir : _restPalmar;
      for (const bName of sideCfg.fingers[fName]) {
        const bone = armsRoot.getObjectByName(bName);
        if (!bone) continue;
        bone.getWorldQuaternion(_restInvQ).invert();
        _restBendLocal.copy(targetDir).applyQuaternion(_restInvQ);
        _restBendLocal.y = 0;
        if (_restBendLocal.lengthSq() < 1e-8) {
          _restBendLocal.set(0, 0, 1);
        } else {
          _restBendLocal.normalize();
        }
        const flexAxis = new THREE.Vector3().crossVectors(_restUpY, _restBendLocal).normalize();
        bones.set(bName, {
          bone,
          restPos: bone.position.clone(),
          restQuat: bone.quaternion.clone(),
          restScale: bone.scale.clone(),
          flexAxis,
        });
      }
    }
  }

  if (tempPrev.size > 0) {
    tempPrev.forEach((prev, b) => {
      b.position.copy(prev.pos);
      b.quaternion.copy(prev.quat);
      b.scale.copy(prev.scale);
    });
    armsRoot.updateMatrixWorld(true);
  }

  const rig: CS2FingerRestRig = { palms, handScales, bones, palmCenterLocal };
  cs2FingerRestCache.set(armsRoot, rig);
  return rig;
}

type HandCurlPreset = Record<CS2FingerName, readonly [number, number, number]>;

const FINGER_GRIP_PRESETS: Record<
  'rifle' | 'pistol' | 'karambit',
  { L: HandCurlPreset; R: HandCurlPreset }
> = {
  rifle: {
    // Solid pistol-grip wrap (middle/ring/pinky tightly wrapped, index ~35° on trigger, thumb across backstrap)
    R: {
      index: [22, 35, 22],
      middle: [45, 76, 52],
      ring: [52, 80, 54],
      pinky: [52, 80, 54],
      thumb: [20, 25, 18],
    },
    // Cohesive underside handguard cradle (all 4 fingers uniformly curled ~55-70°, thumb tucked ~25° along side)
    L: {
      index: [34, 56, 40],
      middle: [36, 60, 42],
      ring: [38, 62, 44],
      pinky: [40, 64, 44],
      thumb: [10, 15, 10],
    },
  },
  pistol: {
    // Tight right-hand pistol grip + index ~35° on trigger + thumb forward along frame
    R: {
      index: [22, 35, 24],
      middle: [45, 78, 54],
      ring: [54, 84, 56],
      pinky: [54, 84, 56],
      thumb: [14, 16, 12],
    },
    // Tight two-handed support wrap over right knuckles + thumb parallel to slide
    L: {
      index: [46, 74, 52],
      middle: [48, 78, 54],
      ring: [50, 80, 56],
      pinky: [50, 80, 56],
      thumb: [12, 14, 10],
    },
  },
  karambit: {
    // Tight closed reverse-grip fist: handle clamped cleanly, index locked around retention ring, thumb tucked over index knuckle
    R: {
      index: [48, 72, 52],
      middle: [58, 84, 56],
      ring: [60, 86, 58],
      pinky: [60, 86, 58],
      thumb: [19, 21, 15],
    },
    // Relaxed natural CS2 open guard: fingers gently & uniformly curved (~22-30°) together, thumb relaxed ~18° inward
    L: {
      index: [12, 24, 18],
      middle: [14, 26, 20],
      ring: [16, 28, 22],
      pinky: [18, 30, 22],
      thumb: [8, 10, 8],
    },
  },
};

function setFingerChainCurl(
  rig: CS2FingerRestRig,
  boneNames: readonly [string, string, string],
  curlsDeg: readonly [number, number, number]
): void {
  for (let i = 0; i < 3; i++) {
    const entry = rig.bones.get(boneNames[i]);
    if (!entry) continue;
    entry.bone.position.copy(entry.restPos);
    entry.bone.scale.copy(entry.restScale);
    _fingerQ.setFromAxisAngle(entry.flexAxis, curlsDeg[i] * DEG2RAD);
    entry.bone.quaternion.copy(entry.restQuat).multiply(_fingerQ);
  }
}

/**
 * Deterministically overwrites every left and right palm & finger phalanx transform from
 * bind-pose rest + verified anatomical flexion axes (`restQuat * axisAngle(flexAxis, rad)`).
 * Zero accumulation, zero swimming, zero floating/detached knuckles.
 */
export function applyCS2PhysicalFingerGrip(
  armsRoot: THREE.Object3D,
  mode: 'rifle' | 'pistol' | 'karambit',
  bindPoseSnapshot?: Map<THREE.Object3D, BoneTransformSnapshot>
): void {
  const rig = initCS2FingerRestRig(armsRoot, bindPoseSnapshot);

  for (let i = 0; i < rig.handScales.length; i++) {
    const hs = rig.handScales[i];
    hs.bone.scale.copy(hs.restScale);
  }

  for (let i = 0; i < rig.palms.length; i++) {
    const p = rig.palms[i];
    p.bone.position.copy(p.restPos);
    p.bone.quaternion.copy(p.restQuat);
    p.bone.scale.copy(p.restScale);
  }

  const preset = FINGER_GRIP_PRESETS[mode];
  for (const side of ['L', 'R'] as const) {
    const chains = CS2_FINGER_BONE_CHAINS[side].fingers;
    const handPreset = preset[side];
    for (const fName of ['index', 'middle', 'ring', 'pinky', 'thumb'] as const) {
      setFingerChainCurl(rig, chains[fName], handPreset[fName]);
    }
  }
}

/**
 * Shared single-source-of-truth CS2 arm IK posture solver used both at runtime
 * (`WeaponViewmodel.update`) and in the automated skinned-vertex Vitest gate.
 */
export function applyCS2WeaponHandPosture(params: {
  armsRoot: THREE.Object3D;
  meshRoot: THREE.Object3D;
  armIKSolver: ArmIKSolver;
  cfg: WeaponSocketConfig;
  weaponSocket: THREE.Object3D | null;
  handRSocket: THREE.Object3D | null;
  handLSocket: THREE.Object3D | null;
  gripAnchorWorld: THREE.Vector3 | null;
  leftHandLockWeight: number;
  isReloading: boolean;
  isInspecting: boolean;
  inspectProgress?: number;
  narrowOffsetX?: number;
  bindPoseSnapshot?: Map<THREE.Object3D, BoneTransformSnapshot>;
}): void {
  const {
    armsRoot,
    meshRoot,
    armIKSolver,
    cfg,
    weaponSocket,
    handRSocket,
    handLSocket,
    gripAnchorWorld,
    leftHandLockWeight,
    isReloading,
    isInspecting,
    inspectProgress = 0,
    narrowOffsetX = 0,
    bindPoseSnapshot,
  } = params;

  if (cfg.leftArmPoseMode === 'rifle') {
    if (!handLSocket || !gripAnchorWorld) {
      applyCS2PhysicalFingerGrip(armsRoot, 'rifle', bindPoseSnapshot);
      return;
    }
    const fIdx = armsRoot.getObjectByName('DEF-f_index01L_147');
    const fMid = armsRoot.getObjectByName('DEF-f_middle01L_180');
    const fRing = armsRoot.getObjectByName('DEF-f_ring01L_199');
    handLSocket.getWorldPosition(_ikA);

    for (let iter = 0; iter < 3; iter++) {
      handLSocket.updateWorldMatrix(true, false);
      handLSocket.getWorldPosition(_ikA);
      if (fIdx && fMid && fRing) {
        fIdx.updateWorldMatrix(true, false);
        fMid.updateWorldMatrix(true, false);
        fRing.updateWorldMatrix(true, false);
        fIdx.getWorldPosition(_ikB);
        fMid.getWorldPosition(_ikC);
        fRing.getWorldPosition(_ikD);
        _ikB.add(_ikC).add(_ikD).multiplyScalar(1 / 3);
        _ikE.subVectors(_ikB, _ikA);
        _ikF.subVectors(gripAnchorWorld, _ikE);
      } else {
        _ikF.copy(gripAnchorWorld);
      }

      if (isReloading) {
        const magBlend = 1.0 - THREE.MathUtils.clamp(leftHandLockWeight, 0, 1);
        _ikF.x += 0.010 * magBlend;
        _ikF.y -= 0.042 * magBlend;
        _ikF.z += 0.048 * magBlend;
      }

      // Strictly downward elbow pole keeps DEF-forearmL_235 off bottom screen edge across all clips
      _ikG.set(_ikF.x - 0.08, _ikF.y - 0.55, _ikF.z + 0.06);
      armIKSolver.solveCS2LeftHandToTarget(_ikF, _ikG);
    }
    applyCS2PhysicalFingerGrip(armsRoot, 'rifle', bindPoseSnapshot);
    return;
  }

  if (cfg.leftArmPoseMode === 'pistol' && handRSocket && handLSocket) {
    handRSocket.getWorldPosition(_ikA);
    handRSocket.getWorldQuaternion(_ikQ1);
    const pistolReloadDipY = isReloading ? -0.014 : 0;
    _ikB.set(0.088 + narrowOffsetX, -0.094 + pistolReloadDipY, -0.225);
    meshRoot.localToWorld(_ikB);
    _ikC.set(0.26 + narrowOffsetX, -0.48, 0.02);
    meshRoot.localToWorld(_ikC);
    armIKSolver.solveCS2RightHandToTarget(_ikB, _ikC);
    if (handRSocket.parent) {
      handRSocket.parent.updateWorldMatrix(true, false);
      handRSocket.parent.getWorldQuaternion(_ikQ2);
      handRSocket.quaternion.copy(_ikQ2).invert().multiply(_ikQ1);
    }
    handRSocket.updateMatrixWorld(true);
    handRSocket.getWorldPosition(_ikD);

    if (weaponSocket && weaponSocket.parent) {
      _ikE.subVectors(_ikD, _ikA);
      weaponSocket.getWorldPosition(_ikF);
      _ikF.add(_ikE);
      weaponSocket.parent.updateWorldMatrix(true, false);
      weaponSocket.parent.worldToLocal(_ikF);
      weaponSocket.position.copy(_ikF);
      weaponSocket.updateMatrixWorld(true);
      weaponSocket.getWorldPosition(_ikE);
    } else {
      _ikE.copy(_ikD);
    }

    const reloadDropY = isReloading ? -0.032 : 0;
    _ikF.set(_ikE.x - 0.014, _ikE.y - 0.020 + reloadDropY, _ikE.z + 0.008);
    _ikG.set(_ikE.x - 0.22, _ikE.y - 0.48, _ikE.z + 0.08);
    armIKSolver.solveCS2LeftHandToTarget(_ikF, _ikG);
    applyCS2PhysicalFingerGrip(armsRoot, 'pistol', bindPoseSnapshot);
    return;
  }

  if (cfg.leftArmPoseMode === 'karambit' && handRSocket && handLSocket) {
    const inspectEnv = isInspecting
      ? Math.sin(Math.PI * THREE.MathUtils.clamp(inspectProgress, 0, 1))
      : 0;
    handRSocket.getWorldPosition(_ikA);
    handRSocket.getWorldQuaternion(_ikQ1);
    if (inspectEnv > 0.0001) {
      // Subtle <= 18° right-wrist showcase tilt keeping crimson blade clearly framed during ring twirl
      _euler.set(-0.12 * inspectEnv, 0.20 * inspectEnv, 0.15 * inspectEnv, 'XYZ');
      _qDelta.setFromEuler(_euler);
      _ikQ1.premultiply(_qDelta);
    }
    _ikB.set(
      0.104 + narrowOffsetX - 0.028 * inspectEnv,
      -0.097 + 0.045 * inspectEnv,
      -0.232 - 0.060 * inspectEnv
    );
    meshRoot.localToWorld(_ikB);
    _ikC.set(0.28 + narrowOffsetX, -0.48, -0.02);
    meshRoot.localToWorld(_ikC);
    armIKSolver.solveCS2RightHandToTarget(_ikB, _ikC);
    if (handRSocket.parent) {
      handRSocket.parent.updateWorldMatrix(true, false);
      handRSocket.parent.getWorldQuaternion(_ikQ2);
      handRSocket.quaternion.copy(_ikQ2).invert().multiply(_ikQ1);
    }
    handRSocket.updateMatrixWorld(true);
    handRSocket.getWorldPosition(_ikD);

    if (cfg.socketBone !== 'DEF-handR_357' && weaponSocket && weaponSocket.parent) {
      _ikE.subVectors(_ikD, _ikA);
      weaponSocket.getWorldPosition(_ikF);
      _ikF.add(_ikE);
      weaponSocket.parent.updateWorldMatrix(true, false);
      weaponSocket.parent.worldToLocal(_ikF);
      weaponSocket.position.copy(_ikF);
      weaponSocket.updateMatrixWorld(true);
    }

    _ikF.set(-0.088 + narrowOffsetX * 0.5, -0.096, -0.265);
    meshRoot.localToWorld(_ikF);
    _ikG.set(-0.24 + narrowOffsetX * 0.5, -0.48, -0.12);
    meshRoot.localToWorld(_ikG);
    armIKSolver.solveCS2LeftHandToTarget(_ikF, _ikG);
    applyCS2PhysicalFingerGrip(armsRoot, 'karambit', bindPoseSnapshot);
  }
}

export class WeaponViewmodel {
  public mesh: THREE.Group;
  private weaponContainer: THREE.Group;
  private rightArm: THREE.Group;
  private leftArm: THREE.Group;
  private muzzleFlashLight: THREE.PointLight;
  private muzzleFlashMesh: THREE.Group;
  private muzzleFlashMat: THREE.MeshBasicMaterial | null = null;
  private gunsmokeMesh: THREE.Mesh;
  private gunsmokeMat: THREE.MeshBasicMaterial;
  private smokeTimer = 0;
  private flashTimer = 0;
  private currentWeaponId = 'garam-47';

  // Cached Weapon Groups & Animated Parts (supports both procedural Meshes and GLB Bones)
  private weaponMeshes: Map<string, THREE.Group> = new Map();
  private glbWeaponRoots: Map<string, THREE.Object3D> = new Map();
  private muzzleHelpers: Map<string, THREE.Object3D> = new Map();
  private slideMeshes: Map<string, THREE.Object3D> = new Map();
  private boltMeshes: Map<string, THREE.Object3D> = new Map();
  private magMeshes: Map<string, THREE.Object3D> = new Map();
  private karambitSpinPivot: THREE.Group | null = null;
  private karambitRingSpinGroup: THREE.Group | null = null;
  private bladeTrailMesh: THREE.Mesh | null = null;

  // Unified CS2 First-Person Gloved Arms Rig (/models/cs2_fps_arms.glb) for ALL 5 weapons
  private armsContainer: THREE.Group;
  private armsRoot: THREE.Object3D | null = null;
  private armsMixer: THREE.AnimationMixer | null = null;
  private armIKSolver: ArmIKSolver | null = null;
  private armsActions: Map<string, THREE.AnimationAction> = new Map();
  private bindPoseSnapshot: Map<THREE.Object3D, BoneTransformSnapshot> = new Map();
  private cs2WeaponSocket: THREE.Object3D | null = null;
  private cs2HandRSocket: THREE.Object3D | null = null;
  private cs2HandLSocket: THREE.Object3D | null = null;
  private cs2ClipBone: THREE.Object3D | null = null;
  private isCS2ArmsRig = false;
  private rifSocket: THREE.Object3D | null = null;
  private handRSocket: THREE.Object3D | null = null;
  private ikHandCtrlL: THREE.Object3D | null = null;
  private handL: THREE.Object3D | null = null;
  private fingerBones: Map<string, THREE.Object3D> = new Map();
  private akFingerPose: Map<string, THREE.Quaternion> = new Map();
  private leftHandGripAnchors: Map<string, THREE.Object3D> = new Map();
  private leftHandLockWeight = 1.0;
  private armsLoaded = false;
  private activeOneShotTimer = 0;
  private wasReloading = false;

  // Animation triggers & timers
  private slideKick = 0;
  private boltKick = 0;
  private isSlashing = false;
  private slashTime = 0;
  private slashDirection: 1 | -1 = 1;
  private isStabbing = false;
  private stabTime = 0;
  private isInspecting = false;
  private inspectTime = 0;

  // Draw transition (0 to 1 over 0.42s)
  private drawProgress = 1.0;

  // Reload state
  public isReloading = false;
  public reloadProgress = 0;
  public isEmptyReload = false;

  // Track weapons whose high-fidelity CS2 GLB is mounted
  private glbLoadedWeapons: Set<string> = new Set();

  // Spring physics states
  private targetPos = new THREE.Vector3(0.14, -0.13, -0.32);
  private currentPos = new THREE.Vector3(0.14, -0.13, -0.32);
  private velPos = new THREE.Vector3();

  private targetRot = new THREE.Euler(0, 0, 0);
  private currentRot = new THREE.Euler(0, 0, 0);

  private recoilZ = 0;
  private recoilPitch = 0;
  public isScoped = false;
  public currentFaction: 'Vanguard' | 'Syndicate' = 'Vanguard';
  private viewportAspect =
    typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9;

  constructor() {
    this.mesh = new THREE.Group();
    this.weaponContainer = new THREE.Group();
    this.mesh.add(this.weaponContainer);

    // 1. Procedural Fallback Arms (shown only while GLBs load)
    this.rightArm = this.buildTacticalGlove(false);
    this.mesh.add(this.rightArm);

    this.leftArm = this.buildTacticalGlove(true);
    this.mesh.add(this.leftArm);

    // 2. Unified CS2 Rigged First-Person Gloved Arms Container (/models/cs2_fps_arms.glb)
    // Rotation.y = Math.PI maps CS2 +Z forward to camera -Z forward
    this.armsContainer = new THREE.Group();
    this.armsContainer.scale.setScalar(1.0);
    this.armsContainer.rotation.y = Math.PI;
    this.armsContainer.position.set(0.058, -0.872, -0.135);
    this.armsContainer.visible = false;
    this.mesh.add(this.armsContainer);

    // 3. Muzzle Flash Point Light, Volumetric Radial Fireball & Rising Gunsmoke Wisp
    this.muzzleFlashLight = new THREE.PointLight(0xffb844, 0, 14);
    this.muzzleFlashLight.position.set(0, 0.02, -0.54);
    this.mesh.add(this.muzzleFlashLight);

    this.muzzleFlashMesh = this.buildMuzzleFlash();
    this.muzzleFlashMesh.position.set(0, 0.02, -0.54);
    this.muzzleFlashMesh.visible = false;
    this.mesh.add(this.muzzleFlashMesh);

    const { mesh: smokeMesh, mat: smokeMat } = this.buildGunsmokeMesh();
    this.gunsmokeMesh = smokeMesh;
    this.gunsmokeMat = smokeMat;
    this.gunsmokeMesh.position.set(0, 0.02, -0.54);
    this.gunsmokeMesh.visible = false;
    this.mesh.add(this.gunsmokeMesh);

    // Pre-build procedural fallback meshes and asynchronously load unified arms + 5 weapon GLBs
    this.setFaction(this.currentFaction);
    this.buildAllWeaponMeshes();
    this.setWeapon('garam-47');
    this.mesh.position.copy(this.currentPos);
  }

  public setFaction(faction: 'Vanguard' | 'Syndicate'): void {
    this.currentFaction = faction;
    applyFactionGloveTint(this.rightArm, faction);
    applyFactionGloveTint(this.leftArm, faction);
    if (this.armsRoot) {
      applyFactionGloveTint(this.armsRoot, faction);
    }
  }

  private buildTacticalGlove(isLeft: boolean): THREE.Group {
    const glove = new THREE.Group();
    const fabricMat = new THREE.MeshStandardMaterial({
      color: 0x243447,
      roughness: 0.72,
      metalness: 0.22,
      envMapIntensity: 1.6,
    });
    fabricMat.userData.gloveRole = 'fabric';
    const knuckleMat = new THREE.MeshStandardMaterial({
      color: 0x16181b,
      roughness: 0.25,
      metalness: 0.88,
      envMapIntensity: 2.0,
    });
    knuckleMat.userData.gloveRole = 'knuckle';
    const cuffMat = new THREE.MeshStandardMaterial({
      color: 0x33475e,
      roughness: 0.6,
      metalness: 0.35,
      envMapIntensity: 1.5,
    });
    cuffMat.userData.gloveRole = 'cuff';

    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.054, 0.36, 12), fabricMat);
    sleeve.position.set(0, -0.04, 0.16);
    sleeve.rotation.x = Math.PI / 2.3;
    glove.add(sleeve);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 12), cuffMat);
    cuff.position.set(0, -0.02, 0.04);
    cuff.rotation.x = Math.PI / 2.3;
    glove.add(cuff);

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.038, 0.075), fabricMat);
    palm.position.set(0, 0, -0.015);
    glove.add(palm);

    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.014, 0.032), knuckleMat);
    knuckles.position.set(0, 0.02, -0.015);
    glove.add(knuckles);

    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.015 * (isLeft ? -1 : 1);
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.016, 0.042), fabricMat);
      finger.position.set(fx, -0.01, -0.055);
      finger.rotation.x = 0.55;
      glove.add(finger);
    }

    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.04), fabricMat);
    const thumbX = isLeft ? 0.032 : -0.032;
    thumb.position.set(thumbX, 0.01, -0.035);
    thumb.rotation.y = isLeft ? 0.6 : -0.6;
    thumb.rotation.x = 0.3;
    glove.add(thumb);

    return glove;
  }

  private buildMuzzleFlashTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const cx = 128;
    const cy = 128;

    ctx.clearRect(0, 0, 256, 256);

    const outer = ctx.createRadialGradient(cx, cy, 4, cx, cy, 122);
    outer.addColorStop(0.0, 'rgba(255, 255, 240, 1.0)');
    outer.addColorStop(0.22, 'rgba(255, 224, 128, 0.92)');
    outer.addColorStop(0.52, 'rgba(255, 138, 32, 0.55)');
    outer.addColorStop(0.82, 'rgba(220, 62, 10, 0.16)');
    outer.addColorStop(1.0, 'rgba(180, 30, 0, 0.0)');
    ctx.fillStyle = outer;
    ctx.fillRect(0, 0, 256, 256);

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 3 + (i % 2) * 0.18);
      const len = i % 2 === 0 ? 118 : 92;
      const w = i % 2 === 0 ? 22 : 16;
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0.0, 'rgba(255, 255, 245, 0.98)');
      g.addColorStop(0.35, 'rgba(255, 212, 98, 0.85)');
      g.addColorStop(0.75, 'rgba(255, 118, 22, 0.35)');
      g.addColorStop(1.0, 'rgba(255, 80, 0, 0.0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -w * 0.5);
      ctx.quadraticCurveTo(len * 0.55, -w * 0.32, len, 0);
      ctx.quadraticCurveTo(len * 0.55, w * 0.32, 0, w * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 34);
    core.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    core.addColorStop(0.65, 'rgba(255, 248, 210, 0.85)');
    core.addColorStop(1.0, 'rgba(255, 200, 100, 0.0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildMuzzleFlash(): THREE.Group {
    const flashGroup = new THREE.Group();
    const tex = this.buildMuzzleFlashTexture();
    const flashMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.muzzleFlashMat = flashMat;

    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), flashMat);
    const axialH = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.16), flashMat);
    axialH.rotation.y = Math.PI / 2;
    axialH.position.z = -0.10;
    const axialV = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.16), flashMat);
    axialV.rotation.y = Math.PI / 2;
    axialV.rotation.x = Math.PI / 2;
    axialV.position.z = -0.10;

    flashGroup.add(front, axialH, axialV);
    return flashGroup;
  }

  private buildGunsmokeMesh(): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    g.addColorStop(0.0, 'rgba(225, 228, 232, 0.55)');
    g.addColorStop(0.45, 'rgba(195, 200, 208, 0.28)');
    g.addColorStop(1.0, 'rgba(170, 175, 182, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), mat);
    return { mesh, mat };
  }

  private buildAllWeaponMeshes(): void {
    const garam47Group = this.createGaram47Mesh();
    const vanguardM4Group = this.createVanguardM4Mesh();
    const awpGroup = this.createSovereignAWPMesh();
    const deagleGroup = this.createDesertEagleMesh();
    const karambitGroup = this.createKarambitMesh();

    this.weaponMeshes.set('garam-47', garam47Group);
    this.weaponMeshes.set('vanguard-m4', vanguardM4Group);
    this.weaponMeshes.set('sovereign-awp', awpGroup);
    this.weaponMeshes.set('desert-eagle', deagleGroup);
    this.weaponMeshes.set('garam-karambit', karambitGroup);

    this.weaponContainer.add(garam47Group);
    this.weaponContainer.add(vanguardM4Group);
    this.weaponContainer.add(awpGroup);
    this.weaponContainer.add(deagleGroup);
    this.weaponContainer.add(karambitGroup);

    void this.loadExternalModels();
  }

  private sealArmSleeveCutoffs(sm: THREE.SkinnedMesh): void {
  const geom = sm.geometry;
  const pos = geom.attributes.position;
  const normal = geom.attributes.normal;
  const uv = geom.attributes.uv;
  const si = geom.attributes.skinIndex;
  const sw = geom.attributes.skinWeight;
  const index = geom.index;
  if (!index || !pos || !si || !sw) return;

  const edgeCounts = new Map<string, number>();
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    for (const [e1, e2] of [[Math.min(a, b), Math.max(a, b)], [Math.min(b, c), Math.max(b, c)], [Math.min(c, a), Math.max(c, a)]]) {
      const key = `${e1}_${e2}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }

  const nextEdge = new Map<number, number>();
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    for (const [v0, v1] of [[a, b], [b, c], [c, a]]) {
      if (edgeCounts.get(`${Math.min(v0, v1)}_${Math.max(v0, v1)}`) === 1) {
        nextEdge.set(v0, v1);
      }
    }
  }

  const visited = new Set<number>();
  const cutoffLoops: number[][] = [];
  for (const v0 of nextEdge.keys()) {
    if (visited.has(v0)) continue;
    const loop: number[] = [];
    let curr: number | undefined = v0;
    while (curr !== undefined && !visited.has(curr) && nextEdge.has(curr)) {
      visited.add(curr);
      loop.push(curr);
      curr = nextEdge.get(curr);
      if (curr === v0) break;
    }
    if (loop.length >= 8) {
      let avgZ = 0;
      for (const idx of loop) avgZ += pos.getZ(idx);
      avgZ /= loop.length;
      if (avgZ < 0.25) cutoffLoops.push(loop);
    }
  }

  if (cutoffLoops.length === 0) return;

  const newPositions = Array.from(pos.array);
  const newNormals = normal ? Array.from(normal.array) : [];
  const newUvs = uv ? Array.from(uv.array) : [];
  const newSkinIndices = Array.from(si.array);
  const newSkinWeights = Array.from(sw.array);
  const newIndices = Array.from(index.array);

  let vertCount = pos.count;
  for (const loop of cutoffLoops) {
    let cx = 0, cy = 0, cz = 0;
    let sIdx0 = 0, sIdx1 = 0, sIdx2 = 0, sIdx3 = 0;
    let sWt0 = 0, sWt1 = 0, sWt2 = 0, sWt3 = 0;

    for (const vi of loop) {
      cx += pos.getX(vi); cy += pos.getY(vi); cz += pos.getZ(vi);
      sIdx0 = si.getX(vi); sIdx1 = si.getY(vi); sIdx2 = si.getZ(vi); sIdx3 = si.getW(vi);
      sWt0 += sw.getX(vi); sWt1 += sw.getY(vi); sWt2 += sw.getZ(vi); sWt3 += sw.getW(vi);
    }
    const invN = 1 / loop.length;
    cx *= invN; cy *= invN; cz *= invN;
    sWt0 *= invN; sWt1 *= invN; sWt2 *= invN; sWt3 *= invN;

    const centerIdx = vertCount++;
    newPositions.push(cx, cy, cz);
    if (normal) newNormals.push(0, 0, -1);
    if (uv) newUvs.push(0.5, 0.5);
    newSkinIndices.push(sIdx0, sIdx1, sIdx2, sIdx3);
    newSkinWeights.push(sWt0, sWt1, sWt2, sWt3);

    for (let i = 0; i < loop.length; i++) {
      const v0 = loop[i];
      const v1 = loop[(i + 1) % loop.length];
      newIndices.push(centerIdx, v0, v1);
    }
  }

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  if (normal) newGeom.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
  if (uv) newGeom.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
  newGeom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(newSkinIndices, 4));
  newGeom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(newSkinWeights, 4));
  newGeom.setIndex(newIndices);

  sm.geometry.dispose();
  sm.geometry = newGeom;
}

  private async loadExternalModels(): Promise<void> {
    const assetManager = AssetManager.getInstance();

    // 1. Load Unified CS2 First-Person Gloved Arms Rig (/models/cs2_fps_arms.glb)
    try {
      const armsRes = await assetManager.loadModelWithAnimations(CS2_ARMS_MODEL_PATH, {
        envMapIntensity: 1.45,
        castShadow: false,
        receiveShadow: false,
      });

      if (armsRes && armsRes.animations.length > 0) {
        const armsModel = armsRes.model;
        this.armsRoot = armsModel;
        this.bindPoseSnapshot = captureBindPose(armsModel);
        initCS2FingerRestRig(armsModel, this.bindPoseSnapshot);

        // Detect CS2 Rigify sockets (weapon_hand_r_5, DEF-handR_357, DEF-handL_233, clip bone)
        this.cs2WeaponSocket = armsModel.getObjectByName('weapon_hand_r_5') || null;
        this.cs2HandRSocket = armsModel.getObjectByName('DEF-handR_357') || null;
        this.cs2HandLSocket = armsModel.getObjectByName('DEF-handL_233') || null;
        this.cs2ClipBone = armsModel.getObjectByName('v_weapon_m4a1_clip_1') || null;
        this.isCS2ArmsRig = this.cs2WeaponSocket !== null;

        // Legacy rig socket fallback
        this.rifSocket = armsModel.getObjectByName('Rif') || null;
        this.handRSocket = armsModel.getObjectByName('Hand_R') || null;
        this.ikHandCtrlL = armsModel.getObjectByName('IK_Hand_Cntrl_L') || null;
        this.handL = armsModel.getObjectByName('Hand_L') || null;

        if (!this.isCS2ArmsRig) {
          armsModel.traverse((node) => {
            if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
              this.sealArmSleeveCutoffs(node as THREE.SkinnedMesh);
            }
          });
        }

        this.fingerBones.clear();
        armsModel.traverse((node) => {
          if (node.name && (node.name.startsWith('Bone_L.') || node.name.startsWith('Bone_L0'))) {
            this.fingerBones.set(node.name, node);
          }
        });

        this.akFingerPose.clear();
        const akIdle = armsRes.animations.find((a) => a.name === 'AK_Idle');
        if (akIdle) {
          for (const track of akIdle.tracks) {
            if (track.name.endsWith('.quaternion') && track.values.length >= 4) {
              const dot = track.name.lastIndexOf('.');
              const boneName = track.name.slice(0, dot);
              if (boneName.startsWith('Bone_L.') || boneName.startsWith('Bone_L0')) {
                this.akFingerPose.set(
                  boneName,
                  new THREE.Quaternion(
                    track.values[0],
                    track.values[1],
                    track.values[2],
                    track.values[3]
                  )
                );
              }
            }
          }
        }

        const mixer = new THREE.AnimationMixer(armsModel);
        this.armsMixer = mixer;
        this.armIKSolver = new ArmIKSolver(armsModel);
        this.armsActions.clear();

        const allClips = this.isCS2ArmsRig
          ? [...buildCS2AnimationClips(armsRes.animations), ...armsRes.animations]
          : [...armsRes.animations, ...buildKarambitAnimationClips(armsRes.animations)];
        if (!this.isCS2ArmsRig) {
          patchM4IdleClip(allClips);
        }

        for (const clip of allClips) {
          const action = mixer.clipAction(clip);
          const isLoop = clip.name.endsWith('_Idle') || clip.name.endsWith('_Walk');
          if (isLoop) {
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.clampWhenFinished = false;
          } else {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          }
          this.armsActions.set(clip.name, action);
        }

        // Enhance CS2 tactical glove & bare tattooed arm PBR sheen (zero colliding sleeve cylinders)
        armsModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) {
              if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const std = m as THREE.MeshStandardMaterial;
                // FrontSide prevents hollow interior backface artifacts on bare CS2 arms
                std.side = this.isCS2ArmsRig ? THREE.FrontSide : THREE.DoubleSide;
                std.roughness = Math.max(0.58, std.roughness);
                std.metalness = Math.min(0.24, std.metalness);
                std.envMapIntensity = 1.35;
                std.needsUpdate = true;
              }
            }
          }
        });

        applyFactionGloveTint(armsModel, this.currentFaction);
        this.armsContainer.add(armsModel);
        this.armsLoaded = true;
      }
    } catch {
      console.warn('[WeaponViewmodel] Failed to load cs2_fps_arms.glb; using procedural glove fallback.');
    }

    // 2. Fetch optional asset manifest once so optional weapons never trigger 404 console errors
    let assetManifest: Record<string, boolean> = {};
    try {
      const mRes = await fetch('/models/asset-manifest.json');
      if (mRes.ok) {
        assetManifest = (await mRes.json()) as Record<string, boolean>;
      }
    } catch {
      // Proceed with bundled GLBs + procedural CS2 fallback
    }

    const OPTIONAL_MANIFEST_KEYS: Record<string, string> = {
      m4a4: 'm4a4',
      mp9: 'mp9',
      'usp-s': 'usps',
      'glock-18': 'glock18',
    };

    // 3. Load All 9 CS2 Weapons in parallel and bind them to calibrated skeletal socket bones
    const weaponIds = Object.keys(WEAPON_SOCKET_CONFIGS);
    await Promise.all(
      weaponIds.map(async (weaponId) => {
        const cfg = WEAPON_SOCKET_CONFIGS[weaponId];
        try {
          const manifestKey = OPTIONAL_MANIFEST_KEYS[weaponId];
          let loadedModel: THREE.Object3D | null = null;

          if (!manifestKey || assetManifest[manifestKey] === true) {
            loadedModel = await assetManager.loadModel(cfg.modelPath, {
              targetLength: cfg.targetLength,
              anchorBoneName: cfg.anchorBoneName,
              centerPivot: !cfg.anchorBoneName,
              rotationEuler: cfg.rotationEuler,
              envMapIntensity: 1.85,
              castShadow: false,
              receiveShadow: false,
            });
          }

          if (!loadedModel && manifestKey) {
            const wrapper = new THREE.Group();
            wrapper.name = `procedural_cs2_${weaponId}`;
            const inner = buildProceduralCS2Weapon(weaponId);
            // ProceduralWeaponBuilder already anchors the pistol grip strictly at (0,0,0) in 1:1 meters
            // with barrel pointing +Z; rotating Y=PI flips barrel strictly to -Z while keeping the
            // pistol grip seated dead-center inside the closed right palm (never centerPivot!).
            inner.rotation.set(0, Math.PI, 0);
            wrapper.add(inner);
            wrapper.updateMatrixWorld(true);
            wrapper.userData.normalizationScale = 1.0;
            wrapper.userData.barrelAxisLocal = new THREE.Vector3(0, 0, -1);
            if (inner.userData.muzzleTipLocal instanceof THREE.Vector3) {
              const m = inner.userData.muzzleTipLocal.clone();
              wrapper.userData.muzzleTipLocal = new THREE.Vector3(-m.x, m.y, -m.z);
            }
            loadedModel = wrapper;
          }

          if (!loadedModel) return;

          const barrelAxis =
            loadedModel.userData.barrelAxisLocal instanceof THREE.Vector3
              ? loadedModel.userData.barrelAxisLocal.clone().normalize()
              : new THREE.Vector3(0, 0, -1);
          const rearAxisWrapper = barrelAxis.clone().negate();

          // Hook animated weapon sub-nodes (slide, bolt, clip/mag) with exact scale & axis compensation
          loadedModel.traverse((node) => {
            const nameLower = node.name.toLowerCase();
            if (nameLower.includes('slide')) {
              node.userData.basePos = node.position.clone();
              node.userData.recoilStepPerMeter = computeRecoilStepPerMeter(
                loadedModel,
                node,
                rearAxisWrapper
              );
              this.slideMeshes.set(weaponId, node);
            } else if (
              nameLower.includes('bolt_action') ||
              (nameLower.includes('bolt') && !nameLower.includes('rail'))
            ) {
              node.userData.basePos = node.position.clone();
              node.userData.recoilStepPerMeter = computeRecoilStepPerMeter(
                loadedModel,
                node,
                rearAxisWrapper
              );
              this.boltMeshes.set(weaponId, node);
            } else if (nameLower.includes('clip') || nameLower.includes('mag')) {
              node.userData.basePos = node.position.clone();
              node.userData.baseY = node.position.y;
              this.magMeshes.set(weaponId, node);
            }
          });

          // Attach muzzle tip helper directly from normalized barrel bounding extreme
          const muzzleHelper = new THREE.Object3D();
          const detectedMuzzle = loadedModel.userData.muzzleTipLocal;
          if (detectedMuzzle instanceof THREE.Vector3) {
            muzzleHelper.position.copy(detectedMuzzle);
          } else {
            muzzleHelper.position.set(
              cfg.muzzleLocalPos[0],
              cfg.muzzleLocalPos[1],
              cfg.muzzleLocalPos[2]
            );
          }
          loadedModel.add(muzzleHelper);
          this.muzzleHelpers.set(weaponId, muzzleHelper);

          const socketHolder = new THREE.Group();
          socketHolder.name = `${weaponId}-socket-holder`;
          socketHolder.userData.isWeaponAttachment = true;
          socketHolder.position.set(cfg.localPos[0], cfg.localPos[1], cfg.localPos[2]);
          socketHolder.rotation.set(cfg.localRotEuler[0], cfg.localRotEuler[1], cfg.localRotEuler[2]);
          socketHolder.scale.setScalar(cfg.localScale);

          if (cfg.leftHandAnchorLocal) {
            const gripAnchor = new THREE.Object3D();
            gripAnchor.name = 'left_hand_grip_anchor';
            gripAnchor.position.set(
              cfg.leftHandAnchorLocal[0],
              cfg.leftHandAnchorLocal[1],
              cfg.leftHandAnchorLocal[2]
            );
            loadedModel.add(gripAnchor);
            this.leftHandGripAnchors.set(weaponId, gripAnchor);
          }

          if (weaponId === 'garam-karambit') {
            // Apply rich crimson-anodized metallic sheen and PMREM reflections to Karambit blade
            loadedModel.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const m of mats) {
                  if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                    const std = m as THREE.MeshStandardMaterial;
                    std.color.setHex(0xd61e32);
                    std.metalness = 0.68;
                    std.roughness = 0.24;
                    std.envMapIntensity = 2.2;
                    std.emissive.setHex(0x28040a);
                  }
                }
              }
            });
            // Dedicated spin group around actual retention ring pivot for draw/inspect ring-twirl
            const pivot = cfg.ringPivotLocal ?? [0, 0.0251, 0.0835];
            const ringSpinGroup = new THREE.Group();
            ringSpinGroup.position.set(pivot[0], pivot[1], pivot[2]);
            loadedModel.position.set(-pivot[0], -pivot[1], -pivot[2]);
            ringSpinGroup.add(loadedModel);
            socketHolder.add(ringSpinGroup);
            this.karambitRingSpinGroup = ringSpinGroup;
          } else {
            socketHolder.add(loadedModel);
          }

          const targetSocket =
            cfg.socketBone === 'weapon_hand_r_5'
              ? this.cs2WeaponSocket || this.rifSocket
              : cfg.socketBone === 'DEF-handR_357'
                ? this.cs2HandRSocket || this.handRSocket
                : cfg.socketBone === 'Hand_R'
                  ? this.handRSocket || this.cs2HandRSocket
                  : this.rifSocket || this.cs2WeaponSocket;

          if (this.armsLoaded && targetSocket) {
            socketHolder.visible = weaponId === this.currentWeaponId;
            targetSocket.add(socketHolder);
            this.glbWeaponRoots.set(weaponId, socketHolder);
          } else {
            const proceduralGroup = this.weaponMeshes.get(weaponId);
            if (proceduralGroup) {
              proceduralGroup.children.forEach((c) => {
                c.visible = false;
              });
              proceduralGroup.add(loadedModel);
            }
          }

          this.glbLoadedWeapons.add(weaponId);
          if (weaponId === this.currentWeaponId) {
            this.syncArmVisibility();
            this.playWeaponAnimation('idle', 1.0);
          }
        } catch {
          console.warn(`[WeaponViewmodel] Failed to load GLB for ${weaponId}, retaining procedural fallback.`);
        }
      })
    );

    if (this.armsLoaded) {
      this.syncArmVisibility();
      this.playWeaponAnimation('idle', 1.0);
    }
  }

  public setViewportAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    this.viewportAspect = aspect;
    this.applyArmsContainerTransform(getWeaponSocketConfig(this.currentWeaponId));
  }

  private applyArmsContainerTransform(cfg: ReturnType<typeof getWeaponSocketConfig>): void {
    this.armsContainer.scale.setScalar(cfg.armsScale);
    const narrowOffsetX = computeNarrowAspectOffsetX(this.viewportAspect);
    this.armsContainer.position.set(
      cfg.armsOffset[0] + narrowOffsetX,
      cfg.armsOffset[1],
      cfg.armsOffset[2]
    );
  }

  private playWeaponAnimation(
    state: 'idle' | 'walk' | 'draw' | 'fire' | 'altFire' | 'reload' | 'reloadFull' | 'inspect',
    timeScale = 1.0
  ): void {
    if (!this.armsLoaded || !this.armsMixer || !this.armsRoot) return;
    const clipName = resolveWeaponClipName(this.currentWeaponId, state);
    const action = this.armsActions.get(clipName);
    if (!action) return;

    this.armsActions.forEach((act) => {
      act.stop();
    });

    // Restore clean bind pose before evaluating new clip so unkeyed bones (e.g. PBody in M4/Karambit) never retain stale transforms
    restoreBindPose(this.armsRoot, this.bindPoseSnapshot);

    action.reset();
    action.stopFading();
    action.enabled = true;
    action.setEffectiveWeight(1.0);
    action.setEffectiveTimeScale(timeScale);
    action.play();
    this.armsMixer.update(0.001);
    if (this.isCS2ArmsRig) {
      const cfg = getWeaponSocketConfig(this.currentWeaponId);
      applyCS2PhysicalFingerGrip(this.armsRoot, cfg.leftArmPoseMode, this.bindPoseSnapshot);
    } else {
      this.armIKSolver?.solve(this.currentWeaponId === 'garam-karambit');
    }

    const isLoopClip = clipName.endsWith('_Idle') || clipName.endsWith('_Walk');
    const isOneShot =
      !isLoopClip &&
      (state === 'draw' ||
        state === 'fire' ||
        state === 'altFire' ||
        state === 'reload' ||
        state === 'reloadFull' ||
        state === 'inspect');

    if (isOneShot) {
      this.activeOneShotTimer = action.getClip().duration / Math.max(0.1, timeScale);
    } else {
      this.activeOneShotTimer = 0;
    }
  }

  private syncArmVisibility(): void {
    const hasGlb = this.glbLoadedWeapons.has(this.currentWeaponId);
    const usesUnifiedArms = this.armsLoaded && hasGlb;

    if (usesUnifiedArms) {
      const cfg = getWeaponSocketConfig(this.currentWeaponId);
      this.applyArmsContainerTransform(cfg);
      this.armsContainer.visible = true;
      this.rightArm.visible = false;
      this.leftArm.visible = false;

      this.weaponMeshes.forEach((mesh) => {
        mesh.visible = false;
      });
      this.glbWeaponRoots.forEach((holder, id) => {
        holder.visible = id === this.currentWeaponId;
      });
    } else {
      this.armsContainer.visible = false;
      this.rightArm.visible = !hasGlb;
      this.leftArm.visible = !hasGlb;
      this.weaponMeshes.forEach((mesh, id) => {
        mesh.visible = id === this.currentWeaponId;
      });
    }
  }

  public setWeapon(weaponId: string): void {
    this.currentWeaponId = weaponId;

    this.slideKick = 0;
    this.boltKick = 0;
    this.isSlashing = false;
    this.isStabbing = false;
    this.isInspecting = false;
    this.wasReloading = false;
    this.activeOneShotTimer = 0;
    this.drawProgress = 0.0;

    // Calibrate fallback muzzle flash & procedural arm framing per weapon
    if (weaponId === 'desert-eagle') {
      this.muzzleFlashLight.position.set(0.08, -0.11, -0.53);
      this.muzzleFlashMesh.position.set(0.08, -0.11, -0.53);
      this.gunsmokeMesh.position.set(0.08, -0.11, -0.53);
      this.rightArm.position.set(0.04, -0.09, -0.05);
      this.rightArm.rotation.set(0.24, -0.06, 0.10);
      this.leftArm.position.set(-0.02, -0.10, -0.06);
      this.leftArm.rotation.set(0.26, 0.42, -0.16);
    } else if (weaponId === 'garam-karambit') {
      this.rightArm.position.set(0.06, -0.07, -0.06);
      this.rightArm.rotation.set(0.32, -0.22, 0.26);
      this.leftArm.position.set(-0.16, -0.13, -0.16);
      this.leftArm.rotation.set(-0.16, 0.46, -0.26);
    } else if (weaponId === 'sovereign-awp') {
      this.muzzleFlashLight.position.set(-0.06, -0.13, -0.82);
      this.muzzleFlashMesh.position.set(-0.06, -0.13, -0.82);
      this.gunsmokeMesh.position.set(-0.06, -0.13, -0.82);
      this.rightArm.position.set(0.04, -0.09, 0.06);
      this.rightArm.rotation.set(0.18, -0.08, 0.08);
      this.leftArm.position.set(-0.05, -0.08, -0.22);
      this.leftArm.rotation.set(-0.10, 0.44, -0.12);
    } else if (weaponId === 'vanguard-m4') {
      this.muzzleFlashLight.position.set(0.06, -0.10, -0.77);
      this.muzzleFlashMesh.position.set(0.06, -0.10, -0.77);
      this.gunsmokeMesh.position.set(0.06, -0.10, -0.77);
      this.rightArm.position.set(0.04, -0.09, 0.05);
      this.rightArm.rotation.set(0.18, -0.08, 0.08);
      this.leftArm.position.set(-0.04, -0.08, -0.18);
      this.leftArm.rotation.set(-0.10, 0.42, -0.10);
    } else {
      this.muzzleFlashLight.position.set(0.02, -0.13, -0.54);
      this.muzzleFlashMesh.position.set(0.02, -0.13, -0.54);
      this.gunsmokeMesh.position.set(0.02, -0.13, -0.54);
      this.rightArm.position.set(0.04, -0.09, 0.05);
      this.rightArm.rotation.set(0.18, -0.08, 0.08);
      this.leftArm.position.set(-0.04, -0.08, -0.18);
      this.leftArm.rotation.set(-0.10, 0.42, -0.10);
    }

    const cfg = getWeaponSocketConfig(weaponId);
    this.applyArmsContainerTransform(cfg);
    this.syncArmVisibility();
    const drawScale = this.isCS2ArmsRig ? 1.35 : 1.8;
    this.playWeaponAnimation(cfg.clips.draw ? 'draw' : 'idle', drawScale);
  }

  private syncMuzzleTipPosition(): void {
    const helper = this.muzzleHelpers.get(this.currentWeaponId);
    if (!helper || !this.armsLoaded) return;
    this.armsContainer.updateMatrixWorld(true);
    helper.getWorldPosition(_muzzleWorld);
    _muzzleLocal.copy(_muzzleWorld);
    this.mesh.worldToLocal(_muzzleLocal);
    this.muzzleFlashLight.position.copy(_muzzleLocal);
    this.muzzleFlashMesh.position.copy(_muzzleLocal);
  }

  // 1. ELDAR'S CUSTOM DESERT EAGLE (.50 AE) - PROCEDURAL FALLBACK
  private createDesertEagleMesh(): THREE.Group {
    const group = new THREE.Group();
    const frameGeo = new THREE.BoxGeometry(0.038, 0.13, 0.12);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.35, metalness: 0.85 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, -0.05, 0.01);
    frame.rotation.x = -0.22;
    group.add(frame);

    const slideGeo = new THREE.BoxGeometry(0.042, 0.055, 0.22);
    const slideMat = new THREE.MeshStandardMaterial({ color: 0x363b42, roughness: 0.25, metalness: 0.9 });
    const slide = new THREE.Mesh(slideGeo, slideMat);
    slide.position.set(0, 0.015, -0.04);
    group.add(slide);
    this.slideMeshes.set('desert-eagle', slide);

    const deagleMag = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.12, 0.05), frameMat);
    deagleMag.position.set(0, -0.06, 0.01);
    deagleMag.rotation.x = -0.22;
    deagleMag.userData.baseY = -0.06;
    group.add(deagleMag);
    this.magMeshes.set('desert-eagle', deagleMag);

    group.position.set(0.03, 0.01, -0.14);
    group.visible = false;
    return group;
  }

  // 2. GARAM-47 - PROCEDURAL FALLBACK
  private createGaram47Mesh(): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.35, metalness: 0.88 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.085, 0.42), bodyMat);
    group.add(body);

    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.18, 0.065),
      new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.5, metalness: 0.75 })
    );
    mag.position.set(0, -0.11, -0.06);
    mag.userData.baseY = -0.11;
    group.add(mag);
    this.magMeshes.set('garam-47', mag);

    const barrelGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.30, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, bodyMat);
    barrel.position.set(0, 0.015, -0.44);
    group.add(barrel);

    group.position.set(0.03, -0.04, -0.08);
    group.visible = false;
    return group;
  }

  // 3. VANGUARD M4A1-S - PROCEDURAL FALLBACK
  private createVanguardM4Mesh(): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f2429, roughness: 0.35, metalness: 0.85 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.09, 0.36), bodyMat);
    group.add(receiver);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.17, 0.075), bodyMat);
    mag.position.set(0, -0.11, -0.06);
    mag.rotation.x = -0.14;
    mag.userData.baseY = -0.11;
    group.add(mag);
    this.magMeshes.set('vanguard-m4', mag);

    const supGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.28, 16);
    supGeo.rotateX(Math.PI / 2);
    const sup = new THREE.Mesh(
      supGeo,
      new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.3, metalness: 0.9 })
    );
    sup.position.set(0, 0.01, -0.48);
    group.add(sup);

    group.position.set(0.03, -0.04, -0.08);
    group.visible = false;
    return group;
  }

  // 4. SOVEREIGN AWP - PROCEDURAL FALLBACK
  private createSovereignAWPMesh(): THREE.Group {
    const group = new THREE.Group();
    const stockMat = new THREE.MeshStandardMaterial({ color: 0x1a211e, roughness: 0.75, metalness: 0.2 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x121416, metalness: 0.92, roughness: 0.25 });

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.095, 0.58), stockMat);
    group.add(stock);

    const awpMag = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.14, 0.09), metalMat);
    awpMag.position.set(0, -0.07, -0.08);
    awpMag.userData.baseY = -0.07;
    group.add(awpMag);
    this.magMeshes.set('sovereign-awp', awpMag);

    const barrelGeo = new THREE.CylinderGeometry(0.016, 0.018, 0.48, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, metalMat);
    barrel.position.set(0, 0.02, -0.52);
    group.add(barrel);

    const boltGroup = new THREE.Group();
    boltGroup.position.set(0.025, 0.04, 0.08);
    group.add(boltGroup);
    this.boltMeshes.set('sovereign-awp', boltGroup);

    group.position.set(0.04, -0.04, -0.06);
    group.visible = false;
    return group;
  }

  // 5. GARAM CRIMSON TACTICAL KARAMBIT - PROCEDURAL FALLBACK
  private createKarambitMesh(): THREE.Group {
    const root = new THREE.Group();
    const spinPivot = new THREE.Group();
    this.karambitSpinPivot = spinPivot;
    root.add(spinPivot);

    const ringGeo = new THREE.TorusGeometry(0.022, 0.006, 16, 32);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.95,
      roughness: 0.15,
      envMapIntensity: 2.2,
    });
    spinPivot.add(new THREE.Mesh(ringGeo, ringMat));

    const trailGeo = new THREE.RingGeometry(0.18, 0.28, 16, 1, 0, Math.PI / 2);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xff3355,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    this.bladeTrailMesh = new THREE.Mesh(trailGeo, trailMat);
    this.bladeTrailMesh.rotation.x = Math.PI / 2;
    this.bladeTrailMesh.position.set(0.05, 0.18, 0);
    spinPivot.add(this.bladeTrailMesh);

    root.position.set(0.05, -0.08, -0.16);
    root.rotation.set(-0.25, 0.15, -0.30);
    root.visible = false;
    return root;
  }

  public fireRecoil(pitchKick = 0.07, zKick = 0.05): void {
    if (this.currentWeaponId === 'garam-karambit') {
      this.triggerSlash();
      return;
    }

    this.recoilPitch += pitchKick;
    this.recoilZ += zKick;

    if (this.currentWeaponId === 'desert-eagle') {
      this.slideKick = 0.035; // 3.5 cm true metric slide blowback
    } else if (this.currentWeaponId === 'usp-s' || this.currentWeaponId === 'glock-18') {
      this.slideKick = 0.026; // 2.6 cm pistol slide blowback
    } else if (this.currentWeaponId === 'sovereign-awp') {
      this.boltKick = 0.065; // 6.5 cm true metric bolt throw
    } else if (
      this.currentWeaponId === 'garam-47' ||
      this.currentWeaponId === 'vanguard-m4' ||
      this.currentWeaponId === 'm4a4' ||
      this.currentWeaponId === 'mp9'
    ) {
      this.boltKick = 0.055; // 5.5 cm rifle/SMG bolt carrier cycling
    }

    // Play skeletal fire animation on unified FPS arms
    const fireSpeed =
      this.currentWeaponId === 'sovereign-awp'
        ? 1.25
        : this.currentWeaponId === 'desert-eagle'
          ? 1.35
          : 1.5;
    this.playWeaponAnimation('fire', fireSpeed);
    this.syncMuzzleTipPosition();

    // Volumetric radial fireball muzzle flash (suppressed compact puff on M4A1-S & USP-S)
    const isSuppressed = this.currentWeaponId === 'vanguard-m4' || this.currentWeaponId === 'usp-s';
    const baseScale = isSuppressed
      ? 0.34
      : this.currentWeaponId === 'sovereign-awp'
        ? 1.45
        : this.currentWeaponId === 'mp9' || this.currentWeaponId === 'glock-18'
          ? 0.75
          : 1.0;
    const jitter = 0.85 + Math.random() * 0.42;

    this.flashTimer = isSuppressed ? 0.035 : 0.055;
    this.muzzleFlashLight.intensity = isSuppressed ? 2.0 : 6.8;
    this.muzzleFlashMesh.visible = true;
    this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI * 2;
    this.muzzleFlashMesh.scale.setScalar(baseScale * jitter);

    // Spawn rising barrel gunsmoke wisp
    this.smokeTimer = 0.65;
    this.gunsmokeMesh.visible = true;
    this.gunsmokeMesh.position.copy(this.muzzleFlashMesh.position);
    this.gunsmokeMesh.rotation.z = Math.random() * Math.PI * 2;
    this.gunsmokeMesh.scale.setScalar(0.55);
    this.gunsmokeMat.opacity = isSuppressed ? 0.42 : 0.32;
  }

  public triggerInspect(): void {
    if (this.isReloading) return;
    this.isInspecting = true;
    this.inspectTime = 0;
    if (this.currentWeaponId === 'garam-karambit') {
      // Keep CS2_Idle active so rifle CS2_Inspect never spreads hands away from the Karambit
      this.playWeaponAnimation('idle', 1.0);
      return;
    }
    const cfg = getWeaponSocketConfig(this.currentWeaponId);
    if (cfg.clips.inspect) {
      this.playWeaponAnimation('inspect', 1.15);
    }
  }

  public inspect(): void {
    this.triggerInspect();
  }

  public triggerSlash(): void {
    this.isSlashing = true;
    this.slashTime = 0;
    this.slashDirection = this.slashDirection === 1 ? -1 : 1;
    this.playWeaponAnimation('fire', 1.15);
  }

  public triggerStab(): void {
    this.isStabbing = true;
    this.stabTime = 0;
    this.playWeaponAnimation('altFire', 1.1);
  }

  public update(
    dt: number,
    mouseDeltaX: number,
    mouseDeltaY: number,
    walkBob: number,
    strafeRoll: number,
    playerSpeed = 0
  ): void {
    const safeDt = Math.max(0.0001, Math.min(dt, 0.05));

    // Muzzle flash decay
    if (this.flashTimer > 0) {
      this.flashTimer -= safeDt;
      this.syncMuzzleTipPosition();
      const ratio = Math.max(0, this.flashTimer / 0.055);
      this.muzzleFlashLight.intensity =
        (this.currentWeaponId === 'vanguard-m4' ? 2.0 : 6.8) * ratio;
      if (this.muzzleFlashMat) {
        this.muzzleFlashMat.opacity = Math.min(0.96, ratio * 1.4);
      }
      this.muzzleFlashMesh.visible = this.flashTimer > 0;
    } else {
      this.muzzleFlashLight.intensity = 0.0;
      this.muzzleFlashMesh.visible = false;
    }

    // Rising gunsmoke wisp drift & fade
    if (this.smokeTimer > 0) {
      this.smokeTimer -= safeDt;
      const life = Math.max(0, this.smokeTimer / 0.65);
      this.gunsmokeMesh.position.y += safeDt * 0.22;
      this.gunsmokeMesh.position.x += safeDt * 0.035;
      this.gunsmokeMesh.scale.addScalar(safeDt * 1.15);
      this.gunsmokeMesh.rotation.z += safeDt * 0.65;
      this.gunsmokeMat.opacity = life * 0.34;
      this.gunsmokeMesh.visible = this.smokeTimer > 0;
    } else {
      this.gunsmokeMesh.visible = false;
    }

    const usesUnifiedArms =
      this.armsLoaded &&
      this.armsMixer !== null &&
      this.glbLoadedWeapons.has(this.currentWeaponId);

    if (usesUnifiedArms && this.armsMixer) {
      if (this.isReloading && !this.wasReloading) {
        this.isInspecting = false;
        const reloadState = this.isEmptyReload ? 'reloadFull' : 'reload';
        const clipName = resolveWeaponClipName(this.currentWeaponId, reloadState);
        const act = this.armsActions.get(clipName);
        // Scale reload clip duration to align with weapon reload timer
        const clipDur = act ? act.getClip().duration : 2.2;
        const timeScale = Math.max(0.85, Math.min(2.2, clipDur / 2.25));
        this.playWeaponAnimation(reloadState, timeScale);
      } else if (!this.isReloading && this.wasReloading) {
        this.playWeaponAnimation('idle', 1.0);
      }
      this.wasReloading = this.isReloading;

      if (this.activeOneShotTimer > 0) {
        this.activeOneShotTimer -= safeDt;
        if (this.activeOneShotTimer <= 0 && !this.isReloading) {
          const isWalking = playerSpeed > 0.5 || Math.abs(walkBob) > 0.0012;
          this.playWeaponAnimation(isWalking ? 'walk' : 'idle', 1.0);
        }
      } else if (!this.isReloading && !this.isInspecting && this.drawProgress >= 1.0) {
        const isWalking = playerSpeed > 0.5 || Math.abs(walkBob) > 0.0012;
        const desiredClip = resolveWeaponClipName(this.currentWeaponId, isWalking ? 'walk' : 'idle');
        const act = this.armsActions.get(desiredClip);
        if (act && !act.isRunning()) {
          this.playWeaponAnimation(isWalking ? 'walk' : 'idle', 1.0);
        }
      }

      // Smoothly blend leftHandLockWeight: 1.0 for idle/walk/fire, 0.0 for reload/draw/inspect
      const shouldLockLeftHand =
        !this.isReloading &&
        !this.isInspecting &&
        this.drawProgress >= 1.0;
      if (shouldLockLeftHand) {
        this.leftHandLockWeight = Math.min(1.0, this.leftHandLockWeight + safeDt * 8.0);
      } else {
        this.leftHandLockWeight = Math.max(0.0, this.leftHandLockWeight - safeDt * 8.0);
      }

      // Restore cs2WeaponSocket bind position before mixer evaluation so post-IK socket shifts never accumulate across frames
      if (this.cs2WeaponSocket) {
        const savedSocket = this.bindPoseSnapshot.get(this.cs2WeaponSocket);
        if (savedSocket) {
          this.cs2WeaponSocket.position.copy(savedSocket.position);
        }
      }
      this.armsMixer.update(safeDt);

      if (this.isCS2ArmsRig && this.armsRoot && this.armIKSolver) {
        this.armsContainer.updateMatrixWorld(true);
        const cfg = getWeaponSocketConfig(this.currentWeaponId);
        const gripAnchor = this.leftHandGripAnchors.get(this.currentWeaponId);
        let gripAnchorWorld: THREE.Vector3 | null = null;
        if (gripAnchor) {
          gripAnchor.updateMatrixWorld(true);
          gripAnchor.getWorldPosition(_vA);
          gripAnchorWorld = _vA;
        }
        const karambitInspectProgress = this.isInspecting
          ? THREE.MathUtils.clamp(this.inspectTime / (Math.PI * 2), 0, 1)
          : 0;
        applyCS2WeaponHandPosture({
          armsRoot: this.armsRoot,
          meshRoot: this.mesh,
          armIKSolver: this.armIKSolver,
          cfg,
          weaponSocket: this.cs2WeaponSocket,
          handRSocket: this.cs2HandRSocket,
          handLSocket: this.cs2HandLSocket,
          gripAnchorWorld,
          leftHandLockWeight: this.leftHandLockWeight,
          isReloading: this.isReloading,
          isInspecting: this.isInspecting,
          inspectProgress: karambitInspectProgress,
          narrowOffsetX: computeNarrowAspectOffsetX(this.viewportAspect),
          bindPoseSnapshot: this.bindPoseSnapshot,
        });
      } else {
        if (this.currentWeaponId === 'garam-karambit') {
          const armL = this.armsRoot?.getObjectByName('Arm_L');
          if (armL) {
            armL.scale.set(0.0001, 0.0001, 0.0001);
            armL.position.set(0, -10, 0);
          }
          if (this.ikHandCtrlL) {
            this.ikHandCtrlL.scale.set(0.0001, 0.0001, 0.0001);
            this.ikHandCtrlL.position.set(0, -10, 0);
          }
        } else {
          const armL = this.armsRoot?.getObjectByName('Arm_L');
          if (armL && (armL.scale.x < 0.5 || armL.position.y < -5)) {
            armL.scale.set(1, 1, 1);
            armL.position.set(0, 0.2158, 0);
          }
          if (this.ikHandCtrlL && (this.ikHandCtrlL.scale.x < 0.5 || this.ikHandCtrlL.position.y < -5)) {
            this.ikHandCtrlL.scale.set(1, 1, 1);
          }
        }

        this.armsContainer.updateMatrixWorld(true);

        // Lock left hand to weapon handguard/forend underside anchor (legacy rig)
        if (this.leftHandLockWeight > 0.001 && this.ikHandCtrlL && this.currentWeaponId !== 'garam-karambit') {
          const gripAnchor = this.leftHandGripAnchors.get(this.currentWeaponId);
          const cfg = getWeaponSocketConfig(this.currentWeaponId);
          if (gripAnchor) {
            if (
              this.akFingerPose.size > 0 &&
              (this.currentWeaponId === 'garam-47' ||
                this.currentWeaponId === 'vanguard-m4' ||
                this.currentWeaponId === 'sovereign-awp' ||
                this.currentWeaponId === 'desert-eagle')
            ) {
              this.akFingerPose.forEach((qTarget, boneName) => {
                const bone = this.fingerBones.get(boneName);
                if (bone) {
                  bone.quaternion.slerp(qTarget, this.leftHandLockWeight);
                }
              });
              this.handL?.updateMatrixWorld(true);
            }

            gripAnchor.updateMatrixWorld(true);
            gripAnchor.getWorldPosition(_vA);

            const b5 = this.fingerBones.get('Bone_L005') || this.fingerBones.get('Bone_L.005');
            const b9 = this.fingerBones.get('Bone_L009') || this.fingerBones.get('Bone_L.009');
            const b13 = this.fingerBones.get('Bone_L013') || this.fingerBones.get('Bone_L.013');
            if (b5 && b9 && b13 && this.handL) {
              b5.getWorldPosition(_vB);
              b9.getWorldPosition(_vC);
              b13.getWorldPosition(_vD);
              _vC.add(_vB).add(_vD).multiplyScalar(1 / 3);
              this.handL.getWorldPosition(_vD);
              _vC.sub(_vD);
              _vA.sub(_vC);
            }

            const upArm = this.armsRoot?.getObjectByName('UpArm_L');
            const upArmPos = upArm ? upArm.getWorldPosition(_vB) : null;
            const reachDist = upArmPos ? _vA.distanceTo(upArmPos) : 0.35;
            const isGripValid = reachDist >= 0.02 && reachDist <= 0.75;
            if (isGripValid) {
              if (this.ikHandCtrlL.parent) {
                this.ikHandCtrlL.parent.updateMatrixWorld(true);
                this.ikHandCtrlL.parent.worldToLocal(_vB.copy(_vA));
                this.ikHandCtrlL.position.lerp(_vB, this.leftHandLockWeight);
              } else {
                this.ikHandCtrlL.position.lerp(_vA, this.leftHandLockWeight);
              }
              this.ikHandCtrlL.updateMatrixWorld(true);
              if (this.handL && cfg.leftHandRelRotEuler) {
                _euler.set(
                  cfg.leftHandRelRotEuler[0],
                  cfg.leftHandRelRotEuler[1],
                  cfg.leftHandRelRotEuler[2],
                  'XYZ'
                );
                _qDelta.setFromEuler(_euler);
                this.handL.quaternion.slerp(_qDelta, this.leftHandLockWeight);
              }
            }
          }
        }

        this.armIKSolver?.solve(this.currentWeaponId === 'garam-karambit');
      }
    } else {
      this.wasReloading = this.isReloading;
    }

    if (this.isScoped) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Equip draw raise animation (0 to 1 over 0.42s)
    let drawY = 0;
    let drawPitch = 0;
    if (this.drawProgress < 1.0) {
      this.drawProgress = Math.min(1.0, this.drawProgress + safeDt * 2.38);
      const easeOut = 1.0 - this.drawProgress;
      drawY = usesUnifiedArms ? easeOut * -0.072 : easeOut * -0.22;
      drawPitch = usesUnifiedArms ? easeOut * -0.15 : 0;
    }

    // CS2 Karambit Ring-Spin on Draw & Inspect (around index finger retention ring)
    if (this.currentWeaponId === 'garam-karambit') {
      const inspectProgress = this.isInspecting
        ? THREE.MathUtils.clamp(this.inspectTime / (Math.PI * 2), 0, 1)
        : 0;
      const spinAngle =
        this.drawProgress < 1.0
          ? (1.0 - this.drawProgress) * Math.PI * 2
          : this.isInspecting
            ? computeKarambitInspectSpinAngle(inspectProgress)
            : 0;
      if (this.karambitRingSpinGroup) {
        this.karambitRingSpinGroup.rotation.x = spinAngle;
      }
      if (this.karambitSpinPivot) {
        this.karambitSpinPivot.rotation.z = spinAngle;
      }
    }

    // Scale- & axis-compensated slide blowback recovery (zero allocations)
    const slide = this.slideMeshes.get(this.currentWeaponId);
    if (slide) {
      this.slideKick += (0 - this.slideKick) * (1 - Math.exp(-32 * safeDt));
      const basePos = slide.userData.basePos as THREE.Vector3 | undefined;
      const step = slide.userData.recoilStepPerMeter as THREE.Vector3 | undefined;
      if (basePos && step) {
        slide.position.copy(basePos).addScaledVector(step, this.slideKick);
      } else {
        const baseZ = typeof slide.userData.baseZ === 'number' ? slide.userData.baseZ : -0.05;
        slide.position.z = baseZ + this.slideKick;
      }
    }

    // Scale- & axis-compensated bolt blowback recovery (zero allocations)
    const bolt = this.boltMeshes.get(this.currentWeaponId);
    if (bolt) {
      this.boltKick += (0 - this.boltKick) * (1 - Math.exp(-18 * safeDt));
      const basePos = bolt.userData.basePos as THREE.Vector3 | undefined;
      const step = bolt.userData.recoilStepPerMeter as THREE.Vector3 | undefined;
      if (basePos && step) {
        bolt.position.copy(basePos).addScaledVector(step, this.boltKick);
      } else {
        const baseZ = typeof bolt.userData.baseZ === 'number' ? bolt.userData.baseZ : 0.08;
        bolt.position.z = baseZ + this.boltKick;
      }
    }

    // Melee timers & fallback arc
    let meleeYaw = 0;
    let meleePitch = 0;
    let meleeZ = 0;

    if (this.isSlashing) {
      this.slashTime += safeDt * (Math.PI / 0.34);
      if (this.slashTime >= Math.PI) {
        this.isSlashing = false;
        this.slashTime = 0;
        if (this.bladeTrailMesh)
          (this.bladeTrailMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      } else if (!usesUnifiedArms || this.isCS2ArmsRig) {
        const arc = Math.sin(this.slashTime);
        meleeYaw = this.slashDirection * arc * 0.42;
        meleePitch = -arc * 0.24;
        meleeZ = -arc * 0.05;
      }
    } else if (this.isStabbing) {
      this.stabTime += safeDt * (Math.PI / 0.46);
      if (this.stabTime >= Math.PI) {
        this.isStabbing = false;
        this.stabTime = 0;
      } else if (!usesUnifiedArms || this.isCS2ArmsRig) {
        const p = this.stabTime / Math.PI;
        const lunge = Math.sin(p * Math.PI);
        meleeZ = -lunge * 0.16;
        meleePitch = -lunge * 0.24;
      }
    }

    // Authentic CS2 Inspect Animation (F Key): smooth side-to-side receiver showcase + Karambit spin flourish
    let inspectYaw = 0;
    let inspectPitch = 0;
    let inspectRoll = 0;

    if (this.isInspecting) {
      this.inspectTime += safeDt * 2.2;
      if (this.inspectTime >= Math.PI * 2) {
        this.isInspecting = false;
        this.inspectTime = 0;
      } else {
        const envelope = Math.sin((this.inspectTime / (Math.PI * 2)) * Math.PI);
        if (this.currentWeaponId === 'garam-karambit') {
          inspectYaw = Math.sin(this.inspectTime) * 0.04 * envelope;
          inspectPitch = Math.sin(this.inspectTime * 0.5) * 0.03 * envelope;
          inspectRoll = Math.sin(this.inspectTime) * 0.05 * envelope;
        } else {
          inspectYaw = Math.sin(this.inspectTime) * 0.30 * envelope;
          inspectPitch = Math.sin(this.inspectTime * 0.5) * 0.12 * envelope;
          inspectRoll = Math.sin(this.inspectTime) * 0.34 * envelope;
        }
      }
    }

    // Reload magazine choreography synced to CS2 clip bone + authentic CS2 tactical weapon cant
    let reloadY = 0;
    let reloadRoll = 0;
    let reloadPitch = 0;
    const currentMag = this.magMeshes.get(this.currentWeaponId);

    if (this.isReloading && usesUnifiedArms) {
      const reloadArc = Math.sin(THREE.MathUtils.clamp(this.reloadProgress, 0, 1) * Math.PI);
      reloadY = -0.022 * reloadArc;
      reloadRoll = 0.20 * reloadArc;
      reloadPitch = 0.075 * reloadArc;

      const magRefBone = this.cs2ClipBone || this.armsRoot?.getObjectByName('Pmag');
      if (magRefBone && currentMag && this.reloadProgress >= 0.18 && this.reloadProgress <= 0.78) {
        magRefBone.updateMatrixWorld(true);
        magRefBone.getWorldPosition(_vA);
        if (currentMag.parent) {
          currentMag.parent.worldToLocal(_vB.copy(_vA));
          currentMag.position.lerp(_vB, 0.45);
        }
      } else if (currentMag && typeof currentMag.userData.baseY === 'number') {
        currentMag.position.y = currentMag.userData.baseY;
      }
    } else if (this.isReloading && !usesUnifiedArms) {
      reloadY = -0.06 * Math.sin(this.reloadProgress * Math.PI);
      reloadRoll = 0.22 * Math.sin(this.reloadProgress * Math.PI);

      if (currentMag && typeof currentMag.userData.baseY === 'number') {
        const baseY = currentMag.userData.baseY;
        if (this.reloadProgress < 0.35) {
          const drop = this.reloadProgress / 0.35;
          currentMag.position.y = baseY - drop * 0.16;
        } else if (this.reloadProgress < 0.70) {
          const rise = (this.reloadProgress - 0.35) / 0.35;
          currentMag.position.y = baseY - (1.0 - rise) * 0.16;
        } else {
          currentMag.position.y = baseY;
        }
      }
    } else if (currentMag && typeof currentMag.userData.baseY === 'number') {
      currentMag.position.y = currentMag.userData.baseY;
    }

    // Unconditionally stable sub-stepped 3D Hooke's Law spring-damper
    const k = 150;
    const c = 18;

    const swayX = -mouseDeltaX * 0.0008;
    const swayY = mouseDeltaY * 0.0008;

    const recoilScale = usesUnifiedArms ? 0.62 : 1.0;
    this.targetRot.y = Math.max(-0.16, Math.min(0.16, swayX)) + meleeYaw + inspectYaw;
    this.targetRot.x =
      Math.max(-0.16, Math.min(0.16, swayY)) +
      this.recoilPitch * recoilScale +
      drawPitch +
      reloadPitch +
      meleePitch +
      inspectPitch;
    this.targetRot.z = strafeRoll + reloadRoll + inspectRoll;

    // Decay recoil kicks
    this.recoilPitch += (0 - this.recoilPitch) * (1 - Math.exp(-22 * safeDt));
    this.recoilZ += (0 - this.recoilZ) * (1 - Math.exp(-24 * safeDt));

    // Unified arms rig is already authored in camera space around Head_Cam (0, 0, 0)
    const basePosX = usesUnifiedArms ? 0.0 : 0.14;
    const basePosY = usesUnifiedArms ? 0.0 : -0.13;
    const basePosZ = usesUnifiedArms ? 0.0 : -0.32;

    this.targetPos.x = basePosX;
    this.targetPos.y = basePosY + walkBob + reloadY + drawY;
    this.targetPos.z = basePosZ + this.recoilZ * recoilScale + meleeZ;

    const subSteps = Math.max(1, Math.ceil(safeDt / (1 / 120)));
    const stepDt = safeDt / subSteps;
    for (let i = 0; i < subSteps; i++) {
      const fX = -k * (this.currentPos.x - this.targetPos.x) - c * this.velPos.x;
      const fY = -k * (this.currentPos.y - this.targetPos.y) - c * this.velPos.y;
      const fZ = -k * (this.currentPos.z - this.targetPos.z) - c * this.velPos.z;

      this.velPos.x += fX * stepDt;
      this.velPos.y += fY * stepDt;
      this.velPos.z += fZ * stepDt;

      this.currentPos.x += this.velPos.x * stepDt;
      this.currentPos.y += this.velPos.y * stepDt;
      this.currentPos.z += this.velPos.z * stepDt;
    }

    if (
      !Number.isFinite(this.currentPos.x) ||
      !Number.isFinite(this.currentPos.y) ||
      !Number.isFinite(this.currentPos.z)
    ) {
      this.currentPos.copy(this.targetPos);
      this.velPos.set(0, 0, 0);
    }
    this.mesh.position.copy(this.currentPos);

    this.currentRot.x += (this.targetRot.x - this.currentRot.x) * (1 - Math.exp(-18 * safeDt));
    this.currentRot.y += (this.targetRot.y - this.currentRot.y) * (1 - Math.exp(-18 * safeDt));
    this.currentRot.z += (this.targetRot.z - this.currentRot.z) * (1 - Math.exp(-18 * safeDt));
    this.mesh.rotation.copy(this.currentRot);
  }

  public dispose(): void {
    this.armsMixer?.stopAllAction();
    this.armsMixer = null;
    this.armsActions.clear();
    this.weaponMeshes.forEach((mesh) => {
      AssetManager.disposeObject3D(mesh);
    });
    this.glbWeaponRoots.forEach((holder) => {
      AssetManager.disposeObject3D(holder);
    });
    AssetManager.disposeObject3D(this.muzzleFlashMesh);
    AssetManager.disposeObject3D(this.gunsmokeMesh);
    AssetManager.disposeObject3D(this.armsContainer);
    this.weaponMeshes.clear();
    this.glbWeaponRoots.clear();
    this.muzzleHelpers.clear();
    this.slideMeshes.clear();
    this.boltMeshes.clear();
    this.magMeshes.clear();
  }
}
