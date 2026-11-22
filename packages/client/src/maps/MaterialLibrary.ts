import * as THREE from 'three';
import { AssetManager } from '../render/AssetManager.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface PBRMaterialSet {
  deck: THREE.MeshStandardMaterial;
  sanctum: THREE.MeshStandardMaterial;
  aqueduct: THREE.MeshStandardMaterial;
  foundry: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  drywall: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
}

/**
 * CS2 Photographic PBR Material Library
 * Loads CC0 1K photographic PBR textures with sRGB/linear calibration,
 * maxAnisotropy filtering, and injects world-space triplanar anti-tiling
 * and ground-contact dust height gradients via onBeforeCompile.
 */
export class MaterialLibrary {
  private static instance: MaterialLibrary;
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly maxAnisotropy: number;

  private constructor() {
    this.maxAnisotropy = AssetManager.getInstance().getMaxAnisotropy();
  }

  public static getInstance(): MaterialLibrary {
    if (!MaterialLibrary.instance) {
      MaterialLibrary.instance = new MaterialLibrary();
    }
    return MaterialLibrary.instance;
  }

  private loadTexture(
    url: string,
    colorSpace: THREE.ColorSpace = THREE.NoColorSpace,
    repeatX = 1,
    repeatY = 1
  ): THREE.Texture {
    const tex = this.textureLoader.load(url);
    tex.colorSpace = colorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = this.maxAnisotropy;
    return tex;
  }

