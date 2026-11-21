import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface TracerInstance {
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  lifetime: number;
  maxLifetime: number;
  active: boolean;
}

// Scratch objects for zero runtime GC allocations
const _dummy = new THREE.Object3D();
const _lookTarget = new THREE.Vector3();
const _projPos = new THREE.Vector3();
const _particleColor = new THREE.Color();
const _tracerMid = new THREE.Vector3();
const _tracerTarget = new THREE.Vector3();

interface PooledDamagePopup {
  el: HTMLDivElement;
  remaining: number;
  baseX: number;
  baseY: number;
  active: boolean;
}

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

  // Pooled Instanced Volumetric Tracers (Max 24 = 1 draw call, Zero-GC)
  private tracerPool: TracerInstance[] = [];
  private tracerIndex = 0;
  private readonly MAX_TRACERS = 24;
  private tracerInstancedMesh: THREE.InstancedMesh;
  private tracerMat: THREE.MeshBasicMaterial;

  // Instanced Impact Sparks, Dust Plumes & Blood Mist (96 particles = 1 draw call, zero GC)
  private readonly MAX_PARTICLES = 96;
  private particleMesh: THREE.InstancedMesh;
  private particleIndex = 0;
  private particleActive: Uint8Array;
  private particlePos: Float32Array;
  private particleVel: Float32Array;
  private particleLife: Float32Array;
  private particleMaxLife: Float32Array;
  private particleScale: Float32Array;
  private particleGravity: Float32Array;

  // Pooled DOM Damage Popups (Max 8, Zero-DOM-create/remove during gunfights)
  private readonly MAX_POPUPS = 8;
  private popupPool: PooledDamagePopup[] = [];
  private popupIndex = 0;
  private impactTextures: THREE.CanvasTexture[] = [];

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    // 1. Procedural High-Contrast Bullet Impact Textures
    const concreteTex = this.createImpactTexture('#141618', '#383b40');
    const woodTex = this.createImpactTexture('#281c12', '#4e3422');
    const metalTex = this.createImpactTexture('#0a0c0e', '#5a626b');
    this.impactTextures.push(concreteTex, woodTex, metalTex);

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

    // Asynchronously upgrade casing geometry to realistic 3D 9mm brass model (0 extra draw calls)
    new GLTFLoader().load(
      '/models/casing_9mm.glb',
      (gltf) => {
        let extractedGeo: THREE.BufferGeometry | null = null;
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (!extractedGeo) {
              extractedGeo = child.geometry.clone();
            }
            // Dispose temporary parsed GLTF GPU buffers immediately after cloning
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
        if (extractedGeo) {
          const geo = extractedGeo as THREE.BufferGeometry;
          geo.computeBoundingBox();
          if (geo.boundingBox) {
            const size = new THREE.Vector3();
            geo.boundingBox.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) {
              const scale = 0.024 / maxDim;
              geo.scale(scale, scale, scale);
            }
          }
          this.shellInstancedMesh.geometry.dispose();
          this.shellInstancedMesh.geometry = geo;
        }
      },
      undefined,
      () => {}
    );

    this.shellPos = new Float32Array(this.MAX_SHELLS * 3);
    this.shellVel = new Float32Array(this.MAX_SHELLS * 3);
    this.shellRot = new Float32Array(this.MAX_SHELLS * 3);
    this.shellAngVel = new Float32Array(this.MAX_SHELLS * 3);
    this.shellLife = new Float32Array(this.MAX_SHELLS);
    this.shellBounces = new Uint8Array(this.MAX_SHELLS);

    // 4. Initialize Volumetric Instanced Tracer Pool (Bright golden supersonic streak, 1 draw call, zero runtime allocations)
    const tracerGeo = new THREE.BoxGeometry(0.014, 0.014, 1.0);
    this.tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffe88a,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.tracerInstancedMesh = new THREE.InstancedMesh(tracerGeo, this.tracerMat, this.MAX_TRACERS);
    this.tracerInstancedMesh.frustumCulled = false;
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      this.tracerInstancedMesh.setMatrixAt(i, _dummy.matrix);
      this.tracerPool.push({
        startX: 0,
        startY: 0,
        startZ: 0,
        endX: 0,
        endY: 0,
        endZ: 0,
        lifetime: 0,
        maxLifetime: 0.065,
        active: false,
      });
    }
    this.tracerInstancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.tracerInstancedMesh);

    // 5. Initialize Pooled Instanced Impact & Blood Particle System (1 draw call)
    const particleGeo = new THREE.OctahedronGeometry(0.032, 0);
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, this.MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.particleActive = new Uint8Array(this.MAX_PARTICLES);
    this.particlePos = new Float32Array(this.MAX_PARTICLES * 3);
    this.particleVel = new Float32Array(this.MAX_PARTICLES * 3);
    this.particleLife = new Float32Array(this.MAX_PARTICLES);
    this.particleMaxLife = new Float32Array(this.MAX_PARTICLES);
    this.particleScale = new Float32Array(this.MAX_PARTICLES);
    this.particleGravity = new Float32Array(this.MAX_PARTICLES);

    _particleColor.setHex(0xffffff);
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, _particleColor);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.particleMesh);

    // 6. Initialize Pooled DOM Damage Popups
    if (typeof document !== 'undefined' && document.body) {
      for (let i = 0; i < this.MAX_POPUPS; i++) {
        const el = document.createElement('div');
        el.className = 'damage-popup';
        el.style.left = '0px';
        el.style.top = '0px';
        el.style.display = 'none';
        el.style.willChange = 'transform, opacity';
        document.body.appendChild(el);
        this.popupPool.push({ el, remaining: 0, baseX: 0, baseY: 0, active: false });
      }
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
    _lookTarget.copy(point).add(normal);
    _dummy.lookAt(_lookTarget);
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

  public spawnTracer(from: THREE.Vector3, to: THREE.Vector3, weaponId: string, rightVec?: THREE.Vector3): void {
    if (weaponId === 'vanguard-m4') return; // Suppressed M4A1-S hides tracers

    const idx = this.tracerIndex;
    const tracer = this.tracerPool[idx];
    this.tracerIndex = (this.tracerIndex + 1) % this.MAX_TRACERS;

    const rx = rightVec ? rightVec.x * 0.16 : 0;
    const ry = rightVec ? rightVec.y * 0.16 : 0;
    const rz = rightVec ? rightVec.z * 0.16 : 0;
    tracer.startX = from.x + rx;
    tracer.startY = from.y - 0.11 + ry;
    tracer.startZ = from.z + rz;
    tracer.endX = to.x;
    tracer.endY = to.y;
    tracer.endZ = to.z;
    tracer.maxLifetime = weaponId === 'sovereign-awp' ? 0.085 : 0.062;
    tracer.lifetime = tracer.maxLifetime;
    tracer.active = true;

    const dx = tracer.endX - tracer.startX;
    const dy = tracer.endY - tracer.startY;
    const dz = tracer.endZ - tracer.startZ;
    const dist = Math.max(0.25, Math.hypot(dx, dy, dz));
    const boltLen = Math.min(dist, weaponId === 'sovereign-awp' ? 9.5 : 6.0);

    _tracerMid.set(
      tracer.startX + dx * 0.35,
      tracer.startY + dy * 0.35,
      tracer.startZ + dz * 0.35
    );
    _tracerTarget.set(tracer.endX, tracer.endY, tracer.endZ);
    _dummy.position.copy(_tracerMid);
    _dummy.lookAt(_tracerTarget);
    const widthScale = weaponId === 'sovereign-awp' ? 1.55 : 1.0;
    _dummy.scale.set(widthScale, widthScale, boltLen);
    _dummy.updateMatrix();
    this.tracerInstancedMesh.setMatrixAt(idx, _dummy.matrix);
    this.tracerInstancedMesh.instanceMatrix.needsUpdate = true;
  }

  private emitParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    scale: number,
    maxLife: number,
    gravity: number
  ): void {
    const idx = this.particleIndex;
    this.particleIndex = (this.particleIndex + 1) % this.MAX_PARTICLES;
    const o3 = idx * 3;
    this.particlePos[o3] = x;
    this.particlePos[o3 + 1] = y;
    this.particlePos[o3 + 2] = z;
    this.particleVel[o3] = vx;
    this.particleVel[o3 + 1] = vy;
    this.particleVel[o3 + 2] = vz;
    this.particleLife[idx] = maxLife;
    this.particleMaxLife[idx] = maxLife;
    this.particleScale[idx] = scale;
    this.particleGravity[idx] = gravity;
    this.particleActive[idx] = 1;

    _particleColor.setHex(colorHex);
    this.particleMesh.setColorAt(idx, _particleColor);
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  public spawnImpactBurst(point: THREE.Vector3, normal: THREE.Vector3, materialType: string): void {
    const isMetal = materialType === 'METAL_SHEET';
    const isWood = materialType === 'WOOD_THIN';
    const count = isMetal ? 10 : 8;

    for (let i = 0; i < count; i++) {
      const spread = isMetal ? 3.2 : 2.1;
      const speed = isMetal ? 3.8 + Math.random() * 4.5 : 1.4 + Math.random() * 2.6;
      const vx = normal.x * speed + (Math.random() - 0.5) * spread;
      const vy = normal.y * speed + Math.random() * (isMetal ? 2.4 : 1.8);
      const vz = normal.z * speed + (Math.random() - 0.5) * spread;

      const colorHex = isMetal
        ? i % 2 === 0
          ? 0xffd266
          : 0xff7722
        : isWood
          ? i % 2 === 0
            ? 0xa47144
            : 0x6e4726
          : i % 3 === 0
            ? 0xdfd3be
            : 0xb6a994;

      const scale = isMetal ? 0.55 + Math.random() * 0.55 : 0.9 + Math.random() * 1.1;
      const life = isMetal ? 0.16 + Math.random() * 0.14 : 0.24 + Math.random() * 0.20;
      const grav = isMetal ? 12.0 : isWood ? 10.0 : 3.2;

      this.emitParticle(
        point.x + normal.x * 0.03,
        point.y + normal.y * 0.03,
        point.z + normal.z * 0.03,
        vx,
        vy,
        vz,
        colorHex,
        scale,
        life,
        grav
      );
    }
  }

  public spawnBloodBurst(point: THREE.Vector3, normal: THREE.Vector3, isHeadshot: boolean): void {
    const count = isHeadshot ? 14 : 8;
    for (let i = 0; i < count; i++) {
      const isDinkSpark = isHeadshot && i < 6;
      const speed = isDinkSpark ? 3.6 + Math.random() * 4.0 : 1.2 + Math.random() * 2.4;
      const vx = normal.x * speed + (Math.random() - 0.5) * 2.6;
      const vy = normal.y * speed + Math.random() * (isDinkSpark ? 2.8 : 1.4);
      const vz = normal.z * speed + (Math.random() - 0.5) * 2.6;

      this.emitParticle(
        point.x,
        point.y,
        point.z,
        vx,
        vy,
        vz,
        isDinkSpark ? (i % 2 === 0 ? 0xfff0a0 : 0xffaa22) : i % 2 === 0 ? 0xa8101c : 0x6b0810,
        isDinkSpark ? 0.75 : 1.05 + Math.random() * 0.85,
        isDinkSpark ? 0.18 : 0.26 + Math.random() * 0.14,
        isDinkSpark ? 11.0 : 6.5
      );
    }
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
    if (this.popupPool.length === 0) return;
    _projPos.copy(pos).project(this.camera);
    // Skip popups behind the camera or outside NDC depth
    if (_projPos.z > 1 || _projPos.z < -1) return;

    const x = (_projPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(_projPos.y * 0.5) + 0.5) * window.innerHeight;

    const slot = this.popupPool[this.popupIndex];
    this.popupIndex = (this.popupIndex + 1) % this.popupPool.length;
    slot.baseX = x;
    slot.baseY = y;
    slot.remaining = 0.75;
    slot.active = true;
    slot.el.className = `damage-popup ${isHeadshot ? 'headshot' : ''}`;
    slot.el.textContent = `-${dmg}${isHeadshot ? ' (HEADSHOT)' : ''}`;
    slot.el.style.display = 'block';
    slot.el.style.opacity = '1';
    slot.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  public update(dt: number): void {
    // 1. Tick volumetric instanced tracers along trajectory
    let tracersUpdated = false;
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      const tracer = this.tracerPool[i];
      if (!tracer.active) continue;
      tracer.lifetime -= dt;
      if (tracer.lifetime <= 0) {
        tracer.active = false;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.tracerInstancedMesh.setMatrixAt(i, _dummy.matrix);
        tracersUpdated = true;
      } else {
        const progress = 1.0 - tracer.lifetime / Math.max(0.01, tracer.maxLifetime);
        const dx = tracer.endX - tracer.startX;
        const dy = tracer.endY - tracer.startY;
        const dz = tracer.endZ - tracer.startZ;
        const dist = Math.max(0.25, Math.hypot(dx, dy, dz));
        const boltLen = Math.min(dist * (1.0 - progress * 0.4), 6.5);
        const t = Math.min(0.88, 0.25 + progress * 0.65);
        _tracerMid.set(
          tracer.startX + dx * t,
          tracer.startY + dy * t,
          tracer.startZ + dz * t
        );
        _tracerTarget.set(tracer.endX, tracer.endY, tracer.endZ);
        _dummy.position.copy(_tracerMid);
        _dummy.lookAt(_tracerTarget);
        const fade = Math.max(0.25, 1.0 - progress * 0.6);
        _dummy.scale.set(fade, fade, boltLen);
        _dummy.updateMatrix();
        this.tracerInstancedMesh.setMatrixAt(i, _dummy.matrix);
        tracersUpdated = true;
      }
    }
    if (tracersUpdated) {
      this.tracerInstancedMesh.instanceMatrix.needsUpdate = true;
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

    // 3. Tick pooled impact sparks, dust plumes & blood mist
    let particlesUpdated = false;
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      if (!this.particleActive[i]) continue;
      this.particleLife[i] -= dt;
      if (this.particleLife[i] <= 0) {
        this.particleActive[i] = 0;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, _dummy.matrix);
        particlesUpdated = true;
        continue;
      }

      const o3 = i * 3;
      this.particleVel[o3 + 1] -= this.particleGravity[i] * dt;
      this.particleVel[o3] *= Math.max(0, 1 - 2.2 * dt);
      this.particleVel[o3 + 2] *= Math.max(0, 1 - 2.2 * dt);
      this.particlePos[o3] += this.particleVel[o3] * dt;
      this.particlePos[o3 + 1] += this.particleVel[o3 + 1] * dt;
      this.particlePos[o3 + 2] += this.particleVel[o3 + 2] * dt;

      const tRatio = Math.max(0, this.particleLife[i] / Math.max(0.01, this.particleMaxLife[i]));
      const s = this.particleScale[i] * tRatio;
      _dummy.position.set(this.particlePos[o3], this.particlePos[o3 + 1], this.particlePos[o3 + 2]);
      _dummy.rotation.set(tRatio * 6, tRatio * 4, 0);
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      particlesUpdated = true;
    }
    if (particlesUpdated) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Tick pooled DOM damage popups (GPU-composited transform + opacity only)
    for (let i = 0; i < this.popupPool.length; i++) {
      const slot = this.popupPool[i];
      if (!slot.active) continue;
      slot.remaining -= dt;
      if (slot.remaining <= 0) {
        slot.active = false;
        slot.el.style.display = 'none';
      } else {
        const progress = 1 - slot.remaining / 0.75;
        const yOff = slot.baseY - progress * 28;
        slot.el.style.transform = `translate3d(${slot.baseX.toFixed(1)}px, ${yOff.toFixed(1)}px, 0)`;
        slot.el.style.opacity = `${Math.max(0, 1 - progress * 1.15).toFixed(2)}`;
      }
    }
  }

  public dispose(): void {
    const decalGeo = this.concreteDecals.geometry;
    this.scene.remove(this.concreteDecals, this.woodDecals, this.metalDecals, this.shellInstancedMesh, this.particleMesh);
    decalGeo.dispose();
    (this.concreteDecals.material as THREE.Material).dispose();
    (this.woodDecals.material as THREE.Material).dispose();
    (this.metalDecals.material as THREE.Material).dispose();
    for (const tex of this.impactTextures) {
      tex.dispose();
    }
    this.impactTextures.length = 0;

    this.shellInstancedMesh.geometry.dispose();
    (this.shellInstancedMesh.material as THREE.Material).dispose();
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();

    this.scene.remove(this.tracerInstancedMesh);
    this.tracerInstancedMesh.geometry.dispose();
    this.tracerPool.length = 0;
    this.tracerMat.dispose();

    for (const slot of this.popupPool) {
      slot.el.remove();
    }
    this.popupPool.length = 0;
  }
}
