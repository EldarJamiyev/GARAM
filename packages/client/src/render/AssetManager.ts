import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface ModelNormalizationOptions {
  targetLength?: number; // Target dimension on longest axis (for weapons/props)
  targetHeight?: number; // Target dimension on Y axis (for characters)
  centerAtFeet?: boolean; // Aligns bounding box bottom at Y = 0 and centers X/Z
  centerPivot?: boolean; // Centers bounding box at (0, 0, 0)
  rotationEuler?: [number, number, number]; // Pre-normalization rotation in radians [x, y, z]
  envMapIntensity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export class AssetManager {
  private static instance: AssetManager;
  private loader: GLTFLoader;
  private cache: Map<string, THREE.Object3D> = new Map();
  private inflight: Map<string, Promise<THREE.Object3D | null>> = new Map();
  private failedPaths: Set<string> = new Set();
  private maxAnisotropy = 8;

  private constructor() {
    this.loader = new GLTFLoader();
  }

  public static getInstance(): AssetManager {
    if (!AssetManager.instance) {
      AssetManager.instance = new AssetManager();
    }
    return AssetManager.instance;
  }

  public setMaxAnisotropy(anisotropy: number): void {
    this.maxAnisotropy = Math.max(1, Math.min(16, anisotropy));
  }

  /**
   * Asynchronously loads a .glb / .gltf model with in-flight deduplication and graceful fallback.
   * Returns a normalized wrapper Group containing a SkeletonUtils-cloned model, or null on failure.
   */
  public async loadModel(
    path: string,
    options: ModelNormalizationOptions = {}
  ): Promise<THREE.Object3D | null> {
    if (this.failedPaths.has(path)) {
      return null;
    }

    try {
      const template = await this.getOrLoadTemplate(path);
      if (!template) return null;

      // Safe clone preserving SkinnedMesh skeletons and independent bone hierarchies
      const cloned = SkeletonUtils.clone(template);
      const castShadow = options.castShadow ?? true;
      const receiveShadow = options.receiveShadow ?? true;

      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = castShadow;
          mesh.receiveShadow = receiveShadow;
          mesh.frustumCulled = false;

          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (let i = 0; i < mats.length; i++) {
              const mat = mats[i];
              if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const std = mat as THREE.MeshStandardMaterial;
                std.envMapIntensity = options.envMapIntensity ?? 1.5;
                std.needsUpdate = true;
              }
            }
          }
        }
      });

      const wrapper = new THREE.Group();
      wrapper.name = `glb_wrapper_${path}`;
      if (options.rotationEuler) {
        cloned.rotation.set(
          options.rotationEuler[0],
          options.rotationEuler[1],
          options.rotationEuler[2]
        );
      }
      wrapper.add(cloned);
      this.normalizeGLB(wrapper, cloned, options);
      return wrapper;
    } catch {
      console.warn(`[AssetManager] Model at "${path}" failed to load. Falling back to procedural PBR mesh.`);
      this.failedPaths.add(path);
      return null;
    }
  }

  private async getOrLoadTemplate(path: string): Promise<THREE.Object3D | null> {
    const cached = this.cache.get(path);
    if (cached) return cached;

    let pending = this.inflight.get(path);
    if (!pending) {
      pending = this.loader
        .loadAsync(path)
        .then((gltf) => {
          const root = gltf.scene;
          // Apply texture anisotropy and color-space hygiene once on the template
          root.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const mat of mats) {
                if (!mat) continue;
                const std = mat as THREE.MeshStandardMaterial;
                for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap, std.emissiveMap]) {
                  if (tex) {
                    tex.anisotropy = this.maxAnisotropy;
                    tex.needsUpdate = true;
                  }
                }
              }
            }
          });
          this.cache.set(path, root);
          this.inflight.delete(path);
          return root;
        })
        .catch(() => {
          this.failedPaths.add(path);
          this.inflight.delete(path);
          return null;
        });
      this.inflight.set(path, pending);
    }
    return pending;
  }

  /**
   * Computes accurate skinned or static world bounds, then normalizes scale and pivot inside wrapper.
   */
  public normalizeGLB(
    wrapper: THREE.Group,
    inner: THREE.Object3D,
    options: ModelNormalizationOptions
  ): void {
    const computeSkinnedBox = (target: THREE.Object3D): THREE.Box3 => {
      target.updateMatrixWorld(true);
      target.traverse((child) => {
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          const sm = child as THREE.SkinnedMesh;
          sm.skeleton?.update();
          sm.computeBoundingBox();
          sm.computeBoundingSphere();
        }
      });
      return new THREE.Box3().setFromObject(target);
    };

    let box = computeSkinnedBox(wrapper);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    let scaleFactor = 1.0;
    if (options.targetHeight && size.y > 0.0001) {
      scaleFactor = options.targetHeight / size.y;
    } else if (options.targetLength) {
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0.0001) {
        scaleFactor = options.targetLength / maxDim;
      }
    }

    if (Number.isFinite(scaleFactor) && scaleFactor > 0.0001 && scaleFactor !== 1.0) {
      inner.scale.multiplyScalar(scaleFactor);
      box = computeSkinnedBox(wrapper);
      box.getSize(size);
      box.getCenter(center);
    }

    if (options.centerAtFeet) {
      inner.position.x -= center.x;
      inner.position.y -= box.min.y;
      inner.position.z -= center.z;
    } else if (options.centerPivot) {
      inner.position.x -= center.x;
      inner.position.y -= center.y;
      inner.position.z -= center.z;
    }
    wrapper.updateMatrixWorld(true);
  }

  /**
   * Deeply disposes non-shared procedural geometries, materials, and textures.
   */
  public static disposeObject3D(root: THREE.Object3D): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((mat) => {
            Object.keys(mat).forEach((prop) => {
              const val = (mat as unknown as Record<string, unknown>)[prop];
              if (val && typeof val === 'object' && 'isTexture' in val && (val as THREE.Texture).isTexture) {
                (val as THREE.Texture).dispose();
              }
            });
            mat.dispose();
          });
        }
      }
    });
  }
}