  /**
   * Injects world-space noise variation to eliminate repetitive tiling
   * and grounds wall bases into the floor with a soft warm dust gradient.
   */
  public applyAntiTilingPatch(material: THREE.MeshStandardMaterial, enableDust = true): void {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPositionAntiTile;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPositionAntiTile = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPositionAntiTile;`
      );

      const dustSnippet = enableDust
        ? `
         // CS2 ground-contact dust height gradient (0.0m - 0.85m above deck)
         float dustFactor = clamp((2.95 - vWorldPositionAntiTile.y) / 0.85, 0.0, 1.0);
         vec3 warmDust = vec3(0.76, 0.69, 0.59);
         diffuseColor.rgb = mix(diffuseColor.rgb, warmDust, dustFactor * 0.28);
        `
        : '';

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // World-space triplanar stochastic micro-noise
         float microNoise = sin(vWorldPositionAntiTile.x * 2.3) * sin(vWorldPositionAntiTile.z * 2.3) * sin(vWorldPositionAntiTile.y * 2.3);
         float macroVariation = sin(vWorldPositionAntiTile.x * 0.12 + vWorldPositionAntiTile.z * 0.12) * 0.06;
         diffuseColor.rgb *= (1.0 + macroVariation + microNoise * 0.035);
         ${dustSnippet}
        `
      );
    };
  }

  public createMaterials(): PBRMaterialSet {
    // 1. Cobblestone 04 (Main Courtyards & Lanes)
    const deckDiff = this.loadTexture('/textures/pbr/cobblestone_04/diff_1k.jpg', THREE.SRGBColorSpace, 4, 4);
    const deckNor = this.loadTexture('/textures/pbr/cobblestone_04/nor_gl_1k.jpg', THREE.NoColorSpace, 4, 4);
    const deckRough = this.loadTexture('/textures/pbr/cobblestone_04/rough_1k.jpg', THREE.NoColorSpace, 4, 4);
    const deckMat = new THREE.MeshStandardMaterial({
      map: deckDiff,
      normalMap: deckNor,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: deckRough,
      roughness: 0.88,
      metalness: 0.02,
    });
    this.applyAntiTilingPatch(deckMat, false);

    // 2. Plastered Stone Wall (A Sanctum & Exterior Walls)
    const sanctumDiff = this.loadTexture('/textures/pbr/plastered_stone_wall/diff_1k.jpg', THREE.SRGBColorSpace, 3, 3);
    const sanctumNor = this.loadTexture('/textures/pbr/plastered_stone_wall/nor_gl_1k.jpg', THREE.NoColorSpace, 3, 3);
    const sanctumRough = this.loadTexture('/textures/pbr/plastered_stone_wall/rough_1k.jpg', THREE.NoColorSpace, 3, 3);
    const sanctumMat = new THREE.MeshStandardMaterial({
      map: sanctumDiff,
      normalMap: sanctumNor,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: sanctumRough,
      roughness: 0.90,
      metalness: 0.01,
    });
    this.applyAntiTilingPatch(sanctumMat, true);

    // 3. Damaged Plaster (A Sanctum Accents & Revealing Terracotta)
    const damagedDiff = this.loadTexture('/textures/pbr/damaged_plaster/diff_1k.jpg', THREE.SRGBColorSpace, 3, 3);
    const damagedNor = this.loadTexture('/textures/pbr/damaged_plaster/nor_gl_1k.jpg', THREE.NoColorSpace, 3, 3);
    const damagedRough = this.loadTexture('/textures/pbr/damaged_plaster/rough_1k.jpg', THREE.NoColorSpace, 3, 3);
    const drywallMat = new THREE.MeshStandardMaterial({
      map: damagedDiff,
      normalMap: damagedNor,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: damagedRough,
      roughness: 0.92,
      metalness: 0.02,
    });
    this.applyAntiTilingPatch(drywallMat, true);

    // 4. Concrete Panels (B Foundry Industrial Deck & Walls)
    const concreteDiff = this.loadTexture('/textures/pbr/concrete_panels/diff_1k.jpg', THREE.SRGBColorSpace, 3, 3);
    const concreteNor = this.loadTexture('/textures/pbr/concrete_panels/nor_gl_1k.jpg', THREE.NoColorSpace, 3, 3);
    const concreteRough = this.loadTexture('/textures/pbr/concrete_panels/rough_1k.jpg', THREE.NoColorSpace, 3, 3);
    const foundryMat = new THREE.MeshStandardMaterial({
      map: concreteDiff,
      normalMap: concreteNor,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: concreteRough,
      roughness: 0.78,
      metalness: 0.08,
    });
    this.applyAntiTilingPatch(foundryMat, true);

    // 5. Aqueduct (Dark basalt tinted stone)
    const aqueductMat = new THREE.MeshStandardMaterial({
      map: concreteDiff,
      normalMap: concreteNor,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: concreteRough,
      color: 0x424a52,
      roughness: 0.62,
      metalness: 0.15,
    });
    this.applyAntiTilingPatch(aqueductMat, false);

    // 6. Roof Planks (Timber Doors, Pergolas & Crates)
    const woodDiff = this.loadTexture('/textures/pbr/roof_planks/diff_1k.jpg', THREE.SRGBColorSpace, 2, 2);
    const woodNor = this.loadTexture('/textures/pbr/roof_planks/nor_gl_1k.jpg', THREE.NoColorSpace, 2, 2);
    const woodRough = this.loadTexture('/textures/pbr/roof_planks/rough_1k.jpg', THREE.NoColorSpace, 2, 2);
    const woodMat = new THREE.MeshStandardMaterial({
      map: woodDiff,
      normalMap: woodNor,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: woodRough,
      roughness: 0.75,
      metalness: 0.03,
    });

    // 7. Corrugated Iron 03 (Containers & Industrial Metal Cover)
    const metalDiff = this.loadTexture('/textures/pbr/corrugated_iron_03/diff_1k.jpg', THREE.SRGBColorSpace, 2, 2);
    const metalNor = this.loadTexture('/textures/pbr/corrugated_iron_03/nor_gl_1k.jpg', THREE.NoColorSpace, 2, 2);
    const metalRough = this.loadTexture('/textures/pbr/corrugated_iron_03/rough_1k.jpg', THREE.NoColorSpace, 2, 2);
    const metalMat = new THREE.MeshStandardMaterial({
      map: metalDiff,
      normalMap: metalNor,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: metalRough,
      roughness: 0.42,
      metalness: 0.68,
    });

    return {
      deck: deckMat,
      sanctum: sanctumMat,
      aqueduct: aqueductMat,
      foundry: foundryMat,
      wood: woodMat,
      drywall: drywallMat,
      metal: metalMat,
    };
  }

  /**
   * Batches environmental decals into <= 3 draw calls using mergeGeometries:
   * 1. Wall cracks and damaged plaster corners
   * 2. Ground oil/water stains
   * 3. Ground drainage grates
   */
  public createEnvironmentalDecals(scene: THREE.Scene): void {
    const crackGeos: THREE.BufferGeometry[] = [];
    const stainGeos: THREE.BufferGeometry[] = [];
    const grateGeos: THREE.BufferGeometry[] = [];

    // Cracks on wall corners
    const crackCoords = [
      { x: -33.4, y: 3.8, z: -8.0, rotY: 0, w: 1.2, h: 2.2 },
      { x: -17.5, y: 3.6, z: -16.0, rotY: 0, w: 1.0, h: 1.8 },
      { x: 29.5, y: 3.5, z: -8.0, rotY: 0, w: 1.4, h: 2.4 },
      { x: 22.0, y: 3.4, z: -15.5, rotY: 0, w: 1.1, h: 1.9 },
      { x: 0.0, y: 4.8, z: -16.8, rotY: Math.PI, w: 1.5, h: 2.5 },
      { x: -7.6, y: 2.8, z: -21.0, rotY: Math.PI / 2, w: 0.9, h: 1.6 },
      { x: 7.6, y: 2.8, z: -21.0, rotY: -Math.PI / 2, w: 0.9, h: 1.6 },
    ];
    for (const c of crackCoords) {
      const g = new THREE.PlaneGeometry(c.w, c.h);
      g.rotateY(c.rotY);
      g.translate(c.x, c.y, c.z);
      crackGeos.push(g);
    }

    // Oil & water stains on decks
    const stainCoords = [
      { x: 28.0, z: -18.0, r: 2.4 },
      { x: 31.0, z: -22.0, r: 1.8 },
      { x: 24.0, z: -10.0, r: 2.1 },
      { x: 0.0, z: 8.0, r: 3.0 },
      { x: 1.5, z: -2.0, r: 2.2 },
      { x: -28.0, z: -12.0, r: 1.9 },
    ];
    for (const s of stainCoords) {
      const g = new THREE.PlaneGeometry(s.r * 2, s.r * 2);
      g.rotateX(-Math.PI / 2);
      g.translate(s.x, 2.1 + 0.015, s.z);
      stainGeos.push(g);
    }

    // Aqueduct drainage grates
    const grateCoords = [
      { x: 0.0, z: 12.0 },
      { x: 0.0, z: 0.0 },
      { x: 0.0, z: -12.0 },
    ];
    for (const gr of grateCoords) {
      const g = new THREE.PlaneGeometry(1.6, 2.4);
      g.rotateX(-Math.PI / 2);
      g.translate(gr.x, 0.0 + 0.012, gr.z);
      grateGeos.push(g);
    }

    // Merge and emit batches
    if (crackGeos.length > 0) {
      const merged = mergeGeometries(crackGeos, false);
      crackGeos.forEach((g) => g.dispose());
      if (merged) {
        const mat = new THREE.MeshBasicMaterial({
          map: this.generateProceduralDecalTexture('crack'),
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1.2,
        });
        scene.add(new THREE.Mesh(merged, mat));
      }
    }

    if (stainGeos.length > 0) {
      const merged = mergeGeometries(stainGeos, false);
      stainGeos.forEach((g) => g.dispose());
      if (merged) {
        const mat = new THREE.MeshStandardMaterial({
          map: this.generateProceduralDecalTexture('stain'),
          transparent: true,
          opacity: 0.55,
          roughness: 0.22, // slick wet appearance
          metalness: 0.25,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1.1,
        });
        scene.add(new THREE.Mesh(merged, mat));
      }
    }

    if (grateGeos.length > 0) {
      const merged = mergeGeometries(grateGeos, false);
      grateGeos.forEach((g) => g.dispose());
      if (merged) {
        const mat = new THREE.MeshStandardMaterial({
          map: this.generateProceduralDecalTexture('grate'),
          transparent: true,
          roughness: 0.45,
          metalness: 0.75,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1.0,
        });
        scene.add(new THREE.Mesh(merged, mat));
      }
    }
  }

  private generateProceduralDecalTexture(type: 'crack' | 'stain' | 'grate'): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);

    if (type === 'crack') {
      ctx.strokeStyle = 'rgba(45, 38, 30, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(size * 0.5, 10);
      let currX = size * 0.5;
      for (let y = 20; y < size - 10; y += 15) {
        currX += (Math.sin(y * 0.4) * 12 + Math.cos(y * 0.7) * 8);
        ctx.lineTo(currX, y);
      }
      ctx.stroke();
    } else if (type === 'stain') {
      const g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2 - 10);
      g.addColorStop(0, 'rgba(22, 20, 18, 0.75)');
      g.addColorStop(0.5, 'rgba(35, 30, 24, 0.45)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Cast-iron drainage grate
      ctx.fillStyle = 'rgba(32, 36, 42, 0.95)';
      ctx.fillRect(10, 10, size - 20, size - 20);
      ctx.fillStyle = 'rgba(10, 12, 14, 0.95)';
      for (let y = 25; y < size - 25; y += 16) {
        ctx.fillRect(20, y, size - 40, 7);
      }
      // Metal rim
      ctx.strokeStyle = 'rgba(90, 95, 102, 0.85)';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, size - 20, size - 20);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
