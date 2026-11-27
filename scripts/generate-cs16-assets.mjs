/**
 * Optional AI Asset Generator for CS 1.6 Weapons & SFX using GARAM's ai-service-router.cjs.
 * Note: All 8 weapons + Tactical Shield already have full 1:1 PBR procedural 3D meshes in
 * ProceduralWeaponBuilder.ts and full Web Audio DSP synthesis in ProceduralAudioCS16.ts,
 * so GARAM runs 100% offline immediately.
 * Run this script only if you also want optional Tripo/HF GLBs & ElevenLabs MP3s.
 */
import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generate3DModel, generateTacticalSound } = require('./ai-service-router.cjs');

const NEW_MODELS = [
  { key: 'mp5_navy', prompt: 'Tactical H&K MP5A3 submachine gun, curved 30 round magazine, matte gunmetal steel, isolated 3D game asset', targetLength: 0.54 },
  { key: 'famas', prompt: 'Clarion FAMAS F1 bullpup assault rifle with carry handle and bipod, matte polymer, isolated 3D weapon', targetLength: 0.66 },
  { key: 'galil', prompt: 'Galil ARM assault rifle with wooden handguard and curved steel mag, tactical rifle, isolated 3D asset', targetLength: 0.72 },
  { key: 'scout', prompt: 'Steyr Scout bolt-action sniper rifle with forward scope, matte olive polymer stock, isolated 3D weapon', targetLength: 0.82 },
  { key: 'p90', prompt: 'FN P90 bullpup submachine gun with top translucent horizontal 50 round magazine, isolated 3D asset', targetLength: 0.48 },
  { key: 'm3', prompt: 'Benelli M3 tactical 12 gauge pump shotgun with ribbed forend, matte black steel, isolated 3D weapon', targetLength: 0.78 },
  { key: 'xm1014', prompt: 'Benelli M4 XM1014 semi automatic tactical shotgun with collapsible stock, isolated 3D weapon', targetLength: 0.76 },
  { key: 'tactical_shield', prompt: 'Police tactical ballistic riot shield with armored viewport window and matte steel frame, isolated 3D asset', targetLength: 0.85 },
];

const NEW_SFX = [
  { filename: 'mp5_shot.mp3', prompt: '9mm submachine gun mp5 gunshot crisp tactical punch', durationSec: 0.6 },
  { filename: 'famas_shot.mp3', prompt: '5.56 bullpup assault rifle sharp gunshot crack', durationSec: 0.7 },
  { filename: 'galil_shot.mp3', prompt: '7.62 assault rifle crisp mechanical gunshot', durationSec: 0.8 },
  { filename: 'scout_shot.mp3', prompt: 'lightweight bolt action sniper rifle supersonic crack', durationSec: 0.9 },
  { filename: 'p90_shot.mp3', prompt: 'high velocity 5.7mm PDW rapid submachine gun shot', durationSec: 0.5 },
  { filename: 'm3_shot.mp3', prompt: '12 gauge pump action shotgun heavy boom blast', durationSec: 0.9 },
  { filename: 'xm1014_shot.mp3', prompt: 'semi auto 12 gauge tactical shotgun crisp blast', durationSec: 0.8 },
  { filename: 'm4_unsil.mp3', prompt: 'unsuppressed m4a1 carbine sharp loud gunshot crack', durationSec: 0.7 },
  { filename: 'usp_unsil.mp3', prompt: 'unsuppressed 45 caliber tactical pistol sharp gunshot', durationSec: 0.6 },
  { filename: 'glass_shatter.mp3', prompt: 'plate glass window shattering sharp crystal debris', durationSec: 0.8 },
];

async function main() {
  for (const m of NEW_MODELS) await generate3DModel(m.key, m.prompt, m.targetLength);
  for (const s of NEW_SFX) await generateTacticalSound(s.filename, s.prompt, s.durationSec);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
