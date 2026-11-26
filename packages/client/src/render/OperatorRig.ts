import * as THREE from 'three';
import { settingsStore } from '../core/SettingsStore.js';
import { AssetManager } from './AssetManager.js';
import { OperatorArmIK, WORLD_WEAPON_CATALOG } from './OperatorArmIK.js';

const _headWorld = new THREE.Vector3();
const _chestWorld = new THREE.Vector3();
const _stomWorld = new THREE.Vector3();
const _qDelta = new THREE.Quaternion();
const _euler = new THREE.Euler();

export interface OperatorVisualState {
  isMoving: boolean;
  speed: number;
  isDead: boolean;
  healthRatio: number; // 0 to 1
  team: 'Vanguard' | 'Syndicate';
  name: string;
  isCrouching?: boolean;
  isReloading?: boolean;
  pitch?: number;
  yawOffset?: number;
  velocity?: { x: number; z: number };
  /** Distance from active camera in meters for 3-tier OperatorRig LOD */
  cameraDistance?: number;
}

interface SkeletalBoneBinding {
  bone: THREE.Object3D;
  baseQuat: THREE.Quaternion;
  parentRestQuat: THREE.Quaternion;
  invParentRestQuat: THREE.Quaternion;
  basePos: THREE.Vector3;
}

interface OperatorSkeletonRig {
  root: THREE.Object3D;
  baseRootY: number;
  pelvis?: SkeletalBoneBinding;
  spine0?: SkeletalBoneBinding;
  spine1?: SkeletalBoneBinding;
  spine2?: SkeletalBoneBinding;
  neck?: SkeletalBoneBinding;
  head?: SkeletalBoneBinding;
  legUpperL?: SkeletalBoneBinding;
  legLowerL?: SkeletalBoneBinding;
  legUpperR?: SkeletalBoneBinding;
  legLowerR?: SkeletalBoneBinding;
  armIK: OperatorArmIK;
}

// Shared Geometries across fallback procedural rigs (zero duplicate GPU buffer allocations)
const geoSpine = new THREE.BoxGeometry(0.38, 0.45, 0.26);
const geoVest = new THREE.BoxGeometry(0.44, 0.48, 0.32);
const geoPouch = new THREE.BoxGeometry(0.09, 0.16, 0.08);
const geoPad = new THREE.BoxGeometry(0.12, 0.14, 0.18);
const geoThigh = new THREE.BoxGeometry(0.14, 0.44, 0.16);
const geoBoot = new THREE.BoxGeometry(0.15, 0.42, 0.22);
const geoHeadBase = new THREE.SphereGeometry(0.16, 12, 12);
const geoHelmet = new THREE.SphereGeometry(0.18, 12, 12);
const geoNvgMount = new THREE.BoxGeometry(0.08, 0.08, 0.06);
const geoVisor = new THREE.BoxGeometry(0.24, 0.07, 0.12);
const geoArm = new THREE.CylinderGeometry(0.05, 0.06, 0.38, 8);
geoArm.rotateX(Math.PI / 4);

const geoReceiver = new THREE.BoxGeometry(0.06, 0.09, 0.42);
const geoBarrel = new THREE.CylinderGeometry(0.015, 0.015, 0.38, 8);
geoBarrel.rotateX(Math.PI / 2);
const geoMag = new THREE.BoxGeometry(0.045, 0.14, 0.09);

const geoHeadCollider = new THREE.SphereGeometry(0.22, 6, 6);
const geoBodyCollider = new THREE.CylinderGeometry(0.36, 0.36, 1.25, 6);
const matInvisibleCollider = new THREE.MeshBasicMaterial({ visible: false });

const geoShadow = new THREE.PlaneGeometry(1.05, 1.05);
geoShadow.rotateX(-Math.PI / 2);

let sharedShadowTexture: THREE.CanvasTexture | null = null;
function getSharedShadowTexture(): THREE.CanvasTexture {
  if (!sharedShadowTexture) {
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d')!;
    const sGrad = sCtx.createRadialGradient(64, 64, 4, 64, 64, 64);
    sGrad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    sGrad.addColorStop(0.45, 'rgba(0, 0, 0, 0.38)');
    sGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 128, 128);
    sharedShadowTexture = new THREE.CanvasTexture(shadowCanvas);
    sharedShadowTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return sharedShadowTexture;
}

