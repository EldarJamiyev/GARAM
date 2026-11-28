# GARAM: ZERO HOUR — Competitive 5v5 Browser Tactical FPS

<p align="center">
  <img src="docs/assets/hero-banner.svg" alt="GARAM: ZERO HOUR Hero Banner" width="100%">
</p>

<p align="center">
  <a href="https://github.com/EldarJamiyev/GARAM"><img src="https://img.shields.io/badge/GitHub-EldarJamiyev%2FGARAM-00F0FF?style=for-the-badge&logo=github" alt="GitHub Repository"></a>
  <img src="https://img.shields.io/badge/Tickrate-128Hz%20Parity%20Kinematics-00FF88?style=for-the-badge" alt="128Hz Physics">
  <img src="https://img.shields.io/badge/Netcode-64--Tick%20Clock--Synced-FF2A55?style=for-the-badge" alt="64-Tick Rewind">
  <img src="https://img.shields.io/badge/Tests-178%20Passing-00FF88?style=for-the-badge" alt="178 Vitest Tests">
  <img src="https://img.shields.io/badge/TypeScript-Strict%20Zero--Any-blue?style=for-the-badge&logo=typescript" alt="Strict TypeScript">
</p>

---

## 1. High-Level Vision & Tactical Philosophy

**GARAM: ZERO HOUR** is an authentic, browser-native competitive 5v5 tactical first-person shooter engineered to deliver Counter-Strike 2 mechanical fidelity, sub-millimeter movement responsiveness, and esports visual clarity directly in any modern WebGL2 browser.

