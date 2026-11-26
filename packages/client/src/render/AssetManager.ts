import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface ModelNormalizationOptions {
  targetLength?: number;              // Target dimension on longest axis (for weapons/props)
  targetHeight?: number;              // Target dimension on Y axis (for characters)
  anchorBoneName?: string;            // Translates inner so first matching bone sits at (0,0,0) of wrapper
  centerAtFeet?: boolean;             // Aligns bounding box bottom at Y = 0 and centers X/Z
  centerPivot?: boolean;              // Centers bounding box at (0, 0, 0)
  rotationEuler?: [number, number, number]; // Pre-normalization rotation in radians [x, y, z]
  envMapIntensity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface NormalizedModelUserData {
  normalizationScale: number;
  normalizedBounds: THREE.Box3;
  barrelAxisLocal: THREE.Vector3;
  muzzleTipLocal: THREE.Vector3;
  anchorBoneFound: boolean;
}

interface CachedAssetEntry {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export class AssetManager {
  private static instance: AssetManager;
  private loader: GLTFLoader;
  private cache: Map<string, CachedAssetEntry> = new Map();
  private inflight: Map<string, Promise<CachedAssetEntry | null>> = new Map();
  private failedPaths: Set<string> = new Set();
  private maxAnisotropy = 8;
  private progressListeners: Set<(pct: number, label: string) => void> = new Set();
  private currentProgressPct = 100;
  private currentProgressLabel = '3D ARENA & VIEWMODELS READY';

  private constructor() {
    this.loader = new GLTFLoader();
  }

  public static getInstance(): AssetManager {
    if (!AssetManager.instance) {
      AssetManager.instance = new AssetManager();
    }
    return AssetManager.instance;
  }

  public onProgress(listener: (pct: number, label: string) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.currentProgressPct, this.currentProgressLabel);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  public reportProgress(pct: number, label?: string): void {
    this.currentProgressPct = Math.max(0, Math.min(100, Math.round(pct)));
    if (label) {
      this.currentProgressLabel = label;
    }
    this.progressListeners.forEach((cb) => cb(this.currentProgressPct, this.currentProgressLabel));
  }

  public getLoadingProgress(): { pct: number; label: string } {
    return { pct: this.currentProgressPct, label: this.currentProgressLabel };
  }

  public setMaxAnisotropy(anisotropy: number): void {
    this.maxAnisotropy = Math.max(1, Math.min(16, anisotropy));
  }

  public getMaxAnisotropy(): number {
    return this.maxAnisotropy;
  }

  public static disposeObject3D(obj: THREE.Object3D, disposeTextures = false): void {
    const disposedTextures = disposeTextures ? new Set<THREE.Texture>() : null;
    const disposeMaterialTextures = (mat: THREE.Material) => {
      if (!disposedTextures) return;
      const std = mat as THREE.MeshStandardMaterial & {
        bumpMap?: THREE.Texture | null;
        alphaMap?: THREE.Texture | null;
        lightMap?: THREE.Texture | null;
      };
      const maps: Array<THREE.Texture | null | undefined> = [
        std.map,
        std.normalMap,
        std.roughnessMap,
        std.metalnessMap,
        std.aoMap,
        std.bumpMap,
        std.emissiveMap,
        std.alphaMap,
        std.lightMap,
      ];
      for (const tex of maps) {
        if (tex && !disposedTextures.has(tex)) {
          disposedTextures.add(tex);
          tex.dispose();
        }
      }
    };

    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (let i = 0; i < mats.length; i++) {
            disposeMaterialTextures(mats[i]);
            mats[i].dispose();
          }
        }
      }
    });
  }

  /**
   * Asynchronously loads a .glb / .gltf model with in-flight deduplication and graceful fallback.
   * Returns a normalized wrapper Group containing a SkeletonUtils-cloned model, or null on failure.
   */
  public async loadModel(
    path: string,
    options: ModelNormalizationOptions = {}
  ): Promise<THREE.Object3D | null> {
    const res = await this.loadModelWithAnimations(path, options);
    return res ? res.model : null;
  }

  /**
   * Loads a .glb / .gltf model along with its embedded THREE.AnimationClip array.
   */
  public async loadModelWithAnimations(
    path: string,
    options: ModelNormalizationOptions = {}
  ): Promise<{ model: THREE.Object3D; animations: THREE.AnimationClip[] } | null> {
    if (this.failedPaths.has(path)) {
      return null;
    }

    try {
      const entry = await this.getOrLoadTemplate(path);
      if (!entry) return null;

      // Safe clone preserving SkinnedMesh skeletons and independent bone hierarchies
      const cloned = SkeletonUtils.clone(entry.scene);

      const castShadow = options.castShadow ?? true;
      const receiveShadow = options.receiveShadow ?? true;
      const envIntensity = options.envMapIntensity ?? 1.6;

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
                std.envMapIntensity = envIntensity;
                this.applyTextureAnisotropy(std);
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

      AssetManager.normalizeGLB(wrapper, cloned, options);
      return { model: wrapper, animations: entry.animations };
    } catch {
      console.warn(`[AssetManager] Model at "${path}" failed to load. Falling back to procedural PBR mesh.`);
      this.failedPaths.add(path);
      return null;
    }
  }

  private applyTextureAnisotropy(std: THREE.MeshStandardMaterial): void {
    const texList: Array<THREE.Texture | null> = [
      std.map,
      std.normalMap,
      std.roughnessMap,
      std.metalnessMap,
      std.aoMap,
      std.emissiveMap,
    ];
    for (let i = 0; i < texList.length; i++) {
      const tex = texList[i];
      if (tex) {
        tex.anisotropy = this.maxAnisotropy;
      }
    }
  }

  private async getOrLoadTemplate(path: string): Promise<CachedAssetEntry | null> {
    const cached = this.cache.get(path);
    if (cached) return cached;

    const existingPromise = this.inflight.get(path);
    if (existingPromise) return existingPromise;

    const loadPromise = new Promise<CachedAssetEntry | null>((resolve) => {
      this.loader.load(
        path,
        (gltf) => {
          const root = gltf.scene;
          const animations = gltf.animations || [];

          root.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const mat of mats) {
                if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                  const std = mat as THREE.MeshStandardMaterial;
                  this.applyTextureAnisotropy(std);
                  std.envMapIntensity = 1.6;
                }
              }
            }
          });

          const entry: CachedAssetEntry = { scene: root, animations };
          this.cache.set(path, entry);
          this.inflight.delete(path);
          resolve(entry);
        },
        undefined,
        () => {
          this.failedPaths.add(path);
          this.inflight.delete(path);
          resolve(null);
        }
      );
    });

    this.inflight.set(path, loadPromise);
    return loadPromise;
  }

  /**
   * Scales an arbitrary GLB scene into realistic metric coordinates, optionally anchors
   * a specific bone (e.g. 'weapon_hand_r') to wrapper (0,0,0), and writes deterministic
   * normalization metadata (scale, bounds, barrelAxisLocal, muzzleTipLocal) to wrapper.userData.
   */
  public static normalizeGLB(
    wrapper: THREE.Group,
    inner: THREE.Object3D,
    options: ModelNormalizationOptions
  ): NormalizedModelUserData {
    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = new THREE.Vector3();
    box.getSize(size);

    let scaleFactor = 1.0;
    if (options.targetHeight && size.y > 0.0001) {
      scaleFactor = options.targetHeight / size.y;
    } else if (options.targetLength) {
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0.0001) {
        scaleFactor = options.targetLength / maxDim;
      }
    }

    if (scaleFactor !== 1.0) {
      inner.scale.multiplyScalar(scaleFactor);
      wrapper.updateMatrixWorld(true);
    }

    let anchorBoneFound = false;
    if (options.anchorBoneName) {
      const prefix = options.anchorBoneName.toLowerCase();
      let anchorObj: THREE.Object3D | null = null;
      inner.traverse((obj) => {
        if (!anchorObj && obj.name && obj.name.toLowerCase().startsWith(prefix)) {
          anchorObj = obj;
        }
      });

      if (anchorObj) {
        const boneWorld = new THREE.Vector3();
        (anchorObj as THREE.Object3D).getWorldPosition(boneWorld);
        const boneInWrapper = wrapper.worldToLocal(boneWorld);
        inner.position.sub(boneInWrapper);
        wrapper.updateMatrixWorld(true);
        anchorBoneFound = true;
      }
    }

    const scaledBox = new THREE.Box3().setFromObject(inner);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);

    if (!anchorBoneFound) {
      if (options.centerAtFeet) {
        inner.position.x -= center.x;
        inner.position.z -= center.z;
        inner.position.y -= scaledBox.min.y;
        wrapper.updateMatrixWorld(true);
      } else if (options.centerPivot) {
        inner.position.sub(center);
        wrapper.updateMatrixWorld(true);
      }
    }

    const finalBox = new THREE.Box3().setFromObject(inner);
    const finalSize = new THREE.Vector3();
    const finalCenter = new THREE.Vector3();
    finalBox.getSize(finalSize);
    finalBox.getCenter(finalCenter);

    // Detect primary longitudinal barrel axis (longest bounding dimension)
    // Sign points toward whichever bounding extreme is farther from the grip/origin (muzzle end > stock end)
    const barrelAxisLocal = new THREE.Vector3(0, 0, -1);
    const muzzleTipLocal = new THREE.Vector3(finalCenter.x, finalBox.min.y + finalSize.y * 0.68, finalCenter.z);

    if (finalSize.z >= finalSize.x && finalSize.z >= finalSize.y) {
      const forwardSign = Math.abs(finalBox.max.z) >= Math.abs(finalBox.min.z) ? 1 : -1;
      barrelAxisLocal.set(0, 0, forwardSign);
      muzzleTipLocal.set(
        finalCenter.x,
        finalBox.min.y + finalSize.y * 0.68,
        forwardSign > 0 ? finalBox.max.z : finalBox.min.z
      );
    } else if (finalSize.x >= finalSize.y && finalSize.x >= finalSize.z) {
      const forwardSign = Math.abs(finalBox.max.x) >= Math.abs(finalBox.min.x) ? 1 : -1;
      barrelAxisLocal.set(forwardSign, 0, 0);
      muzzleTipLocal.set(
        forwardSign > 0 ? finalBox.max.x : finalBox.min.x,
        finalBox.min.y + finalSize.y * 0.68,
        finalCenter.z
      );
    } else {
      const forwardSign = Math.abs(finalBox.max.y) >= Math.abs(finalBox.min.y) ? 1 : -1;
      barrelAxisLocal.set(0, forwardSign, 0);
      muzzleTipLocal.set(
        finalCenter.x,
        forwardSign > 0 ? finalBox.max.y : finalBox.min.y,
        finalCenter.z
      );
    }

    const meta: NormalizedModelUserData = {
      normalizationScale: scaleFactor,
      normalizedBounds: finalBox,
      barrelAxisLocal,
      muzzleTipLocal,
      anchorBoneFound,
    };

    wrapper.userData.normalizationScale = meta.normalizationScale;
    wrapper.userData.normalizedBounds = meta.normalizedBounds;
    wrapper.userData.barrelAxisLocal = meta.barrelAxisLocal;
    wrapper.userData.muzzleTipLocal = meta.muzzleTipLocal;
    wrapper.userData.anchorBoneFound = meta.anchorBoneFound;

    return meta;
  }
}
