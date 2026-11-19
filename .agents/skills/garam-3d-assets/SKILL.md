---
name: garam-3d-assets
description: Enforces 3D GLB model normalization, SkinnedMesh cloning, dual-pass viewmodel safety, and graceful procedural fallback for GARAM ZERO HOUR.
---

# GARAM ZERO HOUR — 3D Asset Architecture & GLTF/GLB Invariants

This skill defines the technical standards for importing, normalizing, rendering, and falling back on 3D assets (`.glb` / `.gltf`) in **GARAM: ZERO HOUR**.

## 1. Dimensional Normalization (`normalizeGLB`)
Every loaded 3D asset must pass through a bounding-box normalization utility before attachment to the scene graph:
- **Pivot Centering**: Compute `THREE.Box3().setFromObject(model)`. Offset mesh children so the pivot corresponds to the realistic grip point (weapons) or feet center at `y = 0` (operators).
- **Target Dimensions**:
  - **Weapons (Longest Axis)**:
    - `garam-47`: 0.88 m
    - `vanguard-m4`: 0.84 m
    - `sovereign-awp`: 1.22 m
    - `desert-eagle`: 0.27 m
    - `garam-karambit`: 0.22 m
    - Grenades: 0.12 m
  - **Operators (Height `size.y`)**:
    - `operator_garam`: 1.82 m (standing eye-level 1.68 m)
    - `operator_syndicate`: 1.82 m (standing eye-level 1.68 m)

## 2. SkinnedMesh & Dual-Pass Rendering Discipline
- **Cloning Characters**: When instantiating multiple operators, use `SkeletonUtils.clone(root)` from `three/examples/jsm/utils/SkeletonUtils.js` to ensure skeletal bones and animations are not shared across distinct entities.
- **Shadows & Culling**: For all loaded meshes, traverse and apply:
  ```typescript
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ```
- **Dual-Pass Viewmodels**: Weapon viewmodels must NEVER be placed in `worldScene`. They must reside exclusively in `viewmodelScene` rendered with `viewmodelCamera` (FOV 68°, near plane `0.005m`) after `renderer.clearDepth()`. This physically prevents weapon barrels from penetrating solid world walls.
- **PBR Material Upgrade**: Elevate material properties with `material.envMapIntensity = 1.6`, procedural roughness maps, and `anisotropy = renderer.capabilities.getMaxAnisotropy()`.

## 3. Graceful Procedural Fallback
- All external `.glb` loading through `AssetManager.ts` must be asynchronous, non-blocking, and safely enclosed in `try / catch`.
- If a `.glb` asset fails to fetch, is not yet generated, or is corrupted, `WeaponViewmodel.ts` and `OperatorRig.ts` MUST immediately and seamlessly fall back to their built-in procedural PBR geometries.
- The game must boot and play at 60+ FPS under all network and asset conditions with zero unhandled exceptions.
