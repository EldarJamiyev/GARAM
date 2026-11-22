global.self = global;
const fs = require('fs');
const path = require('path');
const THREE = require('three');

// Import ViewmodelRig configs & ArmIKSolver
const { WEAPON_SOCKET_CONFIGS, buildKarambitAnimationClips, patchM4IdleClip, resolveWeaponClipName } = require('../packages/client/dist/assets/garam-shared-D_ROkbfB.js') || {};

async function main() {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();

  function loadGLB(relPath) {
    const fullPath = path.resolve(__dirname, '../packages/client/public', relPath);
    const buf = fs.readFileSync(fullPath);
    return new Promise((resolve, reject) => {
      loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
    });
  }

  // Load configs directly from ViewmodelRig.ts source if needed
  const cfgRaw = fs.readFileSync(path.resolve(__dirname, '../packages/client/src/viewmodel/ViewmodelRig.ts'), 'utf8');
  
  // Dynamic import of ArmIKSolver
  // We can load ts-node or compile on the fly, or load the built bundle
  const armsGltf = await loadGLB('models/fps_arms_tactical.glb');

  const weaponFiles = {
    'garam-47': 'models/garam47.glb',
    'vanguard-m4': 'models/m4a1s.glb',
    'sovereign-awp': 'models/awp.glb',
    'desert-eagle': 'models/deagle.glb',
    'garam-karambit': 'models/karambit.glb',
  };

  const loadedWeapons = {};
  for (const [id, f] of Object.entries(weaponFiles)) {
    loadedWeapons[id] = await loadGLB(f);
  }

  const cam = new THREE.PerspectiveCamera(62, 1440 / 900, 0.005, 50);
  cam.updateProjectionMatrix();

  // Test with exact socket configs
  const socketConfigs = {
    'garam-47': {
      socketBone: 'Rif',
      armsScale: 0.38,
      armsOffset: [0.065, -0.21, -0.32],
      leftHandAnchorLocal: [0.000, -0.018, -0.235],
      clip: 'AK_Idle',
    },
    'vanguard-m4': {
      socketBone: 'Rif',
      armsScale: 0.38,
      armsOffset: [0.065, -0.21, -0.32],
      leftHandAnchorLocal: [0.002, 0.032, -0.245],
      clip: 'M4_Idle',
    },
    'sovereign-awp': {
      socketBone: 'Rif',
      armsScale: 0.38,
      armsOffset: [0.065, -0.21, -0.32],
      leftHandAnchorLocal: [0.000, 0.022, -0.255],
      clip: 'SRifle_Idle',
    },
    'desert-eagle': {
      socketBone: 'Rif',
      armsScale: 0.40,
      armsOffset: [0.045, -0.19, -0.32],
      leftHandAnchorLocal: [-0.014, -0.018, 0.002],
      clip: 'Pistol_Idle',
    },
    'garam-karambit': {
      socketBone: 'Hand_R',
      armsScale: 0.40,
      armsOffset: [0.040, -0.18, -0.28],
      leftHandAnchorLocal: undefined,
      clip: 'Karambit_Idle',
    },
  };

  console.log('\n======================================================');
  console.log('SKINNED VERTEX CAMERA-SPACE ANALYSIS');
  console.log('======================================================');

  // Skinned mesh evaluation helper
  function evaluateSkinnedVertices(mesh, camera) {
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    const skinIndexAttr = geo.attributes.skinIndex;
    const skinWeightAttr = geo.attributes.skinWeight;
    const skeleton = mesh.skeleton;
    skeleton.update();

    const boneMatrices = skeleton.boneMatrices; // Float32Array
    const vertex = new THREE.Vector3();
    const skinned = new THREE.Vector3();
    const temp = new THREE.Vector3();

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    let countZCloserThan10cm = 0;
    let pixelsInViewport = 0;

    // Grid of 1440x900 buckets for pixel coverage estimate
    const gridW = 144;
    const gridH = 90;
    const covered = new Uint8Array(gridW * gridH);

    const camMatrixInverse = camera.matrixWorldInverse;

    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);

      const i4 = i * 4;
      const si0 = skinIndexAttr.getX(i);
      const si1 = skinIndexAttr.getY(i);
      const si2 = skinIndexAttr.getZ(i);
      const si3 = skinIndexAttr.getW(i);

      const sw0 = skinWeightAttr.getX(i);
      const sw1 = skinWeightAttr.getY(i);
      const sw2 = skinWeightAttr.getZ(i);
      const sw3 = skinWeightAttr.getW(i);

      skinned.set(0, 0, 0);

      // Bone matrix transform
      const addBoneTransform = (boneIdx, weight) => {
        if (weight <= 0) return;
        const offset = boneIdx * 16;
        const m = boneMatrices;
        // m is a 4x4 matrix
        temp.x = m[offset + 0] * vertex.x + m[offset + 4] * vertex.y + m[offset + 8] * vertex.z + m[offset + 12];
        temp.y = m[offset + 1] * vertex.x + m[offset + 5] * vertex.y + m[offset + 9] * vertex.z + m[offset + 13];
        temp.z = m[offset + 2] * vertex.x + m[offset + 6] * vertex.y + m[offset + 10] * vertex.z + m[offset + 14];
        skinned.addScaledVector(temp, weight);
      };

      addBoneTransform(si0, sw0);
      addBoneTransform(si1, sw1);
      addBoneTransform(si2, sw2);
      addBoneTransform(si3, sw3);

      // Now skinned is in bind-root space, transform by mesh.matrixWorld
      skinned.applyMatrix4(mesh.matrixWorld);

      // Transform to camera space
      const camP = skinned.clone().applyMatrix4(camMatrixInverse);

      minX = Math.min(minX, camP.x);
      maxX = Math.max(maxX, camP.x);
      minY = Math.min(minY, camP.y);
      maxY = Math.max(maxY, camP.y);
      minZ = Math.min(minZ, camP.z);
      maxZ = Math.max(maxZ, camP.z);

      if (camP.z > -0.10) {
        countZCloserThan10cm++;
      }

      // Project to NDC
      const ndc = skinned.clone().project(camera);
      if (ndc.z >= 0 && ndc.z <= 1 && ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1) {
        const gx = Math.floor((ndc.x + 1) * 0.5 * (gridW - 1));
        const gy = Math.floor((1 - (ndc.y + 1) * 0.5) * (gridH - 1));
        if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
          covered[gy * gridW + gx] = 1;
        }
      }
    }

    let coveredCount = 0;
    for (let j = 0; j < covered.length; j++) if (covered[j]) coveredCount++;
    const coveragePct = (coveredCount / (gridW * gridH)) * 100;

    return {
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
      countZCloserThan10cm,
      coveragePct,
    };
  }

  for (const [weaponId, sc] of Object.entries(socketConfigs)) {
    console.log(`\n--- Weapon: ${weaponId} (${sc.clip}) ---`);
    const root = armsGltf.scene.clone(true);
    let sm = null;
    root.traverse(c => { if (c.isSkinnedMesh) sm = c; });

    const armsContainer = new THREE.Group();
    armsContainer.position.set(...sc.armsOffset);
    armsContainer.scale.setScalar(sc.armsScale);
    armsContainer.rotation.y = Math.PI;
    armsContainer.add(root);

    const mixer = new THREE.AnimationMixer(root);
    const clip = armsGltf.animations.find(a => a.name === sc.clip) || armsGltf.animations[0];
    mixer.clipAction(clip).play();
    mixer.update(0.01);

    armsContainer.updateMatrixWorld(true);

    const stats = evaluateSkinnedVertices(sm, cam);
    console.log(`  Camera Space Bounds: X=[${stats.bounds.minX.toFixed(3)}, ${stats.bounds.maxX.toFixed(3)}] Y=[${stats.bounds.minY.toFixed(3)}, ${stats.bounds.maxY.toFixed(3)}] Z=[${stats.bounds.minZ.toFixed(3)}, ${stats.bounds.maxZ.toFixed(3)}]`);
    console.log(`  Vertices with camZ > -0.10m: ${stats.countZCloserThan10cm}`);
    console.log(`  Estimated Screen Coverage: ${stats.coveragePct.toFixed(1)}%`);

    // Check landmark bones
    const getBoneInfo = (name) => {
      const b = root.getObjectByName(name);
      if (!b) return 'MISSING';
      const w = b.getWorldPosition(new THREE.Vector3());
      const ndc = w.clone().project(cam);
      return `world=(${w.x.toFixed(3)}, ${w.y.toFixed(3)}, ${w.z.toFixed(3)}) ndc=(${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`;
    };

    console.log(`  UpArm_L:    ${getBoneInfo('UpArm_L')}`);
    console.log(`  Forearm_L:  ${getBoneInfo('Forearm_L')}`);
    console.log(`  Hand_L:     ${getBoneInfo('Hand_L')}`);
    console.log(`  UpArm_R:    ${getBoneInfo('UpArm_R')}`);
    console.log(`  Forearm_R:  ${getBoneInfo('Forearm_R')}`);
    console.log(`  Hand_R:     ${getBoneInfo('Hand_R')}`);
  }
}

main().catch(console.error);
