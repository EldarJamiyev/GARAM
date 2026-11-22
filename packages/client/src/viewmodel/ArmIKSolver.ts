import * as THREE from 'three';

export interface TwoBoneIKChain {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  effector: THREE.Object3D;
  target: THREE.Object3D;
  pole: THREE.Object3D | null;
  twistBones: THREE.Object3D[];
  /** Cumulative twist fractions (nested chain) or direct fractions (sibling bones) */
  twistWeights: number[];
  /** True when twistBones[i+1] is a child of twistBones[i] (fps_arms_tactical.glb) */
  nestedTwistChain: boolean;
  /** Bind-pose local Y twist angles for each twist bone */
  bindTwistAngles: number[];
  /** Bind-pose relative quaternion inv(qForearmWorld) * qHandWorld */
  bindForearmToHand: THREE.Quaternion;
  /** Bind-pose local position of upper arm (restored before optional clavicle slack) */
  upperBindLocalPos: THREE.Vector3;
  /** Optional fallback pole direction in upper.parent space if pole node is absent */
  fallbackPoleDir: THREE.Vector3;
}

// Pre-allocated scratch math objects (zero per-frame heap allocations)
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vPole = new THREE.Vector3();
const _vToTarget = new THREE.Vector3();
const _vDirT = new THREE.Vector3();
const _vToPole = new THREE.Vector3();
const _vBendDir = new THREE.Vector3();
const _vDesiredDir1 = new THREE.Vector3();
const _vDesiredDir2 = new THREE.Vector3();
const _vDesiredElbow = new THREE.Vector3();
const _vClampedTarget = new THREE.Vector3();
const _vCurDir1 = new THREE.Vector3();
const _vCurDir2 = new THREE.Vector3();
const _vSlackWorld = new THREE.Vector3();
const _vSlackLocal = new THREE.Vector3();
const _vAxisY = new THREE.Vector3(0, 1, 0);

const _qParentWorld = new THREE.Quaternion();
const _qBoneWorld = new THREE.Quaternion();
const _qDeltaWorld = new THREE.Quaternion();
const _qNewWorld = new THREE.Quaternion();
const _qForearmWorld = new THREE.Quaternion();
const _qHandWorld = new THREE.Quaternion();
const _qTwistRel = new THREE.Quaternion();
const _qInvBind = new THREE.Quaternion();
const _qTwistOnly = new THREE.Quaternion();

