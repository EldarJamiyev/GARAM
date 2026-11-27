import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ArmIKSolver } from './src/viewmodel/ArmIKSolver.js';
import { WEAPON_SOCKET_CONFIGS, buildCS2AnimationClips, captureBindPose } from './src/viewmodel/ViewmodelRig.js';
import { applyCS2PhysicalFingerGrip, initCS2FingerRestRig } from './src/viewmodel/WeaponViewmodel.js';

function loadGlb(p: string) {
  const buf = fs.readFileSync(p);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise<any>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

const armsGltf = await loadGlb('../../public/models/cs2_fps_arms.glb');
const karaGltf = await loadGlb('../../public/models/karambit.glb');

const km = karaGltf.scene;
km.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(km);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
const s = 0.22 / Math.max(size.x, size.y, size.z);
const kmNorm = new THREE.Group();
km.position.copy(center).multiplyScalar(-s);
km.scale.setScalar(s);
kmNorm.add(km);
kmNorm.updateMatrixWorld(true);
const boxN = new THREE.Box3().setFromObject(kmNorm);
console.log('Karambit norm box min:', boxN.min.toArray().map((n:number)=>+n.toFixed(4)), 'max:', boxN.max.toArray().map((n:number)=>+n.toFixed(4)));

const ringVerts: THREE.Vector3[] = [];
kmNorm.traverse((c: any) => {
  if (c.isMesh) {
    const pos = c.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld);
      if (v.z > 0.068) ringVerts.push(v.clone());
    }
  }
});
const ringCentroid = ringVerts.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, ringVerts.length));
console.log('Karambit ringCentroid:', ringCentroid.toArray().map((n:number)=>+n.toFixed(4)));

const cfg = WEAPON_SOCKET_CONFIGS['garam-karambit'];
const root = clone(armsGltf.scene);
const snap = captureBindPose(root);
initCS2FingerRestRig(root, snap);
const meshRoot = new THREE.Group();
const container = new THREE.Group();
container.position.set(...cfg.armsOffset);
container.scale.setScalar(cfg.armsScale);
container.rotation.y = Math.PI;
container.add(root);
meshRoot.add(container);

const clips = buildCS2AnimationClips(armsGltf.animations);
const idle = clips.find(c => c.name === 'CS2_Idle')!;
const mixer = new THREE.AnimationMixer(root);
mixer.clipAction(idle).play();
mixer.update(0.05);
meshRoot.updateMatrixWorld(true);

const handR = root.getObjectByName('DEF-handR_357')!;
const wHandR = root.getObjectByName('weapon_hand_r_5')!;
const solver = new ArmIKSolver(root);

const handRQuat0 = handR.getWorldQuaternion(new THREE.Quaternion());
solver.solveCS2RightHandToTarget(new THREE.Vector3(0.104, -0.097, -0.232), new THREE.Vector3(0.28, -0.48, -0.02));
handR.parent!.updateWorldMatrix(true, false);
const pQ = handR.parent!.getWorldQuaternion(new THREE.Quaternion());
handR.quaternion.copy(pQ).invert().multiply(handRQuat0);
handR.updateMatrixWorld(true);
applyCS2PhysicalFingerGrip(root, 'karambit', snap);
meshRoot.updateMatrixWorld(true);

const hRw = handR.getWorldPosition(new THREE.Vector3());
const idx01 = root.getObjectByName('DEF-f_index01R_271')!.getWorldPosition(new THREE.Vector3());
const idx02 = root.getObjectByName('DEF-f_index02R_272')!.getWorldPosition(new THREE.Vector3());
const mid01 = root.getObjectByName('DEF-f_middle01R_304')!.getWorldPosition(new THREE.Vector3());
const rng01 = root.getObjectByName('DEF-f_ring01R_323')!.getWorldPosition(new THREE.Vector3());
const pnk01 = root.getObjectByName('DEF-f_pinky01R_342')!.getWorldPosition(new THREE.Vector3());
const thm02 = root.getObjectByName('DEF-thumb02R_266')!.getWorldPosition(new THREE.Vector3());

console.log('handR world:', hRw.toArray().map(n=>+n.toFixed(4)));
console.log('idx01 world:', idx01.toArray().map(n=>+n.toFixed(4)), 'dist:', idx01.distanceTo(hRw).toFixed(4));
console.log('idx02 world:', idx02.toArray().map(n=>+n.toFixed(4)), 'dist:', idx02.distanceTo(hRw).toFixed(4));
console.log('mid01 world:', mid01.toArray().map(n=>+n.toFixed(4)));
console.log('rng01 world:', rng01.toArray().map(n=>+n.toFixed(4)));
console.log('pnk01 world:', pnk01.toArray().map(n=>+n.toFixed(4)));
console.log('thm02 world:', thm02.toArray().map(n=>+n.toFixed(4)));
console.log('handR worldScale:', handR.getWorldScale(new THREE.Vector3()).toArray().map(n=>+n.toFixed(4)));

const oldHolder = new THREE.Group();
oldHolder.position.set(...cfg.localPos);
oldHolder.rotation.set(...cfg.localRotEuler);
oldHolder.scale.setScalar(cfg.localScale);
wHandR.add(oldHolder);
meshRoot.updateMatrixWorld(true);
const oldRingWorld = new THREE.Vector3(...cfg.ringPivotLocal!).applyMatrix4(oldHolder.matrixWorld);
const oldTipWorld = new THREE.Vector3(...cfg.muzzleLocalPos).applyMatrix4(oldHolder.matrixWorld);
console.log('CURRENT idle ring world:', oldRingWorld.toArray().map(n=>+n.toFixed(4)), 'dist to handR:', oldRingWorld.distanceTo(hRw).toFixed(4));
console.log('CURRENT idle tip world:', oldTipWorld.toArray().map(n=>+n.toFixed(4)));

const relMat = handR.matrixWorld.clone().invert().multiply(oldHolder.matrixWorld);
const rp = new THREE.Vector3(), rq = new THREE.Quaternion(), rs = new THREE.Vector3();
relMat.decompose(rp, rq, rs);
const re = new THREE.Euler().setFromQuaternion(rq, 'XYZ');
console.log('Current pose in handR local -> pos:', rp.toArray().map(n=>+n.toFixed(4)), 'rot:', [re.x, re.y, re.z].map(n=>+n.toFixed(4)), 'scale:', rs.toArray().map(n=>+n.toFixed(4)));
