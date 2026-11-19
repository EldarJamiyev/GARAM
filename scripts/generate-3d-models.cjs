/**
 * GARAM: ZERO HOUR — 3D Model Generation Pipeline
 * Generates and saves textured .glb models directly into packages/client/public/models/
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { generate3DModel } = require('./ai-service-router.cjs');

const WEAPONS_3D_SPECS = [
  {
    key: 'garam47',
    prompt: 'Modern tactical AK-47 assault rifle, matte black carbon fiber body, crimson red and brushed gold metallic accents, picatinny rails, isolated weapon asset',
    targetLength: 0.88,
  },
  {
    key: 'm4a1s',
    prompt: 'Suppressed M4A1-S tactical carbine rifle, matte black finish with silencer and holographic sight, isolated 3D game weapon',
    targetLength: 0.84,
  },
  {
    key: 'awp',
    prompt: 'Heavy military bolt-action sniper rifle with long scope and bipod, matte obsidian and crimson finish, isolated 3D game asset',
    targetLength: 1.22,
  },
  {
    key: 'deagle',
    prompt: 'Heavy caliber tactical Desert Eagle pistol, brushed steel and crimson gold engraved slide, isolated 3D weapon',
    targetLength: 0.27,
  },
  {
    key: 'karambit',
    prompt: 'Tactical curved karambit combat knife, blackened steel blade with crimson finger ring handle, isolated 3D weapon',
    targetLength: 0.22,
  },
];

async function generateAllModels() {
  console.log('========================================================');
  console.log('🚀 GARAM: ZERO HOUR — 3D WEAPON ASSET GENERATION PIPELINE');
  console.log('========================================================');

  const results = [];
  for (const spec of WEAPONS_3D_SPECS) {
    const res = await generate3DModel(spec.key, spec.prompt, spec.targetLength);
    results.push({ ...spec, ...res });
  }

  console.log('\n========================================================');
  console.log('📊 3D MODEL GENERATION REPORT');
  console.log('========================================================');
  for (const r of results) {
    console.log(`• ${r.key}.glb: ${r.success ? '✅ SAVED' : '❌ FAILED'} (${r.sizeBytes || 0} bytes)`);
  }
  console.log('========================================================\n');
}

generateAllModels().catch((err) => {
  console.error('Fatal error during 3D model generation:', err);
  process.exit(1);
});