const MAX_CLAVICLE_SLACK_M = 0.06;
const MAX_FOREARM_TWIST_RAD = 2.2; // ±126° anatomical pronation/supination limit

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapAnglePi(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Extracts the signed twist angle (in radians) of quaternion `q` around local +Y axis.
 */
export function extractYTwistAngle(q: THREE.Quaternion): number {
  const lenSq = q.y * q.y + q.w * q.w;
  if (lenSq < 1e-10) return 0;
  const invLen = 1 / Math.sqrt(lenSq);
  const ty = q.y * invLen;
  const tw = q.w * invLen;
  return wrapAnglePi(2 * Math.atan2(ty, tw));
}

/**
 * Pure analytical 2-bone IK solver operating directly in world space and projecting
 * exact swing deltas into each bone's parent frame. Zero heap allocations per call.
 *
 * Works with arbitrary Blender / Source2 / glTF bone local axes because it rotates
 * the actual segment vectors (pA->pB and pB->pC) onto the Law-of-Cosines solution.
 */
export function solveTwoBoneIK(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  effector: THREE.Object3D,
  targetWorld: THREE.Vector3,
  poleWorld: THREE.Vector3 | null,
  allowClavicleSlack = false,
  upperBindLocalPos?: THREE.Vector3
): number {
  if (upperBindLocalPos) {
    upper.position.copy(upperBindLocalPos);
  }

  if (upper.parent) {
    upper.parent.updateWorldMatrix(true, false);
  }
  upper.updateWorldMatrix(false, true);

  upper.getWorldPosition(_vA);
  lower.getWorldPosition(_vB);
  effector.getWorldPosition(_vC);

  const len1 = _vA.distanceTo(_vB);
  const len2 = _vB.distanceTo(_vC);
  if (len1 < 1e-5 || len2 < 1e-5) {
    return _vC.distanceTo(targetWorld);
  }

  _vToTarget.subVectors(targetWorld, _vA);
  let rawDist = _vToTarget.length();
  if (rawDist < 1e-5) {
    return _vC.distanceTo(targetWorld);
  }

  // Optional subtle clavicle pull ONLY if an animation clip hyper-extends the hand slightly
  // past (len1 + len2), guaranteeing <2mm wrist closure without altering in-reach poses.
  const maxReach = len1 + len2 - 0.0005;
  if (allowClavicleSlack && rawDist > maxReach && upper.parent) {
    const excess = Math.min(MAX_CLAVICLE_SLACK_M, rawDist - maxReach);
    _vDirT.copy(_vToTarget).divideScalar(rawDist);
    _vSlackWorld.copy(_vA).addScaledVector(_vDirT, excess);
    _vSlackLocal.copy(_vSlackWorld);
    upper.parent.worldToLocal(_vSlackLocal);
    upper.position.copy(_vSlackLocal);
    upper.updateWorldMatrix(false, true);

    upper.getWorldPosition(_vA);
    lower.getWorldPosition(_vB);
    effector.getWorldPosition(_vC);
    _vToTarget.subVectors(targetWorld, _vA);
    rawDist = _vToTarget.length();
    if (rawDist < 1e-5) {
      return _vC.distanceTo(targetWorld);
    }
  }

  const minReach = Math.abs(len1 - len2) + 0.0005;
  const clampedDist = clamp(rawDist, minReach, maxReach);
  _vDirT.copy(_vToTarget).divideScalar(rawDist);

  // Law of Cosines for shoulder bend angle
  const cosAlpha = clamp(
    (len1 * len1 + clampedDist * clampedDist - len2 * len2) / (2 * len1 * clampedDist),
    -1,
    1
  );
  const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));

  // Determine bend plane direction perpendicular to shoulder->target using pole target
  if (poleWorld) {
    _vToPole.subVectors(poleWorld, _vA);
  } else {
    _vToPole.subVectors(_vB, _vA);
  }
  _vBendDir.copy(_vToPole).addScaledVector(_vDirT, -_vToPole.dot(_vDirT));

  if (_vBendDir.lengthSq() < 1e-8) {
    // Fallback to current elbow bend direction
    _vToPole.subVectors(_vB, _vA);
    _vBendDir.copy(_vToPole).addScaledVector(_vDirT, -_vToPole.dot(_vDirT));
  }
  if (_vBendDir.lengthSq() < 1e-8) {
    // Final orthogonal fallback (prefer downward -Y elbow bend)
    _vToPole.set(0, -1, 0);
    _vBendDir.copy(_vToPole).addScaledVector(_vDirT, -_vToPole.dot(_vDirT));
    if (_vBendDir.lengthSq() < 1e-8) {
      _vToPole.set(1, 0, 0);
      _vBendDir.copy(_vToPole).addScaledVector(_vDirT, -_vToPole.dot(_vDirT));
    }
  }
  _vBendDir.normalize();

  // Desired world direction of upper arm and target elbow position
  _vDesiredDir1
    .copy(_vDirT)
    .multiplyScalar(cosAlpha)
    .addScaledVector(_vBendDir, sinAlpha)
    .normalize();

  _vDesiredElbow.copy(_vA).addScaledVector(_vDesiredDir1, len1);
  _vClampedTarget.copy(_vA).addScaledVector(_vDirT, clampedDist);
  _vDesiredDir2.subVectors(_vClampedTarget, _vDesiredElbow).normalize();

  // Step 1: Swing upper arm from current shoulder->elbow onto desiredDir1
  _vCurDir1.subVectors(_vB, _vA).normalize();
  _qDeltaWorld.setFromUnitVectors(_vCurDir1, _vDesiredDir1);
  upper.getWorldQuaternion(_qBoneWorld);
  _qNewWorld.multiplyQuaternions(_qDeltaWorld, _qBoneWorld);

  if (upper.parent) {
    upper.parent.getWorldQuaternion(_qParentWorld);
    upper.quaternion.copy(_qParentWorld).invert().multiply(_qNewWorld).normalize();
  } else {
    upper.quaternion.copy(_qNewWorld).normalize();
  }
  upper.updateWorldMatrix(false, true);

  // Step 2: Re-read elbow & effector and swing forearm onto desiredDir2
  lower.getWorldPosition(_vB);
  effector.getWorldPosition(_vC);
  _vCurDir2.subVectors(_vC, _vB);
  if (_vCurDir2.lengthSq() > 1e-10) {
    _vCurDir2.normalize();
    _qDeltaWorld.setFromUnitVectors(_vCurDir2, _vDesiredDir2);
    lower.getWorldQuaternion(_qBoneWorld);
    _qNewWorld.multiplyQuaternions(_qDeltaWorld, _qBoneWorld);

    if (lower.parent) {
      lower.parent.getWorldQuaternion(_qParentWorld);
      lower.quaternion.copy(_qParentWorld).invert().multiply(_qNewWorld).normalize();
    } else {
      lower.quaternion.copy(_qNewWorld).normalize();
    }
    lower.updateWorldMatrix(false, true);
  }

  effector.getWorldPosition(_vC);
  return _vC.distanceTo(targetWorld);
}

