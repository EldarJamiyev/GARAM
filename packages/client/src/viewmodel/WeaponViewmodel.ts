import * as THREE from 'three';

export class WeaponViewmodel {
  public mesh: THREE.Group;
  private weaponContainer: THREE.Group;
  private rightArm: THREE.Mesh;
  private muzzleFlashLight: THREE.PointLight;
  private currentWeaponId = 'garam-47';

  // Weapon parts for slide blowback & animation
  private slideMesh: THREE.Mesh | null = null;
  private slideKick = 0;

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
    this.muzzleFlashLight = new THREE.PointLight(0xffaa33, 0, 10);
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

  private buildWeaponMesh(id: string): void {
    // Clear previous weapon
    while (this.weaponContainer.children.length > 0) {
      this.weaponContainer.remove(this.weaponContainer.children[0]);
    }
    this.slideMesh = null;

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

  // 1. ELDAR'S CUSTOM DESERT EAGLE (Pistol)
  private buildDesertEagle(): void {
    const group = new THREE.Group();

    // Pistol Frame / Lower Grip
    const frameGeo = new THREE.BoxGeometry(0.04, 0.14, 0.12);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x181a1d,
      roughness: 0.4,
      metalness: 0.8,
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, -0.06, 0.02);
    frame.rotation.x = -0.22;
    group.add(frame);

    // Gold grip medallion emblem
    const medGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.042, 16);
    medGeo.rotateZ(Math.PI / 2);
    const medMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Metallic Gold
      roughness: 0.2,
      metalness: 0.9,
    });
    const medallion = new THREE.Mesh(medGeo, medMat);
    medallion.position.set(0, -0.05, 0.02);
    group.add(medallion);

    // Slide (Blowback recoiling element with crimson accent)
    const slideGeo = new THREE.BoxGeometry(0.045, 0.06, 0.24);
    const slideMat = new THREE.MeshStandardMaterial({
      color: 0x22262a,
      roughness: 0.25,
      metalness: 0.9,
    });
    this.slideMesh = new THREE.Mesh(slideGeo, slideMat);
    this.slideMesh.position.set(0, 0.02, -0.05);
    group.add(this.slideMesh);

    // Crimson Top Engraving Slide
    const topGeo = new THREE.BoxGeometry(0.046, 0.01, 0.22);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xd91438,
      roughness: 0.3,
      metalness: 0.6,
    });
    const topStripe = new THREE.Mesh(topGeo, topMat);
    topStripe.position.set(0, 0.035, 0);
    this.slideMesh.add(topStripe);

    // Barrel tip
    const barrelGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.08, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.95, roughness: 0.2 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.02, -0.18);
    group.add(barrel);

    // Adjust position for pistol viewmodel
    group.position.set(0.02, -0.02, -0.1);
    this.weaponContainer.add(group);
    this.rightArm.position.set(0.08, -0.14, 0.08);
  }

  // 2. GARAM-47 (Assault Rifle)
  private buildGaram47(): void {
    const group = new THREE.Group();

    // Receiver Body
    const bodyGeo = new THREE.BoxGeometry(0.05, 0.08, 0.38);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.35, metalness: 0.85 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Crimson Dust Cover
    const dustGeo = new THREE.BoxGeometry(0.052, 0.018, 0.26);
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xd91438, roughness: 0.3, metalness: 0.5 });
    const dust = new THREE.Mesh(dustGeo, dustMat);
    dust.position.set(0, 0.045, -0.04);
    group.add(dust);

    // Curved Banana Magazine
    const magGeo = new THREE.BoxGeometry(0.035, 0.18, 0.08);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x222528, roughness: 0.5, metalness: 0.7 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.11, -0.06);
    mag.rotation.x = -0.28;
    group.add(mag);

    // Wooden / Polymer Foregrip
    const gripGeo = new THREE.BoxGeometry(0.048, 0.06, 0.16);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x6e3d22, roughness: 0.6, metalness: 0.1 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, -0.01, -0.22);
    group.add(grip);

    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.32, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0f1011, roughness: 0.2, metalness: 0.95 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.02, -0.36);
    group.add(barrel);

    this.weaponContainer.add(group);
    this.rightArm.position.set(0.12, -0.18, 0.08);
  }

  // 3. VANGUARD M4A1-S (Suppressed Rifle)
  private buildVanguardM4(): void {
    const group = new THREE.Group();

    // Sleek Modern Receiver
    const bodyGeo = new THREE.BoxGeometry(0.048, 0.075, 0.36);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f2327, roughness: 0.25, metalness: 0.9 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Straight STANAG Magazine
    const magGeo = new THREE.BoxGeometry(0.032, 0.16, 0.065);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.4, metalness: 0.8 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.1, -0.04);
    group.add(mag);

    // Top Picatinny Rail
    const railGeo = new THREE.BoxGeometry(0.03, 0.015, 0.28);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.9, roughness: 0.2 });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(0, 0.045, -0.04);
    group.add(rail);

    // Long Cylindrical Tactical Suppressor (M4A1-S Signature)
    const supGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.28, 20);
    supGeo.rotateX(Math.PI / 2);
    const supMat = new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.3, metalness: 0.85 });
    const suppressor = new THREE.Mesh(supGeo, supMat);
    suppressor.position.set(0, 0.015, -0.36);
    group.add(suppressor);

    // Blue Vanguard Accent Band
    const bandGeo = new THREE.CylinderGeometry(0.023, 0.023, 0.03, 20);
    bandGeo.rotateX(Math.PI / 2);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x3b9eff, roughness: 0.2, metalness: 0.6 });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, 0.015, -0.28);
    group.add(band);

    this.weaponContainer.add(group);
    this.rightArm.position.set(0.12, -0.18, 0.08);
  }

  // 4. SOVEREIGN AWP (Heavy Sniper Rifle)
  private buildSovereignAWP(): void {
    const group = new THREE.Group();

    // Heavy Stock and Long Receiver
    const bodyGeo = new THREE.BoxGeometry(0.055, 0.09, 0.48);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x223026, roughness: 0.4, metalness: 0.4 }); // Olive-drab sniper stock
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Fluted Heavy Sniper Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.018, 0.016, 0.45, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0e1012, roughness: 0.2, metalness: 0.95 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.025, -0.44);
    group.add(barrel);

    // Large Dual-Ring Magnified Optical Scope Tube
    const scopeGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.26, 20);
    scopeGeo.rotateX(Math.PI / 2);
    const scopeMat = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.15, metalness: 0.9 });
    const scope = new THREE.Mesh(scopeGeo, scopeMat);
    scope.position.set(0, 0.085, -0.05);
    group.add(scope);

    // Scope Mount Rings
    const ringGeo = new THREE.BoxGeometry(0.03, 0.035, 0.02);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd91438, metalness: 0.7, roughness: 0.3 });
    const ring1 = new THREE.Mesh(ringGeo, ringMat);
    ring1.position.set(0, 0.06, -0.12);
    const ring2 = new THREE.Mesh(ringGeo, ringMat);
    ring2.position.set(0, 0.06, 0.02);
    group.add(ring1, ring2);

    // Bolt-action handle
    const boltGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.06, 12);
    boltGeo.rotateZ(Math.PI / 2);
    const bolt = new THREE.Mesh(boltGeo, ringMat);
    bolt.position.set(0.045, 0.04, 0.08);
    group.add(bolt);

    this.weaponContainer.add(group);
    this.rightArm.position.set(0.13, -0.18, 0.08);
  }

  // 5. GARAM CRIMSON KARAMBIT (Melee Knife)
  private buildKarambit(): void {
    const group = new THREE.Group();

    // Tactical Polymer Handle with Finger Ring
    const handleGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.14, 16);
    handleGeo.rotateX(Math.PI / 3);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.8 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    group.add(handle);

    // Safety Finger Ring at base
    const ringGeo = new THREE.TorusGeometry(0.022, 0.006, 12, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, -0.06, 0.08);
    group.add(ring);

    // Curved Claw Blade (Crimson Anodized Finish)
    const bladeGeo = new THREE.ConeGeometry(0.032, 0.16, 16);
    bladeGeo.rotateX(-Math.PI / 2.5);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xd91438,
      roughness: 0.15,
      metalness: 0.85,
    });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(0, 0.04, -0.1);
    group.add(blade);

    group.position.set(0.05, -0.04, -0.15);
    this.weaponContainer.add(group);
    this.rightArm.position.set(0.08, -0.14, 0.08);
  }

  public fireRecoil(pitchKick = 0.07, zKick = 0.05): void {
    this.recoilPitch += pitchKick;
    this.recoilZ += zKick;

    // Trigger slide blowback if pistol
    if (this.slideMesh) {
      this.slideKick = 0.035;
    }

    // Flash light trigger
    this.muzzleFlashLight.intensity = 5.0;
    setTimeout(() => {
      this.muzzleFlashLight.intensity = 0.0;
    }, 45);
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

    // 3D Hooke's Law spring-damper for mouse sway
    const k = 150;
    const c = 18;

    const swayX = -mouseDeltaX * 0.0008;
    const swayY = mouseDeltaY * 0.0008;

    this.targetRot.y = Math.max(-0.16, Math.min(0.16, swayX));
    this.targetRot.x = Math.max(-0.16, Math.min(0.16, swayY)) + this.recoilPitch;
    this.targetRot.z = strafeRoll;

    // Decay recoil kicks
    this.recoilPitch += (0 - this.recoilPitch) * (1 - Math.exp(-22 * dt));
    this.recoilZ += (0 - this.recoilZ) * (1 - Math.exp(-24 * dt));

    this.targetPos.z = -0.45 + this.recoilZ;
    this.targetPos.y = -0.22 + walkBob;

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
