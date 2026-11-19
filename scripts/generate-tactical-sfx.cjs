/**
 * GARAM: ZERO HOUR — Tactical Sound Generation Pipeline
 * Uses ElevenLabs Sound Generation API to synthesize authentic weapon SFX
 */

require('dotenv').config();
const { generateTacticalSound } = require('./ai-service-router.cjs');

const SFX_SPECS = [
  {
    filename: 'knife_draw.mp3',
    prompt: 'tactical knife blade draw whoosh sharp metallic slide',
    durationSec: 0.6,
  },
  {
    filename: 'low_ammo_click.mp3',
    prompt: 'empty gun magazine spring mechanical metallic click',
    durationSec: 0.5,
  },
  {
    filename: 'm4_suppressed.mp3',
    prompt: 'suppressed tactical rifle gunshot quiet mechanical snap',
    durationSec: 0.7,
  },
  {
    filename: 'deagle_shot.mp3',
    prompt: 'heavy 50 caliber tactical handgun gunshot powerful blast',
    durationSec: 0.9,
  },
  {
    filename: 'awp_shot.mp3',
    prompt: 'heavy military bolt action sniper rifle gunshot loud supersonic crack reverberation',
    durationSec: 1.2,
  },
];

async function generateAllSFX() {
  console.log('========================================================');
  console.log('🔊 GARAM: ZERO HOUR — ELEVENLABS TACTICAL AUDIO PIPELINE');
  console.log('========================================================');

  for (const spec of SFX_SPECS) {
    await generateTacticalSound(spec.filename, spec.prompt, spec.durationSec);
  }

  console.log('\n✅ All tactical audio generation complete!\n');
}

generateAllSFX().catch((err) => {
  console.error('Fatal error during audio generation:', err);
  process.exit(1);
});
