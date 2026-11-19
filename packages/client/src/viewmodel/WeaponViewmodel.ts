import * as THREE from 'three';

export class WeaponViewmodel {
  public mesh: THREE.Group;
  private barrel: THREE.Mesh;
  private body: THREE.Mesh;
  private muzzleFlashLight: THREE.PointLight;

  // Spring physics states
  private targetPos = new THREE.Vector3(0.24, -0.22, -0.45);
  private currentPos = new THREE.Vector3(0.24, -0.22, -0.45);
  private velPos = new THREE.Vector3();

  private targetRot = new THREE.Euler(0, 0, 0);
  private currentRot = new THREE.Euler(0, 0, 0);

  private recoilZ = 0;
  private recoilPitch = 0;

  constructor() {
    this.mesh = new THREE.Group();

    // Weapon receiver body (Matte black tactical finish)
    const bodyGeo = new THREE.BoxGeometry(0.05, 0.08, 0.35);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c1e,
      roughness: 0.35,
      metalness: 0.85,
    });
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.mesh.add(this.body);

    // Weapon barrel / shroud
    const barrelGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.28, 16);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x0f1011,
      roughness: 0.2,
      metalness: 0.95,
    });
    this.barrel = new THREE.Mesh(barrelGeo, barrelMat);
    this.barrel.position.set(0, 0.02, -0.25);
    this.mesh.add(this.barrel);

    // Crimson Sovereign accent stripe (Signature Eldar Garamov aesthetic)
    const accentGeo = new THREE.BoxGeometry(0.052, 0.012, 0.22);
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xd91438,
      roughness: 0.3,
      metalness: 0.4,
    });
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.position.set(0, 0.045, -0.02);
    this.mesh.add(accent);

    // Magazine
    const magGeo = new THREE.BoxGeometry(0.035, 0.16, 0.07);
    const magMat = new THREE.MeshStandardMaterial({
      color: 0x24272b,
      roughness: 0.5,
      metalness: 0.6,
    });
    const mag = new THREE.Mesh(magGeo, magMat);
    mag.position.set(0, -0.1, -0.05);
    mag.rotation.x = -0.2;
    this.mesh.add(mag);

    // First person tactical gloved arm
    const armGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.38, 16);
    armGeo.rotateX(Math.PI / 3);
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x111315,
      roughness: 0.8,
      metalness: 0.1,
    });
    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.08, -0.16, 0.05);
    this.mesh.add(rightArm);

    // Muzzle flash point light
    this.muzzleFlashLight = new THREE.PointLight(0xffaa33, 0, 8);
    this.muzzleFlashLight.position.set(0, 0.02, -0.42);
    this.mesh.add(this.muzzleFlashLight);

    this.mesh.position.copy(this.currentPos);
  }

  public fireRecoil(pitchKick = 0.06, zKick = 0.04): void {
    this.recoilPitch += pitchKick;
    this.recoilZ += zKick;

    // Flash light trigger
    this.muzzleFlashLight.intensity = 4.0;
    setTimeout(() => {
      this.muzzleFlashLight.intensity = 0.0;
    }, 45);
  }

  public update(dt: number, mouseDeltaX: number, mouseDeltaY: number, walkBob: number, strafeRoll: number): void {
    // 3D Hooke's Law spring-damper for mouse lag / weapon sway
    const k = 140; // stiffness
    const c = 16;  // damping

    const swayX = -mouseDeltaX * 0.0008;
    const swayY = mouseDeltaY * 0.0008;

    this.targetRot.y = Math.max(-0.15, Math.min(0.15, swayX));
    this.targetRot.x = Math.max(-0.15, Math.min(0.15, swayY)) + this.recoilPitch;
    this.targetRot.z = strafeRoll;

    // Exponential decay of recoil
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
