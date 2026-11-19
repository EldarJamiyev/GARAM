import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface ModelNormalizationOptions {
  targetLength?: number; // Target dimension on longest horizontal axis (for weapons)
  targetHeight?: number; // Target dimension on Y axis (for characters)
  centerAtFeet?: boolean; // If true, sets bounding box bottom at Y = 0
  envMapIntensity?: number;
}

export class AssetManager {
  private static instance: AssetManager;
  private loader: GLTFLoader;
  private cache: Map<string, THREE.Group | THREE.Object3D> = new Map();
  private failedPaths: Set<string> = new Set();

  private constructor() {
    this.loader = new GLTFLoader();
  }

  public static getInstance(): AssetManager {
    if (!AssetManager.instance) {
      AssetManager.instance = new AssetManager();
    }
    return AssetManager.instance;
  }

  /**
   * Asynchronously loads a .glb / .gltf model with graceful procedural fallback.
   * Returns a cloned and normalized Object3D, or null if the file cannot be found/loaded.
   */
  public async loadModel(
    path: string,
    options: ModelNormalizationOptions = {}
  ): Promise<THREE.Object3D | null> {
    if (this.failedPaths.has(path)) {
      return null;
    }

    try {
      let template = this.cache.get(path);
      if (!template) {
        const gltf = await this.loader.loadAsync(path);
        template = gltf.scene;
        this.cache.set(path, template);
      }

      // Safe clone preserving SkinnedMesh skeletons if present
      const cloned = SkeletonUtils.clone(template) as THREE.Group;

      // Apply PBR upgrades, shadow flags, and culling discipline
      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;

          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((mat) => {
              if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const std = mat as THREE.MeshStandardMaterial;
                std.envMapIntensity = options.envMapIntensity ?? 1.6;
                std.needsUpdate = true;
              }
            });
          }
        }
      });

      this.normalizeGLB(cloned, options);
      return cloned;
    } catch (err) {
      // Graceful fallback: log once and return null so procedural models take over
      console.warn(`[AssetManager] Model at "${path}" not found or failed to load. Falling back to procedural PBR mesh.`);
      this.failedPaths.add(path);
      return null;
    }
  }

  /**
   * Normalizes model pivot and scale based on bounding box metrics
   */
  public normalizeGLB(object: THREE.Object3D, options: ModelNormalizationOptions): void {
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // 1. Scale normalization
    let scaleFactor = 1.0;
    if (options.targetHeight && size.y > 0) {
      scaleFactor = options.targetHeight / size.y;
    } else if (options.targetLength) {
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        scaleFactor = options.targetLength / maxDim;
      }
    }

    if (scaleFactor !== 1.0) {
      object.scale.multiplyScalar(scaleFactor);
      box.setFromObject(object);
      box.getSize(size);
      box.getCenter(center);
    }

    // 2. Pivot adjustment
    if (options.centerAtFeet) {
      // Align bottom of model with local Y = 0
      object.position.y -= box.min.y;
      object.position.x -= center.x;
      object.position.z -= center.z;
    }
  }
}
