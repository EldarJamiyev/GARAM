# Asset Attribution & Licensing Manifest

All 3D models, skeletal animation packs, textures, and audio assets bundled in **GARAM: ZERO HOUR** are audited below with verified provenance and licensing. Assets carrying restrictive Non-Commercial (`CC-BY-NC`) terms (such as the previously bundled `m4a1s_fp.glb`) have been **removed** so the repository maintains clean commercial-compatible licensing (`CC-BY-4.0`, `CC0`, MIT, or original in-repo synthesis).

---

## 1. First-Person Arms & Skeletal Animation Rig

| Asset File | Creator | Source URL | Verified License | Usage & Notes |
| :--- | :--- | :--- | :---: | :--- |
| `packages/client/public/models/fps_arms_tactical.glb` | **ccransh** | [FPS AK-74m animations](https://sketchfab.com/3d-models/fps-ak-74m-animations-94be8385c402474cacd39bc096c6ca14)<br>[Animated FPS hands (rifle)](https://sketchfab.com/3d-models/animated-fps-hands-rifle-animation-pack-5f2d0ed780a94724b36ab505f7564057)<br>[FPS pistol animations](https://sketchfab.com/3d-models/fps-pistol-animations-0d7a343dcb6f401197a73c91aee93f6d)<br>[FPS sniper animations](https://sketchfab.com/3d-models/fps-animations-sniper-rifle-c15ae8393d824f5b929e3f69691cdd31) | **CC-BY-4.0** | Unified first-person rigged tactical gloved arms mesh + PBR maps combined with AK, Rifle/M4, Sniper/AWP, and Pistol skeletal `AnimationClip`s; Karambit melee clips generated procedurally over the same skeleton. |

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