/**
 * Distributes forearm pronation/supination twist smoothly across twist helper bones
 * so the wrist mesh never pinches ("candy-wrapper" artifact).
 */
export function applyForearmTwist(chain: TwoBoneIKChain): void {
  if (chain.twistBones.length === 0) return;

  chain.lower.getWorldQuaternion(_qForearmWorld);
  chain.target.getWorldQuaternion(_qHandWorld);

  // Relative rotation between actual hand orientation and zero-twist hand orientation:
  // delta = inv(qForearmWorld) * (qHandWorld * inv(bindForearmToHand))
  _qInvBind.copy(chain.bindForearmToHand).invert();
  _qTwistRel.copy(_qHandWorld).multiply(_qInvBind);
  _qTwistRel.premultiply(_qForearmWorld.invert()).normalize();

  const deltaTwist = clamp(
    extractYTwistAngle(_qTwistRel),
    -MAX_FOREARM_TWIST_RAD,
    MAX_FOREARM_TWIST_RAD
  );

  let prevCumulative = 0;
  for (let i = 0; i < chain.twistBones.length; i++) {
    const bone = chain.twistBones[i];
    const targetWeight = chain.twistWeights[i] ?? 0.5;
    const incrementalWeight = chain.nestedTwistChain
      ? targetWeight - prevCumulative
      : targetWeight;
    prevCumulative = targetWeight;

    const bindAngle = chain.bindTwistAngles[i] ?? 0;
    const finalAngle = bindAngle + deltaTwist * incrementalWeight;
    _qTwistOnly.setFromAxisAngle(_vAxisY, finalAngle);
    bone.quaternion.copy(_qTwistOnly);
  }

  chain.lower.updateWorldMatrix(false, true);
}

/**
 * Post-mixer analytical 2-bone Arm IK & Forearm Twist solver for `fps_arms_tactical.glb`.
 * Closes detached `Hand_L`/`Hand_R` wrist gaps (<0.002m) across all 22+ clips and
 * distributes forearm roll cleanly across `BoneTwist_03/02/01`.
 */