- **Lead Operator:** Eldar Garamov (Callsign: Sovereign-1), Supreme Commander of the GARAM Vanguard.
- **The Conflict:** **GARAM Vanguard** (Defenders / CT) vs. **The Obsidian Syndicate** (Attackers / T).
- **Core Directives:**
  1. **Strict 128Hz Kinematic Determinism & CS2 Smooth Step Traversal:** Pure mathematical kinematics with `STOP_SPEED` Source friction, `SpatialGrid` broadphase acceleration, Circle-AABB Separating Axis Theorem (SAT) wall deflection, overhead ceiling clearance verification, air-strafe speed capping, lowest-riser CS2 step-up / downhill step-down grounding, and bidirectional `stepOffsetY` camera smoothing. Discrete 1/128s server sub-stepping and full `KinematicSnapshot` reconciliation guarantee zero Euler drift between client prediction and authoritative server.
  2. **Authoritative Anti-Cheat & Input Hardening:** Ray origin, deterministic PRNG spread (`BallisticsSpread`), per-weapon fire cooldowns, 180ms weapon-deploy lockouts, and bomb plant/defuse ownership mutexes are strictly enforced server-side. Includes atomic IP connection caps, smooth token-bucket rate limiting, trusted proxy hop parsing, strict production `Origin` validation, 2KB payload caps, full-RTT `ping_challenge`/`pong_challenge` verification, and recursive prototype-pollution defenses.
  3. **Zero Standing Spread RNG & Pinpoint First-Shot Invariant:** All primary rifles and pistols (`garam-47`, `vanguard-m4`, `m4a4`, `sovereign-awp`, `desert-eagle`, `usp-s`, `glock-18`) enforce `sprayPattern[0] = [0.0, 0.0]` with full magazine-length recoil arrays. Stationary shooting (`speed <= 0.38 m/s`) provides 100% deterministic, laser-precise first-shot accuracy, and scoped Sovereign AWP shots support high-penetration collateral hits (`penetrationPower >= 250`).
  4. **Human-Perception Tactical Bot AI (Zero Prefires, Anti-Clump & Counter-Strafe Footwork):** Collision-free tactical waypoint & nav-graph patrolling across both `DE_DUST2 (A-SITE)` and `CS_OFFICE (2-SITE)` with unique per-bot round-start hold destinations, `>= 2.05m` personal-space separation even while holding angles, `>= 3.0m` LOS-verified threat watch angles (eliminating wall-staring), forward-FOV visual perception, peripheral/distance/surprise reaction latencies, strict crosshair-alignment firing gates, counter-strafed burst-and-strafe combat footwork with natural mid-range tactical crouching, cover retreats on reload/low HP, flashbang blindness & smooth anti-flash turns, live mid-match difficulty re-scaling, and smoke-occluded `hasLineOfSight`.
  5. **CS2 (Source 2) Dual-Pass PBR Rendering, Authentic Weapon Grips, Pure Combat HUD & 12 Studio Audio Samples:** Depth-isolated viewmodel rendering (`60°–66°` FOV) with dedicated `RoomEnvironment` PMREM studio reflections, 3-point viewmodel lighting, calibrated per-weapon PBR materials, golden Mediterranean `DE_DUST2` daylight with warm sandstone grading & grounded contact shadows, unified CS2 Rigify first-person arms (`cs2_fps_arms.glb`) with locked two-handed Weaver pistol grips, relaxed palm-down Karambit stance & biomechanical curled fingers, fiery 8-point orange-gold muzzle flash star, near-plane-clamped razor-thin amber tracers, pooled billboarded crimson blood-mist puffs + rear-wall/floor blood splatters, full 18-weapon CS2 + CS 1.6 arsenal, 12 studio ElevenLabs CS2 audio samples (`ak47_shot`, `m4a4_shot`, `m4_suppressed`, `mp9_shot`, `deagle_shot`, `usps_shot`, `glock18_shot`, `awp_shot`, `headshot_dink`, `c4_beep`, `knife_draw`, `low_ammo_click`) + ascending kill chimes, authentic CS2 HUD (top `ALIVE | TIMER+SCORE | ALIVE` header with pulsing crimson C4 icon, pure top-right SVG killfeed with weapon silhouettes/headshot skull/wallbang icons, separate compact bottom-left radio/system feed, crisp SVG curved directional damage arc, `320ms` kill-beam flare + skull kill-card fan, sleek horizontal MVP round-win ribbon), synchronous hard-cut round resets, and compact overflow-free Lobby.
  6. **Shared `MapRegistry` & Adaptive Clock-Skew Immune 64-Tick Netcode:** Both client and authoritative 64-tick `GameRoom.ts` resolve map colliders, spawn points, buy zones, bombsites, and bot patrol routes through a single shared `MapRegistry` (`mapId` handshake on `join`/`welcome`), eliminating online server-client map desync alongside 64-slot ring-buffer `O(1)` half-RTT hitbox rewind, Int16-clamped Binary Protocol v2 (`36 + 29*N` bytes), and 2×128Hz batched binary inputs (`0x03`, 41 bytes).
  7. **Authoritative Utility Physics & MR12 Halftime Rules:** Shared `UtilitySimulation` steps server-side bouncing grenade arcs with sloped voxel ramp-lip deflection, active `MapBounds`, LOS-occluded HE blast waves, and smoke-extinguishable 40 DPS Molotov zones alongside automatic MR12 Round 13 halftime side-swap and `$800` pistol-round resets.
  8. **Zero-Quality-Loss WebGL2 Optimization & `UNLIMITED FPS` Pacing:** Static map/light matrix freezing (`matrixAutoUpdate = false`), freeze-time/throttled shadow updates (`invalidateShadows`/`updateShadows`), frustum-culled and behind-camera LOD-skipped 3P `OperatorRig` updates, blur-free HUD compositing, `TypedArray` zero-allocation `[F3]` frame-time telemetry, smart software-WebGL detection banner without overwriting saved GPU presets, and selectable Lobby frame pacing (`VSYNC`, `120 FPS`, `240 FPS`, `UNLIMITED FPS` via reusable `MessageChannel`).

---

## 2. Monorepo & System Architecture

<p align="center">
  <img src="docs/assets/architecture-diagram.svg" alt="GARAM Architecture Diagram" width="100%">
</p>

The project is structured as an npm workspaces monorepo enforcing strict boundaries:

