# Asset Attribution & Licensing Manifest

All 3D models, skeletal animation packs, textures, and audio assets bundled in **GARAM: ZERO HOUR** are audited below with verified provenance and licensing. Note that the CS2 first-person arms rig (`cs2_fps_arms.glb`) carries a **CC-BY-NC 4.0** (non-commercial) license; all other weapon, agent, texture, and audio assets are `CC-BY-4.0`, `CC0`, MIT, or project-licensed.

---

## 1. First-Person Arms & Skeletal Animation Rig

| Asset File | Creator | Source URL | Verified License | Usage & Notes |
| :--- | :--- | :--- | :---: | :--- |
| `packages/client/public/models/cs2_fps_arms.glb` | **1Matzh** (animations) / **epal** (CS2 arms & gloves rig) | [M4A1-S (CS2) \| First Person Animations](https://sketchfab.com/3d-models/m4a1-s-cs2-first-person-animations-440c4299f3d64cd897eddcd19400eabb) | **CC-BY-NC 4.0** | Extracted via `scripts/build-cs2-arms.mjs` (embedded M4A1-S mesh stripped). Continuous Rigify CS2 gloved hands + tactical sleeves with native `weapon_hand_r_5` socket and `Equip`, `Shots`, `Reload`, `Inspect` skeletal animations shared across all 5 weapons. Non-commercial use only. |

---

## 2. 3D Weapons, Operators & Tactical Props

| Asset File | Creator | Source URL | Verified License | Usage & Notes |
| :--- | :--- | :--- | :---: | :--- |
| `packages/client/public/models/garam47.glb` | **6lucius** | [AK-47 Weapon Model](https://sketchfab.com/3d-models/rifle-ak-47-weapon-model-cs2-6b2244ba66274c71abdd194d0b04f731) | **CC-BY-4.0** | Garam-47 first-person viewmodel & world rifle. |
| `packages/client/public/models/m4a1s.glb` | **6lucius** | [M4A1-S Weapon Model](https://sketchfab.com/3d-models/rifle-m4a1-s-weapon-model-cs2-4ced85fd77e04b71ade5ab11cb28c529) | **CC-BY-4.0** | Vanguard M4A1-S first-person viewmodel & world CT rifle. |
| `packages/client/public/models/awp.glb` | **6lucius** | [AWP Weapon Model](https://sketchfab.com/3d-models/rifle-awp-weapon-model-cs2-23ad3d7fb46b40e59cab7937654e2691) | **CC-BY-4.0** | Sovereign AWP sniper rifle viewmodel. |
| `packages/client/public/models/deagle.glb` | **6lucius** | [Desert Eagle Weapon Model](https://sketchfab.com/3d-models/pistol-desert-eagle-weapon-model-cs2-ffff93713abe49fbbe62eba3eea2b287) | **CC-BY-4.0** | Desert Eagle .50 AE sidearm viewmodel. |
| `packages/client/public/models/karambit.glb` | **Diamonddogkz** | [Karambit Low-Poly](https://sketchfab.com/Diamonddogkz) (embedded GLTF attribution) | **CC-BY-4.0** | Garam Crimson Karambit melee viewmodel. |
| `packages/client/public/models/c4.glb` | **6lucius** | [Bomb C4 Explosive](https://sketchfab.com/6lucius) (embedded GLTF attribution) | **CC-BY-4.0** | Planted & carried C4 explosive device. |
| `packages/client/public/models/grenade.glb` | **ForevereQ** | [Frag Grenade Model](https://sketchfab.com/ForevereQ) (embedded GLTF attribution) | **CC-BY-4.0** | Tactical utility projectile mesh. |
| `packages/client/public/models/operator_vanguard.glb` | **6lucius** | [SAS CS2 Agent Model (Blue)](https://sketchfab.com/3d-models/sas-cs2-agent-model-blue-7f18aaccd0ee4694a36646101a12339e) | **CC-BY-4.0** | Vanguard (CT) third-person skeletal operator rig. |
| `packages/client/public/models/operator_syndicate.glb` | **6lucius** | [Balkan CS2 Agent Model](https://sketchfab.com/6lucius) (embedded GLTF attribution) | **CC-BY-4.0** | Syndicate (T) third-person skeletal operator rig. |
| `packages/client/public/models/casing_9mm.glb` | **Original / In-Repo** | Authored in project repository | **MIT** | Instanced brass shell casing ejection mesh. |

---

## 3. Environment Lighting & Textures

| Asset File | Creator | Source URL | Verified License | Usage & Notes |
| :--- | :--- | :--- | :---: | :--- |
| `packages/client/public/models/de_dust2.glb` | **StarKnightt** (Blender geometry) / **Poly Haven** (WebP PBR textures) | [StarKnightt/counter-strike-in-browser](https://github.com/StarKnightt/counter-strike-in-browser) | **MIT / CC0 1.0** | Full 3D PBR-textured competitive `de_dust2` arena (Long, A Site, Ramp, CT Spawn, Pit, Short Catwalk) with Poly Haven CC0 textures and watertight SAT AABB colliders extracted via `scripts/build-de-dust2.mjs`. |
| `packages/client/public/textures/skybox/kloofendal_1k.hdr` | **Poly Haven** (`kloofendal_43d_clear_puresky`) | [Poly Haven HDRI](https://polyhaven.com/a/kloofendal_43d_clear_puresky) | **CC0 1.0** | Equirectangular golden-hour IBL reflection & ambient sky lighting. |
| Procedural Canvas PBR Maps (`DeCitadelMap.ts`, `EffectsManager.ts`) | **GARAM Systems Team** | Generated in-client via HTML5 Canvas | **MIT** | Limestone flagstones, stucco masonry, cargo crates, corrugated steel, impact decals, and muzzle star textures. |

---

## 4. Audio Assets & Procedural DSP

| Asset File / System | Origin | License | Notes |
| :--- | :--- | :---: | :--- |
| `packages/client/public/audio/awp_shot.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Sovereign AWP supersonic boom sample. |
| `packages/client/public/audio/deagle_shot.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Desert Eagle .50 AE shot sample. |
| `packages/client/public/audio/m4_suppressed.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Vanguard M4A1-S suppressed shot sample. |
| `packages/client/public/audio/knife_draw.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Karambit metallic draw ring sample. |
| `packages/client/public/audio/low_ammo_click.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Dry-fire / low-ammo mechanical warning click. |
| `ProceduralAudio.ts` | **GARAM Systems Team** | **MIT** | Real-time Web Audio API synthesis for Garam-47 (AK-47) layered gunfire, mechanical reload foley, footsteps, surface impacts, headshot dink, shell clinks, flashbang tinnitus, smoke hiss, and indoor tunnel convolver reverb. |
