import * as THREE from 'three';
import { settingsStore } from '../core/SettingsStore.js';
import { AssetManager } from './AssetManager.js';
import { solveTwoBoneIK, extractYTwistAngle } from '../viewmodel/ArmIKSolver.js';

const _headWorld = new THREE.Vector3();
const _chestWorld = new THREE.Vector3();
const _stomWorld = new THREE.Vector3();
const _leftTargetWorld = new THREE.Vector3();
const _leftPoleWorld = new THREE.Vector3();
const _socketScale = new THREE.Vector3();
const _qDelta = new THREE.Quaternion();
const _qSocketWorld = new THREE.Quaternion();
const _qDesiredWorld = new THREE.Quaternion();
const _qForearmWorld = new THREE.Quaternion();
const _qHandWorld = new THREE.Quaternion();
const _qTwistRel = new THREE.Quaternion();
const _qTwistOut = new THREE.Quaternion();
const _vAxisY = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler();

const WORLD_WEAPON_SPECS: Record<string, { path: string; length: number; forendZ: number; isMelee?: boolean }> = {
  'garam-47': { path: '/models/garam47.glb', length: 0.88, forendZ: 0.30 },
  'vanguard-m4': { path: '/models/m4a1s.glb', length: 0.92, forendZ: 0.31 },
  'sovereign-awp': { path: '/models/awp.glb', length: 1.12, forendZ: 0.34 },
  'desert-eagle': { path: '/models/deagle.glb', length: 0.28, forendZ: 0.04 },
  'garam-karambit': { path: '/models/karambit.glb', length: 0.24, forendZ: 0.0, isMelee: true },
};

export interface OperatorVisualState {
  isMoving: boolean;
  speed: number;
  isDead: boolean;
  healthRatio: number; // 0 to 1
  team: 'Vanguard' | 'Syndicate';
  name: string;
  isCrouching?: boolean;
  pitch?: number;
  yawOffset?: number;
  velocity?: { x: number; z: number };
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
  armUpperL?: SkeletalBoneBinding;
  armLowerL?: SkeletalBoneBinding;
  armUpperR?: SkeletalBoneBinding;
  armLowerR?: SkeletalBoneBinding;
  handL?: SkeletalBoneBinding;
  handR?: SkeletalBoneBinding;
  weaponHandR?: THREE.Object3D;
  armLowerTwistL: THREE.Object3D[];
  armLowerTwistR: THREE.Object3D[];
  armUpperTwistL: THREE.Object3D[];
  armUpperTwistR: THREE.Object3D[];
  legUpperL?: SkeletalBoneBinding;
  legLowerL?: SkeletalBoneBinding;
  legUpperR?: SkeletalBoneBinding;
  legLowerR?: SkeletalBoneBinding;
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

  // High-Fidelity CS2 GLB Operator Rig & World Rifle
  private glbRig: OperatorSkeletonRig | null = null;
  private glbWeaponHolder: THREE.Group | null = null;
  private glbWeaponModel: THREE.Object3D | null = null;
  private leftHandTarget: THREE.Object3D | null = null;
  private holderBasePos = new THREE.Vector3();
  private holderBaseQuat = new THREE.Quaternion();
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

  // Animation Timers & Physics
  private walkCycle = Math.random() * Math.PI * 2;
  private flinchTimer = 0;
  private deathProgress = 0;
  private deathKnockback = new THREE.Vector3();

  constructor(team: 'Vanguard' | 'Syndicate', name: string) {
    this.root = new THREE.Group();
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

    const jacketMat = new THREE.MeshStandardMaterial({
      color: suitColor,
      roughness: 0.72,
      metalness: 0.15,
    });
    const vestMat = new THREE.MeshStandardMaterial({
      color: vestColor,
      roughness: 0.65,
      metalness: 0.25,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.4,
      metalness: 0.4,
    });

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

    const helmetMat = new THREE.MeshStandardMaterial({
      color: vestColor,
      roughness: 0.5,
      metalness: 0.35,
    });
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
    this.rightArm.position.set(0.24, 1.34, 0);
    this.rightArm.add(new THREE.Mesh(geoArm, jacketMat));
    this.proceduralGroup.add(this.rightArm);

    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.24, 1.34, 0);
    const leftArmMesh = new THREE.Mesh(geoArm, jacketMat);
    leftArmMesh.rotation.y = -0.3;
    leftArmMesh.position.set(0.12, -0.06, 0.22);
    this.leftArm.add(leftArmMesh);
    this.proceduralGroup.add(this.leftArm);