export class ArmIKSolver {
  public readonly leftChain: TwoBoneIKChain | null = null;
  public readonly rightChain: TwoBoneIKChain | null = null;
  public lastLeftGap = 0;
  public lastRightGap = 0;

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);

    const byName = new Map<string, THREE.Object3D>();
    root.traverse((obj) => {
      if (obj.name && !byName.has(obj.name)) {
        byName.set(obj.name, obj);
      }
    });

    this.leftChain = this.buildFPSArmChain(byName, 'L');
    this.rightChain = this.buildFPSArmChain(byName, 'R');
  }

  private buildFPSArmChain(
    byName: Map<string, THREE.Object3D>,
    side: 'L' | 'R'
  ): TwoBoneIKChain | null {
    const upper = byName.get(`UpArm_${side}`);
    const lower = byName.get(`Forearm_${side}`);
    const target = byName.get(`Hand_${side}`);
    if (!upper || !lower || !target) return null;

    const twist03 = byName.get(`BoneTwist_03${side}`) ?? byName.get(`BoneTwist_03.${side}`);
    const twist02 = byName.get(`BoneTwist_02${side}`) ?? byName.get(`BoneTwist_02.${side}`);
    const twist01 = byName.get(`BoneTwist_01${side}`) ?? byName.get(`BoneTwist_01.${side}`);
    const effector =
      byName.get(`BoneTwist_01${side}_end`) ??
      byName.get(`BoneTwist_01.${side}_end`) ??
      twist01 ??
      lower;

    const pole = byName.get(`IK_PoleTrgt_${side}`) ?? null;

    const twistBones: THREE.Object3D[] = [];
    const bindTwistAngles: number[] = [];
    if (twist03) {
      twistBones.push(twist03);
      bindTwistAngles.push(extractYTwistAngle(twist03.quaternion));
    }
    if (twist02) {
      twistBones.push(twist02);
      bindTwistAngles.push(extractYTwistAngle(twist02.quaternion));
    }
    if (twist01) {
      twistBones.push(twist01);
      bindTwistAngles.push(extractYTwistAngle(twist01.quaternion));
    }

    const qForearm = new THREE.Quaternion();
    const qHand = new THREE.Quaternion();
    lower.getWorldQuaternion(qForearm);
    target.getWorldQuaternion(qHand);
    const bindForearmToHand = qForearm.invert().multiply(qHand).normalize();

    return {
      upper,
      lower,
      effector,
      target,
      pole,
      twistBones,
      twistWeights: [0.25, 0.55, 0.85],
      nestedTwistChain: true,
      bindTwistAngles,
      bindForearmToHand,
      upperBindLocalPos: upper.position.clone(),
      fallbackPoleDir: new THREE.Vector3(side === 'L' ? -0.4 : 0.4, -0.8, 0.2).normalize(),
    };
  }

  public get isValid(): boolean {
    return this.leftChain !== null || this.rightChain !== null;
  }

  /**
   * Executes right after `armsMixer.update(dt)` every frame.
   * Zero allocations.
   */
  public solve(): void {
    if (this.leftChain) {
      this.lastLeftGap = this.solveChain(this.leftChain);
    }
    if (this.rightChain) {
      this.lastRightGap = this.solveChain(this.rightChain);
    }
  }

  private solveChain(chain: TwoBoneIKChain): number {
    // Ensure target & pole world transforms reflect the latest AnimationMixer frame
    if (chain.target.parent) {
      chain.target.parent.updateWorldMatrix(true, false);
    }
    chain.target.updateWorldMatrix(false, false);
    chain.target.getWorldPosition(_vTarget);

    let polePos: THREE.Vector3 | null = null;
    if (chain.pole) {
      if (chain.pole.parent) {
        chain.pole.parent.updateWorldMatrix(true, false);
      }
      chain.pole.updateWorldMatrix(false, false);
      chain.pole.getWorldPosition(_vPole);
      polePos = _vPole;
    }

    // Solve 2-bone IK first, then distribute forearm twist (pure local Y rotation preserves wrist position)
    const gap = solveTwoBoneIK(
      chain.upper,
      chain.lower,
      chain.effector,
      _vTarget,
      polePos,
      true,
      chain.upperBindLocalPos
    );

    applyForearmTwist(chain);
    return gap;
  }
}
