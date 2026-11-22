import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ArmIKSolver, extractYTwistAngle } from '../viewmodel/ArmIKSolver.js';
import { AssetManager } from '../render/AssetManager.js';
import { computeRecoilStepPerMeter } from '../viewmodel/WeaponViewmodel.js';
import {
  WEAPON_SOCKET_CONFIGS,
  resolveWeaponClipName,
  patchM4IdleClip,
} from '../viewmodel/ViewmodelRig.js';

function buildSyntheticFPSArmRig(useDots: boolean): {
  root: THREE.Group;
  handL: THREE.Object3D;
  handR: THREE.Object3D;
  wristLEnd: THREE.Object3D;
  wristREnd: THREE.Object3D;
  twistsL: THREE.Object3D[];
  twistsR: THREE.Object3D[];
} {
  const root = new THREE.Group();
  const sep = useDots ? '.' : '';

  const buildSide = (side: 'L' | 'R', signX: number) => {
    const clavicle = new THREE.Object3D();
    clavicle.name = `Arm_${side}`;
    clavicle.position.set(signX * 0.18, 0, 0);
    root.add(clavicle);

    const upper = new THREE.Object3D();
    upper.name = `UpArm_${side}`;
    upper.position.set(signX * 0.04, 0, 0);
    clavicle.add(upper);

    const forearm = new THREE.Object3D();
    forearm.name = `Forearm_${side}`;
    forearm.position.set(0, 0.28, 0); // 28cm upper arm along +Y
    upper.add(forearm);

    const twist03 = new THREE.Object3D();
    twist03.name = `BoneTwist_03${sep}${side}`;
    twist03.position.set(0, 0, 0);
    forearm.add(twist03);

    const twist02 = new THREE.Object3D();
    twist02.name = `BoneTwist_02${sep}${side}`;
    twist02.position.set(0, 0.095, 0);
    twist03.add(twist02);

    const twist01 = new THREE.Object3D();
    twist01.name = `BoneTwist_01${sep}${side}`;
    twist01.position.set(0, 0.095, 0);
    twist02.add(twist01);

    const wristEnd = new THREE.Object3D();
    wristEnd.name = `BoneTwist_01${sep}${side}_end`;
    wristEnd.position.set(0, 0.095, 0); // 28.5cm forearm total
    twist01.add(wristEnd);

    const pole = new THREE.Object3D();
    pole.name = `IK_PoleTrgt_${side}`;
    pole.position.set(signX * 0.42, -0.25, 0.15);
    root.add(pole);

    const handCtrl = new THREE.Object3D();
    handCtrl.name = `IK_Hand_Cntrl_${side}`;
    handCtrl.position.set(signX * 0.12, 0.05, 0.34);
    root.add(handCtrl);

    const hand = new THREE.Object3D();
    hand.name = `Hand_${side}`;
    handCtrl.add(hand);

    return { hand, wristEnd, twists: [twist03, twist02, twist01] };
  };

  const left = buildSide('L', -1);
  const right = buildSide('R', 1);
  root.updateMatrixWorld(true);

  return {
    root,
    handL: left.hand,
    handR: right.hand,
    wristLEnd: left.wristEnd,
    wristREnd: right.wristEnd,
    twistsL: left.twists,
    twistsR: right.twists,
  };
}

