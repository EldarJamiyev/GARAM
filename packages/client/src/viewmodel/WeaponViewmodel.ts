import * as THREE from 'three';

export class WeaponViewmodel {
  public mesh: THREE.Group;
  private weaponContainer: THREE.Group;
  private rightArm: THREE.Mesh;
  private muzzleFlashLight: THREE.PointLight;
  private currentWeaponId = 'garam-47';

  // Weapon parts for slide blowback & bolt animation
  private slideMesh: THREE.Mesh | null = null;
  private slideKick = 0;
  private boltMesh: THREE.Mesh | null = null;
  private boltKick = 0;

  // Melee slash animation
  private isSlashing = false;
  private slashTime = 0;

  // Reload tilt
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

    // Build initial weapon
    this.buildWeaponMesh('garam-47');
    this.mesh.position.copy(this.currentPos);
  }

  public setWeapon(weaponId: string): void {
    if (this.currentWeaponId === weaponId) return;
    this.currentWeaponId = weaponId;
    this.buildWeaponMesh(weaponId);
  }

  public getWeaponId(): string {
    return this.currentWeaponId;
  }

  private buildWeaponMesh(id: string): void {
    // Clear previous weapon
    while (this.weaponContainer.children.length > 0) {
      this.weaponContainer.remove(this.weaponContainer.children[0]);
    }
    this.slideMesh = null;
    this.boltMesh = null;
    this.isSlashing = false;

    if (id === 'desert-eagle') {
      this.buildDesertEagle();
    } else if (id === 'vanguard-m4') {
      this.buildVanguardM4();
    } else if (id === 'sovereign-awp') {
      this.buildSovereignAWP();
    } else if (id === 'garam-karambit') {
      this.buildKarambit();
    } else {
      this.buildGaram47();
    }
  }

  // 1. ELDAR'S CUSTOM DESERT EAGLE (Hand Cannon)
  private buildDesertEagle(): void {
    const group = new THREE.Group();

    // Matte tactical frame
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

    // Gold grip medallion emblem (Eldar's Signature Crest)
    const medGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.044, 16);
    medGeo.rotateZ(Math.PI / 2);
    const medMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Polished Gold
      roughness: 0.15,
      metalness: 0.95,
    });
    const medallion = new THREE.Mesh(medGeo, medMat);
    medallion.position.set(0, -0.05, 0.02);
    group.add(medallion);

    // Slide (Blowback recoiling element with brushed chrome & crimson bevel)
    const slideGeo = new THREE.BoxGeometry(0.046, 0.062, 0.25);
    const slideMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f45,
      roughness: 0.2,
      metalness: 0.9,
    });
    this.slideMesh = new THREE.Mesh(slideGeo, slideMat);
    this.slideMesh.position.set(0, 0.02, -0.05);
    group.add(this.slideMesh);

    // Crimson Top Engraving Slide
    const topGeo = new THREE.BoxGeometry(0.048, 0.012, 0.23);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xd91438, // Garam Crimson
      roughness: 0.25,
      metalness: 0.7,
    });
    const topStripe = new THREE.Mesh(topGeo, topMat);
    topStripe.position.set(0, 0.035, 0);
    this.slideMesh.add(topStripe);

    // Heavy caliber barrel tip
    const barrelGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.09, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.95, roughness: 0.15 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.02, -0.19);
    group.add(barrel);

    // Position pistol comfortably in view
    group.position.set(0.02, -0.01, -0.1);
    this.weaponContainer.add(group);
    this.rightArm.position.set(0.08, -0.14, 0.08);
  }

  // 2. GARAM-47 (Assault Rifle)
  private buildGaram47(): void {
    const group = new THREE.Group();

    // Milled Steel Receiver
    const bodyGeo = new THREE.BoxGeometry(0.052, 0.085, 0.4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.35, metalness: 0.88 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Crimson Anodized Dust Cover
    const dustGeo = new THREE.BoxGeometry(0.054, 0.02, 0.28);
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xd91438, roughness: 0.25, metalness: 0.65 });
    const dust = new THREE.Mesh(dustGeo, dustMat);
    dust.position.set(0, 0.05, -0.04);
    group.add(dust);

    // Curved Steel Banana Magazine
    const magGeo = new THREE.BoxGeometry(0.036, 0.2, 0.09);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.5, metalness: 0.75 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.12, -0.06);
    mag.rotation.x = -0.28;
    group.add(mag);

    // Walnut Wood Foregrip
    const gripGeo = new THREE.BoxGeometry(0.05, 0.065, 0.18);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x6e3d22, roughness: 0.55, metalness: 0.05 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, -0.01, -0.24);
    group.add(grip);

    // Rifle Barrel & Slanted Muzzle Compensator
    const barrelGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.34, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.2, metalness: 0.95 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.022, -0.38);
    group.add(barrel);

    // Front sight post
    const sightGeo = new THREE.BoxGeometry(0.012, 0.035, 0.018);
    const sight = new THREE.Mesh(sightGeo, barrelMat);
    sight.position.set(0, 0.045, -0.5);
    group.add(sight);

    this.weaponContainer.add(group);
    this.rightArm.position.set(0.12, -0.18, 0.08);
  }

  // 3. VANGUARD M4A1-S (Suppressed Tactical Rifle)
  private buildVanguardM4(): void {
    const group = new THREE.Group();

    // Matte Navy/Black Modern Monolithic Upper
    const bodyGeo = new THREE.BoxGeometry(0.048, 0.08, 0.38);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.25, metalness: 0.9 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Straight STANAG Magazine
    const magGeo = new THREE.BoxGeometry(0.032, 0.17, 0.07);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x2e353d, roughness: 0.4, metalness: 0.8 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.11, -0.04);
    group.add(mag);

    // Top Picatinny Rail
    const railGeo = new THREE.BoxGeometry(0.032, 0.016, 0.3);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.92, roughness: 0.2 });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(0, 0.048, -0.04);
    group.add(rail);

    // Signature Long Cylindrical Tactical Sound Suppressor
    const supGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.32, 20);
    supGeo.rotateX(Math.PI / 2);
    const supMat = new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.3, metalness: 0.88 });
    const suppressor = new THREE.Mesh(supGeo, supMat);
    suppressor.position.set(0, 0.015, -0.38);
    group.add(suppressor);

    // Vanguard Cyan Accent Ring
    const bandGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.032, 20);
    bandGeo.rotateX(Math.PI / 2);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x00d4ff, // Neon Vanguard Cyan
      roughness: 0.2,
      metalness: 0.7,
      emissive: 0x003344,
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, 0.015, -0.3);
    group.add(band);

    this.weaponContainer.add(group);
    this.rightArm.position.set(0.12, -0.18, 0.08);
  }

  // 4. SOVEREIGN AWP (Heavy Anti-Materiel Sniper Rifle)
  private buildSovereignAWP(): void {
    const group = new THREE.Group();

    // Heavy Arctic/Olive Sniper Stock & Chassis
    const bodyGeo = new THREE.BoxGeometry(0.058, 0.095, 0.52);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x25352b, roughness: 0.45, metalness: 0.35 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Fluted Heavy Sniper Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.018, 0.015, 0.48, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.2, metalness: 0.95 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.025, -0.46);
    group.add(barrel);

    // Dual-Ring Magnified High-Caliber Optical Scope Tube
    const scopeGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.28, 20);
    scopeGeo.rotateX(Math.PI / 2);
    const scopeMat = new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.15, metalness: 0.92 });
    const scope = new THREE.Mesh(scopeGeo, scopeMat);
    scope.position.set(0, 0.088, -0.06);
    group.add(scope);

    // Scope Mount Rings with Crimson Accent
    const ringGeo = new THREE.BoxGeometry(0.034, 0.038, 0.024);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd91438, metalness: 0.75, roughness: 0.3 });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.position.set(0, 0.062, -0.14);
    const ring2 = new THREE.Mesh(ringGeo, ringMat);
    ring2.position.set(0, 0.062, 0.02);
    group.add(ring1, ring2);

    // Bolt-action handle (Animates during bolt cycle!)
    const boltGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.07, 12);
    boltGeo.rotateZ(Math.PI / 2);
    this.boltMesh = new THREE.Mesh(boltGeo, ringMat);
    this.boltMesh.position.set(0.048, 0.042, 0.08);
    group.add(this.boltMesh);

    this.weaponContainer.add(group);
    this.rightArm.position.set(0.13, -0.18, 0.08);
  }

  // 5. GARAM CRIMSON KARAMBIT (Tactical Melee)
  private buildKarambit(): void {
    const group = new THREE.Group();

    // Textured Polymer Ergonomic Finger-Ring Handle
    const handleGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.15, 16);
    handleGeo.rotateX(Math.PI / 3);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.85 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    group.add(handle);

    // Gold Retaining Safety Finger Ring
    const ringGeo = new THREE.TorusGeometry(0.024, 0.007, 12, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.95, roughness: 0.15 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, -0.065, 0.09);
    group.add(ring);

    // Hawkbill Curved Talon Blade (Anodized Garam Crimson finish)
    const bladeGeo = new THREE.ConeGeometry(0.034, 0.18, 16);
    bladeGeo.rotateX(-Math.PI / 2.4);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xee153a, // Radiant Crimson Blade
      roughness: 0.12,
      metalness: 0.88,
    });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(0, 0.045, -0.11);
    group.add(blade);

    group.position.set(0.05, -0.04, -0.15);
    this.weaponContainer.add(group);
    this.rightArm.position.set(0.08, -0.14, 0.08);
  }

  public fireRecoil(pitchKick = 0.07, zKick = 0.05): void {
    if (this.currentWeaponId === 'garam-karambit') {
      this.triggerSlash();
      return;
    }

    this.recoilPitch += pitchKick;
    this.recoilZ += zKick;

    // Trigger slide blowback if pistol
    if (this.slideMesh) {
      this.slideKick = 0.04;
    }

    // Trigger bolt kick if AWP
    if (this.boltMesh) {
      this.boltKick = 0.06;
    }

    // Muzzle flash light pulse
    this.muzzleFlashLight.intensity = 5.5;
    setTimeout(() => {
      this.muzzleFlashLight.intensity = 0.0;
    }, 40);
  }

  public triggerSlash(): void {
    this.isSlashing = true;
    this.slashTime = 0;
  }

  public update(dt: number, mouseDeltaX: number, mouseDeltaY: number, walkBob: number, strafeRoll: number): void {
    if (this.isScoped) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Slide blowback recovery
    if (this.slideMesh) {
      this.slideKick += (0 - this.slideKick) * (1 - Math.exp(-32 * dt));
      this.slideMesh.position.z = -0.05 + this.slideKick;
    }

    // Bolt handle recovery
    if (this.boltMesh) {
      this.boltKick += (0 - this.boltKick) * (1 - Math.exp(-14 * dt));
      this.boltMesh.position.z = 0.08 + this.boltKick;
    }

    // Melee slash rotation swing
    let slashYaw = 0;
    let slashPitch = 0;
    if (this.isSlashing) {
      this.slashTime += dt * 4.5;
      if (this.slashTime >= Math.PI) {
        this.isSlashing = false;
        this.slashTime = 0;
      } else {
        slashYaw = -Math.sin(this.slashTime) * 0.45;
        slashPitch = Math.sin(this.slashTime) * 0.35;
      }
    }

    // Reload animation dip & tilt
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

    this.targetRot.y = Math.max(-0.16, Math.min(0.16, swayX)) + slashYaw;
    this.targetRot.x = Math.max(-0.16, Math.min(0.16, swayY)) + this.recoilPitch + slashPitch;
    this.targetRot.z = strafeRoll + reloadRoll;

    // Decay recoil kicks
    this.recoilPitch += (0 - this.recoilPitch) * (1 - Math.exp(-22 * dt));
    this.recoilZ += (0 - this.recoilZ) * (1 - Math.exp(-24 * dt));

    this.targetPos.z = -0.45 + this.recoilZ;
    this.targetPos.y = -0.22 + walkBob + reloadY;

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
