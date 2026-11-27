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

  // Instanced Decals (48 concrete, 24 wood, 24 metal, 24 blood splatter = 4 draw calls total)
  private readonly MAX_CONCRETE_DECALS = 48;
  private readonly MAX_WOOD_DECALS = 24;
  private readonly MAX_METAL_DECALS = 24;
  private readonly MAX_BLOOD_DECALS = 24;
  private concreteDecals: THREE.InstancedMesh;
  private woodDecals: THREE.InstancedMesh;
  private metalDecals: THREE.InstancedMesh;
  private bloodDecals: THREE.InstancedMesh;
  private concreteIndex = 0;
  private woodIndex = 0;
  private metalIndex = 0;
  private bloodIndex = 0;

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

  // Instanced Impact Sparks & Dust Plumes (96 particles = 1 draw call, zero GC)
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

  // Pooled Billboarded Soft-Edged Crimson Blood Mist (64 sprites = 1 draw call, zero GC)
  private readonly MAX_BLOOD_MIST = 64;
  private bloodMistMesh: THREE.InstancedMesh;
  private bloodMistIndex = 0;
  private bloodMistActive: Uint8Array;
  private bloodMistPos: Float32Array;
  private bloodMistVel: Float32Array;
  private bloodMistLife: Float32Array;
  private bloodMistMaxLife: Float32Array;
  private bloodMistBaseScale: Float32Array;
  private bloodMistSpin: Float32Array;

  // Pooled DOM Damage Popups (Max 8, Zero-DOM-create/remove during gunfights)
  private readonly MAX_POPUPS = 8;
  private popupPool: PooledDamagePopup[] = [];
  private popupIndex = 0;
  private impactTextures: THREE.CanvasTexture[] = [];

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    // 1. Procedural High-Contrast Bullet Impact & CS2 Blood Splatter Textures
    const concreteTex = this.createImpactTexture('#141618', '#383b40');
    const woodTex = this.createImpactTexture('#281c12', '#4e3422');
    const metalTex = this.createImpactTexture('#0a0c0e', '#5a626b');
    const bloodTex = this.createBloodSplatterTexture();
    this.impactTextures.push(concreteTex, woodTex, metalTex, bloodTex);

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

    const bloodMat = new THREE.MeshBasicMaterial({
      map: bloodTex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.8,
      polygonOffsetUnits: -1.8,
    });

    // 2. Initialize Instanced Decal Meshes
    const decalGeo = new THREE.PlaneGeometry(0.14, 0.14);
    const bloodGeo = new THREE.PlaneGeometry(0.58, 0.58);
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

    this.bloodDecals = new THREE.InstancedMesh(bloodGeo, bloodMat, this.MAX_BLOOD_DECALS);
    this.bloodDecals.frustumCulled = false;
    for (let i = 0; i < this.MAX_BLOOD_DECALS; i++) {
      this.bloodDecals.setMatrixAt(i, _dummy.matrix);
    }
    this.bloodDecals.instanceMatrix.needsUpdate = true;
    this.scene.add(this.bloodDecals);

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

    // 4. Initialize Razor-Thin Golden-Amber Instanced Tracer Pool (1 draw call, strictly clamped ahead of camera near-plane)
    const tracerGeo = new THREE.BoxGeometry(0.010, 0.010, 1.0);
    this.tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.92,
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

    // 5. Initialize Pooled Instanced Impact Sparks & Debris System (1 draw call)
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

    // 5b. Pooled Billboarded Crimson Blood-Mist Puff Sprites (1 draw call, expanding/fading over 260ms)
    const mistTex = this.createBloodMistTexture();
    this.impactTextures.push(mistTex);
    const mistGeo = new THREE.PlaneGeometry(0.42, 0.42);
    const mistMat = new THREE.MeshBasicMaterial({
      map: mistTex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.bloodMistMesh = new THREE.InstancedMesh(mistGeo, mistMat, this.MAX_BLOOD_MIST);
    this.bloodMistMesh.frustumCulled = false;
    this.bloodMistActive = new Uint8Array(this.MAX_BLOOD_MIST);
    this.bloodMistPos = new Float32Array(this.MAX_BLOOD_MIST * 3);
    this.bloodMistVel = new Float32Array(this.MAX_BLOOD_MIST * 3);
    this.bloodMistLife = new Float32Array(this.MAX_BLOOD_MIST);
    this.bloodMistMaxLife = new Float32Array(this.MAX_BLOOD_MIST);
    this.bloodMistBaseScale = new Float32Array(this.MAX_BLOOD_MIST);
    this.bloodMistSpin = new Float32Array(this.MAX_BLOOD_MIST);
    for (let i = 0; i < this.MAX_BLOOD_MIST; i++) {
      this.bloodMistMesh.setMatrixAt(i, _dummy.matrix);
      _particleColor.setHex(i % 2 === 0 ? 0xc81220 : 0x7d0a14);
      this.bloodMistMesh.setColorAt(i, _particleColor);
    }
    this.bloodMistMesh.instanceMatrix.needsUpdate = true;
    if (this.bloodMistMesh.instanceColor) this.bloodMistMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.bloodMistMesh);

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

  private createBloodSplatterTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 128);

    const core = ctx.createRadialGradient(64, 64, 4, 64, 64, 34);
    core.addColorStop(0.0, 'rgba(92, 6, 12, 0.94)');
    core.addColorStop(0.55, 'rgba(132, 12, 20, 0.78)');
    core.addColorStop(1.0, 'rgba(110, 8, 14, 0.0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(64, 64, 34, 0, Math.PI * 2);
    ctx.fill();

    // Organic CS2 directional spray droplets
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (i % 3) * 0.21;
      const dist = 16 + ((i * 19) % 38);
      const rx = 3 + ((i * 7) % 8);
      const ry = 2 + ((i * 5) % 5);
      ctx.save();
      ctx.translate(64 + Math.cos(a) * dist, 64 + Math.sin(a) * dist);
      ctx.rotate(a);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(112, 8, 14, 0.85)' : 'rgba(148, 16, 22, 0.72)';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createBloodMistTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 128);

    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 58);
    g.addColorStop(0.0, 'rgba(185, 16, 26, 0.92)');
    g.addColorStop(0.38, 'rgba(140, 10, 18, 0.72)');
    g.addColorStop(0.74, 'rgba(92, 6, 12, 0.30)');
    g.addColorStop(1.0, 'rgba(60, 4, 8, 0.0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();

    // Soft organic aerosol lobes for CS2 crimson burst mist
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const ox = 64 + Math.cos(a) * 18;
      const oy = 64 + Math.sin(a) * 18;
      const lg = ctx.createRadialGradient(ox, oy, 2, ox, oy, 26);
      lg.addColorStop(0.0, 'rgba(162, 14, 22, 0.58)');
      lg.addColorStop(1.0, 'rgba(100, 6, 12, 0.0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(ox, oy, 26, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public spawnBloodDecal(point: THREE.Vector3, normal: THREE.Vector3, isHeadshot = false): void {
    _dummy.position.copy(point).addScaledVector(normal, 0.012);
    const scale = (isHeadshot ? 1.32 : 0.92) + Math.random() * 0.28;
    _dummy.scale.set(scale, scale, 1);
    _lookTarget.copy(point).add(normal);
    _dummy.lookAt(_lookTarget);
    _dummy.rotateZ(Math.random() * Math.PI * 2);
    _dummy.updateMatrix();

    const idx = this.bloodIndex;
    this.bloodIndex = (this.bloodIndex + 1) % this.MAX_BLOOD_DECALS;
    this.bloodDecals.setMatrixAt(idx, _dummy.matrix);
    this.bloodDecals.instanceMatrix.needsUpdate = true;
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
    // Suppressed weapons (M4A1-S & USP-S) hide bullet tracers
    if (weaponId === 'vanguard-m4' || weaponId === 'usp-s') return;

    const dx0 = to.x - from.x;
    const dy0 = to.y - from.y;
    const dz0 = to.z - from.z;
    const totalDist = Math.hypot(dx0, dy0, dz0);
    // Never spawn a tracer when impact is closer than 1.65m (prevents camera near-plane polygon artifacts)
    if (totalDist < 1.65) return;

    const invD = 1 / totalDist;
    const dirX = dx0 * invD;
    const dirY = dy0 * invD;
    const dirZ = dz0 * invD;

    const idx = this.tracerIndex;
    const tracer = this.tracerPool[idx];
    this.tracerIndex = (this.tracerIndex + 1) % this.MAX_TRACERS;

    // Strictly start >= 1.35m ahead of the eye along the shot ray with subtle right/down barrel offset
    const rx = rightVec ? rightVec.x * 0.09 : 0;
    const ry = rightVec ? rightVec.y * 0.09 : 0;
    const rz = rightVec ? rightVec.z * 0.09 : 0;
    const startOffset = 1.35;
    tracer.startX = from.x + dirX * startOffset + rx;
    tracer.startY = from.y + dirY * startOffset - 0.06 + ry;
    tracer.startZ = from.z + dirZ * startOffset + rz;
    tracer.endX = to.x;
    tracer.endY = to.y;
    tracer.endZ = to.z;
    tracer.maxLifetime = weaponId === 'sovereign-awp' ? 0.075 : 0.065;
    tracer.lifetime = tracer.maxLifetime;
    tracer.active = true;

    const segDx = tracer.endX - tracer.startX;
    const segDy = tracer.endY - tracer.startY;
    const segDz = tracer.endZ - tracer.startZ;
    const segDist = Math.hypot(segDx, segDy, segDz);
    if (segDist < 0.25) {
      tracer.active = false;
      return;
    }

    // Clamp bolt tail strictly >= 0.0 along [start..end] (which is already >= 1.35m ahead of camera)
    const maxBoltLen = weaponId === 'sovereign-awp' ? 7.5 : 4.2;
    const headDist = Math.min(segDist, Math.max(0.8, segDist * 0.35));
    const tailDist = Math.max(0, headDist - maxBoltLen);
    const boltLen = Math.max(0.12, headDist - tailDist);
    const midFrac = ((headDist + tailDist) * 0.5) / segDist;

    _tracerMid.set(
      tracer.startX + segDx * midFrac,
      tracer.startY + segDy * midFrac,
      tracer.startZ + segDz * midFrac
    );
    _tracerTarget.set(tracer.endX, tracer.endY, tracer.endZ);
    _dummy.position.copy(_tracerMid);
    _dummy.lookAt(_tracerTarget);
    const widthScale = weaponId === 'sovereign-awp' ? 1.35 : 0.95;
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
    // 1. Expanding crimson aerosol blood-mist sprites (6-10 soft billboarded puffs over 260ms)
    const mistCount = isHeadshot ? 10 : 7;
    for (let i = 0; i < mistCount; i++) {
      const idx = this.bloodMistIndex;
      this.bloodMistIndex = (this.bloodMistIndex + 1) % this.MAX_BLOOD_MIST;
      const o3 = idx * 3;
      const puffSpeed = 0.75 + Math.random() * 1.9;
      this.bloodMistPos[o3] = point.x + (Math.random() - 0.5) * 0.08;
      this.bloodMistPos[o3 + 1] = point.y + (Math.random() - 0.5) * 0.08;
      this.bloodMistPos[o3 + 2] = point.z + (Math.random() - 0.5) * 0.08;
      // Spray both back toward shooter and through exit cone behind target
      const dirSign = i < mistCount * 0.55 ? 1 : -0.75;
      this.bloodMistVel[o3] = normal.x * puffSpeed * dirSign + (Math.random() - 0.5) * 1.8;
      this.bloodMistVel[o3 + 1] = normal.y * puffSpeed * dirSign + (Math.random() - 0.2) * 1.35;
      this.bloodMistVel[o3 + 2] = normal.z * puffSpeed * dirSign + (Math.random() - 0.5) * 1.8;
      const maxLife = 0.24 + Math.random() * 0.06;
      this.bloodMistLife[idx] = maxLife;
      this.bloodMistMaxLife[idx] = maxLife;
      this.bloodMistBaseScale[idx] = (isHeadshot ? 1.18 : 0.88) + Math.random() * 0.45;
      this.bloodMistSpin[idx] = Math.random() * Math.PI * 2;
      this.bloodMistActive[idx] = 1;
    }

    // 2. High-velocity crimson droplets + metallic helmet dink sparks on headshots
    const count = isHeadshot ? 14 : 8;
    for (let i = 0; i < count; i++) {
      const isDinkSpark = isHeadshot && i < 6;
      const speed = isDinkSpark ? 3.8 + Math.random() * 4.2 : 1.4 + Math.random() * 2.6;
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
        isDinkSpark ? (i % 2 === 0 ? 0xfff0a0 : 0xffaa22) : i % 2 === 0 ? 0xc21422 : 0x760812,
        isDinkSpark ? 0.78 : 0.95 + Math.random() * 0.75,
        isDinkSpark ? 0.18 : 0.26 + Math.random() * 0.14,
        isDinkSpark ? 11.0 : 6.8
      );
    }
  }

  public spawnShellCasing(
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    weaponId = 'garam-47'
  ): void {
    const idx = this.shellIndex;
    this.shellIndex = (this.shellIndex + 1) % this.MAX_SHELLS;

    // Weapon-calibrated right-side ejection port offsets in camera space
    const isPistol = weaponId === 'desert-eagle' || weaponId === 'usp-s' || weaponId === 'glock-18';
    const isSniper = weaponId === 'sovereign-awp';
    const rightOff = isPistol ? 0.16 : isSniper ? 0.18 : 0.21;
    const fwdOff = isPistol ? 0.24 : isSniper ? 0.22 : 0.30;
    const yOff = isPistol ? -0.075 : -0.095;

    const offset3 = idx * 3;
    this.shellPos[offset3] = origin.x + right.x * rightOff + forward.x * fwdOff;
    this.shellPos[offset3 + 1] = origin.y + yOff;
    this.shellPos[offset3 + 2] = origin.z + right.z * rightOff + forward.z * fwdOff;

    const speed = (isPistol ? 2.1 : 2.55) + Math.random() * 0.75;
    this.shellVel[offset3] = right.x * speed - forward.x * 0.45;
    this.shellVel[offset3 + 1] = 1.9 + Math.random() * 0.65;
    this.shellVel[offset3 + 2] = right.z * speed - forward.z * 0.45;

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
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.15) {
          tracer.active = false;
          _dummy.position.set(0, -500, 0);
          _dummy.scale.set(0, 0, 0);
          _dummy.updateMatrix();
          this.tracerInstancedMesh.setMatrixAt(i, _dummy.matrix);
          tracersUpdated = true;
          continue;
        }
        // Advance head smoothly to impact while clamping tail >= 0.0 (always >= 1.35m in front of camera)
        const headDist = Math.min(dist, Math.max(0.8, dist * (0.35 + progress * 0.72)));
        const maxLen = Math.min(dist, 4.4 * (1.0 - progress * 0.45));
        const tailDist = Math.max(0, headDist - maxLen);
        const boltLen = Math.max(0.08, headDist - tailDist);
        const midFrac = ((headDist + tailDist) * 0.5) / dist;
        _tracerMid.set(
          tracer.startX + dx * midFrac,
          tracer.startY + dy * midFrac,
          tracer.startZ + dz * midFrac
        );
        _tracerTarget.set(tracer.endX, tracer.endY, tracer.endZ);
        _dummy.position.copy(_tracerMid);
        _dummy.lookAt(_tracerTarget);
        const fade = Math.max(0.18, 1.0 - progress * 0.75);
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

    // 3b. Tick billboarded crimson blood-mist sprites (camera-facing, expanding & dissipating over 260ms)
    let mistUpdated = false;
    for (let i = 0; i < this.MAX_BLOOD_MIST; i++) {
      if (!this.bloodMistActive[i]) continue;
      this.bloodMistLife[i] -= dt;
      if (this.bloodMistLife[i] <= 0) {
        this.bloodMistActive[i] = 0;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.bloodMistMesh.setMatrixAt(i, _dummy.matrix);
        mistUpdated = true;
        continue;
      }
      const o3 = i * 3;
      const drag = Math.max(0, 1 - 4.8 * dt);
      this.bloodMistVel[o3] *= drag;
      this.bloodMistVel[o3 + 1] = this.bloodMistVel[o3 + 1] * drag - 1.8 * dt;
      this.bloodMistVel[o3 + 2] *= drag;
      this.bloodMistPos[o3] += this.bloodMistVel[o3] * dt;
      this.bloodMistPos[o3 + 1] += this.bloodMistVel[o3 + 1] * dt;
      this.bloodMistPos[o3 + 2] += this.bloodMistVel[o3 + 2] * dt;

      const lifeRatio = Math.max(0, this.bloodMistLife[i] / Math.max(0.01, this.bloodMistMaxLife[i]));
      const progress = 1.0 - lifeRatio;
      // Fast burst expansion then smooth dissipation shrink at the tail
      const envelope = progress < 0.45 ? 0.55 + progress * 2.2 : Math.max(0.01, (1.0 - progress) / 0.55) * 1.54;
      const s = this.bloodMistBaseScale[i] * envelope;
      _dummy.position.set(this.bloodMistPos[o3], this.bloodMistPos[o3 + 1], this.bloodMistPos[o3 + 2]);
      _dummy.quaternion.copy(this.camera.quaternion);
      _dummy.rotateZ(this.bloodMistSpin[i] + progress * 0.9);
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      this.bloodMistMesh.setMatrixAt(i, _dummy.matrix);
      mistUpdated = true;
    }
    if (mistUpdated) {
      this.bloodMistMesh.instanceMatrix.needsUpdate = true;
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

  public clearAll(): void {
    _dummy.position.set(0, -500, 0);
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();

    for (let i = 0; i < this.MAX_CONCRETE_DECALS; i++) {
      this.concreteDecals.setMatrixAt(i, _dummy.matrix);
    }
    this.concreteDecals.instanceMatrix.needsUpdate = true;
    this.concreteIndex = 0;

    for (let i = 0; i < this.MAX_WOOD_DECALS; i++) {
      this.woodDecals.setMatrixAt(i, _dummy.matrix);
    }
    this.woodDecals.instanceMatrix.needsUpdate = true;
    this.woodIndex = 0;

    for (let i = 0; i < this.MAX_METAL_DECALS; i++) {
      this.metalDecals.setMatrixAt(i, _dummy.matrix);
    }
    this.metalDecals.instanceMatrix.needsUpdate = true;
    this.metalIndex = 0;

    for (let i = 0; i < this.MAX_BLOOD_DECALS; i++) {
      this.bloodDecals.setMatrixAt(i, _dummy.matrix);
    }
    this.bloodDecals.instanceMatrix.needsUpdate = true;
    this.bloodIndex = 0;

    for (let i = 0; i < this.MAX_SHELLS; i++) {
      this.shellActive[i] = false;
      this.shellInstancedMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.shellInstancedMesh.instanceMatrix.needsUpdate = true;
    this.shellIndex = 0;

    for (let i = 0; i < this.MAX_TRACERS; i++) {
      if (this.tracerPool[i]) this.tracerPool[i].active = false;
      this.tracerInstancedMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.tracerInstancedMesh.instanceMatrix.needsUpdate = true;
    this.tracerIndex = 0;

    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particleActive[i] = 0;
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.particleIndex = 0;

    for (let i = 0; i < this.MAX_BLOOD_MIST; i++) {
      this.bloodMistActive[i] = 0;
      this.bloodMistMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.bloodMistMesh.instanceMatrix.needsUpdate = true;
    this.bloodMistIndex = 0;

    for (let i = 0; i < this.popupPool.length; i++) {
      this.popupPool[i].active = false;
      this.popupPool[i].remaining = 0;
      this.popupPool[i].el.style.display = 'none';
    }
  }

  public dispose(): void {
    const decalGeo = this.concreteDecals.geometry;
    this.scene.remove(
      this.concreteDecals,
      this.woodDecals,
      this.metalDecals,
      this.bloodDecals,
      this.shellInstancedMesh,
      this.particleMesh,
      this.bloodMistMesh
    );
    decalGeo.dispose();
    this.bloodDecals.geometry.dispose();
    (this.concreteDecals.material as THREE.Material).dispose();
    (this.woodDecals.material as THREE.Material).dispose();
    (this.metalDecals.material as THREE.Material).dispose();
    (this.bloodDecals.material as THREE.Material).dispose();
    for (const tex of this.impactTextures) {
      tex.dispose();
    }
    this.impactTextures.length = 0;

    this.shellInstancedMesh.geometry.dispose();
    (this.shellInstancedMesh.material as THREE.Material).dispose();
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();
    this.bloodMistMesh.geometry.dispose();
    (this.bloodMistMesh.material as THREE.Material).dispose();

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
