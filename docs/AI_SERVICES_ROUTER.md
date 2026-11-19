# GARAM: ZERO HOUR — AI Services & Asset Generation Smart Guide Router

> **Autonomous Operating Standard:** AI agents, build scripts, and game pipelines must automatically reference and invoke these integrated services via `scripts/ai-service-router.cjs` without prompting the user for intervention or confirmation.

---

## 1. Credentials & Capabilities Mapping

All credentials are encrypted and injected via the local `.env` environment file (gitignored):

| Environment Variable | Service Provider | Primary Capability | Fallback Hierarchy |
| :--- | :--- | :--- | :--- |
| `HF_TOKEN` | **Hugging Face 3D Spaces** | 3D Textured Weapon & Asset Generation via `@gradio/client` | `prithivMLmods/TRELLIS.2-Text-to-3D` $\to$ `tencent/Hunyuan3D-2` $\to$ `JeffreyXiang/TRELLIS` $\to$ Procedural PBR GLTFExporter |
| `TRIPO_API_KEY` | **Tripo3D API** | Cloud-based fast photorealistic 3D generation | Hugging Face free 3D spaces $\to$ Local GLTFExporter |
| `ELEVENLABS_API_KEY` | **ElevenLabs Sound API** | Ultra-realistic tactical gunfire, knife draws, metallic clicks, and voice announcer | `ELEVENLABS_BACKUP_KEY` $\to$ FreeSound Database Search |
| `FREESOUND_API_KEY` | **FreeSound Database API** | 500,000+ community tactical audio database search & direct download | Procedural Web Audio Synth |
| `GROQ_API_KEY` | **Groq Cloud (Llama 3.3)** | Ultra-fast (&lt; 150ms) tactical bot dialog, situational callouts, and strategy generation | OpenRouter Gateway |
| `GEMINI_API_KEY` | **Google Gemini API** | High-level tactical reasoning, multimodal screenshot analysis, QA playtesting | Groq / OpenRouter |
| `OPENROUTER_API_KEY` | **OpenRouter AI Gateway** | Global multi-model fallback access across Claude, DeepSeek, Llama, and Mistral | Groq / Gemini |

---

## 2. 3D Weapon Asset Pipeline (`AssetManager.ts` & `garam-3d-assets`)

All 3D assets reside in `packages/client/public/models/` and are auto-normalized according to strict competitive FPS invariants:

```
packages/client/public/models/
├── garam47.glb     (0.88m longest axis — Modern tactical AK-47, carbon fiber & crimson accents)
├── m4a1s.glb       (0.84m longest axis — Suppressed M4A1-S carbine, cobalt collar & holo sight)
├── awp.glb         (1.22m longest axis — Sovereign AWP, emerald lens optic & bipod)
├── deagle.glb      (0.27m longest axis — .50 AE Desert Eagle, brushed steel & serrated slide)
└── karambit.glb    (0.22m longest axis — Curved hawkbill blade, gold retention ring)
```

### Auto-Normalization Rules
1. **Longest-Axis Bounding Box Normalization:**  
   Computed via `THREE.Box3().setFromObject(model)`. The model's longest dimension is mathematically scaled to match the target specification:
   $$\text{scaleFactor} = \frac{\text{targetLength}}{\max(\text{size}_x, \text{size}_y, \text{size}_z)}$$
2. **Dual-Pass Rendering Safety:**  
   Models are rendered strictly within the isolated `viewmodelScene` with `viewmodelCamera` (FOV 65°, near plane 0.005m) after `renderer.clearDepth()`. They never enter `worldScene` and cannot penetrate world walls.
3. **Graceful Procedural Fallback:**  
   `WeaponViewmodel.ts` initializes with high-fidelity procedural PBR meshes. When external `.glb` models finish loading asynchronously through `AssetManager.loadModel()`, the visual mesh updates seamlessly. If network timeouts or missing files occur, the procedural fallback remains 100% active.

---

## 3. Tactical Audio & SFX Generation Pipeline

Sound files are synthesized directly into `packages/client/public/audio/`:

```
packages/client/public/audio/
├── knife_draw.mp3       (0.6s — Metallic blade draw whoosh)
├── low_ammo_click.mp3   (0.5s — Mechanical spring magazine click for <= 5 rounds)
├── m4_suppressed.mp3    (0.7s — Muffled 11m gunshot snap)
├── deagle_shot.mp3      (0.9s — Heavy .50 AE gunshot echo)
└── awp_shot.mp3         (1.2s — Supersonic bolt-action sniper rifle crack)
```

### Audio Routing Execution
To generate or refresh sound assets automatically:
```bash
node scripts/generate-tactical-sfx.cjs
```
The script calls `ai-service-router.cjs`, attempting ElevenLabs sound synthesis first, and falling back to FreeSound database queries if quotas are exceeded.

---

## 4. Autonomous Agent Execution Guidelines

Whenever working on GARAM:
1. **Never ask the user for API keys.** All keys are permanently registered in `.env`.
2. **Use `node scripts/ai-service-router.cjs --check`** to inspect the operational status of all connected services at any time.
3. **Auto-commit and auto-push rule:** Every milestone or feature change must automatically be committed and pushed to `origin/main` without asking for user confirmation.
