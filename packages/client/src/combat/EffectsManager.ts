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
  active: boolean;
}

interface TracerLine {
  line: THREE.Line;
  positions: Float32Array;
  lifetime: number;
  active: boolean;
}

export class EffectsManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Pooled Decals (Max 80)
  private decalPool: DecalMesh[] = [];
  private decalPoolIndex = 0;
  private readonly MAX_DECALS = 80;

  // Pooled Tracers (Max 24, Zero-GC)
  private tracerPool: TracerLine[] = [];
  private tracerIndex = 0;
  private readonly MAX_TRACERS = 24;

  // Pooled Shell Casings (Max 32, Zero-GC)
  private shellPool: ShellCasing[] = [];
  private shellIndex = 0;
  private readonly MAX_SHELLS = 32;
  private shellGeometry: THREE.CylinderGeometry;
  private shellMaterial: THREE.MeshStandardMaterial;

  // Decal Materials
  private concreteDecalMat: THREE.MeshBasicMaterial;
  private woodDecalMat: THREE.MeshBasicMaterial;
  private metalDecalMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    // Procedural high-contrast bullet impact decal textures
    const concreteTex = this.createImpactTexture('#141618', '#383b40');
    const woodTex = this.createImpactTexture('#281c12', '#4e3422');
    const metalTex = this.createImpactTexture('#0a0c0e', '#5a626b');

    this.concreteDecalMat = new THREE.MeshBasicMaterial({
      map: concreteTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
    });

    this.woodDecalMat = new THREE.MeshBasicMaterial({
      map: woodTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
    });

    this.metalDecalMat = new THREE.MeshBasicMaterial({
      map: metalTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
    });

    // Initialize Decal Pool
    const decalGeo = new THREE.PlaneGeometry(0.14, 0.14);
    for (let i = 0; i < this.MAX_DECALS; i++) {
      const mesh = new THREE.Mesh(decalGeo, this.concreteDecalMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.decalPool.push({ mesh, inUse: false });
    }

    // Initialize Tracer Pool (Zero Runtime Allocations)
    const tracerMat = new THREE.LineBasicMaterial({
      color: 0xffea55,
      linewidth: 2,
    });
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      const positions = new Float32Array(6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, tracerMat);
      line.visible = false;
      this.scene.add(line);
      this.tracerPool.push({ line, positions, lifetime: 0, active: false });
    }

    // Initialize Shell Casing Pool
    this.shellGeometry = new THREE.CylinderGeometry(0.006, 0.006, 0.024, 8);
    this.shellGeometry.rotateX(Math.PI / 2);
    this.shellMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Polished Brass
      metalness: 0.95,
      roughness: 0.2,
    });

    for (let i = 0; i < this.MAX_SHELLS; i++) {
      const mesh = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shellPool.push({
        mesh,
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        bounces: 0,
        lifetime: 0,
        active: false,
      });
    }
  }

  private createImpactTexture(coreColor: string, rimColor: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    // Outer crater rim
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 28);
    grad.addColorStop(0, coreColor);
    grad.addColorStop(0.5, rimColor);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();

    // Fractured spall flecks
    ctx.fillStyle = coreColor;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 12 + Math.random() * 14;
      const px = 32 + Math.cos(angle) * dist;
      const py = 32 + Math.sin(angle) * dist;
      ctx.fillRect(px, py, 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public spawnBulletDecal(point: THREE.Vector3, normal: THREE.Vector3, materialType: string): void {
    const decal = this.decalPool[this.decalPoolIndex];
    this.decalPoolIndex = (this.decalPoolIndex + 1) % this.MAX_DECALS;

    decal.mesh.position.copy(point).addScaledVector(normal, 0.008);
    decal.mesh.lookAt(point.clone().add(normal));
    decal.mesh.rotation.z = Math.random() * Math.PI * 2;

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

    const tracer = this.tracerPool[this.tracerIndex];
    this.tracerIndex = (this.tracerIndex + 1) % this.MAX_TRACERS;

    const pos = tracer.positions;
    pos[0] = from.x;
    pos[1] = from.y - 0.12;
    pos[2] = from.z;
    pos[3] = to.x;
    pos[4] = to.y;
    pos[5] = to.z;

    const attr = tracer.line.geometry.attributes.position as THREE.BufferAttribute;
    attr.needsUpdate = true;
    tracer.line.visible = true;
    tracer.lifetime = 0.055;
    tracer.active = true;
  }

  public spawnShellCasing(origin: THREE.Vector3, forward: THREE.Vector3, right: THREE.Vector3): void {
    const casing = this.shellPool[this.shellIndex];
    this.shellIndex = (this.shellIndex + 1) % this.MAX_SHELLS;

    casing.mesh.position.copy(origin).addScaledVector(right, 0.2).addScaledVector(forward, 0.25);
    casing.mesh.position.y -= 0.1;

    casing.velocity.copy(right).multiplyScalar(2.4 + Math.random() * 0.8);
    casing.velocity.y = 2.0 + Math.random() * 0.6;
    casing.velocity.addScaledVector(forward, -0.5);

    casing.angularVelocity.set(
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25
    );

    casing.bounces = 0;
    casing.lifetime = 0;
    casing.active = true;
    casing.mesh.visible = true;
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
    // 1. Tick tracers (hide expired ones)
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      const tracer = this.tracerPool[i];
      if (tracer.active) {
        tracer.lifetime -= dt;
        if (tracer.lifetime <= 0) {
          tracer.active = false;
          tracer.line.visible = false;
        }
      }
    }

    // 2. Tick shell casings physics
    for (let i = 0; i < this.MAX_SHELLS; i++) {
      const casing = this.shellPool[i];
      if (!casing.active) continue;

      casing.lifetime += dt;
      if (casing.lifetime > 4.0) {
        casing.active = false;
        casing.mesh.visible = false;
        continue;
      }

      if (casing.bounces < 2) {
        casing.velocity.y -= 19.6 * dt; // Gravity
        casing.mesh.position.addScaledVector(casing.velocity, dt);

        casing.mesh.rotation.x += casing.angularVelocity.x * dt;
        casing.mesh.rotation.y += casing.angularVelocity.y * dt;
        casing.mesh.rotation.z += casing.angularVelocity.z * dt;

        // Floor bounce at y = 0.015
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
