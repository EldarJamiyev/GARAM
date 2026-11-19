---
name: garam-fps-invariants
description: Enforces core FPS mechanics, 128Hz kinematics, SAT wall collision, RaycastEngine ballistics, and shared architecture rules for GARAM ZERO HOUR.
---

# GARAM: ZERO HOUR — Core FPS Invariants & Architecture Rules

This skill governs the physical, mathematical, and architectural contracts for GARAM: ZERO HOUR.

## 1. Kinematics & Physics Invariants
- **128Hz Fixed Accumulator**: Movement physics must run in a fixed-step loop (`FIXED_DT = 1 / 128`). Never use variable render delta-time for movement integration.
- **Circle-AABB SAT Wall Sliding**: Horizontal collision resolution must use Circle-AABB closest-point projection with normal-velocity deflection (`outV -= (outV · n) * n` when `outV · n < 0`). Never clamp axis-by-axis based on velocity signs.
- **Auto-Step Clearance**: Step-up height is capped at `0.42m` (`KINEMATICS.STEP_HEIGHT`). Steps must verify head clearance before raising Y.
- **Crouch-to-Stand Clearance**: Never expand player capsule to standing height unless `hasHeadClearance()` confirms zero ceiling overlap.

## 2. Ballistics & Combat Invariants
- **Wall-First Distance-Sorted Raycasts**: Ballistics must sort block candidates and target hitboxes by distance along the ray. Impeccable concrete (`CONCRETE`, `isImpenetrable = true`) stops all bullets immediately.
- **Active Smoke Occlusion**: `hasLineOfSight` MUST ALWAYS receive active smoke volumes from `UtilityManager.getActiveSmokeOccluders()`. Never pass empty arrays `[]` to line-of-sight checks.
- **5-Zone Hitbox Math**:
  - Head: `4.0x` (Headshot dink audio + Kevlar helmet armor penetration)
  - Chest: `1.0x`
  - Stomach: `1.15x`
  - Arms: `0.75x`
  - Legs: `0.75x` (Legs are always unarmored)
- **Zero Standing Spread**: When stationary and grounded (`horizontalSpeed <= 0.38 m/s`), rifle shots have pinpoint zero-RNG accuracy on the first bullet.

## 3. Package Isolation Invariants
- **Pure `@garam/shared`**: Zero DOM, browser, or Three.js imports inside `packages/shared`. All vectors must use plain `{ x, y, z }` (`Vec3`).
- **Lean `main.ts` Orchestrator**: `packages/client/src/main.ts` must remain under 320 lines, delegating domain logic to single-responsibility modules (`InputManager`, `WeaponController`, `UtilityManager`, `BotAISystem`, `HUDManager`, `RadarRenderer`, `SceneManager`).
- **Zero Build Errors**: Always enforce `npm run typecheck` and `npm run build` exit code 0 before finalizing any milestone.