describe('First-Person Viewmodel, ArmIKSolver & Weapon Rig Suite', () => {
  it('closes detached wrist gaps to < 0.002m on both arms and distributes forearm twist cleanly', () => {
    for (const useDots of [false, true]) {
      const rig = buildSyntheticFPSArmRig(useDots);
      const solver = new ArmIKSolver(rig.root);
      expect(solver.isValid).toBe(true);

      // Simulate detached AnimationMixer frame (like M4_Idle / SRifle_Idle / Pistol_Idle)
      rig.handL.parent!.position.set(-0.08, 0.06, 0.36);
      rig.handR.parent!.position.set(0.10, 0.04, 0.32);
      // Pronate left wrist by +60° around forearm longitudinal pointing axis (+Z)
      rig.handL.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.05);
      rig.root.updateMatrixWorld(true);

      const preGapL = rig.wristLEnd
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(rig.handL.getWorldPosition(new THREE.Vector3()));
      const preGapR = rig.wristREnd
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(rig.handR.getWorldPosition(new THREE.Vector3()));
      expect(preGapL).toBeGreaterThan(0.15);
      expect(preGapR).toBeGreaterThan(0.15);

      solver.solve();

      const postGapL = rig.wristLEnd
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(rig.handL.getWorldPosition(new THREE.Vector3()));
      const postGapR = rig.wristREnd
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(rig.handR.getWorldPosition(new THREE.Vector3()));

      expect(postGapL).toBeLessThan(0.002);
      expect(postGapR).toBeLessThan(0.002);
      expect(solver.lastLeftGap).toBeLessThan(0.002);
      expect(solver.lastRightGap).toBeLessThan(0.002);

      // Twist bones must progressively absorb wrist pronation (cumulative ~85% of roll, zero pinching)
      const twistAngles = rig.twistsL.map((b) => Math.abs(extractYTwistAngle(b.quaternion)));
      const totalTwist = twistAngles[0] + twistAngles[1] + twistAngles[2];
      expect(totalTwist).toBeGreaterThan(0.45);
      // Each individual twist segment must stay bounded (< 90°) preventing candy-wrapper pinching
      for (const a of twistAngles) {
        expect(a).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it('anchors weapon_hand_r bone to wrapper (0,0,0) and records normalizationScale + muzzleTipLocal', () => {
    const wrapper = new THREE.Group();
    const inner = new THREE.Group();

    // Synthetic firearm mesh: 2.0 units long along +Z (stock at -0.5, barrel muzzle at +1.5)
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.36, 2.0),
      new THREE.MeshStandardMaterial()
    );
    body.position.set(0, 0.1, 0.5);
    inner.add(body);

    const gripBone = new THREE.Object3D();
    gripBone.name = 'weapon_hand_r_4';
    gripBone.position.set(0.02, -0.05, 0.0);
    inner.add(gripBone);

    inner.rotation.set(0, Math.PI, 0); // Flip so muzzle points along -Z
    wrapper.add(inner);

    const meta = AssetManager.normalizeGLB(wrapper, inner, {
      targetLength: 0.86,
      anchorBoneName: 'weapon_hand_r',
    });

    expect(meta.anchorBoneFound).toBe(true);
    expect(meta.normalizationScale).toBeCloseTo(0.43, 3);
    expect(wrapper.userData.normalizationScale).toBeCloseTo(0.43, 3);

    // Anchor bone must sit at exact (0, 0, 0) in wrapper space
    const anchorWorld = gripBone.getWorldPosition(new THREE.Vector3());
    expect(anchorWorld.length()).toBeLessThan(1e-4);

    // Muzzle tip must sit at the frontmost (-Z) barrel extreme (~ -0.645m from grip)
    expect(meta.barrelAxisLocal.z).toBe(-1);
    expect(meta.muzzleTipLocal.z).toBeCloseTo(-0.645, 2);
  });

  it('compensates slide/bolt blowback across arbitrary normalizationScale & rotated parent bones (0.02m-0.08m)', () => {
    // Case A: 36x scaled wrapper (non-Source2 scale stress test)
    const wrapper36 = new THREE.Group();
    const inner36 = new THREE.Group();
    inner36.scale.setScalar(36.0);
    const slide36 = new THREE.Object3D();
    slide36.name = 'v_weapon_deagle_slide_0';
    slide36.position.set(0.01, 0.02, 0.03);
    inner36.add(slide36);
    wrapper36.add(inner36);
    wrapper36.userData.normalizationScale = 36.0;

    const baseWorldA = slide36.getWorldPosition(new THREE.Vector3());
    const stepA = computeRecoilStepPerMeter(wrapper36, slide36, new THREE.Vector3(0, 0, 1));
    slide36.position.addScaledVector(stepA, 0.035);
    wrapper36.updateMatrixWorld(true);
    const movedWorldA = slide36.getWorldPosition(new THREE.Vector3());
    const deltaA = movedWorldA.clone().sub(baseWorldA);

    expect(deltaA.length()).toBeCloseTo(0.035, 4);
    expect(deltaA.z).toBeCloseTo(0.035, 4);
    expect(deltaA.length()).toBeGreaterThanOrEqual(0.02);
    expect(deltaA.length()).toBeLessThanOrEqual(0.08);

    // Case B: Rotated Source2 inch-scale parent bone (0.0234x scale, quaternion [-0.5,-0.5,-0.5,0.5])
    const wrapperS2 = new THREE.Group();
    const s2Node = new THREE.Group();
    s2Node.scale.setScalar(0.0234);
    const handBone = new THREE.Object3D();
    handBone.quaternion.set(-0.5, -0.5, -0.5, 0.5).normalize();
    const boltS2 = new THREE.Object3D();
    boltS2.name = 'v_weapon_awp_bolt_action_0';
    boltS2.position.set(4.36, 3.19, 0.0);
    handBone.add(boltS2);
    s2Node.add(handBone);
    wrapperS2.add(s2Node);

    wrapperS2.updateMatrixWorld(true);
    const baseWorldB = boltS2.getWorldPosition(new THREE.Vector3());
    const stepB = computeRecoilStepPerMeter(wrapperS2, boltS2, new THREE.Vector3(0, 0, 1));
    boltS2.position.addScaledVector(stepB, 0.065);
    wrapperS2.updateMatrixWorld(true);
    const movedWorldB = boltS2.getWorldPosition(new THREE.Vector3());
    const deltaB = movedWorldB.clone().sub(baseWorldB);

    expect(deltaB.length()).toBeCloseTo(0.065, 4);
    expect(deltaB.z).toBeCloseTo(0.065, 4);
    expect(Math.abs(deltaB.x)).toBeLessThan(1e-4);
    expect(Math.abs(deltaB.y)).toBeLessThan(1e-4);
  });

  it('wires real AK_Draw, M4_Draw, Karambit_Draw clips, weapon_hand_r anchoring, and patches M4_Idle tracks', () => {
    expect(resolveWeaponClipName('garam-47', 'draw')).toBe('AK_Draw');
    expect(resolveWeaponClipName('vanguard-m4', 'draw')).toBe('M4_Draw');
    expect(resolveWeaponClipName('garam-karambit', 'draw')).toBe('Karambit_Draw');

    for (const id of ['garam-47', 'vanguard-m4', 'sovereign-awp', 'desert-eagle']) {
      expect(WEAPON_SOCKET_CONFIGS[id].anchorBoneName).toBe('weapon_hand_r');
    }

    const m4Idle = new THREE.AnimationClip('M4_Idle', 1.2, [
      new THREE.QuaternionKeyframeTrack('Hand_R.quaternion', [0, 1.2], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const m4Walk = new THREE.AnimationClip('M4_Walk', 0.8, [
      new THREE.QuaternionKeyframeTrack('Hand_R.quaternion', [0, 0.8], [0, 0, 0, 1, 0, 0, 0, 1]),
      new THREE.QuaternionKeyframeTrack('Hand_L.quaternion', [0, 0.8], [0.1, 0.2, 0.3, 0.9, 0.1, 0.2, 0.3, 0.9]),
      new THREE.QuaternionKeyframeTrack('Bone_L004.quaternion', [0, 0.8], [0.2, 0, 0, 0.98, 0.2, 0, 0, 0.98]),
    ]);

    const added = patchM4IdleClip([m4Idle, m4Walk]);
    expect(added).toBe(2);
    expect(m4Idle.tracks.some((t) => t.name === 'Hand_L.quaternion')).toBe(true);
    expect(m4Idle.tracks.some((t) => t.name === 'Bone_L004.quaternion')).toBe(true);
  });
});
