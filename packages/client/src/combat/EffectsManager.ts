import * as THREE from 'three';

interface DecalMesh {
  mesh: THREE.Mesh;
  inUse: boolean;
}

interface ShellCasing {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  bounces: number;
  lifetime: number;
}

export class EffectsManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Pooled Decals (Max 80)
  private decalPool: DecalMesh[] = [];
  private decalPoolIndex = 0;
  private readonly MAX_DECALS = 80;

  // Active Shell Casings
  private shellCasings: ShellCasing[] = [];
  private shellGeometry: THREE.CylinderGeometry;
  private shellMaterial: THREE.MeshStandardMaterial;

  // Decal Materials
  private concreteDecalMat: THREE.MeshBasicMaterial;
  private woodDecalMat: THREE.MeshBasicMaterial;
  private metalDecalMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    // Procedural decal textures
    this.concreteDecalMat = new THREE.MeshBasicMaterial({
      color: 0x181a1d,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.woodDecalMat = new THREE.MeshBasicMaterial({
      color: 0x24180e,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.metalDecalMat = new THREE.MeshBasicMaterial({
      color: 0x08090a,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // Initialize Decal Pool
    const decalGeo = new THREE.PlaneGeometry(0.12, 0.12);
    for (let i = 0; i < this.MAX_DECALS; i++) {
      const mesh = new THREE.Mesh(decalGeo, this.concreteDecalMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.decalPool.push({ mesh, inUse: false });
    }

    // Shell casing assets
    this.shellGeometry = new THREE.CylinderGeometry(0.006, 0.006, 0.024, 8);
    this.shellGeometry.rotateX(Math.PI / 2);
    this.shellMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Polished Brass
      metalness: 0.95,
      roughness: 0.2,
    });
  }

  public spawnBulletDecal(point: THREE.Vector3, normal: THREE.Vector3, materialType: string): void {
    const decal = this.decalPool[this.decalPoolIndex];
    this.decalPoolIndex = (this.decalPoolIndex + 1) % this.MAX_DECALS;

    decal.mesh.position.copy(point).addScaledVector(normal, 0.008);
    decal.mesh.lookAt(point.clone().add(normal));

    if (materialType === 'WOOD_THIN') {
      decal.mesh.material = this.woodDecalMat;
    } else if (materialType === 'METAL_SHEET') {
      decal.mesh.material = this.metalDecalMat;
    } else {
      decal.mesh.material = this.concreteDecalMat;
    }

    decal.mesh.visible = true;
    decal.inUse = true;
  }

  public spawnTracer(from: THREE.Vector3, to: THREE.Vector3, weaponId: string): void {
    // Suppress tracer lines completely for suppressed Vanguard M4A1-S!
    if (weaponId === 'vanguard-m4') return;

    const points = [from.clone().add(new THREE.Vector3(0, -0.12, 0)), to];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: weaponId === 'sovereign-awp' ? 0xffffff : 0xffea55,
      linewidth: weaponId === 'sovereign-awp' ? 3 : 2,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);

    setTimeout(() => {
      this.scene.remove(line);
      geo.dispose();
      mat.dispose();
    }, 50);
  }

  public spawnShellCasing(origin: THREE.Vector3, forward: THREE.Vector3, right: THREE.Vector3): void {
    const mesh = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
    mesh.position.copy(origin).addScaledVector(right, 0.2).addScaledVector(forward, 0.25);
    mesh.position.y -= 0.1;

    // Eject to the right with slight upward and backward arc
    const vel = right.clone().multiplyScalar(2.4 + Math.random() * 0.8);
    vel.y += 2.0 + Math.random() * 0.6;
    vel.addScaledVector(forward, -0.5);

    const angVel = new THREE.Vector3(
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25
    );

    this.scene.add(mesh);
    this.shellCasings.push({
      mesh,
      velocity: vel,
      angularVelocity: angVel,
      bounces: 0,
      lifetime: 0,
    });
  }

  public spawnDamagePopup(pos: THREE.Vector3, dmg: number, isHeadshot: boolean): void {
    const screenPos = pos.clone().project(this.camera);
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

    const pop = document.createElement('div');
    pop.className = `damage-popup ${isHeadshot ? 'headshot' : ''}`;
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    pop.innerText = `-${dmg}${isHeadshot ? ' (HEADSHOT)' : ''}`;
    document.body.appendChild(pop);
    setTimeout(() => pop.remove(), 800);
  }

  public update(dt: number): void {
    // Tick shell casings physics
    for (let i = this.shellCasings.length - 1; i >= 0; i--) {
      const casing = this.shellCasings[i];
      casing.lifetime += dt;

      if (casing.lifetime > 4.0) {
        this.scene.remove(casing.mesh);
        this.shellCasings.splice(i, 1);
        continue;
      }

      if (casing.bounces < 2) {
        casing.velocity.y -= 19.6 * dt; // Gravity
        casing.mesh.position.addScaledVector(casing.velocity, dt);

        casing.mesh.rotation.x += casing.angularVelocity.x * dt;
        casing.mesh.rotation.y += casing.angularVelocity.y * dt;
        casing.mesh.rotation.z += casing.angularVelocity.z * dt;

        // Floor bounce
        if (casing.mesh.position.y <= 0.015) {
          casing.mesh.position.y = 0.015;
          casing.velocity.y = -casing.velocity.y * 0.45;
          casing.velocity.x *= 0.55;
          casing.velocity.z *= 0.55;
          casing.angularVelocity.multiplyScalar(0.4);
          casing.bounces++;
        }
      }
    }
  }
}