    this.weaponMesh = this.buildRifleMesh(accentColor);
    this.weaponMesh.position.set(0.14, 1.18, 0.32);
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

    const spriteMat = new THREE.SpriteMaterial({
      map: this.uiTexture,
      transparent: true,
      depthTest: true,
    });
    this.uiBillboard = new THREE.Sprite(spriteMat);
    this.uiBillboard.position.set(0, 2.15, 0);
    this.uiBillboard.scale.set(1.4, 0.44, 1);
    this.uiBillboard.castShadow = false;
    this.root.add(this.uiBillboard);

    this.ownedMaterials.push(
      jacketMat,
      vestMat,
      accentMat,
      headMat,
      helmetMat,
      visorMat,
      shadowMat,
      wfMatHead,
      wfMatBody,
      spriteMat
    );
    this.ownedGeometries.push(
      wfHead.geometry,
      wfChest.geometry,
      wfStomach.geometry,
      wfLegs.geometry
    );

    this.updateBillboard(1.0, team, name);

    // Asynchronously load full CS2 skeletal GLB operator + world rifle
    this.loadCharacterGLB(team);
  }

  private async loadCharacterGLB(team: 'Vanguard' | 'Syndicate'): Promise<void> {
    const assetManager = AssetManager.getInstance();
    const modelPath =
      team === 'Vanguard' ? '/models/operator_vanguard.glb' : '/models/operator_syndicate.glb';
    const initialWeaponId = team === 'Vanguard' ? 'vanguard-m4' : 'garam-47';
    this.currentWorldWeaponId = initialWeaponId;
    const spec = WORLD_WEAPON_SPECS[initialWeaponId];

    const [agentModel, rifleModel] = await Promise.all([
      assetManager.loadModel(modelPath, {
        targetHeight: 1.82,
        centerAtFeet: true,
        envMapIntensity: 1.35,
        castShadow: true,
        receiveShadow: true,
      }),
      assetManager.loadModel(spec.path, {
        targetLength: spec.length,
        anchorBoneName: 'weapon_hand_r',
        centerPivot: false,
        envMapIntensity: 1.6,
        castShadow: true,
        receiveShadow: true,
      }),
    ]);

    if (this.isDisposed || !agentModel) return;

    // Compute rest parent world quaternions while agentModel is detached at identity (pure character-local space)
    agentModel.updateMatrixWorld(true);
    const rig: OperatorSkeletonRig = {
      root: agentModel,
      baseRootY: agentModel.position.y,
      armLowerTwistL: [],
      armLowerTwistR: [],
      armUpperTwistL: [],
      armUpperTwistR: [],
    };
    const bindBone = (node: THREE.Object3D): SkeletalBoneBinding => {
      const parentRestQuat = new THREE.Quaternion();
      if (node.parent) {
        node.parent.getWorldQuaternion(parentRestQuat);
      }
      return {
        bone: node,
        baseQuat: node.quaternion.clone(),
        parentRestQuat,
        invParentRestQuat: parentRestQuat.clone().invert(),
        basePos: node.position.clone(),
      };
    };

    agentModel.traverse((node) => {
      const n = node.name.toLowerCase();
      if (n.includes('helper')) return;
      if (n.includes('twist')) {
        if (n.startsWith('arm_lower_l_twist')) rig.armLowerTwistL.push(node);
        else if (n.startsWith('arm_lower_r_twist')) rig.armLowerTwistR.push(node);
        else if (n.startsWith('arm_upper_l_twist')) rig.armUpperTwistL.push(node);
        else if (n.startsWith('arm_upper_r_twist')) rig.armUpperTwistR.push(node);
        return;
      }
      if (n.startsWith('pelvis')) rig.pelvis = bindBone(node);
      else if (n.startsWith('spine_0')) rig.spine0 = bindBone(node);
      else if (n.startsWith('spine_1')) rig.spine1 = bindBone(node);
      else if (n.startsWith('spine_2')) rig.spine2 = bindBone(node);
      else if (n.startsWith('neck_0')) rig.neck = bindBone(node);
      else if (n.startsWith('head_0')) rig.head = bindBone(node);
      else if (n.startsWith('arm_upper_l')) rig.armUpperL = bindBone(node);
      else if (n.startsWith('arm_lower_l')) rig.armLowerL = bindBone(node);
      else if (n.startsWith('arm_upper_r')) rig.armUpperR = bindBone(node);
      else if (n.startsWith('arm_lower_r')) rig.armLowerR = bindBone(node);
      else if (n.startsWith('hand_l')) rig.handL = bindBone(node);
      else if (n.startsWith('hand_r')) rig.handR = bindBone(node);
      else if (n.startsWith('weapon_hand_r')) rig.weaponHandR = node;
      else if (n.startsWith('leg_upper_l')) rig.legUpperL = bindBone(node);
      else if (n.startsWith('leg_lower_l')) rig.legLowerL = bindBone(node);
      else if (n.startsWith('leg_upper_r')) rig.legUpperR = bindBone(node);
      else if (n.startsWith('leg_lower_r')) rig.legLowerR = bindBone(node);
    });

    // Sort twist bones proximal -> distal by local Y offset along forearm
    const sortByLocalY = (a: THREE.Object3D, b: THREE.Object3D) => a.position.y - b.position.y;
    rig.armLowerTwistL.sort(sortByLocalY);
    rig.armLowerTwistR.sort(sortByLocalY);
    rig.armUpperTwistL.sort(sortByLocalY);
    rig.armUpperTwistR.sort(sortByLocalY);

    this.glbRig = rig;
    this.proceduralGroup.visible = false;
    this.root.add(agentModel);

    // Apply neutral combat stance first so right-hand socket world orientation is calibrated
    this.applySkeletalPose(0, false, false, 0, 0, 0);

    // Mount real CS2 world rifle directly onto weapon_hand_r (Vanguard) or hand_r (Syndicate)
    if (rifleModel) {
      this.mountWorldWeapon(rifleModel, spec.forendZ);
    }

    // Re-run pose with left-hand 2-bone IK targeting the mounted rifle forend
    this.applySkeletalPose(0, false, false, 0, 0, 0);
  }

  private mountWorldWeapon(weaponModel: THREE.Object3D, forendZ: number): void {
    const rig = this.glbRig;
    if (!rig) return;

    const socketBone = rig.weaponHandR ?? rig.handR?.bone ?? null;

    if (!this.glbWeaponHolder) {
      const holder = new THREE.Group();
      holder.name = 'operator_weapon_holder';

      // 3D Cross-Plane Volumetric Muzzle Flash at rifle barrel tip
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
      holder.add(flashGroup);
      this.worldMuzzleFlash = flashGroup;

      const leftTarget = new THREE.Object3D();
      leftTarget.name = 'left_hand_forend_target';
      holder.add(leftTarget);
      this.leftHandTarget = leftTarget;

      if (socketBone) {
        this.root.updateMatrixWorld(true);
        socketBone.getWorldScale(_socketScale);
        const invScale = 1 / Math.max(0.002, _socketScale.x);
        holder.scale.setScalar(invScale);

        // On Syndicate (no weapon_hand_r child bone), place grip at Vanguard's exact Source2 palm offset inside hand_r
        if (!rig.weaponHandR && rig.handR) {
          holder.position.set(0.2954, 2.791, -1.1238);
        } else {
          holder.position.set(0, 0, 0);
        }

        // Align holder in socket-local space so weapon barrel (+Z) points cleanly forward in neutral combat stance
        socketBone.getWorldQuaternion(_qSocketWorld);
        this.root.getWorldQuaternion(_qDesiredWorld);
        _euler.set(0.02, 0.16, 0, 'XYZ');
        _qDelta.setFromEuler(_euler);
        _qDesiredWorld.multiply(_qDelta);
        holder.quaternion.copy(_qSocketWorld).invert().multiply(_qDesiredWorld).normalize();

        this.holderBasePos.copy(holder.position);
        this.holderBaseQuat.copy(holder.quaternion);
        socketBone.add(holder);
      } else {
        holder.position.set(-0.08, 1.29, 0.34);
        holder.rotation.set(0.03, 0.22, 0);
        this.holderBasePos.copy(holder.position);
        this.holderBaseQuat.copy(holder.quaternion);
        this.root.add(holder);
      }

      this.glbWeaponHolder = holder;
    }

    if (this.glbWeaponModel && this.glbWeaponHolder) {
      this.glbWeaponHolder.remove(this.glbWeaponModel);
    }
    this.glbWeaponModel = weaponModel;
    this.glbWeaponHolder.add(weaponModel);

    if (this.leftHandTarget) {
      this.leftHandTarget.position.set(0, 0.02, forendZ);
    }

    if (this.worldMuzzleFlash) {
      const tip = weaponModel.userData.muzzleTipLocal;
      if (tip instanceof THREE.Vector3) {
        this.worldMuzzleFlash.position.copy(tip);
      } else {
        this.worldMuzzleFlash.position.set(0, 0.04, 0.50);
      }
    }
  }

  /**
   * Swaps the bot's visible 3P world weapon GLB via cached AssetManager clones.
   */
  public async setWeapon(weaponId: string): Promise<void> {
    if (this.currentWorldWeaponId === weaponId || this.isDisposed) return;
    const spec = WORLD_WEAPON_SPECS[weaponId];
    if (!spec) return;
    this.currentWorldWeaponId = weaponId;

    const loaded = await AssetManager.getInstance().loadModel(spec.path, {
      targetLength: spec.length,
      anchorBoneName: spec.isMelee ? undefined : 'weapon_hand_r',
      centerPivot: !!spec.isMelee,
      envMapIntensity: 1.6,
      castShadow: true,
      receiveShadow: true,
    });
    if (!loaded || this.isDisposed || this.currentWorldWeaponId !== weaponId) return;
    this.mountWorldWeapon(loaded, spec.forendZ);
  }

  /**
   * Rotates a skeleton bone around Three.js character-local axes (+X Left, +Y Up, +Z Forward)
   * independent of Source 2 / glTF bone roll conventions.
   */
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

  /**
   * Distributes forearm roll across sibling `arm_lower_*_twist` / `twist1` bones (50% average roll)
   * to prevent pinched elbows and wrists on Source2 skeletal rigs.
   */
  private applySiblingForearmTwist(
    forearm: SkeletalBoneBinding | undefined,
    hand: SkeletalBoneBinding | undefined,
    twistBones: THREE.Object3D[]
  ): void {
    if (!forearm || !hand || twistBones.length === 0) return;
    forearm.bone.getWorldQuaternion(_qForearmWorld);
    hand.bone.getWorldQuaternion(_qHandWorld);
    _qTwistRel.copy(_qForearmWorld).invert().multiply(_qHandWorld).normalize();
    const twistAngle = Math.max(-1.6, Math.min(1.6, extractYTwistAngle(_qTwistRel)));

    for (let i = 0; i < twistBones.length; i++) {
      const weight = twistBones.length === 1 ? 0.5 : (i + 1) / (twistBones.length + 1);
      _qTwistOut.setFromAxisAngle(_vAxisY, twistAngle * weight);
      twistBones[i].quaternion.copy(_qTwistOut);
    }
  }

  private applySkeletalPose(
    legSwing: number,
    isMoving: boolean,
    isCrouching: boolean,
    aimPitch: number,
    aimYaw: number,
    flinchOffset: number
  ): void {
    const rig = this.glbRig;
    if (!rig) return;

    // 1. Root vertical stance drop on crouch & subtle stride bob (true Three.js meter space)
    const crouchDrop = isCrouching ? -0.34 : 0;
    const walkBob = isMoving
      ? Math.abs(Math.sin(this.walkCycle * 2)) * 0.026
      : Math.sin(performance.now() * 0.003) * 0.006;
    rig.root.position.y = rig.baseRootY + crouchDrop + walkBob;

    // 2. Spine & Head tracking + flinch (character-local: +X tilts forward/down, +Y turns left)
    const torsoForwardLean = (isCrouching ? 0.18 : 0.05) - aimPitch * 0.28 - flinchOffset;
    this.applyCharSpaceDelta(rig.spine1, torsoForwardLean, 0.12, 0);
    this.applyCharSpaceDelta(rig.spine2, -aimPitch * 0.14, 0.08, 0);
    this.applyCharSpaceDelta(rig.head, -aimPitch * 0.35 - flinchOffset * 0.7, aimYaw * 0.45 - 0.16, 0);

    // 3. Tactical 2-Handed Rifle Stance (right arm drives weapon socket; left arm refined via 2-bone IK)
    const recoilKick = this.fireRecoilTimer > 0 ? Math.sin((this.fireRecoilTimer / 0.09) * Math.PI) : 0;
    this.applyCharSpaceDelta(rig.armUpperR, -0.18 - aimPitch * 0.28 - recoilKick * 0.08, 0.82, 0.58);
    this.applyCharSpaceDelta(rig.armLowerR, -0.78 - recoilKick * 0.10, 0.32, -0.22);
    this.applyCharSpaceDelta(rig.armUpperL, -0.55 - aimPitch * 0.25, -1.32, -0.48);
    this.applyCharSpaceDelta(rig.armLowerL, -0.42, -0.35, 0.15);

    // Apply subtle weapon recoil kick directly on the hand-parented weapon holder
    if (this.glbWeaponHolder) {
      this.glbWeaponHolder.position.copy(this.holderBasePos);
      this.glbWeaponHolder.quaternion.copy(this.holderBaseQuat);
      if (recoilKick > 0.001) {
        _euler.set(-recoilKick * 0.12, 0, 0, 'XYZ');
        _qDelta.setFromEuler(_euler);
        this.glbWeaponHolder.quaternion.multiply(_qDelta);
      }
    }

    // Lock left support hand onto rifle forend via zero-allocation 2-bone analytical IK
    const spec = WORLD_WEAPON_SPECS[this.currentWorldWeaponId];
    if (
      rig.armUpperL &&
      rig.armLowerL &&
      rig.handL &&
      this.leftHandTarget &&
      spec &&
      !spec.isMelee &&
      spec.forendZ > 0.05
    ) {
      this.root.updateMatrixWorld(true);
      this.leftHandTarget.getWorldPosition(_leftTargetWorld);
      // Pole vector outward-left & downward relative to operator root so left elbow bends naturally
      _leftPoleWorld.set(0.75, 0.75 + crouchDrop, 0.15).applyMatrix4(this.root.matrixWorld);
      solveTwoBoneIK(
        rig.armUpperL.bone,
        rig.armLowerL.bone,
        rig.handL.bone,
        _leftTargetWorld,
        _leftPoleWorld,
        false
      );
    }

    // Distribute forearm twist smoothly across arm_lower_*_twist helper bones
    this.applySiblingForearmTwist(rig.armLowerL, rig.handL, rig.armLowerTwistL);
    this.applySiblingForearmTwist(rig.armLowerR, rig.handR, rig.armLowerTwistR);

    // 4. Leg Locomotion & Crouch Knee Flex (-X swings thigh forward, +X bends knee backward)
    if (isMoving) {
      const lSwing = legSwing;
      const rSwing = -legSwing;
      const crouchBias = isCrouching ? 0.45 : 0;
      this.applyCharSpaceDelta(rig.legUpperL, -lSwing - crouchBias, 0, 0);
      this.applyCharSpaceDelta(rig.legLowerL, Math.max(0, lSwing) * 0.85 + crouchBias * 1.45, 0, 0);
      this.applyCharSpaceDelta(rig.legUpperR, -rSwing - crouchBias, 0, 0);
      this.applyCharSpaceDelta(rig.legLowerR, Math.max(0, rSwing) * 0.85 + crouchBias * 1.45, 0, 0);
    } else if (isCrouching) {
      this.applyCharSpaceDelta(rig.legUpperL, -0.62, 0, 0);
      this.applyCharSpaceDelta(rig.legLowerL, 1.12, 0, 0);
      this.applyCharSpaceDelta(rig.legUpperR, -0.48, 0, 0);
      this.applyCharSpaceDelta(rig.legLowerR, 0.92, 0, 0);
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
    for (const mat of this.ownedMaterials) {
      mat.dispose();
    }
    for (const geo of this.ownedGeometries) {
      geo.dispose();
    }
    this.ownedMaterials = [];
    this.ownedGeometries = [];
    if (this.glbWeaponHolder) {
      this.glbWeaponHolder.removeFromParent();
      this.glbWeaponHolder = null;
    }
    this.glbWeaponModel = null;
    this.leftHandTarget = null;
    if (this.glbRig) {
      this.root.remove(this.glbRig.root);
      this.glbRig = null;
    }
  }

  public triggerDeath(hitDir?: THREE.Vector3, isHeadshot?: boolean): void {
    if (hitDir) {
      this.deathKnockback.copy(hitDir).normalize().multiplyScalar(isHeadshot ? 1.8 : 1.2);
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

  public triggerFlinch(): void {
    this.flinchTimer = 0.14;
  }

  public triggerMuzzleFlash(): void {
    this.muzzleFlashTimer = 0.055;
    this.fireRecoilTimer = 0.09;
    if (this.worldMuzzleFlash) {
      this.worldMuzzleFlash.visible = true;
      this.worldMuzzleFlash.rotation.z = Math.random() * Math.PI * 2;
      this.worldMuzzleFlash.scale.setScalar(0.85 + Math.random() * 0.45);
    }
  }

  public update(dt: number, state: OperatorVisualState): void {
    if (state.isDead) {
      if (this.deathProgress < 1.0) {
        this.deathProgress = Math.min(1.0, this.deathProgress + dt * 3.5);
        this.root.rotation.x = (-Math.PI / 2) * this.deathProgress;
        this.root.position.y = -0.75 * this.deathProgress;
        if (this.deathKnockback.lengthSq() > 0.01) {
          this.root.position.addScaledVector(this.deathKnockback, dt * (1 - this.deathProgress) * 2.2);
        }
      }
      this.uiBillboard.visible = false;
      this.contactShadow.visible = false;
      if (this.glbWeaponHolder) this.glbWeaponHolder.visible = false;
      return;
    }

    if (this.deathProgress > 0) {
      this.deathProgress = 0;
      this.root.rotation.x = 0;
      this.deathKnockback.set(0, 0, 0);
    }

    this.uiBillboard.visible = true;
    this.contactShadow.visible = true;
    if (this.glbWeaponHolder) this.glbWeaponHolder.visible = true;

    const isCrouching = !!state.isCrouching;
    const targetTorsoY = isCrouching ? 0.46 : 0.88;
    const targetHeadY = isCrouching ? 0.95 : 1.50;
    const targetArmY = isCrouching ? 0.82 : 1.34;
    const targetWeaponY = isCrouching ? 0.70 : 1.18;
    const targetBillboardY = isCrouching ? 1.60 : 2.15;

    this.head.position.y = targetHeadY;
    this.rightArm.position.y = targetArmY;
    this.leftArm.position.y = targetArmY;
    this.weaponMesh.position.y = targetWeaponY;
    this.uiBillboard.position.y = targetBillboardY;
    this.headCollider.position.y = isCrouching ? 1.05 : 1.66;
    this.bodyCollider.position.y = isCrouching ? 0.55 : 0.95;

    let vStrafe = 0;
    if (state.velocity && (Math.abs(state.velocity.x) > 0.01 || Math.abs(state.velocity.z) > 0.01)) {
      const yaw = this.root.rotation.y;
      const cosY = Math.cos(-yaw);
      const sinY = Math.sin(-yaw);
      vStrafe = state.velocity.x * cosY - state.velocity.z * sinY;
    }

    let legSwing = 0;
    if (state.isMoving) {
      this.walkCycle += dt * state.speed * 4.2;
      legSwing = Math.sin(this.walkCycle) * (isCrouching ? 0.28 : 0.48);
      this.leftLeg.rotation.x = legSwing;
      this.rightLeg.rotation.x = -legSwing;
      this.leftLeg.rotation.z = Math.max(-0.15, Math.min(0.15, vStrafe * 0.04));
      this.rightLeg.rotation.z = Math.max(-0.15, Math.min(0.15, -vStrafe * 0.04));

      this.torso.position.y = targetTorsoY + Math.abs(Math.sin(this.walkCycle * 2)) * 0.03;
      this.root.rotation.z = Math.max(-0.06, Math.min(0.06, -vStrafe * 0.015));
    } else {
      this.leftLeg.rotation.x = isCrouching ? -0.35 : 0;
      this.rightLeg.rotation.x = isCrouching ? -0.35 : 0;
      this.leftLeg.rotation.z = 0;
      this.rightLeg.rotation.z = 0;
      this.torso.position.y = targetTorsoY + Math.sin(performance.now() * 0.003) * 0.012;
      this.root.rotation.z = 0;
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
    const aimYaw = state.yawOffset || 0;
    let flinchOffset = 0;
    if (this.flinchTimer > 0) {
      this.flinchTimer -= dt;
      flinchOffset = -0.18;
    }

    if (this.glbRig) {
      this.applySkeletalPose(legSwing, state.isMoving, isCrouching, aimPitch, aimYaw, flinchOffset);
    } else {
      this.torso.rotation.x = (isCrouching ? 0.12 : 0) + aimPitch * 0.35 + flinchOffset;
      this.head.rotation.x = aimPitch * 0.45 + flinchOffset * 1.2;
      this.head.rotation.y = aimYaw * 0.50;
      this.rightArm.rotation.x = aimPitch * 0.45;
      this.leftArm.rotation.x = aimPitch * 0.45;
      this.weaponMesh.rotation.x = aimPitch * 0.45;
    }

    this.updateBillboard(state.healthRatio, state.team, state.name);
  }

  private updateBillboard(hpRatio: number, team: 'Vanguard' | 'Syndicate', name: string): void {
    const localTeam = settingsStore.settings.faction;
    const hpPct = Math.max(0, Math.min(100, Math.round(hpRatio * 100)));
    const key = `${hpPct}:${team}:${localTeam}:${name}`;
    if (key === this.lastBillboardKey) return;
    this.lastBillboardKey = key;

    const ctx = this.uiCtx;
    ctx.clearRect(0, 0, 256, 80);

    const isAlly = team === localTeam;
    (this.uiBillboard.material as THREE.SpriteMaterial).depthTest = !isAlly;
    const tagColor = isAlly ? '#3b9eff' : '#ffaa00';
    const tagText = isAlly ? `[ALLY] ${name}` : `[ENEMY] ${name}`;

    ctx.fillStyle = 'rgba(8, 11, 16, 0.88)';
    ctx.beginPath();
    ctx.roundRect(10, 8, 236, 64, 8);
    ctx.fill();
    ctx.strokeStyle = tagColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tagText, 128, 34);

    const barX = 24;
    const barY = 44;
    const barW = 208;
    const barH = 12;

    ctx.fillStyle = '#22262c';
    ctx.fillRect(barX, barY, barW, barH);

    let hpColor = '#00ff88';
    if (hpRatio < 0.35) hpColor = '#ff2233';
    else if (hpRatio < 0.65) hpColor = '#ffaa00';

    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, Math.max(0, barW * (hpPct / 100)), barH);

    this.uiTexture.needsUpdate = true;
  }
}