- **`@garam/shared`**: Pure, deterministic TypeScript kernel with **zero DOM or Three.js dependencies**. Implements 128Hz kinematics with `KinematicSnapshot`, `SpatialGrid` zero-alloc broad-phase acceleration, Circle-AABB SAT collision resolution, 5-zone raycast ballistics with AWP collaterals & `BallisticsSpread`, `UtilitySimulation` grenade/HE/Molotov physics, shared `MapRegistry` (`de_dust2` & `cs_office` descriptors), `TacticalNavGraph`, MR12 CS2 economy & halftime rules, Binary Protocol v2 + batched input (`0x03`) codecs, recursive `Validator`, and `MatchSimulation`.
- **`@garam/client`**: Client application running Three.js (WebGL2), dual-pass `60°–66°` CS2 viewmodels with faction-tinted gloves, procedural PMREM IBL materials, Web Audio DSP convolver reverb + sampled weapon acoustics, top-down orthographic baked 2D radar, wall-deflecting dropped weapon physics, XSS-safe spectator system, pooled DOM/GPU combat VFX, lazy-loaded `CustomizerUI`, batched binary prediction reconciliation, and lean orchestrator (`main.ts <= 320 lines`).
- **`@garam/server`**: Authoritative 64-tick Node.js server running shared `MapRegistry` physics verification, ring-buffer crouch/yaw-aware historical hitbox rewind, authoritative buy/reload/utility/plant-defuse simulation with mutexes, 5v5 bot takeover & patrolling, live smoke-occluded PVS, cryptographic `RoomRegistry`, token-bucket rate limiting, and backpressure-guarded snapshot streaming.

---

## 3. Competitive Arena (`MapRegistry`: `DE_DUST2`)

<p align="center">
  <img src="docs/assets/decitadel-tactical-map.svg" alt="GARAM Tactical Radar Blueprint" width="100%">
</p>

The arena pool is dedicated exclusively to **`DE_DUST2 (A-SITE)` (`de_dust2`)**, synchronized between client and authoritative 64-tick server via `MapRegistry`:

1. **`DE_DUST2 (A-SITE)` (`de_dust2`, Active Competitive Arena):**
   - Full Counter-Strike 2 Dust 2 GLB (`packages/client/public/models/de_dust_2_with_real_light.glb`) with embedded real lighting, paired with **watertight 0.24m precomputed AABB colliders** (`DeDust2Data.ts`), walkable doorway/stair clearances, and real-time Lobby progress streaming.
   - Covers **CT Spawn**, **A Ramp**, **Bombsite A**, **A Pit**, **A Car**, **A Long Doors**, **A Short Catwalk**, **Mid Doors**, **B Tunnels**, and **Bombsite B** for authentic 5v5 executes and retakes.

---

## 4. Competitive Arsenal & Ballistics (18 CS2 + CS 1.6 Weapons)

<p align="center">
  <img src="docs/assets/arsenal-ballistics.svg" alt="GARAM Arsenal and Ballistics Telemetry" width="100%">
</p>

### Weapon Specifications & Recoil Patterns

