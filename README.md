# GARAM: ZERO HOUR — Game Systems & Architecture Specification

> **Official Repository:** [https://github.com/EldarJamiyev/GARAM](https://github.com/EldarJamiyev/GARAM)  
> **Architecture:** Three.js (WebGL2/WebGPU) + Rapier3D WASM + Colyseus 64-Tick Server + TypeScript (npm workspaces)  
> **Design Target:** Tournament-Grade 5v5 Tactical FPS (CS:GO / CS2 Feel with Total Sandbox Modularity)

---

## 1. High-Level Vision & Tactical Philosophy

**GARAM: ZERO HOUR** is a tactical competitive first-person shooter featuring high-skill gunplay, deterministic movement, and total sandbox flexibility.

- **Lead Operator:** Eldar Garamov (Callsign: Sovereign-1), Supreme Commander of the GARAM Vanguard.
- **The Conflict:** **GARAM Vanguard** (Defenders / CT) vs. **The Obsidian Syndicate** (Attackers / T).
- **Core Directives:**
  1. **Strict Tactical Focus:** Pure firearms, ballistic simulation, tactical utility, economy management, and bomb defusal.
  2. **Zero Standing Spread RNG:** Clean counter-strafing or stationary shooting produces 100% deterministic pinpoint first-shot accuracy.
  3. **Authoritative Server Architecture:** 64-tick server simulation with Rapier3D physics, client-side prediction, and timestamped circular hitbox history rewind (bounded to 80ms) for cheat-resistant, lag-compensated hit registration.
  4. **Sandbox & Customizer Suite:** In-game live JSON editor for weapon stats, recoil tables, bot behaviors, crosshairs, and match rules.

---

## 2. Launch Scope vs. Future Vision

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LAUNCH SCOPE (Phases 1 - 4)                     │
├────────────────────────────────────────────────────────────────────────┤
│ • 128Hz Fixed Accumulator Kinematics & 112ms Counter-Strafing          │
│ • Dual-Pass Depth-Isolated Viewmodel (FOV 68°, zero wall clipping)     │
│ • 5 Core Weapons: Garam-47, Vanguard M4A1-S, Sovereign AWP,           │
│   Eldar's Custom Desert Eagle, Garam Tactical Karambit                 │
│ • Tactical Utility: Volumetric Smoke, Flashbang (afterimage), HE, Fire │
│ • Competitive Map: DE_CITADEL (3-lane: Armory A, Mid, Reactor Vault B) │
│ • 5v5 Bomb Defusal Loop: Pulse Core (40s), Buy Menu (B), Scoreboard    │
│ • 4-Tier State-Machine Bot AI (Recruit, Veteran, Elite, Sovereign)     │
│ • 64-Tick Authoritative Colyseus Server with 80ms Hitbox Rewind        │
│ • Live In-Game Crosshair & JSON Weapon Customizer                      │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        FUTURE VISION (Phases 5 - 8)                    │
├────────────────────────────────────────────────────────────────────────┤
│ • Additional Maps: DE_BAKU_TERMINAL (Caspian port), DE_METRO, DE_DISTRICT│
│ • Extended Modes: 1v1 Aim Arena (Proving Grounds), Horde Wave Defense, │
│   Gun Game, Arms Race, 2v2 Wingman                                     │
│ • In-Engine 3D Map Maker & .garam Content Package Export/Import        │
│ • Full Operator Studio (Visors, Armor Plates, Glove Styles, Hex Camo)  │
│ • Cloud Persistence: Supabase PostgreSQL (ELO, Profiles), Upstash Redis│
│ • LiveKit Proximity WebRTC Squad Voice Comms                           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Condensed Executable Milestones

| Milestone | Deliverables | Verification Gate |
| :--- | :--- | :--- |
| **Milestone 1: Monorepo & Physics Kernel** | Scaffolding (`packages/client`, `packages/server`, `packages/shared`), 128Hz accumulator, Rapier3D kinematic character controller, PointerLock, counter-strafing. | Horizontal speed drops $< 0.38\,\text{m/s}$ in $\le 115\,\text{ms}$; 0.42m auto-step climbs stairs without camera jitter. |
| **Milestone 2: Ballistics & Dual-Pass Viewmodel** | Dual-pass rendering (`clearDepth`), 6-DOF weapon springs, Garam-47, M4A1-S, AWP, Desert Eagle, 30-round spray tables, multi-material wall penetration. | Weapon never clips walls; 30 bullets trace exact spray pattern; wood penetrates with entry/exit decals. |
| **Milestone 3: DE_CITADEL & Tactical Utility** | 3-lane geometry, PBR materials, HDR sky, volumetric smoke grid, flashbang blindness angle calculation, HE grenade clearing smoke. | HE grenade clears 2.6s hole in smoke; flashbang whiteout fades smoothly; Mid contact at ~4.8s. |
| **Milestone 4: 5v5 Defusal & Authoritative Netcode** | Colyseus 64-tick server, Rapier3D sensor hitboxes (Head 4x, Torso 1x, Limbs 0.75x), 80ms rewind, Pulse Core plant/defuse, economy engine, bot AI. | 2 independent browser tabs play in a 5v5 match; hits validated by server; round state cycle executes cleanly. |
| **Milestone 5: In-Game Customizer & Audio DSP** | Esc customizer (recoil, bot stats, crosshair JSON), procedural Web Audio gunshots/headshot dinks, HRTF spatial panner, lowpass wall occlusion. | Muffled footsteps behind concrete; crisp helmet dinks; live JSON tweaks update weapon stats instantly. |
| **Milestone 6: Production Hardening & CI** | Zero TypeScript errors (`npx tsc --noEmit`), headless automated physics unit tests, GitHub sync. | Clean build across all packages; GitHub remote completely in sync. |

---

## 4. Movement Kinematics & Counter-Strafing Mathematics

Physics simulation runs on a fixed timestep accumulator at 128Hz ($dt = 0.0078125\,\text{s}$).

### Movement Constants
- Eye Heights: $\text{Stand} = 1.72\,\text{m}$, $\text{Crouch} = 1.16\,\text{m}$ (interpolated via exponential decay $\text{lerp}(h_{\text{curr}}, h_{\text{target}}, 1 - e^{-18 \cdot dt})$)
- Maximum Speeds:
  - Knife / Melee: $6.35\,\text{m/s}$ (250 units/s)
  - Pistol: $6.10\,\text{m/s}$
  - Assault Rifle: $5.45\,\text{m/s}$ (215 units/s)
  - AWP: $5.08\,\text{m/s}$
  - Silent Walk (Shift): $3.30\,\text{m/s}$
  - Crouch (Ctrl): $2.15\,\text{m/s}$
- Ground Acceleration: $a = 5.6$
- Ground Friction: $f = 5.2$
- Air Acceleration: $a_{\text{air}} = 12.0$ (Max air wish speed: $0.76\,\text{m/s}$)

### Counter-Strafing Equation
When traveling at $v_x = +5.45\,\text{m/s}$ and reversing input ($wishDir = -1$):
$$\Delta v = - \left( v_x \cdot f + a \cdot v_{\text{max}} \right) \cdot dt$$
Speed drops below the pinpoint threshold ($0.38\,\text{m/s}$) in $112\,\text{ms}$, resetting spread instantly to 0.

---

## 5. Ballistics, Recoil Patterns & Penetration

### Spread Calculation
$$\theta_{\text{spread}} = \theta_{\text{base}} + \theta_{\text{move}} \cdot \left(\frac{\max(0, v_{\text{horiz}} - 0.38)}{v_{\text{max}}}\right)^2 + \theta_{\text{air}} \cdot \mathbb{I}_{\text{airborne}} + \theta_{\text{bloom}}$$
Stationary rifle fire ($\theta_{\text{base}} = 0$) achieves zero spread (laser accuracy).

### 30-Shot Spray Tables
- **Garam-47:** Shots 1–5 pull straight up ($+0.35^\circ \to +1.8^\circ$ pitch); shots 6–12 drift right ($+1.1^\circ$ yaw); shots 13–22 sweep left ($-1.9^\circ$ yaw); shots 23–30 swing right ($+1.6^\circ$ yaw).
- **Vanguard M4A1-S:** Tighter vertical pull, suppressed muzzle signature, laser-tight 3-round bursts.

### Multi-Layer Wall Penetration
Raycasts perform forward intersection, followed by a reverse raycast from $\mathbf{p}_{\text{hit}} + \mathbf{d}_{\text{ray}} \cdot 1.5\,\text{m}$ to measure wall thickness $T$:
$$\text{Damage}_{\text{exit}} = \text{Damage}_{\text{entry}} \cdot \mu_{\text{mat}} - T \cdot \text{Cost}_{\text{mat}}$$
- `WOOD_THIN`: $\mu = 0.75$, $\text{Cost} = 18\,\text{dmg/m}$
- `DRYWALL`: $\mu = 0.70$, $\text{Cost} = 22\,\text{dmg/m}$
- `METAL_SHEET`: $\mu = 0.45$, $\text{Cost} = 45\,\text{dmg/m}$
- `CONCRETE`: Impenetrable ($\text{Cost} = \infty$)

---

## 6. Viewmodel Rendering & 6-DOF Coupled Springs

1. **Dual-Pass Rendering:**
   - Pass 1: Render `worldScene` with player FOV ($90^\circ - 110^\circ$).
   - Pass 2: Invoke `renderer.clearDepth()`, then render `viewmodelScene` with locked FOV ($68^\circ$) and near-clip $0.005\,\text{m}$.
2. **Coupled 3D Springs (Hooke's Law: $F = -kx - cv$):**
   - Mouse Lag / Inertia: Rotational lag proportional to mouse delta ($k = 180, c = 18$).
   - Strafe Banking: $\pm 0.035\,\text{rad}$ roll during strafing.
   - Recoil Impulse: $+0.045\,\text{m}$ Z-pushback, $+0.055\,\text{rad}$ muzzle pitch.
   - Walk Bob: Figure-8 bob cycle scaled by horizontal velocity.

---

## 7. Authoritative Server & Lag Compensation

- **State Sync:** Colyseus room running at 64 ticks/second with binary schema delta compression.
- **Hitbox Rewind:** 1000ms ring buffer storing 5 articulated sensor colliders per operator:
  - Head (Sphere $r = 0.115\,\text{m}$, 4.0x damage, helmet dink audio)
  - Upper Chest (Capsule, 1.0x damage, Kevlar mitigation)
  - Stomach/Pelvis (Capsule, 1.15x damage, Kevlar mitigation)
  - Arms (Capsules, 0.75x damage)
  - Legs (Capsules, 0.75x damage)
- On shot arrival, the server rewinds colliders by $\Delta t = \min(80\,\text{ms}, \text{ServerNow} - \text{ClientTimestamp})$, performs authoritative raycasts, and restores live state in $<0.2\,\text{ms}$.

---

## 8. Web Audio Procedural Sound DSP

- **Binaural Spatialization:** `PannerNode` with `HRTF` panning model.
- **Wall Occlusion:**
  - Clear line of sight: Filter cutoff at 20,000 Hz.
  - 1 wall obstruction: Low-pass cutoff at 750 Hz ($0.55\times$ gain).
  - 2+ wall obstructions: Low-pass cutoff at 320 Hz ($0.25\times$ gain).
- **Procedural Synthesizers:**
  - Gunshot punch: 110Hz $\to$ 38Hz sine oscillator + 1200Hz bandpass noise crack.
  - Headshot dink: High-frequency metallic resonator ring (3200Hz).
  - Flash tinnitus: High-pitched pure sine wave (2800Hz) decaying over 4.5s.