let sharedBotFlashTexture: THREE.CanvasTexture | null = null;
function getSharedBotFlashTexture(): THREE.CanvasTexture {
  if (!sharedBotFlashTexture) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0.0, 'rgba(255, 255, 240, 1.0)');
    g.addColorStop(0.3, 'rgba(255, 206, 96, 0.88)');
    g.addColorStop(0.68, 'rgba(255, 110, 20, 0.35)');
    g.addColorStop(1.0, 'rgba(255, 60, 0, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    sharedBotFlashTexture = new THREE.CanvasTexture(c);
    sharedBotFlashTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return sharedBotFlashTexture;
}
const geoBotFlashPlane = new THREE.PlaneGeometry(0.36, 0.36);

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export class OperatorRig {
  public root: THREE.Group;
  public headCollider: THREE.Mesh;
  public bodyCollider: THREE.Mesh;
  private wireframeGroup: THREE.Group;

  // Procedural Fallback Group & Limbs
  private proceduralGroup: THREE.Group;
  private leftLeg: THREE.Group;
  private rightLeg: THREE.Group;
  private torso: THREE.Group;
  private head: THREE.Group;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private weaponMesh: THREE.Group;
  private contactShadow: THREE.Mesh;

  // High-Fidelity CS2 GLB Operator Rig & Spine-Anchored Dual-Arm IK
  private glbRig: OperatorSkeletonRig | null = null;
  private currentWorldWeaponId = 'garam-47';
  private worldMuzzleFlash: THREE.Group | null = null;
  private muzzleFlashTimer = 0;
  private fireRecoilTimer = 0;
  private isDisposed = false;

  // UI Billboard
  private uiBillboard: THREE.Sprite;
  private uiCanvas: HTMLCanvasElement;
  private uiCtx: CanvasRenderingContext2D;
  private uiTexture: THREE.CanvasTexture;
  private lastBillboardKey = '';
  private ownedMaterials: THREE.Material[] = [];
  private ownedGeometries: THREE.BufferGeometry[] = [];

  // Natural Locomotion & Combat State Blends
  private walkCycle = Math.random() * Math.PI * 2;
  private crouchBlend = 0;
  private sprintBlend = 0;
  private reloadBlend = 0;
  private leanForward = 0;
  private leanLateral = 0;
  private upperBodyYaw = 0;
  private flinchTimer = 0;
  private flinchDir = 1;
  private deathProgress = 0;
  private deathKnockback = new THREE.Vector3();
  private deathStartY = 0;
  private lodTickCounter = 0;

  constructor(team: 'Vanguard' | 'Syndicate', name: string, skipAsyncLoad = false) {
    this.root = new THREE.Group();
    this.root.userData.isOperatorRig = true;
    this.proceduralGroup = new THREE.Group();
    this.root.add(this.proceduralGroup);

    const isVanguard = team === 'Vanguard';
    const suitColor = isVanguard ? 0x1b2026 : 0x3d352b;
    const vestColor = isVanguard ? 0x0f1317 : 0x24201a;
    const accentColor = isVanguard ? 0x3b9eff : 0xffaa00;
    const visorGlow = isVanguard ? 0xd91438 : 0xffaa00;

    // 1. Procedural Fallback Torso & Ballistic Vest
    this.torso = new THREE.Group();
    this.torso.position.y = 0.88;

    const jacketMat = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.72, metalness: 0.15 });
    const vestMat = new THREE.MeshStandardMaterial({ color: vestColor, roughness: 0.65, metalness: 0.25 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4, metalness: 0.4 });

    const spine = new THREE.Mesh(geoSpine, jacketMat);
    spine.position.y = 0.22;
    this.torso.add(spine);

    const vest = new THREE.Mesh(geoVest, vestMat);
    vest.position.set(0, 0.28, 0.01);
    this.torso.add(vest);

    for (let i = -1; i <= 1; i++) {
      const pouch = new THREE.Mesh(geoPouch, accentMat);
      pouch.position.set(i * 0.11, 0.22, 0.18);
      this.torso.add(pouch);
    }

    const leftPad = new THREE.Mesh(geoPad, accentMat);
    leftPad.position.set(-0.26, 0.42, 0);
    this.torso.add(leftPad);

    const rightPad = new THREE.Mesh(geoPad, accentMat);
    rightPad.position.set(0.26, 0.42, 0);
    this.torso.add(rightPad);
    this.proceduralGroup.add(this.torso);

    // 2. Procedural Fallback Legs
    this.leftLeg = this.buildLeg(suitColor, vestColor);
    this.leftLeg.position.set(-0.13, 0.85, 0);
    this.proceduralGroup.add(this.leftLeg);

    this.rightLeg = this.buildLeg(suitColor, vestColor);
    this.rightLeg.position.set(0.13, 0.85, 0);
    this.proceduralGroup.add(this.rightLeg);

    // 3. Procedural Fallback Head
    this.head = new THREE.Group();
    this.head.position.y = 1.45;

    const headMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });
    const headBase = new THREE.Mesh(geoHeadBase, headMat);
    headBase.position.y = 0.16;
    this.head.add(headBase);

    const helmetMat = new THREE.MeshStandardMaterial({ color: vestColor, roughness: 0.5, metalness: 0.35 });
    const helmet = new THREE.Mesh(geoHelmet, helmetMat);
    helmet.position.set(0, 0.20, -0.01);
    this.head.add(helmet);

    const nvgMount = new THREE.Mesh(geoNvgMount, accentMat);
    nvgMount.position.set(0, 0.24, 0.17);
    this.head.add(nvgMount);

    const visorMat = new THREE.MeshStandardMaterial({
      color: visorGlow,
      emissive: visorGlow,
      emissiveIntensity: 0.65,
      roughness: 0.1,
      metalness: 0.9,
    });
    const visor = new THREE.Mesh(geoVisor, visorMat);
    visor.position.set(0, 0.16, 0.13);
    visor.castShadow = false;
    this.head.add(visor);
    this.proceduralGroup.add(this.head);

    // 4. Procedural Fallback Arms & Rifle
    this.rightArm = new THREE.Group();
    this.rightArm.position.set(-0.24, 1.34, 0);
    this.rightArm.add(new THREE.Mesh(geoArm, jacketMat));
    this.proceduralGroup.add(this.rightArm);

    this.leftArm = new THREE.Group();
    this.leftArm.position.set(0.24, 1.34, 0);
    const leftArmMesh = new THREE.Mesh(geoArm, jacketMat);
    leftArmMesh.rotation.y = 0.3;
    leftArmMesh.position.set(-0.12, -0.06, 0.22);
    this.leftArm.add(leftArmMesh);
    this.proceduralGroup.add(this.leftArm);

    this.weaponMesh = this.buildRifleMesh(accentColor);
    this.weaponMesh.position.set(-0.14, 1.18, 0.34);
    this.proceduralGroup.add(this.weaponMesh);

    // 5. Invisible Hitbox Colliders for RaycastEngine
    this.headCollider = new THREE.Mesh(geoHeadCollider, matInvisibleCollider);
    this.headCollider.position.set(0, 1.66, 0);
    this.headCollider.castShadow = false;
    this.root.add(this.headCollider);

    this.bodyCollider = new THREE.Mesh(geoBodyCollider, matInvisibleCollider);
    this.bodyCollider.position.set(0, 0.95, 0);
    this.bodyCollider.castShadow = false;
    this.root.add(this.bodyCollider);

    // 6. Grounded Contact Shadow Disc
    const shadowMat = new THREE.MeshBasicMaterial({
      map: getSharedShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.42,
    });
    this.contactShadow = new THREE.Mesh(geoShadow, shadowMat);
    this.contactShadow.position.y = 0.015;
    this.contactShadow.castShadow = false;
    this.contactShadow.receiveShadow = false;
    this.root.add(this.contactShadow);

    // 7. Hitbox Wireframe Debug Overlays ([F2] Sandbox)
    this.wireframeGroup = new THREE.Group();
    this.wireframeGroup.visible = false;
    const wfMatHead = new THREE.MeshBasicMaterial({ color: 0xff0044, wireframe: true });
    const wfMatBody = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
    const wfHead = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 8), wfMatHead);
    wfHead.position.set(0, 1.66, 0);
    this.wireframeGroup.add(wfHead);

    const wfChest = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.32, 8), wfMatBody);
    wfChest.position.set(0, 1.34, 0);
    this.wireframeGroup.add(wfChest);

    const wfStomach = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.30, 8), wfMatBody);
    wfStomach.position.set(0, 1.03, 0);
    this.wireframeGroup.add(wfStomach);

    const wfLegs = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.88, 8), wfMatBody);
    wfLegs.position.set(0, 0.44, 0);
    this.wireframeGroup.add(wfLegs);
    this.root.add(this.wireframeGroup);

    // 8. Overhead Tactical Health & Nameplate Billboard
    this.uiCanvas = document.createElement('canvas');
    this.uiCanvas.width = 256;
    this.uiCanvas.height = 80;
    this.uiCtx = this.uiCanvas.getContext('2d')!;
    this.uiTexture = new THREE.CanvasTexture(this.uiCanvas);
    this.uiTexture.colorSpace = THREE.SRGBColorSpace;

    const spriteMat = new THREE.SpriteMaterial({
      map: this.uiTexture,
      transparent: true,
      depthTest: true,
    });
    this.uiBillboard = new THREE.Sprite(spriteMat);
    this.uiBillboard.position.set(0, 2.15, 0);
    this.uiBillboard.scale.set(1.25 * 0.85, 0.36 * 0.85, 1);
    this.uiBillboard.castShadow = false;
    this.root.add(this.uiBillboard);

    this.ownedMaterials.push(
      jacketMat, vestMat, accentMat, headMat, helmetMat, visorMat,
      shadowMat, wfMatHead, wfMatBody, spriteMat
    );
    this.ownedGeometries.push(wfHead.geometry, wfChest.geometry, wfStomach.geometry, wfLegs.geometry);

    this.updateBillboard(1.0, team, name);

    if (!skipAsyncLoad) {
      void this.loadCharacterGLB(team);
    }
  }

  /**
   * Binds a pre-normalized operator GLB scene directly (used both at runtime and in Vitest).
   */
  public bindAgentScene(agentModel: THREE.Object3D, initialWeaponId: string): OperatorArmIK {
    agentModel.updateMatrixWorld(true);

    const bindBone = (node: THREE.Object3D): SkeletalBoneBinding => {
      const parentRestQuat = new THREE.Quaternion();
      if (node.parent) node.parent.getWorldQuaternion(parentRestQuat);
      return {
        bone: node,
        baseQuat: node.quaternion.clone(),
        parentRestQuat,
        invParentRestQuat: parentRestQuat.clone().invert(),
        basePos: node.position.clone(),
      };
    };

    let pelvis: SkeletalBoneBinding | undefined;
    let spine0: SkeletalBoneBinding | undefined;
    let spine1: SkeletalBoneBinding | undefined;
    let spine2: SkeletalBoneBinding | undefined;
    let neck: SkeletalBoneBinding | undefined;
    let head: SkeletalBoneBinding | undefined;
    let legUpperL: SkeletalBoneBinding | undefined;
    let legLowerL: SkeletalBoneBinding | undefined;
    let legUpperR: SkeletalBoneBinding | undefined;
    let legLowerR: SkeletalBoneBinding | undefined;

    let armUpperL: THREE.Object3D | undefined;
    let armLowerL: THREE.Object3D | undefined;
    let handL: THREE.Object3D | undefined;
    let armUpperR: THREE.Object3D | undefined;
    let armLowerR: THREE.Object3D | undefined;
    let handR: THREE.Object3D | undefined;
    const armLowerTwistL: THREE.Object3D[] = [];
    const armLowerTwistR: THREE.Object3D[] = [];
    const fingersL: { bone: THREE.Object3D; baseQuat: THREE.Quaternion }[] = [];
    const fingersR: { bone: THREE.Object3D; baseQuat: THREE.Quaternion }[] = [];

    agentModel.traverse((node) => {
      const n = node.name.toLowerCase();
      if (n.includes('helper')) return;
      if (n.includes('twist')) {
        if (n.startsWith('arm_lower_l_twist')) armLowerTwistL.push(node);
        else if (n.startsWith('arm_lower_r_twist')) armLowerTwistR.push(node);
        return;
      }
      if (n.startsWith('finger_') && !n.includes('meta') && !n.includes('thumb')) {
        if (n.includes('_l_')) fingersL.push({ bone: node, baseQuat: node.quaternion.clone() });
        else if (n.includes('_r_')) fingersR.push({ bone: node, baseQuat: node.quaternion.clone() });
        return;
      }
      if (n.startsWith('pelvis')) pelvis = bindBone(node);
      else if (n.startsWith('spine_0')) spine0 = bindBone(node);
      else if (n.startsWith('spine_1')) spine1 = bindBone(node);
      else if (n.startsWith('spine_2')) spine2 = bindBone(node);
      else if (n.startsWith('neck_0')) neck = bindBone(node);
      else if (n.startsWith('head_0')) head = bindBone(node);
      else if (n.startsWith('arm_upper_l')) armUpperL = node;
      else if (n.startsWith('arm_lower_l')) armLowerL = node;
      else if (n.startsWith('hand_l')) handL = node;
      else if (n.startsWith('arm_upper_r')) armUpperR = node;
      else if (n.startsWith('arm_lower_r')) armLowerR = node;
      else if (n.startsWith('hand_r')) handR = node;
      else if (n.startsWith('leg_upper_l')) legUpperL = bindBone(node);
      else if (n.startsWith('leg_lower_l')) legLowerL = bindBone(node);
      else if (n.startsWith('leg_upper_r')) legUpperR = bindBone(node);
      else if (n.startsWith('leg_lower_r')) legLowerR = bindBone(node);
    });

    const sortByLocalY = (a: THREE.Object3D, b: THREE.Object3D) => a.position.y - b.position.y;
    armLowerTwistL.sort(sortByLocalY);
    armLowerTwistR.sort(sortByLocalY);

    const spineAnchor = spine2?.bone ?? spine1?.bone ?? agentModel;
    this.proceduralGroup.visible = false;
    this.root.add(agentModel);

    const armIK = new OperatorArmIK({
      root: this.root,
      spineAnchor,
      armUpperL,
      armLowerL,
      handL,
      armUpperR,
      armLowerR,
      handR,
      armLowerTwistL,
      armLowerTwistR,
      fingersL,
      fingersR,
    });

    // Attach 3D Cross-Plane Volumetric Muzzle Flash to armIK.muzzleAnchor
    const flashMat = new THREE.MeshBasicMaterial({
      map: getSharedBotFlashTexture(),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ownedMaterials.push(flashMat);
    const flashGroup = new THREE.Group();
    const fp1 = new THREE.Mesh(geoBotFlashPlane, flashMat);
    const fp2 = new THREE.Mesh(geoBotFlashPlane, flashMat);
    fp2.rotation.y = Math.PI / 2;
    const fp3 = new THREE.Mesh(geoBotFlashPlane, flashMat);
    fp3.rotation.x = Math.PI / 2;
    flashGroup.add(fp1, fp2, fp3);
    flashGroup.visible = false;
    armIK.muzzleAnchor.add(flashGroup);
    this.worldMuzzleFlash = flashGroup;

    this.currentWorldWeaponId = initialWeaponId;
    this.glbRig = {
      root: agentModel,
      baseRootY: agentModel.position.y,
      pelvis,
      spine0,
      spine1,
      spine2,
      neck,
      head,
      legUpperL,
      legLowerL,
      legUpperR,
      legLowerR,
      armIK,
    };

    return armIK;
  }

  private async loadCharacterGLB(team: 'Vanguard' | 'Syndicate'): Promise<void> {
    const assetManager = AssetManager.getInstance();
    const modelPath =
      team === 'Vanguard' ? '/models/operator_vanguard.glb' : '/models/operator_syndicate.glb';
    const initialWeaponId = team === 'Vanguard' ? 'vanguard-m4' : 'garam-47';

    const agentModel = await assetManager.loadModel(modelPath, {
      targetHeight: 1.82,
      centerAtFeet: true,
      envMapIntensity: 1.35,
      castShadow: true,
      receiveShadow: true,
    });
    if (this.isDisposed || !agentModel) return;

    const armIK = this.bindAgentScene(agentModel, initialWeaponId);
    await armIK.loadAndAttachWeapon(initialWeaponId);
    if (this.isDisposed) return;

    this.applySkeletalPose(0, false, 0, 0, 0, 0);
  }

  public getArmIK(): OperatorArmIK | null {
    return this.glbRig?.armIK ?? null;
  }

  /**
   * Swaps the bot's visible 3P world weapon (all 9 CS2 weapons supported).
   */
  public async setWeapon(weaponId: string): Promise<void> {
    if (this.isDisposed) return;
    if (!WORLD_WEAPON_CATALOG[weaponId]) return;
    if (this.currentWorldWeaponId === weaponId && this.glbRig) return;
    this.currentWorldWeaponId = weaponId;
    if (this.glbRig) {
      await this.glbRig.armIK.loadAndAttachWeapon(weaponId);
    }
  }

  private applyCharSpaceDelta(binding: SkeletalBoneBinding | undefined, rx: number, ry: number, rz: number): void {
    if (!binding) return;
    _euler.set(rx, ry, rz, 'XYZ');
    _qDelta.setFromEuler(_euler);
    binding.bone.quaternion
      .copy(binding.invParentRestQuat)
      .multiply(_qDelta)
      .multiply(binding.parentRestQuat)
      .multiply(binding.baseQuat);
  }

  private applySkeletalPose(
    legSwing: number,
    isMoving: boolean,
    aimPitch: number,
    aimYaw: number,
    flinchOffset: number,
    lodLevel: 0 | 1 | 2
  ): void {
    const rig = this.glbRig;
    if (!rig) return;

    // 1. Velocity-driven pelvis vertical stride bounce + lateral weight shift + smooth crouch drop
    const crouchDrop = -0.34 * this.crouchBlend;
    const walkBob = isMoving
      ? Math.abs(Math.sin(this.walkCycle)) * 0.032
      : Math.sin(performance.now() * 0.0026) * 0.006;
    const latShift = isMoving ? Math.sin(this.walkCycle) * 0.022 : 0;

    rig.root.position.y = rig.baseRootY + crouchDrop + walkBob;
    rig.root.position.x = latShift;

    // 2. Spine & Head tracking (upper-body decoupled yaw up to ±45°, acceleration lean, hit flinch)
    const clampedYaw = Math.max(-0.78, Math.min(0.78, aimYaw));
    const torsoForwardLean = 0.04 + 0.16 * this.crouchBlend + this.leanForward - aimPitch * 0.20 - flinchOffset;
    this.applyCharSpaceDelta(rig.spine1, torsoForwardLean, clampedYaw * 0.42 + 0.06, this.leanLateral);
    this.applyCharSpaceDelta(rig.spine2, -aimPitch * 0.16, clampedYaw * 0.34 + 0.04, this.leanLateral * 0.5);
    this.applyCharSpaceDelta(rig.head, -aimPitch * 0.42 - flinchOffset * 0.6, clampedYaw * 0.24 - 0.08, 0);

    // 3. Spine-Anchored Weapon Mount + Dual-Arm Analytical 2-Bone IK
    const recoilKick = this.fireRecoilTimer > 0 ? Math.sin((this.fireRecoilTimer / 0.09) * Math.PI) : 0;
    rig.armIK.solve({
      aimPitch,
      sprintBlend: this.sprintBlend,
      recoilKick,
      reloadBlend: this.reloadBlend,
      crouchBlend: this.crouchBlend,
      lodLevel,
    });

    // 4. Leg Locomotion & Smooth Crouch Knee Flex
    const crouchBias = 0.56 * this.crouchBlend;
    if (isMoving) {
      const lSwing = legSwing;
      const rSwing = -legSwing;
      this.applyCharSpaceDelta(rig.legUpperL, -lSwing - crouchBias, 0, 0);
      this.applyCharSpaceDelta(rig.legLowerL, Math.max(0, lSwing) * 0.92 + crouchBias * 1.55, 0, 0);
      this.applyCharSpaceDelta(rig.legUpperR, -rSwing - crouchBias, 0, 0);
      this.applyCharSpaceDelta(rig.legLowerR, Math.max(0, rSwing) * 0.92 + crouchBias * 1.55, 0, 0);
    } else if (this.crouchBlend > 0.05) {
      this.applyCharSpaceDelta(rig.legUpperL, -0.62 * this.crouchBlend, 0.04, 0);
      this.applyCharSpaceDelta(rig.legLowerL, 1.12 * this.crouchBlend, 0, 0);
      this.applyCharSpaceDelta(rig.legUpperR, -0.48 * this.crouchBlend, -0.04, 0);
      this.applyCharSpaceDelta(rig.legLowerR, 0.92 * this.crouchBlend, 0, 0);
    } else {
      // Relaxed athletic combat stance
      this.applyCharSpaceDelta(rig.legUpperL, -0.06, 0.04, 0);
      this.applyCharSpaceDelta(rig.legLowerL, 0.10, 0, 0);
      this.applyCharSpaceDelta(rig.legUpperR, 0.05, -0.04, 0);
      this.applyCharSpaceDelta(rig.legLowerR, 0.08, 0, 0);
    }
  }

  public setWireframesVisible(visible: boolean): void {
    this.wireframeGroup.visible = visible;
  }

  public getWorldHitboxes() {
    if (this.glbRig?.head && this.glbRig?.spine2) {
      this.glbRig.head.bone.updateWorldMatrix(true, false);
      this.glbRig.spine2.bone.updateWorldMatrix(true, false);
      this.glbRig.head.bone.getWorldPosition(_headWorld);
      this.glbRig.spine2.bone.getWorldPosition(_chestWorld);
      _stomWorld.copy(_chestWorld);
      _stomWorld.y -= 0.28;
      return {
        head: { x: _headWorld.x, y: _headWorld.y + 0.06, z: _headWorld.z },
        chest: { x: _chestWorld.x, y: _chestWorld.y, z: _chestWorld.z },
        stomach: { x: _stomWorld.x, y: _stomWorld.y, z: _stomWorld.z },
      };
    }

    this.head.updateWorldMatrix(true, false);
    this.torso.updateWorldMatrix(true, false);
    this.head.getWorldPosition(_headWorld);
    this.torso.getWorldPosition(_chestWorld);
    _chestWorld.y += 0.28;
    _stomWorld.copy(_chestWorld);
    _stomWorld.y -= 0.30;

    return {
      head: { x: _headWorld.x, y: _headWorld.y + 0.16, z: _headWorld.z },
      chest: { x: _chestWorld.x, y: _chestWorld.y, z: _chestWorld.z },
      stomach: { x: _stomWorld.x, y: _stomWorld.y, z: _stomWorld.z },
    };
  }

  public dispose(): void {
    this.isDisposed = true;
    this.uiTexture.dispose();
    for (const mat of this.ownedMaterials) mat.dispose();
    for (const geo of this.ownedGeometries) geo.dispose();
    this.ownedMaterials = [];
    this.ownedGeometries = [];
    if (this.glbRig) {
      this.glbRig.armIK.dispose();
      this.root.remove(this.glbRig.root);
      this.glbRig = null;
    }
  }

  public triggerDeath(hitDir?: THREE.Vector3, isHeadshot?: boolean): void {
    this.deathStartY = this.root.position.y;
    if (hitDir) {
      this.deathKnockback.copy(hitDir).normalize().multiplyScalar(isHeadshot ? 1.6 : 1.1);
    }
  }

  private buildLeg(suitColor: number, bootColor: number): THREE.Group {
    const leg = new THREE.Group();
    const pantsMat = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.8 });
    const bootMat = new THREE.MeshStandardMaterial({ color: bootColor, roughness: 0.6, metalness: 0.2 });
    this.ownedMaterials.push(pantsMat, bootMat);

    const thigh = new THREE.Mesh(geoThigh, pantsMat);
    thigh.position.y = -0.22;
    leg.add(thigh);

    const boot = new THREE.Mesh(geoBoot, bootMat);
    boot.position.set(0, -0.62, 0.02);
    leg.add(boot);

    return leg;
  }

  private buildRifleMesh(accentColor: number): THREE.Group {
    const gun = new THREE.Group();
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.8, roughness: 0.3 });
    const accMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4 });
    this.ownedMaterials.push(gunMat, accMat);

    const receiver = new THREE.Mesh(geoReceiver, gunMat);
    gun.add(receiver);
    const barrel = new THREE.Mesh(geoBarrel, gunMat);
    barrel.position.set(0, 0.02, 0.36);
    gun.add(barrel);
    const mag = new THREE.Mesh(geoMag, accMat);
    mag.position.set(0, -0.09, 0.06);
    gun.add(mag);
    gun.scale.setScalar(0.9);
    return gun;
  }

  public triggerFlinch(directionSign = 1): void {
    this.flinchTimer = 0.14;
    this.flinchDir = directionSign;
  }

  public triggerMuzzleFlash(): void {
    this.muzzleFlashTimer = 0.055;
    this.fireRecoilTimer = 0.09;
    this.sprintBlend = 0; // Snap weapon level immediately on shot
    if (this.worldMuzzleFlash) {
      this.worldMuzzleFlash.visible = true;
      this.worldMuzzleFlash.rotation.z = Math.random() * Math.PI * 2;
      this.worldMuzzleFlash.scale.setScalar(0.85 + Math.random() * 0.45);
    }
  }

  public update(dt: number, state: OperatorVisualState): void {
    if (state.isDead) {
      if (this.deathProgress < 1.0) {
        this.deathProgress = Math.min(1.0, this.deathProgress + dt / 0.38);
        const eased = 1 - Math.pow(1 - this.deathProgress, 3);
        this.root.rotation.x = (-Math.PI / 2) * eased;
        this.root.position.y = this.deathStartY + 0.16 * (1 - eased) - 0.12 * eased;
        if (this.deathKnockback.lengthSq() > 0.01) {
          this.root.position.addScaledVector(this.deathKnockback, dt * (1 - eased) * 1.4);
        }
      }
      this.uiBillboard.visible = false;
      this.contactShadow.visible = false;
      if (this.glbRig) this.glbRig.armIK.chestWeaponMount.visible = false;
      return;
    }

    if (this.deathProgress > 0) {
      this.deathProgress = 0;
      this.root.rotation.x = 0;
      this.deathKnockback.set(0, 0, 0);
    }

    this.contactShadow.visible = true;
    if (this.glbRig) this.glbRig.armIK.chestWeaponMount.visible = true;

    // 3-Tier Distance LOD for Cross-Device High-FPS
    const camDist = state.cameraDistance ?? 10;
    const lodLevel: 0 | 1 | 2 = camDist < 18 ? 0 : camDist < 38 ? 1 : 2;
    this.lodTickCounter++;

    // Smooth locomotion & stance blends
    const isCrouching = !!state.isCrouching;
    this.crouchBlend = damp(this.crouchBlend, isCrouching ? 1 : 0, 14, dt);
    const wantsSprint = state.isMoving && state.speed > 4.2 && !isCrouching && this.fireRecoilTimer <= 0;
    this.sprintBlend = damp(this.sprintBlend, wantsSprint ? 1 : 0, 10, dt);
    this.reloadBlend = damp(this.reloadBlend, state.isReloading ? 1 : 0, 12, dt);

    const targetTorsoY = 0.88 - 0.42 * this.crouchBlend;
    const targetHeadY = 1.50 - 0.55 * this.crouchBlend;
    const targetArmY = 1.34 - 0.52 * this.crouchBlend;
    const targetWeaponY = 1.18 - 0.48 * this.crouchBlend;

    this.head.position.y = targetHeadY;
    this.rightArm.position.y = targetArmY;
    this.leftArm.position.y = targetArmY;
    this.weaponMesh.position.y = targetWeaponY;
    this.uiBillboard.position.y = 2.15 - 0.55 * this.crouchBlend;
    const scaleFactor = THREE.MathUtils.clamp(camDist * 0.085, 0.24, 1.15);
    this.uiBillboard.scale.set(1.25 * scaleFactor, 0.36 * scaleFactor, 1);
    this.headCollider.position.y = 1.66 - 0.61 * this.crouchBlend;
    this.bodyCollider.position.y = 0.95 - 0.40 * this.crouchBlend;

    let vForward = 0;
    let vStrafe = 0;
    if (state.velocity && (Math.abs(state.velocity.x) > 0.01 || Math.abs(state.velocity.z) > 0.01)) {
      const yaw = this.root.rotation.y;
      const sinY = Math.sin(yaw);
      const cosY = Math.cos(yaw);
      vForward = state.velocity.x * sinY + state.velocity.z * cosY;
      vStrafe = state.velocity.x * cosY - state.velocity.z * sinY;
    }

    this.leanForward = damp(this.leanForward, Math.max(-0.08, Math.min(0.11, vForward * 0.018)), 10, dt);
    this.leanLateral = damp(this.leanLateral, Math.max(-0.09, Math.min(0.09, -vStrafe * 0.016)), 10, dt);
    this.upperBodyYaw = damp(this.upperBodyYaw, state.yawOffset || 0, 12, dt);

    let legSwing = 0;
    if (state.isMoving && state.speed > 0.15) {
      // Velocity-driven stride cadence (~2.65 rad/m)
      this.walkCycle += dt * state.speed * 2.65;
      const strideAmp = Math.min(0.54, 0.16 + state.speed * 0.068) * (1 - 0.38 * this.crouchBlend);
      legSwing = Math.sin(this.walkCycle) * strideAmp;
      this.leftLeg.rotation.x = legSwing;
      this.rightLeg.rotation.x = -legSwing;
      this.torso.position.y = targetTorsoY + Math.abs(Math.sin(this.walkCycle)) * 0.03;
      this.root.rotation.z = this.leanLateral * 0.55;
    } else {
      this.leftLeg.rotation.x = -0.35 * this.crouchBlend;
      this.rightLeg.rotation.x = -0.35 * this.crouchBlend;
      this.torso.position.y = targetTorsoY + Math.sin(performance.now() * 0.003) * 0.01;
      this.root.rotation.z = damp(this.root.rotation.z, 0, 12, dt);
    }

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0 && this.worldMuzzleFlash) {
        this.worldMuzzleFlash.visible = false;
      }
    }
    if (this.fireRecoilTimer > 0) {
      this.fireRecoilTimer = Math.max(0, this.fireRecoilTimer - dt);
    }

    const aimPitch = state.pitch || 0;
    let flinchOffset = 0;
    if (this.flinchTimer > 0) {
      this.flinchTimer = Math.max(0, this.flinchTimer - dt);
      flinchOffset = -0.18 * (this.flinchTimer / 0.14) * this.flinchDir;
    }

    if (this.glbRig) {
      // LOD1 skips every odd non-firing frame for 2x distant-bot CPU savings
      if (lodLevel === 0 || this.fireRecoilTimer > 0 || (this.lodTickCounter & 1) === 0) {
        this.applySkeletalPose(legSwing, state.isMoving && state.speed > 0.15, aimPitch, this.upperBodyYaw, flinchOffset, lodLevel);
      }
    } else {
      this.torso.rotation.x = 0.12 * this.crouchBlend + aimPitch * 0.35 + flinchOffset;
      this.head.rotation.x = aimPitch * 0.45 + flinchOffset * 1.2;
      this.head.rotation.y = this.upperBodyYaw * 0.50;
      this.rightArm.rotation.x = aimPitch * 0.45;
      this.leftArm.rotation.x = aimPitch * 0.45;
      this.weaponMesh.rotation.x = aimPitch * 0.45;
    }

    this.updateBillboard(state.healthRatio, state.team, state.name);
  }

  private updateBillboard(hpRatio: number, team: 'Vanguard' | 'Syndicate', name: string): void {
    const localTeam = settingsStore.settings.faction;
    const isAlly = team === localTeam;

    if (!isAlly) {
      this.uiBillboard.visible = false;
      return;
    }
    this.uiBillboard.visible = true;

    const hpPct = Math.max(0, Math.min(100, Math.round(hpRatio * 100)));
    const key = `${hpPct}:${team}:${localTeam}:${name}`;
    if (key === this.lastBillboardKey) return;
    this.lastBillboardKey = key;

    const ctx = this.uiCtx;
    ctx.clearRect(0, 0, 256, 80);

    const accent = team === 'Vanguard' ? '#38bdf8' : '#f59e0b';
    ctx.font = '800 18px "Segoe UI", Arial, sans-serif';
    const textW = Math.min(224, Math.max(96, Math.ceil(ctx.measureText(name).width) + 22));
    const pillX = Math.round((256 - textW) * 0.5);

    ctx.fillStyle = 'rgba(8, 12, 18, 0.72)';
    ctx.beginPath();
    ctx.roundRect(pillX, 20, textW, 28, 6);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(128, 64);
    ctx.lineTo(120, 52);
    ctx.lineTo(136, 52);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(name, 128, 40);

    const spriteMat = this.uiBillboard.material as THREE.SpriteMaterial;
    spriteMat.depthTest = true;
    spriteMat.opacity = 0.94;
    this.uiTexture.needsUpdate = true;
  }
}