| Weapon | Slot | Cost | Damage (Body / Head) | RPM | Mag / Reserve | Unique Mechanical Features |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Garam-47** | 1 | $2,700 | 36 / 144 HP | 600 | 30 / 90 | CS2 '7' recoil spray curve, 1-shot headshot kill, authentic curved banana magazine. |
| **Vanguard M4A1-S** | 1 | $2,750 | 33 / 132 HP | 666 | 25 / 75 | Detachable suppressor (`Mouse 2`: `+2` raw dmg unsilenced), muffled 24m acoustic radius. |
| **M4A4** | 1 | $3,100 | 33 / 132 HP | 666 | 30 / 90 | Full 30-round STANAG magazine CT rifle for sustained multi-target site anchor holds. |
| **Clarion 5.56 (FAMAS)** | 1 | $2,250 | 30 / 120 HP | 666 | 25 / 90 | Vanguard budget bullpup rifle with `Mouse 2` 3-round `1100 RPM` burst-fire toggle. |
| **IDF Defender (Galil)** | 1 | $2,000 | 30 / 120 HP | 675 | 35 / 90 | Syndicate eco/force rifle with high-capacity 35-round curved steel magazine. |
| **MP9** | 1 | $1,250 | 26 / 104 HP | 857 | 30 / 120 | High-mobility force-buy SMG (`$600` kill reward) with blistering 857 RPM CQC fire rate. |
| **K&M MP5 Navy** | 1 | $1,500 | 26 / 104 HP | 800 | 30 / 120 | Classic CS 1.6 tight-spray SMG (`$600` kill reward) with high run-and-gun accuracy. |
| **ES C90 (P90)** | 1 | $2,350 | 26 / 104 HP | 900 | 50 / 100 | Top-loaded 50-round bullpup SMG built for high-speed site rushes and anti-eco sweeps. |
| **Leone 12G Super (M3)** | 1 | $1,700 | 20×9 / 80×9 HP | 68 | 8 / 32 | Pump-action 9-pellet buckshot cannon (`$900` kill reward) with interruptible shell reload. |
| **Leone YG1265 (XM1014)** | 1 | $3,000 | 22×6 / 88×6 HP | 240 | 7 / 32 | Semi/auto tactical 6-pellet shotgun (`$900` kill reward) with shell-by-shell tube reload. |
| **Schmidt Scout** | 1 | $2,750 | 75 / 300 HP | 48 | 10 / 90 | Signature CS 1.6 `6.50 m/s` ultra-fast mobility, dual-stage scope, low jump inaccuracy. |
| **Sovereign AWP** | 1 | $4,750 | 115 / 460 HP | 45 | 5 / 30 | 1-shot lethal torso kill, dual-stage 28°/10° optical zoom, high-penetration collaterals. |
| **Vanguard Ballistic Shield** | 1 | $2,200 | 45 / 45 HP | 90 | 1 / 0 | CT tactical riot shield blocking frontal gunfire; `Mouse 2` raises full-coverage viewport. |
| **Desert Eagle** | 2 | $700 | 53 / 212 HP | 267 | 7 / 35 | Heavy `.50 AE` pocket cannon, serrated cocking slide, lethal 1-shot headshot at close/mid. |
| **USP-S** | 2 | $200 | 35 / 140 HP | 352 | 12 / 24 | Tactical CT sidearm with `Mouse 2` detachable suppressor (`+2` raw dmg unsilenced). |
| **Glock-18** | 2 | $200 | 30 / 120 HP | 400 | 20 / 120 | Syndicate 20-round sidearm with `Mouse 2` classic 3-round `920 RPM` burst-fire toggle. |
| **.40 Dual Elites** | 2 | $800 | 45 / 180 HP | 500 | 30 / 120 | Syndicate dual-wielded pistols alternating left/right barrels across a 30-round pool. |
| **Crimson Karambit** | 3 | $0 | 55 / 55 (180 Backstab) | 120 | 1 / 0 | Curved hawkbill blade in authentic CS2 dual-hand bottom-edge CQC posture with `[F]` ring spin. |

### 5-Zone Raycast Ballistics Multipliers
- **Head (`HEAD`):** 4.00x multiplier (Instant lethal rifle/sniper hit)
- **Chest (`CHEST`):** 1.00x baseline damage
- **Stomach (`STOMACH`):** 1.15x multiplier
- **Arms & Hands (`ARMS`):** 0.75x multiplier
- **Legs & Feet (`LEGS`):** 0.75x multiplier (Applies 58% tagging deceleration)

---

## 5. Controls & Keybindings Reference

