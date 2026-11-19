# GARAM: ZERO HOUR — Elite Fundamentals Overhaul (Sprints E1–E7)

This document tracks the technical execution of the **Elite Fundamentals Overhaul** across all 7 sprints.

---

## Sprint Tracking & Status

### Checkpoint 1: Engine Core, Input & Tournament Kinematics
- [x] **Sprint E1: Raw Input, Zero-Jitter Interpolation & Zero-GC Engine Core**
  - [x] E1.1: PointerLock with `{ unadjustedMovement: true }` and mouse spike filter (< 350px/frame guard)
  - [x] E1.2: 128Hz Sub-tick Camera Position Interpolation (`lerp(prevState, state, alpha)`)
  - [x] E1.3: Zero-GC hot-loop with pre-allocated scratch vectors/eulers in `main.ts` & systems
  - [x] E1.4: Tournament Perf Graph `[F3]` (`packages/client/src/core/PerfMonitor.ts`)
- [x] **Sprint E2: Tournament-Grade Source Kinematics & Movement Feel**
  - [x] E2.1: Exponential Step Camera Damping (`stepOffsetY`) for smooth stair climbing
  - [x] E2.2: Weapon Tagging Deceleration (`applyTagging(weaponTagPower)`)
  - [x] E2.3: Landing Recovery Deceleration & Hard Touchdown Camera Dip
  - [x] E2.4: Crouch-Spam Stamina Decay & Recovery
  - [x] E2.5: Kinematics unit tests for tagging, landing damping, and crouch stamina (18/18 passed)

### Checkpoint 2: Gunplay, Hitreg & Visual Pipeline
- [x] **Sprint E3: True CS2-Grade Gunplay, Recoil Control & Exact Hitreg**
  - [x] E3.1: Weapon spread patterns, first-shot pinpoint accuracy, recovery curves
  - [x] E3.2: 5-zone hitboxes with Kevlar/Helmet armor degradation formulas
  - [x] E3.3: Dual entry/exit decals with penetration particle splinters
- [x] **Sprint E4: Visual Clarity, Lighting Pipeline & Architectural Depth**
  - [x] E4.1: Atmospheric sky gradient dome with sun disc & directional godrays
  - [x] E4.2: High-fidelity textured map surfaces with anisotropic filtering
  - [x] E4.3: Articulated dual-hand tactical gloved rig & weapon PBR overhaul

### Checkpoint 3: Tactical Bot Brain, True Weapon Geometry, Sprints E5–E7 & Living SVG README
- [x] **Part 1: Karambit & Weapon Geometry Overhaul**
  - [x] P1.1: Rebuild Garam Crimson Karambit with `THREE.Shape` + `THREE.ExtrudeGeometry` (curved hawkbill talon blade, beveled edge, crimson metallic + chrome razor edge, contoured G10 handle, integrated gold retention ring)
  - [x] P1.2: Reverse-grip right-hand pose, left-hand martial guard, 360° ring-spin draw `[3]`/`[Q]`, continuous `[F]` inspect twirl, alternating M1 slashes & M2 heavy stab
  - [x] P1.3: Weapon silhouette upgrade for Garam-47 (curved banana mag, stock heel, muzzle brake), M4A1-S (perforated suppressor, carry handle), AWP (flared bell, emerald lens, bipod), and Desert Eagle (triangular shroud, slide serrations)
- [x] **Sprint E5: Tactical Bot Brain (Roam, Execute, Flank, Real Ballistics)**
  - [x] E5.1: 28+ node connected tactical waypoint graph + A* pathfinding covering all lanes & elevations of `DE_CITADEL`
  - [x] E5.2: Anti-stuck displacement monitor (0.6s / 0.25m check, perpendicular sidestep repath) & bot-to-bot separation
  - [x] E5.3: Per-round Tactical Director: 5 Syndicate strategies (`RUSH_A_LONG`, `SPLIT_A_MID`, `RUSH_B_TUNNELS`, `MID_TO_B_SPLIT`, `DEFAULT_PICKS_AND_LATE_EXEC`) & 4 Vanguard setups (`STANDARD_2_1_2`, `AGGRESSIVE_MID_CONTROL`, `HEAVY_A_STACK`, `RETAKE_ANCHOR`)
  - [x] E5.4: Dynamic bot roles: silent lurker/flanker (`[SHIFT]`), post-plant crossfire defense, coordinated site retake & defuse
  - [x] E5.5: Real ballistic bot gunplay via `executeTacticalRaycast()` (no fake random hits, real recoil, 5-zone hitboxes, burst firing, counter-strafing to 0 m/s, jiggle-peeking)
  - [x] E5.6: Sound event awareness (footsteps, unsuppressed, suppressed M4A1-S, reloads, bomb plant/defuse)
  - [x] E5.7: Bot utility deployment (smokes at Mid Doors / bomb, flashbang site executes, defensive choke molotovs)
- [x] **Sprint E6: Competitive Match UX, Weapon Dropping, Spectator & Audio Ecology**
  - [x] E6.1: Teammate Spectator Camera on death (`M1`/`M2` cycle living allies, spectator HUD banner)
  - [x] E6.2: CS2 / Valorant Combat Report card (Damage Given / Taken, hit & headshot breakdown) + killfeed badges (`🎯`, `🧱`, `☁️`, `🗡️`)
  - [x] E6.3: Physical weapon dropping `[G]` & floor looting (`[E]` swap / walk-over pickup, dropped Pulse Core)
  - [x] E6.4: Acoustic zone reverb (`ConvolverNode` indoor room impulse in B Tunnels/Connectors vs open Mid/Site A)
  - [x] E6.5: Low-ammo metallic spring click (last 5 rounds) & Buy Menu rejection feedback (audio error + red pulse)
  - [x] E6.6: Pre-Match Lobby controls footer update (`[G] Drop Weapon`, `[F3] Perf Graph`) & `main.ts` architecture trim (<= 650 lines)
- [x] **Sprint E7: 64-Tick Netcode Hardening & 28+ Vitest Suite**
  - [x] E7.1: Server-side bot fill in `GameRoom.ts` sharing navgraph and `executeTacticalRaycast()`
  - [x] E7.2: Sync combat report, badges, and smooth client error-correction reconciliation over 80ms
  - [x] E7.3: Expand Vitest suite to 28+ tests (`navgraph.test.ts`, `lagcomp.test.ts`, `callout.test.ts` — 40 total passing)
- [x] **Part 5: Living README with Custom Vector SVG Visuals**
  - [x] P5.1: Create 5 high-craft SVGs in `docs/assets/` (`hero-banner.svg`, `architecture-diagram.svg`, `decitadel-tactical-map.svg`, `arsenal-ballistics.svg`, `roadmap-progress.svg`)
  - [x] P5.2: Rewrite `README.md` embedding all 5 SVGs with comprehensive documentation and verified KPIs

---

## Verification Gate Criteria
1. `npm run typecheck` (0 errors across all 3 packages)
2. `npm test` (100% pass)
3. `npm run build` (clean compilation)
4. Push to `origin/main`
