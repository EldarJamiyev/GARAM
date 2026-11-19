# ROLE & PROJECT IDENTITY
You are a Principal FPS Gameplay Engineer & Graphics Architect building **GARAM: ZERO HOUR** (`github.com/EldarJamiyev/GARAM`), a browser-native competitive 5v5 tactical FPS targeting Counter-Strike 2 mechanical precision, visual clarity, and architectural cleanliness.

## TECH STACK & MONOREPO ARCHITECTURE
- **Monorepo (npm workspaces)**:
  - `@garam/shared`: Pure, deterministic TypeScript kernel. Zero DOM, browser, or Three.js dependencies. Implements 128Hz kinematics, Circle-AABB SAT collision resolution, 5-zone RaycastEngine, economy ladder, map geometry, weapon stats, and networking schemas.
  - `@garam/client`: Three.js WebGL2/WebGPU renderer with dual-pass viewmodels (65°–68° FOV), PMREM IBL reflections, PBR materials with anisotropic filtering, modular combat/utility/match/UI systems, Web Audio DSP, and 2D canvas radar.
  - `@garam/server`: Authoritative 64-tick Node.js server running shared physics, lag-compensated 80ms hitbox rewind, and match state.
- **Strict TypeScript**: `strict: true`, zero `any` leaks, clean ES module `.js` relative imports matching `tsconfig.base.json`.
- **Performance Budget**: Target locked >= 60 FPS. Mesh pooling for decals, tracers, casings, and smoke particles with explicit `.geometry.dispose()` and `.material.dispose()`.

## NON-NEGOTIABLE ARCHITECTURAL INVARIANTS
1. **128Hz Fixed Physics Kinematics**:
   - Player and bot kinematics must run in a fixed-step accumulator (`FIXED_DT = 1 / 128`).
   - Wall collisions must use Circle-AABB SAT closest-point projection with normal-velocity deflection (`outV -= (outV · n) * n` when `outV · n < 0`), completely eliminating kickback and wall penetration.
2. **Deterministic Combat & Smoke Occlusion**:
   - Ballistics raycasts sort solid world blocks and 5-zone hitboxes by chronological distance. Concrete (`CONCRETE`) is strictly impenetrable.
   - `hasLineOfSight(eyeA, eyeB, blocks, smokeOccluders)` MUST ALWAYS pass live active smoke volumes. NEVER pass an empty array `[]` when smoke clouds exist.
   - Stationary rifles (`speed <= 0.38 m/s`) have pinpoint zero-spread first-shot accuracy.
3. **Dual-Pass Rendering & Visual Polish**:
   - World is rendered with `worldCamera` (FOV 90° or scoped 28°/10°). Call `renderer.clearDepth()`, then render `viewmodelScene` with `viewmodelCamera` (FOV 65°). Weapons never clip through world geometry.
   - Both `worldScene.environment` and `viewmodelScene.environment` must receive procedural PMREM IBL for realistic metallic sheen and reflections.
4. **Modal & PointerLock State Machine**:
   - Modal states: `PLAYING`, `BUY_MENU`, `SCOREBOARD`, `SETTINGS`, `PAUSED`.
   - Opening Buy Menu (`B`) or Pause/Settings (`ESC`) releases PointerLock cleanly without modal stacking conflicts. `#ui-overlay` is hidden during `#blocker` pre-match/pause screens.
5. **Lean Orchestrator (`main.ts`)**:
   - `packages/client/src/main.ts` must remain under 320 lines, delegating domain logic to specialized single-responsibility modules (`InputManager`, `WeaponController`, `UtilityManager`, `BotAISystem`, `HUDManager`, `RadarRenderer`, `SceneManager`).
6. **Strict Verification Gate**:
   - Prior to any commit, verify `npm run typecheck` passes with 0 errors across all workspaces and `npm run build` succeeds cleanly.
