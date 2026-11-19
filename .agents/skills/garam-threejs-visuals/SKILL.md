---
name: garam-threejs-visuals
description: Enforces Three.js PBR rendering standards, PMREM IBL reflections, dual-pass viewmodels, texture anisotropy, and GPU disposal discipline for GARAM.
---

# GARAM: ZERO HOUR — Three.js PBR & Visual Standards

## 1. Scene & Environment Lighting
- **PMREM Image-Based Lighting (IBL)**: Generate a procedural studio/sky environment map using `THREE.PMREMGenerator` and assign it to BOTH `worldScene.environment` and `viewmodelScene.environment`. This provides metallic reflections for weapon receivers, scopes, and metal props.
- **Atmospheric Sky**: Render a gradient sky dome from deep zenith azure (`#1e5f9e`) to warm sunlit horizon haze (`#d4e4f7`) with a glowing sun disc shader.
- **Horizon Depth**: Add low-poly silhouette geometry (industrial structures, warehouse roofs, cranes, and distant hills) outside the 120m fortress perimeter to eliminate void horizons.
- **Lighting & Color**: `ACESFilmicToneMapping` with exposure ~1.05. Warm direct sunlight (`#fff2df`, intensity 1.3, soft shadows) paired with cool hemisphere bounce (`#cde2f8` / `#485058`).

## 2. Textures & Materials
- **PBR Texture Pairing**: Procedural albedo maps must be accompanied by paired bump/normal and roughness maps.
- **Texture Anisotropy**: Always call `texture.anisotropy = renderer.capabilities.getMaxAnisotropy()` on ground, wall, crate, and container textures to eliminate distant texture blurring at oblique angles.
- **Albedo Balance**: Tactical concrete albedo must maintain brightness around `#787e85` with subtle grunge, expansion joints, and wear lines, ensuring high-contrast visibility for player and bot silhouettes.

## 3. Viewmodel & Weapon Standards
- **Dual-Pass Rendering**: Render `worldScene` with `worldCamera` (FOV 90° / 28° / 10°), call `renderer.clearDepth()`, then render `viewmodelScene` with `viewmodelCamera` (FOV 65°–68°). Viewmodel weapons must NEVER clip through walls.
- **2-Handed Articulation**: First-person viewmodel must display both a tactical right firing arm and an articulated left support arm/glove.
- **Procedural Weapons**: Guns must use beveled/chamfered layered geometry, picatinny rails, iron sights, charging handles, and textured grips instead of primitive boxes.

## 4. GPU Resource Discipline
- **Mesh Pooling**: Pre-cache weapon meshes and decal meshes. Never instantiate new WebGL geometries or materials during active gameplay loops.
- **Strict Disposal**: When particle effects, smoke puffs, or grenades expire, explicitly call `.geometry.dispose()` and `.material.dispose()` to prevent WebGL memory leaks. Target consistent >= 60 FPS performance.