| Action | Primary Input | Secondary / Alternate | Notes |
| :--- | :---: | :---: | :--- |
| **Move Forward / Back / Strafe** | `W`, `S`, `A`, `D` | — | 128Hz fixed kinematics, counter-strafing, and vertical ladder climbing. |
| **Jump / Crouch-Jump** | `Space` | — | Air strafing enabled (`wishDir` acceleration); cycles Spectator camera mode when dead. |
| **Crouch (Duck)** | `ControlLeft` | — | Smooth eye height transition ($1.72\text{m} \to 1.16\text{m}$). |
| **Walk (Silent Movement)** | `ShiftLeft` | — | Restricts speed to $3.30\text{m/s}$, eliminates all footstep audio cues. |
| **Primary Fire / Slash** | `Mouse 1 (Left)` | — | Automatic, burst, pump, or semi-auto fire / Karambit alternating slashes. |
| **Secondary Action (M2)** | `Mouse 2 (Right)` | — | AWP/Scout zoom, M4A1-S/USP-S silencer toggle, Glock/FAMAS 3-rd burst, Shield raise, Karambit stab. |
| **Reload Weapon** | `R` | — | Full animation timer or interruptible shell-by-shell shotgun tube reload. |
| **Quick Switch Weapon** | `Q` | — | Instantly flips to previous weapon slot with draw animation. |
| **Weapon Slot Selection** | `1`, `2`, `3`, `4`, `5` | `Scroll Wheel` | Primary (1), Secondary (2), Knife (3), Utility cycle (4), Bomb (5). |
| **Grenade Quick-Select** | `Z`, `X`, `C`, `V` | — | Smoke (Z), Flash (X), HE Grenade (C), Molotov (V). |
| **Drop Active Weapon** | `G` | — | Tosses active firearm into 3D world with physical drop arc. |
| **Interact / Defuse / Hostage / Loot** | `E` | — | Hold to defuse (5s kit, 10s raw), escort `cs_office` hostages, or loot floor weapons. |
| **Inspect Weapon & Knife Spin** | `F` | — | Continuous CS2 finger-ring spin on Karambit, sway inspect on guns. |
| **Tactical Buy Menu** | `B` | — | Available in buy zones during freeze time or first 20s. |
| **CS 1.6 Auto-Buy / Re-Buy / Ammo** | `F1` / `F4` | `,` / `.` | Auto-Buy (`F1`), Re-Buy previous kit (`F4`), Buy Primary Ammo (`,`), Buy Secondary Ammo (`.`). |
| **CS 1.6 Tactical Radio Comms** | `H` then `1–9` | — | Issues voiced team callouts & commands (`Cover Me`, `Follow Me`, `Hold Position`, `Regroup`, etc.) obeyed by bots. |
| **Spray Emblem / NightVision** | `T` / `N` | — | Stamps custom CS 1.6 spray decal on walls (`T`); toggles tactical green NVG (`N`, requires $1,250 NVG). |
| **Performance Monitor Overlay** | `F3` | — | Real-time FPS, frame time, latency, draw calls, triangles. |
| **Sandbox Customizer Panel** | `F2` | — | Live crosshairs, infinite ammo, bot freeze, and practice cash. |
| **Scoreboard / Combat Status** | `Tab` | — | Displays live player stats, K/D/A, ping, and bot rosters. |
| **Spectator Teammate & Mode Cycle** | `Mouse 1` / `Mouse 2` | `Space` | Cycles living allies (`M1`/`M2`) and switches First-Person / Chase / Free-Look (`Space`). |

---

## 6. Development Roadmap & Verification

<p align="center">
  <img src="docs/assets/roadmap-progress.svg" alt="GARAM Development Roadmap Progress" width="100%">
</p>

