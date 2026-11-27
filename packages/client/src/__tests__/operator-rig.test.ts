import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AssetManager } from '../render/AssetManager.js';
import { OperatorArmIK, WORLD_WEAPON_CATALOG } from '../render/OperatorArmIK.js';
import { buildProceduralCS2Weapon } from '../render/ProceduralWeaponBuilder.js';

async function loadStrippedGlb(relPath: string, opts: Parameters<typeof AssetManager.normalizeGLB>[2]) {
  const fullPath = fileURLToPath(new URL(`../../public/models/${relPath}`, import.meta.url));
  const io = new NodeIO();
  const doc = await io.read(fullPath);
  for (const tex of doc.getRoot().listTextures()) tex.dispose();
  const bin = await io.writeBinary(doc);

  const loader = new GLTFLoader();
  const gltf: any = await new Promise((res, rej) =>
    loader.parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), '', res, rej)
  );
  const wrapper = new THREE.Group();
  wrapper.add(gltf.scene);
  AssetManager.normalizeGLB(wrapper, gltf.scene, opts);
  return wrapper;
}

function createArmIKForAgent(agentWrapper: THREE.Object3D): {
  root: THREE.Group;
  ik: OperatorArmIK;
  handL: THREE.Object3D;
  handR: THREE.Object3D;
} {
  const root = new THREE.Group();
  root.add(agentWrapper);
  root.updateMatrixWorld(true);

  let spine2: THREE.Object3D | undefined;
  let armUpperL: THREE.Object3D | undefined;
  let armLowerL: THREE.Object3D | undefined;
  let handL: THREE.Object3D | undefined;
  let armUpperR: THREE.Object3D | undefined;
  let armLowerR: THREE.Object3D | undefined;
  let handR: THREE.Object3D | undefined;
  const armLowerTwistL: THREE.Object3D[] = [];
  const armLowerTwistR: THREE.Object3D[] = [];

  agentWrapper.traverse((n) => {
    const name = n.name.toLowerCase();
    if (name.includes('helper')) return;
    if (name.includes('twist')) {
      if (name.startsWith('arm_lower_l_twist')) armLowerTwistL.push(n);
      else if (name.startsWith('arm_lower_r_twist')) armLowerTwistR.push(n);
      return;
    }
    if (name.startsWith('spine_2')) spine2 = n;
    else if (name.startsWith('arm_upper_l')) armUpperL = n;
    else if (name.startsWith('arm_lower_l')) armLowerL = n;
    else if (name.startsWith('hand_l')) handL = n;
    else if (name.startsWith('arm_upper_r')) armUpperR = n;
    else if (name.startsWith('arm_lower_r')) armLowerR = n;
    else if (name.startsWith('hand_r')) handR = n;
  });

  expect(spine2, 'spine_2 bone must exist').toBeDefined();
  expect(armUpperR && armLowerR && handR, 'right arm bones must exist').toBeTruthy();
  expect(armUpperL && armLowerL && handL, 'left arm bones must exist').toBeTruthy();

  const ik = new OperatorArmIK({
    root,
    spineAnchor: spine2!,
    armUpperL,
    armLowerL,
    handL,
    armUpperR,
    armLowerR,
    handR,
    armLowerTwistL,
    armLowerTwistR,
    fingersL: [],
    fingersR: [],
  });

  return { root, ik, handL: handL!, handR: handR! };
}

describe('3P OperatorRig & OperatorArmIK (Vanguard + Syndicate)', () => {
  it('points real GLB & procedural weapons forward (dot >= 0.985) and locks BOTH hands <= 0.02m onto grip sockets on BOTH operators', async () => {
    const agentFiles = ['operator_vanguard.glb', 'operator_syndicate.glb'] as const;
    const weaponFixtures: Array<{ id: string; glb?: string }> = [
      { id: 'vanguard-m4', glb: 'm4a1s.glb' },
      { id: 'garam-47', glb: 'garam47.glb' },
      { id: 'sovereign-awp', glb: 'awp.glb' },
      { id: 'desert-eagle', glb: 'deagle.glb' },
      { id: 'm4a4' },
      { id: 'usp-s' },
      { id: 'glock-18' },
      { id: 'mp9' },
    ];

    for (const agentFile of agentFiles) {
      const agent = await loadStrippedGlb(agentFile, { targetHeight: 1.82, centerAtFeet: true });
      const { root, ik, handL, handR } = createArmIKForAgent(agent);

      // Test at arbitrary world yaw (e.g. rotated 1.15 rad) to prove yaw invariance
      root.rotation.y = 1.15;
      root.position.set(4.5, 1.4, -3.2);
      root.updateMatrixWorld(true);

      const expectedForward = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(root.quaternion)
        .normalize();

      for (const wp of weaponFixtures) {
        const spec = WORLD_WEAPON_CATALOG[wp.id];
        const weaponObj = wp.glb
          ? await loadStrippedGlb(wp.glb, {
              targetLength: spec.targetLength,
              anchorBoneName: 'weapon_hand_r',
              centerPivot: false,
            })
          : buildProceduralCS2Weapon(wp.id);

        ik.attachWeaponObject(weaponObj, wp.id);
        const { rightGap, leftGap } = ik.solve({
          aimPitch: 0,
          sprintBlend: 0,
          recoilKick: 0,
          reloadBlend: 0,
          crouchBlend: 0,
          lodLevel: 0,
        });

        const barrelDir = ik.getWorldBarrelDirection();
        const alignment = barrelDir.dot(expectedForward);

        expect(
          alignment,
          `${agentFile} holding ${wp.id}: barrel must point forward (dot=${alignment.toFixed(4)})`
        ).toBeGreaterThanOrEqual(0.985);

        // Verify muzzle sits strictly IN FRONT of the operator's chest (never backwards through torso!)
        const muzzleW = ik.muzzleAnchor.getWorldPosition(new THREE.Vector3());
        const rootW = root.getWorldPosition(new THREE.Vector3());
        const forwardDist = muzzleW.clone().sub(rootW).dot(expectedForward);
        expect(
          forwardDist,
          `${agentFile} holding ${wp.id}: muzzle must be in front of chest (${forwardDist.toFixed(3)}m)`
        ).toBeGreaterThan(0.45);

        // Verify BOTH right trigger hand and left support hand sit within <= 0.02m of grip sockets
        const gripRW = ik.gripRSocket.getWorldPosition(new THREE.Vector3());
        const gripLW = ik.gripLSocket.getWorldPosition(new THREE.Vector3());
        const handRW = handR.getWorldPosition(new THREE.Vector3());
        const handLW = handL.getWorldPosition(new THREE.Vector3());

        expect(rightGap, `${agentFile} ${wp.id} right IK gap`).toBeLessThanOrEqual(0.02);
        expect(leftGap, `${agentFile} ${wp.id} left IK gap`).toBeLessThanOrEqual(0.02);
        expect(handRW.distanceTo(gripRW), `${agentFile} ${wp.id} hand_r -> grip_r`).toBeLessThanOrEqual(0.02);
        expect(handLW.distanceTo(gripLW), `${agentFile} ${wp.id} hand_l -> grip_l`).toBeLessThanOrEqual(0.02);
      }
    }
  });
});
