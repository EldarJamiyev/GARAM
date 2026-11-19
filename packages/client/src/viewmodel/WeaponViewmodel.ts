import * as THREE from 'three';

export class WeaponViewmodel {
  public mesh: THREE.Group;
  private weaponContainer: THREE.Group;
  private rightArm: THREE.Mesh;
  private muzzleFlashLight: THREE.PointLight;
  private currentWeaponId = 'garam-47';

  // Cached 5 Weapon Groups (Zero WebGL memory leaks on switch)
  private weaponMeshes: Map<string, THREE.Group> = new Map();
  private slideMeshes: Map<string, THREE.Mesh> = new Map();
  private boltMeshes: Map<string, THREE.Mesh> = new Map();

  // Animation triggers & timers
  private slideKick = 0;
  private boltKick = 0;
  private isSlashing = false;
  private slashTime = 0;
  private isStabbing = false;
  private stabTime = 0;

  // Draw transition (0 to 1 over 0.25s)
  private drawProgress = 1.0;

  // Reload state
  public isReloading = false;
  public reloadProgress = 0;

  // Spring physics states
  private targetPos = new THREE.Vector3(0.24, -0.22, -0.45);
  private currentPos = new THREE.Vector3(0.24, -0.22, -0.45);
  private velPos = new THREE.Vector3();

  private targetRot = new THREE.Euler(0, 0, 0);
  private currentRot = new THREE.Euler(0, 0, 0);

  private recoilZ = 0;
  private recoilPitch = 0;
  public isScoped = false;

