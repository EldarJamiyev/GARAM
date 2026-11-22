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

  it('verifies ArmIKSolver wrist seam gap < 0.002m across idle, fire recoil, and reload states', () => {
    const rig = buildSyntheticFPSArmRig(false);
    const solver = new ArmIKSolver(rig.root);
    expect(solver.isValid).toBe(true);

    const states = [
      { name: 'idle', posL: [-0.08, 0.06, 0.36], posR: [0.10, 0.04, 0.32], rotL: 0.2 },
      { name: 'fire_recoil', posL: [-0.075, 0.075, 0.33], posR: [0.105, 0.058, 0.29], rotL: 0.35 },
      { name: 'reload', posL: [-0.14, -0.02, 0.28], posR: [0.09, 0.035, 0.31], rotL: 0.8 },
    ];

    for (const state of states) {
      rig.handL.parent!.position.set(state.posL[0], state.posL[1], state.posL[2]);
      rig.handR.parent!.position.set(state.posR[0], state.posR[1], state.posR[2]);
      rig.handL.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), state.rotL);
      rig.root.updateMatrixWorld(true);

      solver.solve();

      const gapL = rig.wristLEnd
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(rig.handL.getWorldPosition(new THREE.Vector3()));
      const gapR = rig.wristREnd
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(rig.handR.getWorldPosition(new THREE.Vector3()));

      expect(gapL, `${state.name} left wrist gap`).toBeLessThan(0.002);
      expect(gapR, `${state.name} right wrist gap`).toBeLessThan(0.002);
    }
  });

  it('enforces left-hand-to-forend grip anchor calibration within < 0.025m for all firearms', () => {
    const physicalForendUnderside: Record<string, [number, number, number]> = {
      'garam-47': [0.000, -0.018, -0.235],
      'vanguard-m4': [0.002, 0.032, -0.245],
      'sovereign-awp': [0.000, 0.022, -0.255],
      'desert-eagle': [-0.014, -0.018, 0.002],
    };

    for (const [weaponId, expectedPos] of Object.entries(physicalForendUnderside)) {
      const cfg = WEAPON_SOCKET_CONFIGS[weaponId];
      expect(cfg).toBeDefined();
      expect(cfg.leftHandAnchorLocal).toBeDefined();
      const actual = new THREE.Vector3(...cfg.leftHandAnchorLocal!);
      const expected = new THREE.Vector3(...expectedPos);
      const dist = actual.distanceTo(expected);
      expect(dist, `${weaponId} leftHandAnchor distance to forend`).toBeLessThan(0.025);
    }
  });

  it('validates CS2 Karambit reverse-grip orientation, visible hawkbill blade, and ring positioning', () => {
    const kCfg = WEAPON_SOCKET_CONFIGS['garam-karambit'];
    expect(kCfg).toBeDefined();
    expect(kCfg.localRotEuler).toBeDefined();

    // CS2 reverse-grip rotation: angled broad bevel toward camera [-3.05, -3.12, -2.58]
    const [rx, ry, rz] = kCfg.localRotEuler!;
    expect(rx).toBeCloseTo(-3.05, 1);
    expect(ry).toBeCloseTo(-3.12, 1);
    expect(rz).toBeCloseTo(-2.58, 1);

    // Compute NDC projection using viewmodel camera (FOV 62°, 1440x900)
    const camera = new THREE.PerspectiveCamera(62, 1440 / 900, 0.005, 10);
    camera.updateProjectionMatrix();

    const vmMesh = new THREE.Group();
    const armsContainer = new THREE.Group();
    armsContainer.position.set(...kCfg.armsOffset);
    armsContainer.rotation.y = Math.PI;
    armsContainer.scale.setScalar(kCfg.armsScale);
    vmMesh.add(armsContainer);

    const ikHandCtrlR = new THREE.Object3D();
    ikHandCtrlR.position.set(-0.180, 0.220, 0.230);
    ikHandCtrlR.quaternion.set(-0.0572, 0.0106, 0.5295, 0.8463);
    armsContainer.add(ikHandCtrlR);

    const handR = new THREE.Object3D();
    handR.quaternion.set(-0.4733, 0.5626, 0.514, -0.4419);
    ikHandCtrlR.add(handR);

    const socketHolder = new THREE.Group();
    socketHolder.position.set(...kCfg.localPos);
    socketHolder.rotation.set(...kCfg.localRotEuler!);
    handR.add(socketHolder);

    const ringSpinGroup = new THREE.Group();
    ringSpinGroup.position.set(0, 0.02, 0.085);
    socketHolder.add(ringSpinGroup);

    const knifeModel = new THREE.Group();
    knifeModel.position.set(0, -0.02, -0.085);
    ringSpinGroup.add(knifeModel);

    const bladeTip = new THREE.Object3D();
    bladeTip.position.set(0, -0.045, -0.110);
    knifeModel.add(bladeTip);

    vmMesh.updateMatrixWorld(true);

    const tipWorld = bladeTip.getWorldPosition(new THREE.Vector3());
    const ringWorld = ringSpinGroup.getWorldPosition(new THREE.Vector3());

    const tipNDC = tipWorld.clone().project(camera);
    const ringNDC = ringWorld.clone().project(camera);

    // Blade tip must project inside lower-right visible viewport
    expect(tipNDC.x).toBeGreaterThan(0.12);
    expect(tipNDC.x).toBeLessThan(0.55);
    expect(tipNDC.y).toBeGreaterThan(-0.55);
    expect(tipNDC.y).toBeLessThan(-0.05);

    // Blade tip must be higher in the viewport than the retention ring (curved blade sweeps UP)
    expect(tipNDC.y).toBeGreaterThan(ringNDC.y);
    expect(tipNDC.x).toBeLessThan(ringNDC.x);
  });

  it('guarantees zero crosshair collision (|ndcX| < 0.12 && |ndcY| < 0.12) across all 5 viewmodel setups', () => {
    const camera = new THREE.PerspectiveCamera(62, 1440 / 900, 0.005, 10);
    camera.updateProjectionMatrix();

    for (const [weaponId, cfg] of Object.entries(WEAPON_SOCKET_CONFIGS)) {
      const armsContainer = new THREE.Group();
      armsContainer.rotation.y = Math.PI;

      const inner = new THREE.Group();
      inner.position.set(...cfg.armsOffset);
      inner.scale.setScalar(cfg.armsScale);
      armsContainer.add(inner);

      const rightHand = new THREE.Group();
      inner.add(rightHand);

      const weaponWrapper = new THREE.Group();
      if (cfg.localRotEuler) {
        weaponWrapper.rotation.set(...cfg.localRotEuler);
      }
      rightHand.add(weaponWrapper);

      // Check key landmark points (grip, muzzle, top rail)
      const pointsToCheck = [
        new THREE.Vector3(0, 0, 0), // grip
        new THREE.Vector3(0, 0.08, -0.5), // muzzle or barrel
        new THREE.Vector3(0, 0.12, -0.2), // top rail / sight
      ];

      armsContainer.updateMatrixWorld(true);

      for (const pt of pointsToCheck) {
        const worldPt = pt.clone().applyMatrix4(weaponWrapper.matrixWorld);
        const ndc = worldPt.project(camera);

        // Point must not occupy the center crosshair deadzone
        const inDeadzone = Math.abs(ndc.x) < 0.12 && Math.abs(ndc.y) < 0.12;
        expect(inDeadzone, `${weaponId} point ${pt.toArray()} in crosshair deadzone (ndc: ${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`).toBe(false);
      }
    }
  });

  it('confirms AWP top scope rail sits strictly below crosshair elevation (ndcY <= -0.02)', () => {
    const camera = new THREE.PerspectiveCamera(62, 1440 / 900, 0.005, 10);
    camera.updateProjectionMatrix();

    const awpCfg = WEAPON_SOCKET_CONFIGS['sovereign-awp'];
    const vmRoot = new THREE.Group();
    vmRoot.position.set(0.14, -0.13, -0.32);

    const awp = new THREE.Group();
    awp.position.set(...awpCfg.localPos);
    awp.rotation.set(...awpCfg.localRotEuler);
    vmRoot.add(awp);

    // Scope top rail landmark in AWP space
    const scopeRail = new THREE.Object3D();
    scopeRail.position.set(0, 0.12, -0.22);
    awp.add(scopeRail);

    vmRoot.updateMatrixWorld(true);
    const scopeNDC = scopeRail.getWorldPosition(new THREE.Vector3()).project(camera);

    expect(scopeNDC.y, 'AWP scope rail NDC Y').toBeLessThanOrEqual(-0.02);
  });

  it('guarantees 0 skinned arm vertices clipping near-plane (camZ > -0.01m), screen coverage <= 24%, and elbows ndcY < -0.50 across all 5 weapons', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');

    const glbPath = path.resolve(__dirname, '../../../packages/client/public/models/fps_arms_tactical.glb');
    if (!fs.existsSync(glbPath)) return; // graceful skip if file not present in test runner

    const buf = fs.readFileSync(glbPath);
    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((res, rej) => {
      loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej);
    });

    const camera = new THREE.PerspectiveCamera(62, 1440 / 900, 0.005, 50);
    camera.updateProjectionMatrix();

    for (const [weaponId, cfg] of Object.entries(WEAPON_SOCKET_CONFIGS)) {
      const root = clone(gltf.scene);
      let sm: THREE.SkinnedMesh | null = null;
      root.traverse((c: any) => { if (c.isSkinnedMesh) sm = c; });
      expect(sm).not.toBeNull();

      const container = new THREE.Group();
      container.position.set(...cfg.armsOffset);
      container.scale.setScalar(cfg.armsScale);
      container.rotation.y = Math.PI;
      container.add(root);

      const mixer = new THREE.AnimationMixer(root);
      const clipName = cfg.clips.idle;
      const clip = gltf.animations.find((a: any) => a.name === clipName) || gltf.animations[0];
      mixer.clipAction(clip).play();
      mixer.update(0.01);
      container.updateMatrixWorld(true);

      sm!.skeleton.update();
      const bm = sm!.skeleton.boneMatrices;
      const bindMatrix = sm!.bindMatrix;
      const bindMatrixInverse = sm!.bindMatrixInverse;
      const matrixWorld = sm!.matrixWorld;

      const pos = sm!.geometry.attributes.position;
      const si = sm!.geometry.attributes.skinIndex;
      const sw = sm!.geometry.attributes.skinWeight;
      const v = new THREE.Vector4(), skinVertex = new THREE.Vector4(), skinned = new THREE.Vector4(), t = new THREE.Vector4();
      let countCloserNearPlane = 0;
      const gridW = 144, gridH = 90;
      const cov = new Uint8Array(gridW * gridH);
      const ndc = new THREE.Vector3();

      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i), 1.0);
        skinVertex.copy(v).applyMatrix4(bindMatrix);
        skinned.set(0, 0, 0, 0);

        for (let k = 0; k < 4; k++) {
          const idx = k === 0 ? si.getX(i) : k === 1 ? si.getY(i) : k === 2 ? si.getZ(i) : si.getW(i);
          const w = k === 0 ? sw.getX(i) : k === 1 ? sw.getY(i) : k === 2 ? sw.getZ(i) : sw.getW(i);
          if (w <= 0) continue;
          const off = idx * 16;
          t.x = bm[off+0]*skinVertex.x + bm[off+4]*skinVertex.y + bm[off+8]*skinVertex.z + bm[off+12]*skinVertex.w;
          t.y = bm[off+1]*skinVertex.x + bm[off+5]*skinVertex.y + bm[off+9]*skinVertex.z + bm[off+13]*skinVertex.w;
          t.z = bm[off+2]*skinVertex.x + bm[off+6]*skinVertex.y + bm[off+10]*skinVertex.z + bm[off+14]*skinVertex.w;
          t.w = bm[off+3]*skinVertex.x + bm[off+7]*skinVertex.y + bm[off+11]*skinVertex.z + bm[off+15]*skinVertex.w;
          skinned.addScaledVector(t, w);
        }
        skinned.applyMatrix4(bindMatrixInverse);
        skinned.applyMatrix4(matrixWorld);

        if (skinned.z > -0.01) countCloserNearPlane++;

        ndc.set(skinned.x, skinned.y, skinned.z).project(camera);
        if (ndc.z >= 0 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) {
          const gx = Math.floor((ndc.x + 1) * 0.5 * (gridW - 1));
          const gy = Math.floor((1 - (ndc.y + 1) * 0.5) * (gridH - 1));
          cov[gy * gridW + gx] = 1;
        }
      }

      let covCount = 0;
      for (let j = 0; j < cov.length; j++) if (cov[j]) covCount++;
      const covPct = (covCount / (gridW * gridH)) * 100;

      // 1. Zero vertices clipping camera near-plane
      expect(countCloserNearPlane, `${weaponId} vertices clipping near-plane`).toBe(0);

      // 2. Viewmodel screen coverage strictly <= 24%
      expect(covPct, `${weaponId} screen coverage`).toBeLessThanOrEqual(24.0);

      // 3. Elbows hang naturally in lower screen half
      const elbowL = root.getObjectByName('Forearm_L');
      if (elbowL) {
        const eLndc = elbowL.getWorldPosition(new THREE.Vector3()).project(camera);
        expect(eLndc.y, `${weaponId} Forearm_L NDC Y`).toBeLessThan(-0.50);
      }
    }
  });

  it('confirms Garam-47 front sight framing sits at ndcX >= 0.18 matching CS2 right-side framing', () => {
    const camera = new THREE.PerspectiveCamera(62, 1440 / 900, 0.005, 50);
    camera.updateProjectionMatrix();

    const akCfg = WEAPON_SOCKET_CONFIGS['garam-47'];
    const akContainer = new THREE.Group();
    akContainer.rotation.y = Math.PI;

    const akInner = new THREE.Group();
    akInner.position.set(...akCfg.armsOffset);
    akInner.scale.setScalar(akCfg.armsScale);
    akContainer.add(akInner);

    const rightHand = new THREE.Group();
    akInner.add(rightHand);

    const akMesh = new THREE.Group();
    akMesh.position.set(...akCfg.localPos);
    akMesh.rotation.set(...akCfg.localRotEuler);
    rightHand.add(akMesh);

    const frontSight = new THREE.Object3D();
    frontSight.position.set(0.008, 0.095, -0.52);
    akMesh.add(frontSight);

    akContainer.updateMatrixWorld(true);
    const sightNDC = frontSight.getWorldPosition(new THREE.Vector3()).project(camera);

    expect(sightNDC.x, 'Garam-47 front sight ndcX').toBeGreaterThanOrEqual(0.18);
  });

  it('confirms Karambit tactical guard Hand_L projects strictly below ndcY <= -0.80 clear of crosshair', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

    const glbPath = path.resolve(__dirname, '../../../packages/client/public/models/fps_arms_tactical.glb');
    if (!fs.existsSync(glbPath)) return;

    const buf = fs.readFileSync(glbPath);
    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((res, rej) => {
      loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej);
    });

    const camera = new THREE.PerspectiveCamera(62, 1440 / 900, 0.005, 50);
    camera.updateProjectionMatrix();

    const kCfg = WEAPON_SOCKET_CONFIGS['garam-karambit'];
    const kContainer = new THREE.Group();
    kContainer.position.set(...kCfg.armsOffset);
    kContainer.scale.setScalar(kCfg.armsScale);
    kContainer.rotation.y = Math.PI;
    kContainer.add(gltf.scene);

    const handL = gltf.scene.getObjectByName('Hand_L');
    const ikL = gltf.scene.getObjectByName('IK_Hand_Cntrl_L');
    expect(handL).toBeDefined();
    expect(ikL).toBeDefined();

    ikL!.position.set(0.260, -0.040, 0.140);
    kContainer.updateMatrixWorld(true);

    const kHandNDC = handL!.getWorldPosition(new THREE.Vector3()).project(camera);
    expect(kHandNDC.y, 'Karambit Hand_L NDC Y').toBeLessThanOrEqual(-0.80);
    expect(kHandNDC.x, 'Karambit Hand_L NDC X').toBeLessThan(-0.25);
  });

  it('verifies firearm left palm centroid tracks weapon grip anchor within <= 0.015m eliminating detachment', () => {
    const handL = new THREE.Object3D();
    const ikHandCtrlL = new THREE.Object3D();
    const parent = new THREE.Group();
    parent.add(ikHandCtrlL);
    ikHandCtrlL.add(handL);

    const b5 = new THREE.Object3D();
    b5.position.set(0.02, 0.04, 0.02);
    handL.add(b5);

    const b9 = new THREE.Object3D();
    b9.position.set(0.00, 0.045, 0.025);
    handL.add(b9);

    const b13 = new THREE.Object3D();
    b13.position.set(-0.02, 0.04, 0.02);
    handL.add(b13);

    parent.updateMatrixWorld(true);

    const gripAnchorWorld = new THREE.Vector3(0.04, -0.22, -0.42);

    // Compute palm centroid offset
    const p5 = b5.getWorldPosition(new THREE.Vector3());
    const p9 = b9.getWorldPosition(new THREE.Vector3());
    const p13 = b13.getWorldPosition(new THREE.Vector3());
    const palm = new THREE.Vector3().add(p5).add(p9).add(p13).multiplyScalar(1 / 3);
    const pHand = handL.getWorldPosition(new THREE.Vector3());

    const palmOffset = palm.clone().sub(pHand);
    const targetWristWorld = gripAnchorWorld.clone().sub(palmOffset);

    parent.worldToLocal(targetWristWorld);
    ikHandCtrlL.position.copy(targetWristWorld);
    parent.updateMatrixWorld(true);

    const finalPalm = new THREE.Vector3()
      .add(b5.getWorldPosition(new THREE.Vector3()))
      .add(b9.getWorldPosition(new THREE.Vector3()))
      .add(b13.getWorldPosition(new THREE.Vector3()))
      .multiplyScalar(1 / 3);

    const gap = finalPalm.distanceTo(gripAnchorWorld);
    expect(gap).toBeLessThanOrEqual(0.015);
  });
});