### Test Suite Coverage (178 Passing Tests Across 21 Suites)
Run the automated test suite across all packages:
```bash
npm test
```
```text
 ✓ packages/client/src/__tests__/client-systems.test.ts       (21 tests)
 ✓ packages/client/src/__tests__/viewmodel-rig.test.ts        (12 tests)
 ✓ packages/client/src/__tests__/operator-rig.test.ts         (2 tests)
 ✓ packages/server/src/__tests__/gameroom.integration.test.ts (9 tests)
 ✓ packages/server/src/__tests__/pvs.test.ts                  (1 test)
 ✓ packages/server/src/__tests__/registry.test.ts             (6 tests)
 ✓ packages/shared/src/__tests__/botai.test.ts                (9 tests)
 ✓ packages/shared/src/__tests__/botprofiles.test.ts          (3 tests)
 ✓ packages/shared/src/__tests__/kinematics.test.ts           (16 tests)
 ✓ packages/shared/src/__tests__/ballistics.test.ts           (26 tests)
 ✓ packages/shared/src/__tests__/simulation.test.ts           (11 tests)
 ✓ packages/shared/src/__tests__/spatial.test.ts              (3 tests)
 ✓ packages/shared/src/__tests__/binarycodec.test.ts          (6 tests)
 ✓ packages/shared/src/__tests__/security.test.ts             (7 tests)
 ✓ packages/shared/src/__tests__/lagcomp.test.ts              (8 tests)
 ✓ packages/shared/src/__tests__/navgraph.test.ts             (12 tests)
 ✓ packages/shared/src/__tests__/callout.test.ts              (5 tests)
 ✓ packages/shared/src/__tests__/dedust2.test.ts              (8 tests)
 ✓ packages/shared/src/__tests__/economy.test.ts              (5 tests)
 ✓ packages/shared/src/__tests__/cs16-pack.test.ts            (5 tests)
 ✓ packages/shared/src/__tests__/docs-sync.test.ts            (3 tests)

 Test Files  21 passed (21)
      Tests  178 passed (178)
```

---

## 7. In-Engine Gameplay & Visual Telemetry

The screenshots below are captured directly from live headless Chrome WebGL2 playtests at 1440×900 via `scripts/visual-audit.cjs`, demonstrating the Source 2 optical pipeline, 6 photographic PBR texture sets, procedural architecture, and unified viewmodel rig:

<p align="center">
  <img src="docs/assets/playtests/audit_01_lobby.png" alt="Lobby Panoramic Overlook & Golden-Hour Lighting" width="48%">
  <img src="docs/assets/playtests/audit_02_garam47_idle.png" alt="Garam-47 CS2 Framing & PBR Wood Handguard" width="48%">
</p>
<p align="center">
  <img src="docs/assets/playtests/audit_09_m4a1s_idle.png" alt="Vanguard M4A1-S Suppressed Stance" width="48%">
  <img src="docs/assets/playtests/audit_11_awp_idle.png" alt="Sovereign AWP Sniper Low-Ready Framing" width="48%">
</p>
<p align="center">
  <img src="docs/assets/playtests/audit_05_deagle_idle.png" alt="Desert Eagle .50 AE Heavy Handgun Stance" width="48%">
  <img src="docs/assets/playtests/audit_07_karambit_idle.png" alt="Garam Crimson Doppler Karambit Reverse-Grip" width="48%">
</p>
<p align="center">
  <img src="docs/assets/playtests/audit_08_karambit_inspect.png" alt="Karambit Index-Finger Twirl Inspect Animation" width="48%">
  <img src="docs/assets/playtests/audit_14_mid_watchtower.png" alt="Mid Watchtower, Terracotta Roof & Sloped Cheek-Walls" width="48%">
</p>
<p align="center">
  <img src="docs/assets/playtests/audit_19_3p_vanguard_bot.png" alt="3P Operator Bot & CSM Directional Ground Shadows" width="48%">
  <img src="docs/assets/playtests/audit_20_ortho_radar_hud.png" alt="CS2 Tournament HUD, Rotating Radar & Volumetric Smoke" width="48%">
</p>

---

## 8. Quick Start & Developer Guide

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation & Launch
```bash
# Clone the repository
git clone https://github.com/EldarJamiyev/GARAM.git
cd GARAM

# Install monorepo dependencies
npm install

# Verify TypeScript across all workspaces (0 errors required)
npm run typecheck

# Execute unit and integration tests
npm test

# Build all packages
npm run build

# Start the local development server (Client on http://localhost:3000)
npm run dev
```

Alternatively, on Windows, double-click **`PLAY_GARAM.bat`** in the project root for one-click launch.

---

## 9. License & Credits

Built with precision by **Eldar Jamiyev** & the GARAM Systems Team.  
All gameplay systems, deterministic kinematics, and architectural specifications are maintained under the MIT License.
