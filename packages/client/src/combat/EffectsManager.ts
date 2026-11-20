import * as THREE from 'three';

interface TracerLine {
  line: THREE.Line;
  positions: Float32Array;
  lifetime: number;
  active: boolean;
}

// Scratch objects for zero runtime GC allocations
const _dummy = new THREE.Object3D();
const _matrix = new THREE.Matrix4();
const _zeroScale = new THREE.Vector3(0, 0, 0);

export class EffectsManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Instanced Decals (48 concrete, 24 wood, 24 metal = exactly 3 draw calls total)
  private readonly MAX_CONCRETE_DECALS = 48;
  private readonly MAX_WOOD_DECALS = 24;
  private readonly MAX_METAL_DECALS = 24;
  private concreteDecals: THREE.InstancedMesh;
  private woodDecals: THREE.InstancedMesh;
  private metalDecals: THREE.InstancedMesh;
  private concreteIndex = 0;
  private woodIndex = 0;
  private metalIndex = 0;

  // Instanced Shell Casings (48 casings = exactly 1 draw call total)
  private readonly MAX_SHELLS = 48;
  private shellInstancedMesh: THREE.InstancedMesh;
  private shellIndex = 0;
  private shellActive: boolean[] = [];
  private shellPos: Float32Array;
  private shellVel: Float32Array;
  private shellRot: Float32Array;
  private shellAngVel: Float32Array;
  private shellLife: Float32Array;
  private shellBounces: Uint8Array;

  // Pooled Tracers (Max 24, Zero-GC)
  private tracerPool: TracerLine[] = [];
  private tracerIndex = 0;
  private readonly MAX_TRACERS = 24;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    // 1. Procedural High-Contrast Bullet Impact Textures
    const concreteTex = this.createImpactTexture('#141618', '#383b40');
    const woodTex = this.createImpactTexture('#281c12', '#4e3422');
    const metalTex = this.createImpactTexture('#0a0c0e', '#5a626b');

    const concreteMat = new THREE.MeshBasicMaterial({
      map: concreteTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
    });

    const woodMat = new THREE.MeshBasicMaterial({
      map: woodTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
    });

    const metalMat = new THREE.MeshBasicMaterial({
      map: metalTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
    });

    // 2. Initialize Instanced Decal Meshes
    const decalGeo = new THREE.PlaneGeometry(0.14, 0.14);
    _dummy.position.set(0, -500, 0);
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();

    this.concreteDecals = new THREE.InstancedMesh(decalGeo, concreteMat, this.MAX_CONCRETE_DECALS);
    this.concreteDecals.frustumCulled = false;
    for (let i = 0; i < this.MAX_CONCRETE_DECALS; i++) {
      this.concreteDecals.setMatrixAt(i, _dummy.matrix);
    }
    this.concreteDecals.instanceMatrix.needsUpdate = true;
    this.scene.add(this.concreteDecals);

    this.woodDecals = new THREE.InstancedMesh(decalGeo, woodMat, this.MAX_WOOD_DECALS);
    this.woodDecals.frustumCulled = false;
    for (let i = 0; i < this.MAX_WOOD_DECALS; i++) {
      this.woodDecals.setMatrixAt(i, _dummy.matrix);
    }
    this.woodDecals.instanceMatrix.needsUpdate = true;
    this.scene.add(this.woodDecals);

    this.metalDecals = new THREE.InstancedMesh(decalGeo, metalMat, this.MAX_METAL_DECALS);
    this.metalDecals.frustumCulled = false;
    for (let i = 0; i < this.MAX_METAL_DECALS; i++) {
      this.metalDecals.setMatrixAt(i, _dummy.matrix);
    }
    this.metalDecals.instanceMatrix.needsUpdate = true;
    this.scene.add(this.metalDecals);

    // 3. Initialize Instanced Shell Casing Mesh & Typed Arrays
    const shellGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.024, 8);
    shellGeo.rotateX(Math.PI / 2);
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Polished Brass
      metalness: 0.95,
      roughness: 0.2,
    });

    this.shellInstancedMesh = new THREE.InstancedMesh(shellGeo, shellMat, this.MAX_SHELLS);
    this.shellInstancedMesh.frustumCulled = false;
    this.shellInstancedMesh.castShadow = false;
    for (let i = 0; i < this.MAX_SHELLS; i++) {
      this.shellInstancedMesh.setMatrixAt(i, _dummy.matrix);
      this.shellActive.push(false);
    }
    this.shellInstancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.shellInstancedMesh);

    this.shellPos = new Float32Array(this.MAX_SHELLS * 3);
    this.shellVel = new Float32Array(this.MAX_SHELLS * 3);
    this.shellRot = new Float32Array(this.MAX_SHELLS * 3);
    this.shellAngVel = new Float32Array(this.MAX_SHELLS * 3);
    this.shellLife = new Float32Array(this.MAX_SHELLS);
    this.shellBounces = new Uint8Array(this.MAX_SHELLS);

    // 4. Initialize Tracer Pool (Zero Runtime Allocations)
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
    _dummy.position.copy(point).addScaledVector(normal, 0.008);
    _dummy.scale.set(1, 1, 1);
    _dummy.lookAt(point.clone().add(normal));
    _dummy.rotateZ(Math.random() * Math.PI * 2);
    _dummy.updateMatrix();

    if (materialType === 'WOOD_THIN') {
      const idx = this.woodIndex;
      this.woodIndex = (this.woodIndex + 1) % this.MAX_WOOD_DECALS;
      this.woodDecals.setMatrixAt(idx, _dummy.matrix);
      this.woodDecals.instanceMatrix.needsUpdate = true;
    } else if (materialType === 'METAL_SHEET') {
      const idx = this.metalIndex;
      this.metalIndex = (this.metalIndex + 1) % this.MAX_METAL_DECALS;
      this.metalDecals.setMatrixAt(idx, _dummy.matrix);
      this.metalDecals.instanceMatrix.needsUpdate = true;
    } else {
      const idx = this.concreteIndex;
      this.concreteIndex = (this.concreteIndex + 1) % this.MAX_CONCRETE_DECALS;
      this.concreteDecals.setMatrixAt(idx, _dummy.matrix);
      this.concreteDecals.instanceMatrix.needsUpdate = true;
    }
  }

  public spawnTracer(from: THREE.Vector3, to: THREE.Vector3, weaponId: string): void {
    if (weaponId === 'vanguard-m4') return; // Suppressed

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
    const idx = this.shellIndex;
    this.shellIndex = (this.shellIndex + 1) % this.MAX_SHELLS;

    const offset3 = idx * 3;
    this.shellPos[offset3] = origin.x + right.x * 0.2 + forward.x * 0.25;
    this.shellPos[offset3 + 1] = origin.y - 0.1;
    this.shellPos[offset3 + 2] = origin.z + right.z * 0.2 + forward.z * 0.25;

    const speed = 2.4 + Math.random() * 0.8;
    this.shellVel[offset3] = right.x * speed - forward.x * 0.5;
    this.shellVel[offset3 + 1] = 2.0 + Math.random() * 0.6;
    this.shellVel[offset3 + 2] = right.z * speed - forward.z * 0.5;

    this.shellRot[offset3] = Math.random() * Math.PI * 2;
    this.shellRot[offset3 + 1] = Math.random() * Math.PI * 2;
    this.shellRot[offset3 + 2] = Math.random() * Math.PI * 2;

    this.shellAngVel[offset3] = (Math.random() - 0.5) * 25;
    this.shellAngVel[offset3 + 1] = (Math.random() - 0.5) * 25;
    this.shellAngVel[offset3 + 2] = (Math.random() - 0.5) * 25;

    this.shellLife[idx] = 0;
    this.shellBounces[idx] = 0;
    this.shellActive[idx] = true;

    _dummy.position.set(this.shellPos[offset3], this.shellPos[offset3 + 1], this.shellPos[offset3 + 2]);
    _dummy.rotation.set(this.shellRot[offset3], this.shellRot[offset3 + 1], this.shellRot[offset3 + 2]);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    this.shellInstancedMesh.setMatrixAt(idx, _dummy.matrix);
    this.shellInstancedMesh.instanceMatrix.needsUpdate = true;
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
    // 1. Tick tracers
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

    // 2. Tick instanced shell casings physics
    let casingsUpdated = false;
    for (let i = 0; i < this.MAX_SHELLS; i++) {
      if (!this.shellActive[i]) continue;

      this.shellLife[i] += dt;
      if (this.shellLife[i] > 4.0) {
        this.shellActive[i] = false;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.shellInstancedMesh.setMatrixAt(i, _dummy.matrix);
        casingsUpdated = true;
        continue;
      }

      const offset3 = i * 3;
      if (this.shellBounces[i] < 2) {
        this.shellVel[offset3 + 1] -= 19.6 * dt; // Gravity
        this.shellPos[offset3] += this.shellVel[offset3] * dt;
        this.shellPos[offset3 + 1] += this.shellVel[offset3 + 1] * dt;
        this.shellPos[offset3 + 2] += this.shellVel[offset3 + 2] * dt;

        this.shellRot[offset3] += this.shellAngVel[offset3] * dt;
        this.shellRot[offset3 + 1] += this.shellAngVel[offset3 + 1] * dt;
        this.shellRot[offset3 + 2] += this.shellAngVel[offset3 + 2] * dt;

        // Floor bounce at y = 0.015
        if (this.shellPos[offset3 + 1] <= 0.015) {
          this.shellPos[offset3 + 1] = 0.015;
          this.shellVel[offset3 + 1] = -this.shellVel[offset3 + 1] * 0.45;
          this.shellVel[offset3] *= 0.55;
          this.shellVel[offset3 + 2] *= 0.55;
          this.shellAngVel[offset3] *= 0.4;
          this.shellAngVel[offset3 + 1] *= 0.4;
          this.shellAngVel[offset3 + 2] *= 0.4;
          this.shellBounces[i]++;
        }

        _dummy.position.set(this.shellPos[offset3], this.shellPos[offset3 + 1], this.shellPos[offset3 + 2]);
        _dummy.rotation.set(this.shellRot[offset3], this.shellRot[offset3 + 1], this.shellRot[offset3 + 2]);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        this.shellInstancedMesh.setMatrixAt(i, _dummy.matrix);
        casingsUpdated = true;
      }
    }

    if (casingsUpdated) {
      this.shellInstancedMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
