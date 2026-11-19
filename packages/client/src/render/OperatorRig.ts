import * as THREE from 'three';

export interface OperatorVisualState {
  isMoving: boolean;
  speed: number;
  isDead: boolean;
  healthRatio: number; // 0 to 1
  team: 'Vanguard' | 'Syndicate';
  name: string;
}

// Shared Geometries across all 10 operators to eliminate duplicate GPU buffer allocations
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
const geoStock = new THREE.BoxGeometry(0.05, 0.09, 0.18);
const geoSight = new THREE.BoxGeometry(0.03, 0.04, 0.12);

const geoHeadCollider = new THREE.SphereGeometry(0.22, 6, 6);
const geoBodyCollider = new THREE.CylinderGeometry(0.36, 0.36, 1.25, 6);
const matInvisibleCollider = new THREE.MeshBasicMaterial({ visible: false });

const geoShadow = new THREE.PlaneGeometry(0.95, 0.95);
geoShadow.rotateX(-Math.PI / 2);

let sharedShadowTexture: THREE.CanvasTexture | null = null;
function getSharedShadowTexture(): THREE.CanvasTexture {
  if (!sharedShadowTexture) {
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d')!;
    const sGrad = sCtx.createRadialGradient(64, 64, 4, 64, 64, 64);
    sGrad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
    sGrad.addColorStop(0.45, 'rgba(0, 0, 0, 0.40)');
    sGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 128, 128);
    sharedShadowTexture = new THREE.CanvasTexture(shadowCanvas);
    sharedShadowTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return sharedShadowTexture;
}

export class OperatorRig {
  public root: THREE.Group;
  public headCollider: THREE.Mesh;
  public bodyCollider: THREE.Mesh;
  private wireframeGroup: THREE.Group;

  // Segmented Limbs
  private leftLeg: THREE.Group;
  private rightLeg: THREE.Group;
  private torso: THREE.Group;
  private head: THREE.Group;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private weaponMesh: THREE.Group;
  private contactShadow: THREE.Mesh;

  // UI Billboard
  private uiBillboard: THREE.Sprite;
  private uiCanvas: HTMLCanvasElement;
  private uiCtx: CanvasRenderingContext2D;
  private uiTexture: THREE.CanvasTexture;

  // Animation Timers & Physics
  private walkCycle = Math.random() * Math.PI * 2;
  private flinchTimer = 0;
  private deathProgress = 0;
  private deathKnockback = new THREE.Vector3();

