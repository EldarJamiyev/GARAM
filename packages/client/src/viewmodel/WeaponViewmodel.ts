import * as THREE from 'three';

export class WeaponViewmodel {
  public mesh: THREE.Group;
  private barrel: THREE.Mesh;
  private body: THREE.Mesh;
  private accent: THREE.Mesh;
  private muzzleFlashLight: THREE.PointLight;

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

    // Weapon receiver body (Matte obsidian black tactical finish)
    const bodyGeo = new THREE.BoxGeometry(0.05, 0.08, 0.38);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x141618,
      roughness: 0.3,
      metalness: 0.9,
    });
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.mesh.add(this.body);

    // Barrel / Shroud
    const barrelGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.32, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x0a0b0c,
      roughness: 0.2,
      metalness: 0.95,
    });
    this.barrel = new THREE.Mesh(barrelGeo, barrelMat);
    this.barrel.position.set(0, 0.02, -0.28);
    this.mesh.add(this.barrel);

    // Crimson Sovereign accent stripe (Signature Eldar Garamov aesthetic)
    const accentGeo = new THREE.BoxGeometry(0.052, 0.015, 0.26);
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xd91438,
      roughness: 0.25,
      metalness: 0.5,
    });
    this.accent = new THREE.Mesh(accentGeo, accentMat);
    this.accent.position.set(0, 0.045, -0.04);
    this.mesh.add(this.accent);

    // Magazine (Curved banana mag for Garam-47)
    const magGeo = new THREE.BoxGeometry(0.035, 0.18, 0.08);
    const magMat = new THREE.MeshStandardMaterial({
      color: 0x24282c,
      roughness: 0.5,
      metalness: 0.7,
    });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.11, -0.06);
    mag.rotation.x = -0.25;
    this.mesh.add(mag);

    // Scope tube (For Sovereign AWP)
    const scopeGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.22, 16);
    scopeGeo.rotateX(Math.PI / 2);
    const scopeMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      metalness: 0.9,
      roughness: 0.2,
    });
    const scope = new THREE.Mesh(scopeGeo, scopeMat);
    scope.position.set(0, 0.07, -0.06);
    this.mesh.add(scope);

    // First person tactical gloved arm
    const armGeo = new THREE.CylinderGeometry(0.045, 0.052, 0.42, 16);
    armGeo.rotateX(Math.PI / 3);
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x121416,
      roughness: 0.8,
      metalness: 0.1,
    });
    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.09, -0.18, 0.06);
    this.mesh.add(rightArm);

    // Muzzle flash point light
    this.muzzleFlashLight = new THREE.PointLight(0xffaa33, 0, 10);
    this.muzzleFlashLight.position.set(0, 0.02, -0.46);
    this.mesh.add(this.muzzleFlashLight);

    this.mesh.position.copy(this.currentPos);
  }

  public fireRecoil(pitchKick = 0.07, zKick = 0.05): void {
    this.recoilPitch += pitchKick;
    this.recoilZ += zKick;

    // Flash light trigger
    this.muzzleFlashLight.intensity = 5.0;
    setTimeout(() => {
      this.muzzleFlashLight.intensity = 0.0;
    }, 45);
  }

  public update(dt: number, mouseDeltaX: number, mouseDeltaY: number, walkBob: number, strafeRoll: number): void {
    if (this.isScoped) {
      // Hide weapon viewmodel while scoped in
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

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
