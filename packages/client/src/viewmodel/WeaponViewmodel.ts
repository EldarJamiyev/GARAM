import * as THREE from 'three';

export class WeaponViewmodel {
  public mesh: THREE.Group;
  private weaponContainer: THREE.Group;
  private rightArm: THREE.Group;
  private leftArm: THREE.Group;
  private muzzleFlashLight: THREE.PointLight;
  private muzzleFlashMesh: THREE.Group;
  private flashTimer = 0;
  private currentWeaponId = 'garam-47';

  // Cached 5 Weapon Groups
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
  private isInspecting = false;
  private inspectTime = 0;

  // Draw transition (0 to 1 over 0.25s)
  private drawProgress = 1.0;

  // Reload state
  public isReloading = false;
  public reloadProgress = 0;

  // Spring physics states
  private targetPos = new THREE.Vector3(0.20, -0.20, -0.38);
  private currentPos = new THREE.Vector3(0.20, -0.20, -0.38);
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

    // 1. Right Tactical Gloved Arm
    this.rightArm = this.buildTacticalGlove(false);
    this.mesh.add(this.rightArm);

    // 2. Left Support Arm & Gloved Hand
    this.leftArm = this.buildTacticalGlove(true);
    this.mesh.add(this.leftArm);

    // 3. Muzzle Flash Point Light & 3D Star Planes
    this.muzzleFlashLight = new THREE.PointLight(0xffb844, 0, 14);
    this.muzzleFlashLight.position.set(0, 0.02, -0.54);
    this.mesh.add(this.muzzleFlashLight);

    this.muzzleFlashMesh = this.buildMuzzleFlash();
    this.muzzleFlashMesh.position.set(0, 0.02, -0.54);
    this.muzzleFlashMesh.visible = false;
    this.mesh.add(this.muzzleFlashMesh);