  constructor() {
    this.mesh = new THREE.Group();
    this.weaponContainer = new THREE.Group();
    this.mesh.add(this.weaponContainer);

    // First person tactical gloved arm
    const armGeo = new THREE.CylinderGeometry(0.045, 0.052, 0.42, 16);
    armGeo.rotateX(Math.PI / 3);
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x141618,
      roughness: 0.8,
      metalness: 0.1,
    });
    this.rightArm = new THREE.Mesh(armGeo, armMat);
    this.rightArm.position.set(0.12, -0.18, 0.08);
    this.mesh.add(this.rightArm);

    // Muzzle flash point light
    this.muzzleFlashLight = new THREE.PointLight(0xffb844, 0, 12);
    this.muzzleFlashLight.position.set(0, 0.02, -0.48);
    this.mesh.add(this.muzzleFlashLight);

    // Pre-build and cache all 5 weapon models once
    this.buildAllWeaponMeshes();

    // Set initial visible weapon
    this.setWeapon('garam-47');
    this.mesh.position.copy(this.currentPos);
  }

  private buildAllWeaponMeshes(): void {
    const garam47Group = this.createGaram47Mesh();
    const vanguardM4Group = this.createVanguardM4Mesh();
    const awpGroup = this.createSovereignAWPMesh();
    const deagleGroup = this.createDesertEagleMesh();
    const karambitGroup = this.createKarambitMesh();

    this.weaponMeshes.set('garam-47', garam47Group);
    this.weaponMeshes.set('vanguard-m4', vanguardM4Group);
    this.weaponMeshes.set('sovereign-awp', awpGroup);
    this.weaponMeshes.set('desert-eagle', deagleGroup);
    this.weaponMeshes.set('garam-karambit', karambitGroup);

    this.weaponContainer.add(garam47Group);
    this.weaponContainer.add(vanguardM4Group);
    this.weaponContainer.add(awpGroup);
    this.weaponContainer.add(deagleGroup);
    this.weaponContainer.add(karambitGroup);
  }

  public setWeapon(weaponId: string): void {
    this.currentWeaponId = weaponId;

    // Toggle visibility cleanly without destroying meshes
    this.weaponMeshes.forEach((mesh, id) => {
      mesh.visible = id === weaponId;
    });

    // Reset kicks and trigger clean draw raise animation
    this.slideKick = 0;
    this.boltKick = 0;
    this.isSlashing = false;
    this.isStabbing = false;
    this.drawProgress = 0.0;

    // Adjust arm position per weapon category
    if (weaponId === 'desert-eagle' || weaponId === 'garam-karambit') {
      this.rightArm.position.set(0.08, -0.14, 0.08);
    } else {
      this.rightArm.position.set(0.12, -0.18, 0.08);
    }
  }

  public getWeaponId(): string {
    return this.currentWeaponId;
  }

  // 1. ELDAR'S CUSTOM DESERT EAGLE
  private createDesertEagleMesh(): THREE.Group {
    const group = new THREE.Group();

    const frameGeo = new THREE.BoxGeometry(0.042, 0.14, 0.13);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c20,
      roughness: 0.35,
      metalness: 0.85,
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, -0.06, 0.02);
    frame.rotation.x = -0.22;
    group.add(frame);

    const medGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.044, 16);
    medGeo.rotateZ(Math.PI / 2);
    const medMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.15,
      metalness: 0.95,
    });
    const medallion = new THREE.Mesh(medGeo, medMat);
    medallion.position.set(0, -0.05, 0.02);
    group.add(medallion);

    const slideGeo = new THREE.BoxGeometry(0.046, 0.062, 0.25);
    const slideMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f45,
      roughness: 0.2,
      metalness: 0.9,
    });
    const slide = new THREE.Mesh(slideGeo, slideMat);
    slide.position.set(0, 0.02, -0.05);
    group.add(slide);
    this.slideMeshes.set('desert-eagle', slide);

    const topGeo = new THREE.BoxGeometry(0.048, 0.012, 0.23);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xd91438,
      roughness: 0.25,
      metalness: 0.7,
    });
    const topStripe = new THREE.Mesh(topGeo, topMat);
    topStripe.position.set(0, 0.035, 0);
    slide.add(topStripe);

    const barrelGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.09, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.95, roughness: 0.15 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.02, -0.19);
    group.add(barrel);

    group.position.set(0.02, -0.01, -0.1);
    group.visible = false;
    return group;
  }

  // 2. GARAM-47
  private createGaram47Mesh(): THREE.Group {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.052, 0.085, 0.4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.35, metalness: 0.88 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const dustGeo = new THREE.BoxGeometry(0.054, 0.02, 0.28);
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xd91438, roughness: 0.25, metalness: 0.65 });
    const dust = new THREE.Mesh(dustGeo, dustMat);
    dust.position.set(0, 0.05, -0.04);
    group.add(dust);

    const magGeo = new THREE.BoxGeometry(0.036, 0.2, 0.09);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.5, metalness: 0.75 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.12, -0.06);
    mag.rotation.x = -0.28;
    group.add(mag);

    const gripGeo = new THREE.BoxGeometry(0.05, 0.065, 0.18);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x6e3d22, roughness: 0.55, metalness: 0.05 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, -0.01, -0.24);
    group.add(grip);

    const barrelGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.34, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.2, metalness: 0.95 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.022, -0.38);
    group.add(barrel);

    group.visible = false;
    return group;
  }

  // 3. VANGUARD M4A1-S
  private createVanguardM4Mesh(): THREE.Group {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.048, 0.08, 0.38);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.25, metalness: 0.9 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const magGeo = new THREE.BoxGeometry(0.032, 0.17, 0.07);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x2e353d, roughness: 0.4, metalness: 0.8 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.11, -0.04);
    group.add(mag);

    const railGeo = new THREE.BoxGeometry(0.032, 0.016, 0.3);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.92, roughness: 0.2 });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(0, 0.048, -0.04);
    group.add(rail);

    const supGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.32, 20);
    supGeo.rotateX(Math.PI / 2);
    const supMat = new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.3, metalness: 0.88 });
    const suppressor = new THREE.Mesh(supGeo, supMat);
    suppressor.position.set(0, 0.015, -0.38);
    group.add(suppressor);

    const bandGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.032, 20);
    bandGeo.rotateX(Math.PI / 2);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x00d4ff,
      roughness: 0.2,
      metalness: 0.7,
      emissive: 0x003344,
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, 0.015, -0.3);
    group.add(band);

    group.visible = false;
    return group;
  }

  // 4. SOVEREIGN AWP
  private createSovereignAWPMesh(): THREE.Group {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.058, 0.095, 0.52);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x25352b, roughness: 0.45, metalness: 0.35 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const barrelGeo = new THREE.CylinderGeometry(0.018, 0.015, 0.48, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.2, metalness: 0.95 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.025, -0.46);
    group.add(barrel);

    const scopeGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.28, 20);
    scopeGeo.rotateX(Math.PI / 2);
    const scopeMat = new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.15, metalness: 0.92 });
    const scope = new THREE.Mesh(scopeGeo, scopeMat);
    scope.position.set(0, 0.088, -0.06);
    group.add(scope);

    const ringGeo = new THREE.BoxGeometry(0.034, 0.038, 0.024);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd91438, metalness: 0.75, roughness: 0.3 });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.position.set(0, 0.062, -0.14);
    const ring2 = new THREE.Mesh(ringGeo, ringMat);
    ring2.position.set(0, 0.062, 0.02);
    group.add(ring1, ring2);

    const boltGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.07, 12);
    boltGeo.rotateZ(Math.PI / 2);
    const bolt = new THREE.Mesh(boltGeo, ringMat);
    bolt.position.set(0.048, 0.042, 0.08);
    group.add(bolt);
    this.boltMeshes.set('sovereign-awp', bolt);

    group.visible = false;
    return group;
  }

  // 5. GARAM CRIMSON KARAMBIT
  private createKarambitMesh(): THREE.Group {
    const group = new THREE.Group();

    const handleGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.15, 16);
    handleGeo.rotateX(Math.PI / 3);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.85 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    group.add(handle);

    const ringGeo = new THREE.TorusGeometry(0.024, 0.007, 12, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.95, roughness: 0.15 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, -0.065, 0.09);
    group.add(ring);

    const bladeGeo = new THREE.ConeGeometry(0.034, 0.18, 16);
    bladeGeo.rotateX(-Math.PI / 2.4);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xee153a,
      roughness: 0.12,
      metalness: 0.88,
    });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(0, 0.045, -0.11);
    group.add(blade);

    group.position.set(0.05, -0.04, -0.15);
    group.visible = false;
    return group;
  }

  public fireRecoil(pitchKick = 0.07, zKick = 0.05): void {
    if (this.currentWeaponId === 'garam-karambit') {
      this.triggerSlash();
      return;
    }

    this.recoilPitch += pitchKick;
    this.recoilZ += zKick;

    if (this.currentWeaponId === 'desert-eagle') {
      this.slideKick = 0.04;
    }

    if (this.currentWeaponId === 'sovereign-awp') {
      this.boltKick = 0.07;
    }

    this.muzzleFlashLight.intensity = 5.5;
    setTimeout(() => {
      this.muzzleFlashLight.intensity = 0.0;
    }, 40);
  }

  public triggerSlash(): void {
    this.isSlashing = true;
    this.slashTime = 0;
  }

  public triggerStab(): void {
    this.isStabbing = true;
    this.stabTime = 0;
  }

  public update(dt: number, mouseDeltaX: number, mouseDeltaY: number, walkBob: number, strafeRoll: number): void {
    if (this.isScoped) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Equip draw raise animation (0 to 1 over 0.25s)
    let drawY = 0;
    if (this.drawProgress < 1.0) {
      this.drawProgress = Math.min(1.0, this.drawProgress + dt * 4.0);
      drawY = (1.0 - this.drawProgress) * -0.18;
    }

    // Slide blowback recovery
    const slide = this.slideMeshes.get(this.currentWeaponId);
    if (slide) {
      this.slideKick += (0 - this.slideKick) * (1 - Math.exp(-32 * dt));
      slide.position.z = -0.05 + this.slideKick;
    }

    // Bolt handle recovery
    const bolt = this.boltMeshes.get(this.currentWeaponId);
    if (bolt) {
      this.boltKick += (0 - this.boltKick) * (1 - Math.exp(-14 * dt));
      bolt.position.z = 0.08 + this.boltKick;
    }

    // Melee animations
    let meleeYaw = 0;
    let meleePitch = 0;
    let meleeZ = 0;

    if (this.isSlashing) {
      this.slashTime += dt * 5.0;
      if (this.slashTime >= Math.PI) {
        this.isSlashing = false;
        this.slashTime = 0;
      } else {
        meleeYaw = -Math.sin(this.slashTime) * 0.45;
        meleePitch = Math.sin(this.slashTime) * 0.35;
      }
    } else if (this.isStabbing) {
      this.stabTime += dt * 4.2;
      if (this.stabTime >= Math.PI) {
        this.isStabbing = false;
        this.stabTime = 0;
      } else {
        meleeZ = -Math.sin(this.stabTime) * 0.12;
        meleePitch = -Math.sin(this.stabTime) * 0.22;
      }
    }

    // Reload animation dip & roll
    let reloadY = 0;
    let reloadRoll = 0;
    if (this.isReloading) {
      reloadY = -0.08 * Math.sin(this.reloadProgress * Math.PI);
      reloadRoll = 0.25 * Math.sin(this.reloadProgress * Math.PI);
    }

    // 3D Hooke's Law spring-damper for mouse sway
    const k = 150;
    const c = 18;

    const swayX = -mouseDeltaX * 0.0008;
    const swayY = mouseDeltaY * 0.0008;

    this.targetRot.y = Math.max(-0.16, Math.min(0.16, swayX)) + meleeYaw;
    this.targetRot.x = Math.max(-0.16, Math.min(0.16, swayY)) + this.recoilPitch + meleePitch;
    this.targetRot.z = strafeRoll + reloadRoll;

    // Decay recoil kicks
    this.recoilPitch += (0 - this.recoilPitch) * (1 - Math.exp(-22 * dt));
    this.recoilZ += (0 - this.recoilZ) * (1 - Math.exp(-24 * dt));

    this.targetPos.z = -0.45 + this.recoilZ + meleeZ;
    this.targetPos.y = -0.22 + walkBob + reloadY + drawY;

    // Spring position update
    const fX = -k * (this.currentPos.x - this.targetPos.x) - c * this.velPos.x;
    const fY = -k * (this.currentPos.y - this.targetPos.y) - c * this.velPos.y;
    const fZ = -k * (this.currentPos.z - this.targetPos.z) - c * this.velPos.z;

    this.velPos.x += fX * dt;
    this.velPos.y += fY * dt;
    this.velPos.z += fZ * dt;

    this.currentPos.addScaledVector(this.velPos, dt);
    this.mesh.position.copy(this.currentPos);

    // Rotation interpolation
    this.currentRot.x += (this.targetRot.x - this.currentRot.x) * (1 - Math.exp(-18 * dt));
    this.currentRot.y += (this.targetRot.y - this.currentRot.y) * (1 - Math.exp(-18 * dt));
    this.currentRot.z += (this.targetRot.z - this.currentRot.z) * (1 - Math.exp(-18 * dt));
    this.mesh.rotation.copy(this.currentRot);
  }
}
