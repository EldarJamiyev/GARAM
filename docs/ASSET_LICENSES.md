# Asset Attribution & Licensing Manifest

All 3D models, skeletal animation packs, textures, and audio assets bundled in **GARAM: ZERO HOUR** are audited below with verified provenance and licensing. Note that the CS2 first-person arms rig (`cs2_fps_arms.glb`) carries a **CC-BY-NC 4.0** (non-commercial) license; all other weapon, agent, map, texture, and audio assets are `CC-BY-4.0`, `CC0`, MIT, or project-licensed.

---

## 1. First-Person Arms & Skeletal Animation Rig

| Asset File | Creator | Source URL | Verified License | Usage & Notes |
| :--- | :--- | :--- | :---: | :--- |
| `packages/client/public/models/cs2_fps_arms.glb` | **1Matzh** (animations) / **epal** (CS2 arms & gloves rig) | [M4A1-S (CS2) \| First Person Animations](https://sketchfab.com/3d-models/m4a1-s-cs2-first-person-animations-440c4299f3d64cd897eddcd19400eabb) | **CC-BY-NC 4.0** | Extracted via `scripts/build-cs2-arms.mjs` (embedded M4A1-S mesh stripped). Continuous Rigify CS2 gloved hands + tactical sleeves with native `weapon_hand_r_5` / `DEF-handR_357` sockets and `Equip`, `Shots`, `Reload`, `Inspect` skeletal animations shared across all 9 weapons. Non-commercial use only. |

---

## 2. 3D Weapons, Operators & Tactical Props (All 9 Weapons + Agents + Props Bundled & Optimized `<= 16 MiB`)

| Asset File | Creator | Source URL | Verified License | Usage & Notes |
| :--- | :--- | :--- | :---: | :--- |
| `packages/client/public/models/garam47.glb` | **6lucius** | [AK-47 Weapon Model (CS2)](https://sketchfab.com/3d-models/rifle-ak-47-weapon-model-cs2-6b2244ba66274c71abdd194d0b04f731) | **CC-BY-4.0** | Garam-47 (AK-47) first-person viewmodel & 3P world rifle (`3.5 MiB`). |
| `packages/client/public/models/m4a1s.glb` | **6lucius** | [M4A1-S Weapon Model (CS2)](https://sketchfab.com/3d-models/rifle-m4a1-s-weapon-model-cs2-4ced85fd77e04b71ade5ab11cb28c529) | **CC-BY-4.0** | Vanguard M4A1-S suppressed CT rifle viewmodel & 3P world rifle (`6.0 MiB`). |
| `packages/client/public/models/m4a4.glb` | **6lucius** | [M4A4 Weapon Model (CS2)](https://sketchfab.com/3d-models/rifle-m4a4-weapon-model-cs2-cfb76a05bfd84ee38ce6663ee3ee5ecf) | **CC-BY-4.0** | M4A4 unsilenced CT rifle viewmodel & 3P world rifle (`4.8 MiB`). |
| `packages/client/public/models/awp.glb` | **6lucius** | [AWP Weapon Model (CS2)](https://sketchfab.com/3d-models/rifle-awp-weapon-model-cs2-23ad3d7fb46b40e59cab7937654e2691) | **CC-BY-4.0** | Sovereign AWP sniper rifle viewmodel & 3P world rifle (`4.5 MiB`). |
| `packages/client/public/models/mp9.glb` | **6lucius** | [MP9 Weapon Model (CS2)](https://sketchfab.com/3d-models/smg-mp9-weapon-model-cs2-3dbcae165cb64385b83bf620b1803c80) | **CC-BY-4.0** | MP9 high-cadence tactical SMG viewmodel & 3P world SMG (`1.97 MiB`). |
| `packages/client/public/models/deagle.glb` | **6lucius** | [Desert Eagle Weapon Model (CS2)](https://sketchfab.com/3d-models/pistol-desert-eagle-weapon-model-cs2-ffff93713abe49fbbe62eba3eea2b287) | **CC-BY-4.0** | Desert Eagle .50 AE sidearm viewmodel & 3P world pistol (`3.2 MiB`). |
| `packages/client/public/models/usps.glb` | **6lucius** | [USP-S Weapon Model (CS2)](https://sketchfab.com/3d-models/pistol-usp-s-weapon-model-cs2-5e0c452b1e2e4d7c9ea80638a94afaac) | **CC-BY-4.0** | USP-S suppressed starting pistol viewmodel & 3P world pistol (`1.74 MiB`). |
| `packages/client/public/models/glock18.glb` | **6lucius** | [Glock-18 Weapon Model (CS2)](https://sketchfab.com/3d-models/pistol-glock-18-weapon-model-cs2-e28b38177ffb4cbeba93062d2b7fa552) | **CC-BY-4.0** | Glock-18 starting pistol viewmodel & 3P world pistol (`1.17 MiB`). |
| `packages/client/public/models/karambit.glb` | **Diamonddogkz** | [Karambit Low-Poly](https://sketchfab.com/3d-models/karambit-dfd7606f189a413681305a39b8841ce8) | **CC-BY-4.0** | Garam Crimson Karambit melee viewmodel (`1.7 MiB`). |
| `packages/client/public/models/c4.glb` | **6lucius** | [Bomb C4 Explosive (CS2)](https://sketchfab.com/3d-models/c4-ca14fcc22cda4b2dbd8bf6c936285bac) | **CC-BY-4.0** | Planted & carried C4 explosive device (`2.1 MiB`). |
| `packages/client/public/models/grenade.glb` | **ForevereQ** | [Frag Grenade Model](https://sketchfab.com/3d-models/grenade-0a248ad637794f738797e7e2a2325839) | **CC-BY-4.0** | Tactical utility projectile mesh (`543 KiB`). |
| `packages/client/public/models/operator_vanguard.glb` | **6lucius** | [SAS CS2 Agent Model (Blue)](https://sketchfab.com/3d-models/sas-cs2-agent-model-blue-7f18aaccd0ee4694a36646101a12339e) | **CC-BY-4.0** | Vanguard (CT) third-person skeletal operator rig (`3.0 MiB`). |
| `packages/client/public/models/operator_syndicate.glb` | **6lucius** | [Balkan CS2 Agent Model](https://sketchfab.com/3d-models/balkan-cs2-agent-a1497ad74c5b41e9a2db063ba1b69aca) | **CC-BY-4.0** | Syndicate (T) third-person skeletal operator rig (`4.3 MiB`). |
| `packages/client/public/models/casing_9mm.glb` | **Original / In-Repo** | Authored in project repository | **MIT** | Instanced brass shell casing ejection mesh (`18 KiB`). |

---

## 3. Competitive 3D Maps & Environment Lighting

| Asset File | Creator | Source URL | Verified License | Usage & Notes |
| :--- | :--- | :--- | :---: | :--- |
| `packages/client/public/models/de_dust2.glb` | **Sketchfab / EldarJamiyev** (`de_dust_2_with_real_light.glb`) | [EldarJamiyev/GARAM — `de_dust_2_with_real_light.glb`](https://github.com/EldarJamiyev/GARAM/blob/main/de_dust_2_with_real_light.glb) | **CC-BY-4.0** | Full baked-lightmap (`KHR_materials_unlit`) competitive `de_dust2` 3D arena (`9.9 MiB`, 11 baked lightmap atlases, 9,061 triangles) with 2,791 watertight SAT AABB colliders and 30-node tactical NavGraph extracted via `scripts/build-de-dust2.mjs`. |
| `packages/client/public/models/cs_office.glb` | **neominigan** | [CS_OFFICE (CS:GO Real Light version)](https://sketchfab.com/3d-models/cs-office-csgo-real-light-version-4e36baec19194164acd47f7cc236d4e6) | **CC-BY-4.0** | Full 3D competitive `cs_office` environment with baked Corona raytraced GI albedo & emissive illumination, optimized via `@gltf-transform` (`dedup`, `prune`) to `14.83 MiB` (`<= 16 MiB`). |
| `packages/client/public/textures/skybox/kloofendal_1k.hdr` | **Poly Haven** (`kloofendal_43d_clear_puresky`) | [Poly Haven HDRI](https://polyhaven.com/a/kloofendal_43d_clear_puresky) | **CC0 1.0** | Equirectangular golden-hour IBL reflection & ambient sky lighting. |
| Procedural Canvas PBR Maps (`CsOfficeMap.ts`, `EffectsManager.ts`) | **GARAM Systems Team** | Generated in-client via HTML5 Canvas | **MIT** | Fallback surface textures, impact decals, and muzzle star textures. |

---

## 4. Sketchfab Collection Audit (`4a662b6f095c4c04aa8473c89eee47f4` / `https://skfb.ly/pQKYU`)

Collection **"Counter Strike Global Offensive"** by **GHOST CS GO (`valeradyovall`)** (`https://skfb.ly/pQKYU` resolves directly to `https://sketchfab.com/valeradyovall/collections/counter-strike-global-offensive-4a662b6f095c4c04aa8473c89eee47f4`) contains **37 models** audited via `GET https://api.sketchfab.com/v3/collections/4a662b6f095c4c04aa8473c89eee47f4/models`:

| # | Model Name | UID | Author | Category | Downloadable | License |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: |
| 1 | `Original AWP \| Dragon lore` | `798ab94120064b8f8a9235367b773327` | `toolazytocreate` | weapon | **Yes** | `CC-BY` |
| 2 | `AK-47 \| Vulcan` | `9ad6f414723742a8898cfaad5c7782ac` | `csgohub.ru` | weapon | **Yes** | `CC-BY` |
| 3 | `AWP \| Gungnir` | `4ffe9625530d42a6ab580c4f6d81ff77` | `csgohub.ru` | weapon | **Yes** | `CC-BY` |
| 4 | `CSGO WEAPON: AWP PRINCE` | `05ed5b789dc546d8b40dd89a071be927` | `WoodenManufacturing` | weapon | **Yes** | `CC-BY` |
| 5 | `M84 Stun Grenade` | `14865bf4dd9f4cd38f69c13fa724be29` | `KIDosn` | utility | **Yes** | `CC-BY-NC` |
| 6 | `Classic Knife - CS 1.6` | `75f08f22f51a4b16bc4faf8319daee18` | `hmtr2005` | weapon | **Yes** | `CC-BY` |
| 7–37 | 31 CS:GO skin previews (`Desert Eagle \| Blaze`, `AK-47 \| Wasteland Rebel`, `AK-47 \| The Empress`, `★ Karambit \| Marble Fade`, `AK-47 \| Neon Rider`, `AK-47 \| Bloodsport`, `M26 Grenade`, `Smoke Grenade M18 RED`, `M4A1-S \| Chantico's Fire`, `M4A4 \| Desolate Space`, `Nova \| Hyper Beast`, `★ Bayonet \| Lore`, `★ Flip Knife \| Lore`, `★ Gut Knife \| Lore`, `★ M9 Bayonet \| Lore`, `CSGO Bomb`, `AWP \| Medusa`, `★ Karambit \| Lore`, `AWP \| Fever Dream`, `USP-S \| Neo-Noir`, `M4A4 \| Neo-Noir`, `MAC-10 \| Neon Rider`, `AK-47 \| Neon Revolution`, `Five-SeveN \| Hyper Beast`, `M4A1-S \| Hyper Beast`, `AWP \| Hyper Beast`, `P90 \| Asiimov`, `M4A4 \| Asiimov`, `AWP \| Asiimov`, `M4A4 \| Howl`, `AWP \| Dragon Lore`) | Various (`csgoitems.pro`, `nightcrawler441`, `jimmybui`, `Franck-Allen_Nguyen`, `vispro`) | Various | weapon / utility / prop | **No** (`isDownloadable: false`) | `Standard (View-Only)` |

---

## 5. Audio Assets & Procedural DSP

| Asset File / System | Origin | License | Notes |
| :--- | :--- | :---: | :--- |
| `packages/client/public/audio/awp_shot.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Sovereign AWP supersonic boom sample. |
| `packages/client/public/audio/deagle_shot.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Desert Eagle .50 AE shot sample. |
| `packages/client/public/audio/m4_suppressed.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Vanguard M4A1-S suppressed shot sample. |
| `packages/client/public/audio/knife_draw.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Karambit metallic draw ring sample. |
| `packages/client/public/audio/low_ammo_click.mp3` | Project Audio Synthesis (ElevenLabs SFX) | **Project-Licensed** | Dry-fire / low-ammo mechanical warning click. |
| `ProceduralAudio.ts` | **GARAM Systems Team** | **MIT** | Real-time Web Audio API synthesis for Garam-47 (AK-47) layered gunfire, mechanical reload foley, footsteps, surface impacts, headshot dink, shell clinks, flashbang tinnitus, smoke hiss, and indoor tunnel convolver reverb. |