    // Pre-build and cache all 5 weapon models
    this.buildAllWeaponMeshes();
    this.setWeapon('garam-47');
    this.mesh.position.copy(this.currentPos);
  }

  private buildTacticalGlove(isLeft: boolean): THREE.Group {
    const glove = new THREE.Group();
    const fabricMat = new THREE.MeshStandardMaterial({
      color: 0x16181b,
      roughness: 0.85,
      metalness: 0.12,
    });
    const knuckleMat = new THREE.MeshStandardMaterial({
      color: 0x0c0e10,
      roughness: 0.3,
      metalness: 0.75,
    });
    const cuffMat = new THREE.MeshStandardMaterial({
      color: 0x242830,
      roughness: 0.6,
      metalness: 0.35,
    });

    // Forearm sleeve angled into frame
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.054, 0.36, 12), fabricMat);
    sleeve.position.set(0, -0.04, 0.16);
    sleeve.rotation.x = Math.PI / 2.3;
    glove.add(sleeve);

    // Tactical Glove Cuff
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 12), cuffMat);
    cuff.position.set(0, -0.02, 0.04);
    cuff.rotation.x = Math.PI / 2.3;
    glove.add(cuff);

    // Palm & Back of Hand
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.038, 0.075), fabricMat);
    palm.position.set(0, 0, -0.015);
    glove.add(palm);

    // Carbon-Fiber Armor Knuckle Guard
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.014, 0.032), knuckleMat);
    knuckles.position.set(0, 0.02, -0.015);
    glove.add(knuckles);

    // 4 Articulated Fingers (Curled around grip)
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.015 * (isLeft ? -1 : 1);
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.016, 0.042), fabricMat);
      finger.position.set(fx, -0.01, -0.055);
      finger.rotation.x = 0.55;
      glove.add(finger);
    }

    // Opposable Thumb
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.04), fabricMat);
    const thumbX = isLeft ? 0.032 : -0.032;
    thumb.position.set(thumbX, 0.01, -0.035);
    thumb.rotation.y = isLeft ? 0.6 : -0.6;
    thumb.rotation.x = 0.3;
    glove.add(thumb);

    return glove;
  }

  private buildMuzzleFlash(): THREE.Group {
    const flashGroup = new THREE.Group();
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe077,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });

    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), flashMat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), flashMat);
    p2.rotation.y = Math.PI / 2;
    const p3 = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), flashMat);
    p3.rotation.z = Math.PI / 4;

    flashGroup.add(p1);
    flashGroup.add(p2);
    flashGroup.add(p3);
    return flashGroup;
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

    this.weaponMeshes.forEach((mesh, id) => {
      mesh.visible = id === weaponId;
    });

    this.slideKick = 0;
    this.boltKick = 0;
    this.isSlashing = false;
    this.isStabbing = false;
    this.isInspecting = false;
    this.drawProgress = 0.0;

    // Adjust left & right arms depending on weapon type
    if (weaponId === 'desert-eagle') {
      // 2-handed Weaver pistol grip firmly supporting .50 AE frame
      this.rightArm.position.set(0.05, -0.08, -0.06);
      this.rightArm.rotation.set(0.22, -0.08, 0.12);
      this.leftArm.visible = true;
      this.leftArm.position.set(0.0, -0.10, -0.08);
      this.leftArm.rotation.set(0.28, 0.42, -0.18);
    } else if (weaponId === 'garam-karambit') {
      // 1-handed reverse tactical knife grip through index ring
      this.rightArm.position.set(0.07, -0.07, -0.08);
      this.rightArm.rotation.set(0.32, -0.18, 0.22);
      this.leftArm.visible = false;
    } else {
      // 2-handed rifle support with visible gloved left hand holding handguard
      this.rightArm.position.set(0.06, -0.10, 0.02);
      this.rightArm.rotation.set(0.18, -0.1, 0.1);
      this.leftArm.visible = true;
      this.leftArm.position.set(-0.06, -0.08, -0.24);
      this.leftArm.rotation.set(-0.15, 0.45, -0.1);
    }
  }

  // 1. ELDAR'S CUSTOM DESERT EAGLE (.50 AE)
  private createDesertEagleMesh(): THREE.Group {
    const group = new THREE.Group();

    // Heavy Steel Frame
    const frameGeo = new THREE.BoxGeometry(0.038, 0.13, 0.12);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.35, metalness: 0.85 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, -0.05, 0.01);
    frame.rotation.x = -0.22;
    group.add(frame);

    // Textured Grip Panels
    const gripPanelMat = new THREE.MeshStandardMaterial({ color: 0x121416, roughness: 0.88, metalness: 0.1 });
    const gripL = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.10, 0.07), gripPanelMat);
    gripL.position.set(-0.018, -0.05, 0.01);
    gripL.rotation.x = -0.22;
    group.add(gripL);
    const gripR = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.10, 0.07), gripPanelMat);
    gripR.position.set(0.018, -0.05, 0.01);
    gripR.rotation.x = -0.22;
    group.add(gripR);

    // Gold GARAM Medallion on Grip
    const medGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.042, 16);
    medGeo.rotateZ(Math.PI / 2);
    const medMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.15, metalness: 0.95 });
    const medallion = new THREE.Mesh(medGeo, medMat);
    medallion.position.set(0, -0.045, 0.01);
    group.add(medallion);

    // Trigger Guard & Trigger
    const triggerGuard = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.4, metalness: 0.8 })
    );
    triggerGuard.position.set(0, -0.03, -0.04);
    group.add(triggerGuard);

    // Chamfered Slide (.50 AE Heavy Blowback)
    const slideGeo = new THREE.BoxGeometry(0.042, 0.055, 0.22);
    const slideMat = new THREE.MeshStandardMaterial({ color: 0x363b42, roughness: 0.25, metalness: 0.9 });
    const slide = new THREE.Mesh(slideGeo, slideMat);
    slide.position.set(0, 0.015, -0.04);
    group.add(slide);
    this.slideMeshes.set('desert-eagle', slide);

    // Crimson Top Stripe
    const topGeo = new THREE.BoxGeometry(0.044, 0.01, 0.20);
    const topMat = new THREE.MeshStandardMaterial({ color: 0xd91438, roughness: 0.25, metalness: 0.65 });
    const topStripe = new THREE.Mesh(topGeo, topMat);
    topStripe.position.set(0, 0.03, 0);
    slide.add(topStripe);

    // Rear Combat Sights
    const rearSight = new THREE.Mesh(
      new THREE.BoxGeometry(0.034, 0.014, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x10ff66 })
    );
    rearSight.position.set(0, 0.035, 0.09);
    slide.add(rearSight);

    // Front Sight Post
    const frontSight = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.016, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x10ff66 })
    );
    frontSight.position.set(0, 0.035, -0.09);
    slide.add(frontSight);

    // Fluted Barrel with Recessed Crown
    const barrelGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.09, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.95, roughness: 0.15 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(0, 0.015, -0.16);
    group.add(barrel);

    group.position.set(0.03, 0.01, -0.14);
    group.visible = false;
    return group;
  }

  // 2. GARAM-47 (TACTICAL AK-47 WITH CRIMSON TRIM)
  private createGaram47Mesh(): THREE.Group {
    const group = new THREE.Group();

    // Milled Steel Receiver
    const bodyGeo = new THREE.BoxGeometry(0.052, 0.085, 0.42);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.35, metalness: 0.88 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Picatinny Top Rail
    const railGeo = new THREE.BoxGeometry(0.036, 0.014, 0.34);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.3, metalness: 0.9 });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(0, 0.052, -0.04);
    group.add(rail);

    // Crimson Ribbed Dust Cover
    const dustGeo = new THREE.BoxGeometry(0.054, 0.022, 0.26);
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xd91438, roughness: 0.25, metalness: 0.65 });
    const dust = new THREE.Mesh(dustGeo, dustMat);
    dust.position.set(0, 0.058, -0.04);
    group.add(dust);

    // Curved Banana Magazine
    const magGeo = new THREE.BoxGeometry(0.038, 0.22, 0.095);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.5, metalness: 0.75 });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.13, -0.07);
    mag.rotation.x = -0.32;
    group.add(mag);

    // Textured Polymer Handguard
    const gripGeo = new THREE.BoxGeometry(0.05, 0.065, 0.20);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x282b30, roughness: 0.85 });
    const handguard = new THREE.Mesh(gripGeo, gripMat);
    handguard.position.set(0, -0.01, -0.26);
    group.add(handguard);

    // Gas Block & Tube
    const gasGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.22, 12);
    gasGeo.rotateX(Math.PI / 2);
    const gasTube = new THREE.Mesh(gasGeo, bodyMat);
    gasTube.position.set(0, 0.042, -0.26);
    group.add(gasTube);

    // Cold-Hammered Steel Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.30, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, bodyMat);
    barrel.position.set(0, 0.015, -0.44);
    group.add(barrel);

    // Muzzle Compensator
    const compGeo = new THREE.BoxGeometry(0.026, 0.026, 0.06);
    const compMat = new THREE.MeshStandardMaterial({ color: 0xd91438, metalness: 0.85, roughness: 0.3 });
    const comp = new THREE.Mesh(compGeo, compMat);
    comp.position.set(0, 0.015, -0.58);
    group.add(comp);

    // Front Iron Sight Post
    const sightGeo = new THREE.BoxGeometry(0.008, 0.032, 0.012);
    const sightMat = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
    const sight = new THREE.Mesh(sightGeo, sightMat);
    sight.position.set(0, 0.048, -0.54);
    group.add(sight);

    // Ergonomic Pistol Grip
    const pGrip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.13, 0.06), gripMat);
    pGrip.position.set(0, -0.09, 0.12);
    pGrip.rotation.x = -0.35;
    group.add(pGrip);

    group.position.set(0.03, -0.04, -0.08);
    group.visible = false;
    return group;
  }

  // 3. VANGUARD M4A1-S (SUPPRESSED TACTICAL CARBINE)
  private createVanguardM4Mesh(): THREE.Group {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f2429, roughness: 0.35, metalness: 0.85 });
    const cyanMat = new THREE.MeshStandardMaterial({ color: 0x3b9eff, roughness: 0.25, metalness: 0.7 });

    // Upper & Lower Receiver
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.09, 0.36), bodyMat);
    group.add(receiver);

    // Cyan Vanguard Upper Stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.32), cyanMat);
    stripe.position.set(0, 0.05, 0);
    group.add(stripe);

    // Carry Handle & Optic Mount
    const carry = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.035, 0.18), bodyMat);
    carry.position.set(0, 0.075, 0.02);
    group.add(carry);

    // Straight STANAG Magazine
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.17, 0.075), bodyMat);
    mag.position.set(0, -0.11, -0.06);
    mag.rotation.x = -0.14;
    group.add(mag);

    // Quad-Rail Handguard
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.22), bodyMat);
    handguard.position.set(0, 0.01, -0.26);
    group.add(handguard);

    // Monolithic Cylindrical Sound Suppressor
    const supGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.28, 16);
    supGeo.rotateX(Math.PI / 2);
    const sup = new THREE.Mesh(supGeo, cyanMat);
    sup.position.set(0, 0.01, -0.48);
    group.add(sup);

    // Pistol Grip
    const pGrip = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.12, 0.055), bodyMat);
    pGrip.position.set(0, -0.09, 0.10);
    pGrip.rotation.x = -0.32;
    group.add(pGrip);

    group.position.set(0.03, -0.04, -0.08);
    group.visible = false;
    return group;
  }

  // 4. SOVEREIGN AWP (HIGH-PRECISION BOLT-ACTION SNIPER)
  private createSovereignAWPMesh(): THREE.Group {
    const group = new THREE.Group();

    const stockMat = new THREE.MeshStandardMaterial({ color: 0x1a211e, roughness: 0.75, metalness: 0.2 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x121416, metalness: 0.92, roughness: 0.25 });
    const scopeMat = new THREE.MeshStandardMaterial({ color: 0x0a0c0e, metalness: 0.95, roughness: 0.15 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.95, roughness: 0.2 });

    // Chassis / Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.095, 0.58), stockMat);
    group.add(stock);

    // Gold Sovereign Trim Line
    const goldStripe = new THREE.Mesh(new THREE.BoxGeometry(0.057, 0.012, 0.48), goldMat);
    goldStripe.position.set(0, 0.02, 0);
    group.add(goldStripe);

    // Fluted Match Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.016, 0.018, 0.48, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, metalMat);
    barrel.position.set(0, 0.02, -0.52);
    group.add(barrel);

    // Heavy Muzzle Brake
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.034, 0.08), metalMat);
    brake.position.set(0, 0.02, -0.74);
    group.add(brake);

    // Optical Sniper Scope & Mount
    const scopeTubeGeo = new THREE.CylinderGeometry(0.024, 0.028, 0.32, 16);
    scopeTubeGeo.rotateX(Math.PI / 2);
    const scopeTube = new THREE.Mesh(scopeTubeGeo, scopeMat);
    scopeTube.position.set(0, 0.095, -0.06);
    group.add(scopeTube);

    // Scope Mount Rings
    const ring1 = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.045, 0.03), goldMat);
    ring1.position.set(0, 0.075, 0.04);
    group.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.045, 0.03), goldMat);
    ring2.position.set(0, 0.075, -0.16);
    group.add(ring2);

    // Interactive Bolt Handle with Sphere Knob
    const boltGroup = new THREE.Group();
    const boltRod = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.07), metalMat);
    boltRod.rotation.z = Math.PI / 2.6;
    boltRod.position.set(0.035, 0.02, 0);
    boltGroup.add(boltRod);

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 12), goldMat);
    knob.position.set(0.065, 0.035, 0);
    boltGroup.add(knob);

    boltGroup.position.set(0.025, 0.04, 0.08);
    group.add(boltGroup);
    this.boltMeshes.set('sovereign-awp', boltGroup as unknown as THREE.Mesh);

    group.position.set(0.04, -0.04, -0.06);
    group.visible = false;
    return group;
  }

  // 5. GARAM CRIMSON KARAMBIT
  private createKarambitMesh(): THREE.Group {
    const group = new THREE.Group();

    // Ergonomic Finger-Groove Handle
    const handleGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.16, 16);
    handleGeo.rotateX(Math.PI / 3);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.85 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    group.add(handle);

    // Gold Index Finger Ring
    const ringGeo = new THREE.TorusGeometry(0.025, 0.007, 12, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.95, roughness: 0.15 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, -0.07, 0.09);
    group.add(ring);

    // Curved Anodized Crimson Talon Blade
    const bladeGeo = new THREE.ConeGeometry(0.036, 0.19, 16);
    bladeGeo.rotateX(-Math.PI / 2.4);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xee153a,
      roughness: 0.12,
      metalness: 0.88,
    });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(0, 0.048, -0.12);
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
      this.slideKick = 0.045;
    }
    if (this.currentWeaponId === 'sovereign-awp') {
      this.boltKick = 0.085;
    }

    // Flash light & 3D star-plane muzzle flash (deterministic frame-based timer)
    this.flashTimer = 0.055;
    this.muzzleFlashLight.intensity = 6.0;
    this.muzzleFlashMesh.visible = true;
    this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI * 2;
  }

  public triggerInspect(): void {
    if (this.isReloading) return;
    this.isInspecting = true;
    this.inspectTime = 0;
  }

  public inspect(): void {
    this.triggerInspect();
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
    // Muzzle flash decay
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.muzzleFlashLight.intensity = 6.0;
      this.muzzleFlashMesh.visible = true;
    } else {
      this.muzzleFlashLight.intensity = 0.0;
      this.muzzleFlashMesh.visible = false;
    }

    if (this.isScoped) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Equip draw raise animation (0 to 1 over 0.25s)
    let drawY = 0;
    if (this.drawProgress < 1.0) {
      this.drawProgress = Math.min(1.0, this.drawProgress + dt * 4.0);
      drawY = (1.0 - this.drawProgress) * -0.22;
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

    // Inspect Animation (F Key: Rotates and showcases engravings)
    let inspectYaw = 0;
    let inspectPitch = 0;
    let inspectRoll = 0;

    if (this.isInspecting) {
      this.inspectTime += dt * 2.2;
      if (this.inspectTime >= Math.PI * 2) {
        this.isInspecting = false;
        this.inspectTime = 0;
      } else {
        inspectYaw = Math.sin(this.inspectTime) * 0.55;
        inspectPitch = Math.sin(this.inspectTime * 0.5) * 0.28;
        inspectRoll = Math.sin(this.inspectTime) * 0.45;
      }
    }

    // Reload animation dip & roll
    let reloadY = 0;
    let reloadRoll = 0;
    if (this.isReloading) {
      reloadY = -0.09 * Math.sin(this.reloadProgress * Math.PI);
      reloadRoll = 0.28 * Math.sin(this.reloadProgress * Math.PI);
    }

    // 3D Hooke's Law spring-damper for mouse sway
    const k = 150;
    const c = 18;

    const swayX = -mouseDeltaX * 0.0008;
    const swayY = mouseDeltaY * 0.0008;

    this.targetRot.y = Math.max(-0.16, Math.min(0.16, swayX)) + meleeYaw + inspectYaw;
    this.targetRot.x = Math.max(-0.16, Math.min(0.16, swayY)) + this.recoilPitch + meleePitch + inspectPitch;
    this.targetRot.z = strafeRoll + reloadRoll + inspectRoll;

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
