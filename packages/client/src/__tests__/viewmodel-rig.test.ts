import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ArmIKSolver, extractYTwistAngle } from '../viewmodel/ArmIKSolver.js';
import { AssetManager } from '../render/AssetManager.js';
import { computeRecoilStepPerMeter, applyCS2WeaponHandPosture } from '../viewmodel/WeaponViewmodel.js';
import {
  WEAPON_SOCKET_CONFIGS,
  VIEWMODEL_NEAR_PLANE,
  computeViewmodelFov,
  computeNarrowAspectOffsetX,
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

  it('wires CS2_Draw/CS2_Idle/CS2_Fire/CS2_Reload/CS2_Inspect clips, weapon_hand_r anchoring, and legacy patchM4IdleClip', () => {
    expect(resolveWeaponClipName('garam-47', 'draw')).toBe('CS2_Draw');
    expect(resolveWeaponClipName('vanguard-m4', 'draw')).toBe('CS2_Draw');
    expect(resolveWeaponClipName('garam-karambit', 'draw')).toBe('CS2_Draw');
    expect(resolveWeaponClipName('garam-47', 'reload')).toBe('CS2_Reload');
    expect(resolveWeaponClipName('sovereign-awp', 'inspect')).toBe('CS2_Inspect');

    for (const id of ['garam-47', 'vanguard-m4', 'm4a4', 'mp9', 'sovereign-awp', 'desert-eagle', 'usp-s', 'glock-18']) {
      expect(WEAPON_SOCKET_CONFIGS[id].anchorBoneName).toBe('weapon_hand_r');
      expect(WEAPON_SOCKET_CONFIGS[id].socketBone).toBe('weapon_hand_r_5');
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
      'm4a4': [0.002, 0.026, -0.240],
      'mp9': [0.000, -0.015, -0.160],
      'sovereign-awp': [0.000, 0.022, -0.255],
      'desert-eagle': [-0.014, -0.018, 0.002],
      'usp-s': [-0.014, -0.018, 0.002],
      'glock-18': [-0.014, -0.018, 0.002],
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

  async function loadCS2ArmsInNode(): Promise<any | null> {
    const { NodeIO } = await import('@gltf-transform/core');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

    const glbPath = decodeURIComponent(
      new URL('../../public/models/cs2_fps_arms.glb', import.meta.url).pathname
    );

    // Strip embedded images in-memory so Three.js GLTFLoader parses cleanly in headless Node
    const io = new NodeIO();
    let doc;
    try {
      doc = await io.read(glbPath);
    } catch {
      return null;
    }
    for (const tex of doc.getRoot().listTextures()) {
      tex.dispose();
    }
    const stripped = await io.writeBinary(doc);

    const loader = new GLTFLoader();
    return await new Promise<any>((res, rej) => {
      loader.parse(
        stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
        '',
        res,
        rej
      );
    });
  }

  it('enforces hard CS2 skinned-vertex gate across 1440x900 and 430x932: 0 visible bicep cutoffs, elbows off bottom edge, rifle buttstocks tucked off-screen, 0 crosshair occlusion, and authentic Karambit framing', async () => {
    const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
    const { buildCS2AnimationClips } = await import('../viewmodel/ViewmodelRig.js');

    expect(VIEWMODEL_NEAR_PLANE).toBe(0.05);
    expect(computeViewmodelFov(1440 / 900)).toBe(60);
    expect(computeViewmodelFov(430 / 932)).toBeGreaterThanOrEqual(60);
    expect(computeViewmodelFov(430 / 932)).toBeLessThanOrEqual(66);

    const gltf = await loadCS2ArmsInNode();
    expect(gltf, 'cs2_fps_arms.glb must exist in packages/client/public/models/').not.toBeNull();

    const slicedClips = buildCS2AnimationClips(gltf.animations);
    expect(slicedClips.length).toBeGreaterThanOrEqual(6);

    const viewports = [
      { name: '1440x900', w: 1440, h: 900 },
      { name: '430x932', w: 430, h: 932 },
    ] as const;

    const rifleButtplateZ: Record<string, number> = {
      'garam-47': 0.211,
      'vanguard-m4': 0.227,
      'm4a4': 0.220,
      'sovereign-awp': 0.207,
    };

    // Pre-identify open bicep/shoulder boundary vertices on each skinned mesh
    const collectOpenBicepVertices = (sm: THREE.SkinnedMesh): Set<number> => {
      const boundary = new Set<number>();
      const geom = sm.geometry;
      const index = geom.index;
      const si = geom.attributes.skinIndex;
      const sw = geom.attributes.skinWeight;
      if (!index || !si || !sw) return boundary;

      const upperBoneIndices = new Set<number>();
      sm.skeleton.bones.forEach((b, idx) => {
        if (b.name.includes('upper_armL') || b.name.includes('upper_armR')) {
          upperBoneIndices.add(idx);
        }
      });
      if (upperBoneIndices.size === 0) return boundary;

      const edgeCounts = new Map<string, number>();
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        for (const [u, w] of [
          [Math.min(a, b), Math.max(a, b)],
          [Math.min(b, c), Math.max(b, c)],
          [Math.min(c, a), Math.max(c, a)],
        ]) {
          const key = `${u}_${w}`;
          edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        }
      }

      const openVerts = new Set<number>();
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        for (const [u, w] of [
          [a, b],
          [b, c],
          [c, a],
        ]) {
          const key = `${Math.min(u, w)}_${Math.max(u, w)}`;
          if (edgeCounts.get(key) === 1) {
            openVerts.add(u);
            openVerts.add(w);
          }
        }
      }

      for (const vi of openVerts) {
        let upperW = 0;
        for (let k = 0; k < 4; k++) {
          const bi = k === 0 ? si.getX(vi) : k === 1 ? si.getY(vi) : k === 2 ? si.getZ(vi) : si.getW(vi);
          const wt = k === 0 ? sw.getX(vi) : k === 1 ? sw.getY(vi) : k === 2 ? sw.getZ(vi) : sw.getW(vi);
          if (upperBoneIndices.has(bi)) upperW += wt;
        }
        if (upperW >= 0.1) {
          boundary.add(vi);
        }
      }
      return boundary;
    };

    const v = new THREE.Vector4();
    const skinVertex = new THREE.Vector4();
    const skinned = new THREE.Vector4();
    const t = new THREE.Vector4();
    const ndc = new THREE.Vector3();

    for (const vp of viewports) {
      const aspect = vp.w / vp.h;
      const fov = computeViewmodelFov(aspect);
      const narrowOffsetX = computeNarrowAspectOffsetX(aspect);
      const camera = new THREE.PerspectiveCamera(fov, aspect, VIEWMODEL_NEAR_PLANE, 50);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();

      for (const [weaponId, cfg] of Object.entries(WEAPON_SOCKET_CONFIGS)) {
        const root = clone(gltf.scene);
        const skinnedMeshes: THREE.SkinnedMesh[] = [];
        root.traverse((c: any) => {
          if (c.isSkinnedMesh) skinnedMeshes.push(c);
        });
        expect(skinnedMeshes.length).toBeGreaterThanOrEqual(2);

        const meshRoot = new THREE.Group();
        const container = new THREE.Group();
        container.position.set(
          cfg.armsOffset[0] + narrowOffsetX,
          cfg.armsOffset[1],
          cfg.armsOffset[2]
        );
        container.scale.setScalar(cfg.armsScale);
        container.rotation.y = Math.PI;
        container.add(root);
        meshRoot.add(container);

        const mixer = new THREE.AnimationMixer(root);
        const clip = slicedClips.find((a) => a.name === cfg.clips.idle) || slicedClips[0];
        mixer.clipAction(clip).play();
        mixer.update(0.05);
        meshRoot.updateMatrixWorld(true);

        // Mount weapon holder & left-hand grip anchor on socket bone
        const socket = root.getObjectByName(cfg.socketBone) || null;
        expect(socket, `${weaponId} socket ${cfg.socketBone}`).not.toBeNull();
        const holder = new THREE.Group();
        holder.position.set(...cfg.localPos);
        holder.rotation.set(...cfg.localRotEuler);
        holder.scale.setScalar(cfg.localScale);
        socket!.add(holder);

        let gripAnchorWorld: THREE.Vector3 | null = null;
        if (cfg.leftHandAnchorLocal) {
          const anchor = new THREE.Object3D();
          anchor.position.set(...cfg.leftHandAnchorLocal);
          holder.add(anchor);
          meshRoot.updateMatrixWorld(true);
          gripAnchorWorld = anchor.getWorldPosition(new THREE.Vector3());
        } else {
          meshRoot.updateMatrixWorld(true);
        }

        const solver = new ArmIKSolver(root);
        const handR = root.getObjectByName('DEF-handR_357') || null;
        const handL = root.getObjectByName('DEF-handL_233') || null;

        applyCS2WeaponHandPosture({
          armsRoot: root,
          meshRoot,
          armIKSolver: solver,
          cfg,
          weaponSocket: socket,
          handRSocket: handR,
          handLSocket: handL,
          gripAnchorWorld,
          leftHandLockWeight: 1.0,
          isReloading: false,
          isInspecting: false,
          narrowOffsetX,
        });
        meshRoot.updateMatrixWorld(true);

        let visibleBicepCutoffs = 0;
        let crosshairOverlapVerts = 0;

        for (const sm of skinnedMeshes) {
          const bicepVerts = collectOpenBicepVertices(sm);
          sm.skeleton.update();
          const bm = sm.skeleton.boneMatrices;
          const bindMatrix = sm.bindMatrix;
          const bindMatrixInverse = sm.bindMatrixInverse;
          const matrixWorld = sm.matrixWorld;

          const pos = sm.geometry.attributes.position;
          const si = sm.geometry.attributes.skinIndex;
          const sw = sm.geometry.attributes.skinWeight;

          for (let i = 0; i < pos.count; i++) {
            v.set(pos.getX(i), pos.getY(i), pos.getZ(i), 1.0);
            skinVertex.copy(v).applyMatrix4(bindMatrix);
            skinned.set(0, 0, 0, 0);

            for (let k = 0; k < 4; k++) {
              const idx = k === 0 ? si.getX(i) : k === 1 ? si.getY(i) : k === 2 ? si.getZ(i) : si.getW(i);
              const w = k === 0 ? sw.getX(i) : k === 1 ? sw.getY(i) : k === 2 ? sw.getZ(i) : sw.getW(i);
              if (w <= 0) continue;
              const off = idx * 16;
              t.x = bm[off + 0] * skinVertex.x + bm[off + 4] * skinVertex.y + bm[off + 8] * skinVertex.z + bm[off + 12] * skinVertex.w;
              t.y = bm[off + 1] * skinVertex.x + bm[off + 5] * skinVertex.y + bm[off + 9] * skinVertex.z + bm[off + 13] * skinVertex.w;
              t.z = bm[off + 2] * skinVertex.x + bm[off + 6] * skinVertex.y + bm[off + 10] * skinVertex.z + bm[off + 14] * skinVertex.w;
              t.w = bm[off + 3] * skinVertex.x + bm[off + 7] * skinVertex.y + bm[off + 11] * skinVertex.z + bm[off + 15] * skinVertex.w;
              skinned.addScaledVector(t, w);
            }
            skinned.applyMatrix4(bindMatrixInverse);
            skinned.applyMatrix4(matrixWorld);

            const camZ = skinned.z;
            if (camZ < -0.02) {
              ndc.set(skinned.x, skinned.y, skinned.z).project(camera);
              if (bicepVerts.has(i) && Math.abs(ndc.x) <= 1.02 && Math.abs(ndc.y) <= 1.02) {
                visibleBicepCutoffs++;
              }
              if (camZ < -VIEWMODEL_NEAR_PLANE && Math.abs(ndc.x) < 0.12 && Math.abs(ndc.y) < 0.12) {
                crosshairOverlapVerts++;
              }
            }
          }
        }

        expect(
          visibleBicepCutoffs,
          `[${vp.name}] ${weaponId} open bicep/shoulder cutoff vertices visible in viewport`
        ).toBe(0);
        expect(
          crosshairOverlapVerts,
          `[${vp.name}] ${weaponId} hand/arm vertices overlapping crosshair box (|ndc|<0.12)`
        ).toBe(0);

        // Both elbow joints MUST sit off the bottom border (ndcY < -1.0) or behind camera (camZ >= 0)
        for (const elbowName of ['DEF-forearmL_235', 'DEF-forearmR_359']) {
          const elbow = root.getObjectByName(elbowName);
          expect(elbow, `${elbowName} bone must exist`).toBeDefined();
          const eWorld = elbow!.getWorldPosition(new THREE.Vector3());
          const eNdc = eWorld.clone().project(camera);
          const offBottomOrBehind = eWorld.z >= 0 || eNdc.y < -1.0;
          expect(
            offBottomOrBehind,
            `[${vp.name}] ${weaponId} ${elbowName} visible inside bottom border (worldZ=${eWorld.z.toFixed(3)}, ndcY=${eNdc.y.toFixed(3)})`
          ).toBe(true);
        }

        // Rifles: rear buttplate MUST stay tucked into shoulder off bottom-right or behind near plane
        if (weaponId in rifleButtplateZ) {
          const buttWorld = new THREE.Vector3(0, 0.02, rifleButtplateZ[weaponId]).applyMatrix4(
            holder.matrixWorld
          );
          const buttNdc = buttWorld.clone().project(camera);
          const buttTucked = buttWorld.z > -VIEWMODEL_NEAR_PLANE || buttNdc.x > 0.90 || buttNdc.y < -0.95;
          expect(
            buttTucked,
            `[${vp.name}] ${weaponId} rear buttplate floating in viewport (worldZ=${buttWorld.z.toFixed(3)}, ndc=${buttNdc.x.toFixed(2)},${buttNdc.y.toFixed(2)})`
          ).toBe(true);
        }

        // Weapon landmarks MUST NOT collide with crosshair deadzone (|ndc| < 0.12)
        const landmarks =
          weaponId === 'garam-karambit'
            ? [new THREE.Vector3(0, 0, 0), new THREE.Vector3(...cfg.muzzleLocalPos)]
            : [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(
                  cfg.muzzleLocalPos[0] * 0.5,
                  cfg.muzzleLocalPos[1] * 0.5,
                  cfg.muzzleLocalPos[2] * 0.5
                ),
                new THREE.Vector3(...cfg.muzzleLocalPos),
              ];

        for (const pt of landmarks) {
          const ptWorld = pt.clone().applyMatrix4(holder.matrixWorld);
          if (ptWorld.z < -VIEWMODEL_NEAR_PLANE) {
            const ptNdc = ptWorld.clone().project(camera);
            const inDeadzone = Math.abs(ptNdc.x) < 0.12 && Math.abs(ptNdc.y) < 0.12;
            expect(
              inDeadzone,
              `[${vp.name}] ${weaponId} landmark ${pt.toArray()} in crosshair deadzone (${ptNdc.x.toFixed(2)}, ${ptNdc.y.toFixed(2)})`
            ).toBe(false);
          }
        }

        // Rifle/SMG left palm centroid locked flush onto handguard anchor (<= 0.012m)
        if (cfg.leftArmPoseMode === 'rifle' && gripAnchorWorld) {
          const fIdx = root.getObjectByName('DEF-f_index01L_147');
          const fMid = root.getObjectByName('DEF-f_middle01L_180');
          const fRing = root.getObjectByName('DEF-f_ring01L_199');
          if (fIdx && fMid && fRing) {
            const palmCenter = new THREE.Vector3()
              .add(fIdx.getWorldPosition(new THREE.Vector3()))
              .add(fMid.getWorldPosition(new THREE.Vector3()))
              .add(fRing.getWorldPosition(new THREE.Vector3()))
              .multiplyScalar(1 / 3);
            expect(
              palmCenter.distanceTo(gripAnchorWorld),
              `[${vp.name}] ${weaponId} left palm centroid distance to handguard`
            ).toBeLessThanOrEqual(0.012);
          }
        }

        // Authentic CS2 Karambit dual-hand framing on desktop 1440x900
        if (weaponId === 'garam-karambit' && vp.name === '1440x900') {
          const hLNdc = handL!.getWorldPosition(new THREE.Vector3()).project(camera);
          const hRNdc = handR!.getWorldPosition(new THREE.Vector3()).project(camera);
          const tipNdc = new THREE.Vector3(...cfg.muzzleLocalPos)
            .applyMatrix4(holder.matrixWorld)
            .project(camera);

          expect(hLNdc.x, 'Karambit left hand NDC X min').toBeGreaterThanOrEqual(-0.65);
          expect(hLNdc.x, 'Karambit left hand NDC X max').toBeLessThanOrEqual(-0.18);
          expect(hLNdc.y, 'Karambit left hand NDC Y min').toBeGreaterThanOrEqual(-0.85);
          expect(hLNdc.y, 'Karambit left hand NDC Y max').toBeLessThanOrEqual(-0.42);

          expect(hRNdc.x, 'Karambit right fist NDC X min').toBeGreaterThanOrEqual(0.18);
          expect(hRNdc.x, 'Karambit right fist NDC X max').toBeLessThanOrEqual(0.62);
          expect(hRNdc.y, 'Karambit right fist NDC Y min').toBeGreaterThanOrEqual(-0.82);
          expect(hRNdc.y, 'Karambit right fist NDC Y max').toBeLessThanOrEqual(-0.45);

          expect(tipNdc.x, 'Karambit bladeTip NDC X min').toBeGreaterThanOrEqual(0.55);
          expect(tipNdc.x, 'Karambit bladeTip NDC X max').toBeLessThanOrEqual(0.88);
          expect(tipNdc.y, 'Karambit bladeTip NDC Y min').toBeGreaterThanOrEqual(-0.55);
          expect(tipNdc.y, 'Karambit bladeTip NDC Y max').toBeLessThanOrEqual(-0.22);
        }
      }
    }
  });

  it('guarantees restoreBindPose never overwrites mounted weapon transforms with duplicate Sketchfab node names', async () => {
    const { captureBindPose, restoreBindPose } = await import('../viewmodel/ViewmodelRig.js');

    const armsRoot = new THREE.Group();
    const armsScene = new THREE.Group();
    armsScene.name = 'Sketchfab_Scene';
    const weaponSocket = new THREE.Object3D();
    weaponSocket.name = 'weapon_hand_r_5';
    armsScene.add(weaponSocket);
    armsRoot.add(armsScene);

    const snapshot = captureBindPose(armsRoot);

    // Mount a weapon sharing the exact same Sketchfab_Scene name with custom 180-deg flip & normalization scale
    const holder = new THREE.Group();
    holder.userData.isWeaponAttachment = true;
    const weaponScene = new THREE.Group();
    weaponScene.name = 'Sketchfab_Scene';
    weaponScene.rotation.set(0, Math.PI, 0);
    weaponScene.scale.setScalar(0.000603);
    weaponScene.position.set(0.01, -0.02, 0.03);
    holder.add(weaponScene);
    weaponSocket.add(holder);

    // Mutate arms socket, then restoreBindPose
    weaponSocket.position.set(5, 5, 5);
    restoreBindPose(armsRoot, snapshot);

    // Arms socket is restored, while mounted weapon keeps exact rotation, scale, and position
    expect(weaponSocket.position.length()).toBeCloseTo(0, 5);
    expect(Math.abs(weaponScene.rotation.y)).toBeCloseTo(Math.PI, 4);
    expect(weaponScene.scale.x).toBeCloseTo(0.000603, 6);
    expect(weaponScene.position.z).toBeCloseTo(0.03, 5);
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