  constructor(team: 'Vanguard' | 'Syndicate', name: string) {
    this.root = new THREE.Group();

    const isVanguard = team === 'Vanguard';
    const suitColor = isVanguard ? 0x1b2026 : 0x3d352b; // Dark navy/graphite vs Mercenary Tan
    const vestColor = isVanguard ? 0x0f1317 : 0x24201a;
    const accentColor = isVanguard ? 0x3b9eff : 0xffaa00; // Cyan vs Amber
    const visorGlow = isVanguard ? 0xd91438 : 0xffaa00;

    // 1. Torso & Ballistic Vest
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

    // Lower spine
    const spine = new THREE.Mesh(geoSpine, jacketMat);
    spine.position.y = 0.22;
    this.torso.add(spine);

    // Heavy Ballistic Vest + Molle Pouches
    const vest = new THREE.Mesh(geoVest, vestMat);
    vest.position.set(0, 0.28, 0.01);
    this.torso.add(vest);

    // Front magazine pouches
    for (let i = -1; i <= 1; i++) {
      const pouch = new THREE.Mesh(geoPouch, accentMat);
      pouch.position.set(i * 0.11, 0.22, 0.18);
      this.torso.add(pouch);
    }

    // Shoulder Pauldrons / Team Insignia
    const leftPad = new THREE.Mesh(geoPad, accentMat);
    leftPad.position.set(-0.26, 0.42, 0);
    this.torso.add(leftPad);

    const rightPad = new THREE.Mesh(geoPad, accentMat);
    rightPad.position.set(0.26, 0.42, 0);
    this.torso.add(rightPad);

    this.root.add(this.torso);

    // 2. Articulated Legs
    this.leftLeg = this.buildLeg(suitColor, vestColor);
    this.leftLeg.position.set(-0.13, 0.85, 0);
    this.root.add(this.leftLeg);

    this.rightLeg = this.buildLeg(suitColor, vestColor);
    this.rightLeg.position.set(0.13, 0.85, 0);
    this.root.add(this.rightLeg);

    // 3. Articulated Head & FAST Ballistic Helmet
    this.head = new THREE.Group();
    this.head.position.y = 1.45;

    // Head base (balaclava)
    const headMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });
    const headBase = new THREE.Mesh(geoHeadBase, headMat);
    headBase.position.y = 0.16;
    this.head.add(headBase);

    // FAST Tactical Helmet
    const helmetMat = new THREE.MeshStandardMaterial({
      color: vestColor,
      roughness: 0.5,
      metalness: 0.35,
    });
    const helmet = new THREE.Mesh(geoHelmet, helmetMat);
    helmet.position.set(0, 0.20, -0.01);
    this.head.add(helmet);

    // NVG Mount & Ear Protection
    const nvgMount = new THREE.Mesh(geoNvgMount, accentMat);
    nvgMount.position.set(0, 0.24, 0.17);
    this.head.add(nvgMount);

    // Team Visor Glass (Glowing)
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

    this.root.add(this.head);

    // 4. Articulated Arms holding 3D Weapon
    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.24, 1.34, 0);

    const armMesh = new THREE.Mesh(geoArm, jacketMat);
    this.rightArm.add(armMesh);
    this.root.add(this.rightArm);

    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.24, 1.34, 0);
    const leftArmMesh = new THREE.Mesh(geoArm, jacketMat);
    leftArmMesh.rotation.y = -0.3;
    leftArmMesh.position.set(0.12, -0.06, 0.22);
    this.leftArm.add(leftArmMesh);
    this.root.add(this.leftArm);

    // 3D Rifle in hand
    this.weaponMesh = this.buildRifleMesh(accentColor);
    this.weaponMesh.position.set(0.14, 1.18, 0.32);
    this.root.add(this.weaponMesh);

    // 5. Invisible Hitbox Colliders for RaycastEngine
    this.headCollider = new THREE.Mesh(geoHeadCollider, matInvisibleCollider);
    this.headCollider.position.set(0, 1.66, 0);
    this.headCollider.castShadow = false;
    this.root.add(this.headCollider);

    this.bodyCollider = new THREE.Mesh(geoBodyCollider, matInvisibleCollider);
    this.bodyCollider.position.set(0, 0.95, 0);
    this.bodyCollider.castShadow = false;
    this.root.add(this.bodyCollider);

    // 6. Grounded Contact Shadow Disc (Radial Soft Gradient, Shared Texture)
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
      depthTest: false,
    });
    this.uiBillboard = new THREE.Sprite(spriteMat);
    this.uiBillboard.position.set(0, 2.15, 0);
    this.uiBillboard.scale.set(1.4, 0.44, 1);
    this.uiBillboard.castShadow = false;
    this.root.add(this.uiBillboard);

    this.updateBillboard(1.0, team, name);
  }

  public setWireframesVisible(visible: boolean): void {
    this.wireframeGroup.visible = visible;
  }

  public getWorldHitboxes() {
    const headWorld = new THREE.Vector3();
    const chestWorld = new THREE.Vector3();
    const stomWorld = new THREE.Vector3();
    this.head.getWorldPosition(headWorld);
    this.torso.getWorldPosition(chestWorld);
    chestWorld.y += 0.28;
    stomWorld.copy(chestWorld);
    stomWorld.y -= 0.30;

    return {
      head: { x: headWorld.x, y: headWorld.y + 0.16, z: headWorld.z },
      chest: { x: chestWorld.x, y: chestWorld.y, z: chestWorld.z },
      stomach: { x: stomWorld.x, y: stomWorld.y, z: stomWorld.z },
    };
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

    // Thigh + Knee pad
    const thigh = new THREE.Mesh(geoThigh, pantsMat);
    thigh.position.y = -0.22;
    leg.add(thigh);

    // Shin + Combat Boot
    const boot = new THREE.Mesh(geoBoot, bootMat);
    boot.position.set(0, -0.62, 0.02);
    leg.add(boot);

    return leg;
  }

  private buildRifleMesh(accentColor: number): THREE.Group {
    const gun = new THREE.Group();
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.8, roughness: 0.3 });
    const accMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4 });

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

  public update(dt: number, state: OperatorVisualState): void {
    if (state.isDead) {
      // Directional death collapse pose with momentum carry
      if (this.deathProgress < 1.0) {
        this.deathProgress = Math.min(1.0, this.deathProgress + dt * 3.5);
        this.root.rotation.x = -Math.PI / 2 * this.deathProgress;
        this.root.position.y = -0.75 * this.deathProgress;
        if (this.deathKnockback.lengthSq() > 0.01) {
          this.root.position.addScaledVector(this.deathKnockback, dt * (1 - this.deathProgress) * 2.2);
        }
      }
      this.uiBillboard.visible = false;
      this.contactShadow.visible = false;
      return;
    }

    this.uiBillboard.visible = true;
    this.contactShadow.visible = true;

    // 1. Walking Striding Animation
    if (state.isMoving) {
      this.walkCycle += dt * state.speed * 4.2;
      const legSwing = Math.sin(this.walkCycle) * 0.45;
      this.leftLeg.rotation.x = legSwing;
      this.rightLeg.rotation.x = -legSwing;

      // Slight torso bounce
      this.torso.position.y = 0.88 + Math.abs(Math.sin(this.walkCycle * 2)) * 0.04;
    } else {
      // Idle breathing
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
      this.torso.position.y = 0.88 + Math.sin(performance.now() * 0.003) * 0.015;
    }

    // 2. Flinch Reaction
    if (this.flinchTimer > 0) {
      this.flinchTimer -= dt;
      this.torso.rotation.x = -0.18;
      this.head.rotation.x = -0.25;
    } else {
      this.torso.rotation.x = 0;
      this.head.rotation.x = 0;
    }

    this.updateBillboard(state.healthRatio, state.team, state.name);
  }

  /**
   * Renders high-contrast tactical overhead Health Bar + Nameplate
   */
  private updateBillboard(hpRatio: number, team: 'Vanguard' | 'Syndicate', name: string): void {
    const ctx = this.uiCtx;
    ctx.clearRect(0, 0, 256, 80);

    const isAlly = team === 'Vanguard';
    const tagColor = isAlly ? '#3b9eff' : '#ffaa00';
    const tagText = isAlly ? `[ALLY] ${name}` : `[ENEMY] ${name}`;

    // Background pill
    ctx.fillStyle = 'rgba(8, 11, 16, 0.88)';
    ctx.roundRect(10, 8, 236, 64, 8);
    ctx.fill();
    ctx.strokeStyle = tagColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Name Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tagText, 128, 34);

    // Health Bar Frame
    const barX = 24;
    const barY = 44;
    const barW = 208;
    const barH = 12;

    ctx.fillStyle = '#22262c';
    ctx.fillRect(barX, barY, barW, barH);

    // Dynamic HP fill color: Green -> Yellow -> Red
    let hpColor = '#00ff88';
    if (hpRatio < 0.35) hpColor = '#ff2233';
    else if (hpRatio < 0.65) hpColor = '#ffaa00';

    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, Math.max(0, barW * hpRatio), barH);

    this.uiTexture.needsUpdate = true;
  }
}
