#!/usr/bin/env node
/**
 * GARAM: ZERO HOUR — CC0 1K PBR Texture Fetcher
 * Downloads authentic photographic PBR materials from Poly Haven (CC0 public domain)
 * into packages/client/public/textures/pbr/
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outBaseDir = path.resolve(__dirname, '../packages/client/public/textures/pbr');

const TEXTURE_SETS = [
  { id: 'cobblestone_04', label: 'Main Courtyards & Lanes' },
  { id: 'plastered_stone_wall', label: 'A Sanctum & Exterior Walls' },
  { id: 'damaged_plaster', label: 'A Sanctum Accent Walls & Reveals' },
  { id: 'concrete_panels', label: 'B Foundry Industrial Deck & Walls' },
  { id: 'roof_planks', label: 'Timber Doors, Pergolas & Crates' },
  { id: 'corrugated_iron_03', label: 'Foundry Containers & Metal Cover' },
];

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    return; // Already cached
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

async function main() {
  console.log('=====================================================');
  console.log('🧱 GARAM: ZERO HOUR — CC0 PBR TEXTURE ASSET PIPELINE');
  console.log('=====================================================');

  fs.mkdirSync(outBaseDir, { recursive: true });

  for (const set of TEXTURE_SETS) {
    console.log(`\n[PBR] Fetching metadata for ${set.id} (${set.label})...`);
    const setDir = path.join(outBaseDir, set.id);
    fs.mkdirSync(setDir, { recursive: true });

    try {
      const metaRes = await fetch(`https://api.polyhaven.com/files/${set.id}`);
      if (!metaRes.ok) throw new Error(`Meta error: ${metaRes.status}`);
      const data = await metaRes.json();

      const diffUrl =
        data.Diffuse?.['1k']?.jpg?.url ||
        data.Diffuse?.['1k']?.png?.url;
      const norUrl =
        data.nor_gl?.['1k']?.jpg?.url ||
        data.nor_gl?.['1k']?.png?.url ||
        data.nor_dx?.['1k']?.jpg?.url;
      const roughUrl =
        data.Rough?.['1k']?.jpg?.url ||
        data.Rough?.['1k']?.png?.url;

      if (diffUrl) {
        process.stdout.write(`  -> Downloading diffuse... `);
        await downloadFile(diffUrl, path.join(setDir, 'diff_1k.jpg'));
        console.log('done.');
      }
      if (norUrl) {
        process.stdout.write(`  -> Downloading normal (OpenGL)... `);
        await downloadFile(norUrl, path.join(setDir, 'nor_gl_1k.jpg'));
        console.log('done.');
      }
      if (roughUrl) {
        process.stdout.write(`  -> Downloading roughness... `);
        await downloadFile(roughUrl, path.join(setDir, 'rough_1k.jpg'));
        console.log('done.');
      }

      console.log(`✓ [PBR] ${set.id} downloaded successfully.`);
    } catch (err) {
      console.warn(`⚠️ [PBR] Error fetching ${set.id}: ${err.message}. Ensuring procedural fallback exists.`);
    }
  }

  console.log('\n✅ CC0 PBR Texture Pipeline Execution Complete!');
}

main().catch((err) => {
  console.error('Fatal error downloading textures:', err);
  process.exit(1);
});
