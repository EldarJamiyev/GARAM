#!/usr/bin/env node
/**
 * GARAM: ZERO HOUR — CS2 First-Person Gloved Arms Extractor
 * Extracts the authentic CS2 first-person arms & tactical gloves (Object_7 + Object_8)
 * plus the complete Rigify/CS2 skeletal armature and animations (Equip, Shots, Reload,
 * Inspect, Unequip) from Sketchfab model 440c4299f3d64cd897eddcd19400eabb (m4a1s_fp.glb),
 * stripping the embedded M4A1-S weapon mesh and Background geometry/textures so all 5
 * GARAM weapons mount cleanly onto the unified CS2 arms skeleton.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelsDir = path.resolve(__dirname, '../packages/client/public/models');

const srcPath = path.join(modelsDir, 'm4a1s_fp.glb');
const outPath = path.join(modelsDir, 'cs2_fps_arms.glb');

async function main() {
  if (!fs.existsSync(srcPath)) {
    console.error(`[build-cs2-arms] Missing source GLB: ${srcPath}`);
    process.exit(1);
  }

  const io = new NodeIO();
  const doc = await io.read(srcPath);
  const root = doc.getRoot();

  const KEEP_MATERIALS = new Set([
    'modelsweaponsv_modelsarmsv',
    'modelsweaponsv_modelsarmst',
  ]);

  // Remove embedded M4A1-S weapon mesh and background meshes so only CS2 arms/gloves remain
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matNames = mesh.listPrimitives().map((p) => p.getMaterial()?.getName() || '');
    const isArmMesh = matNames.some((m) => KEEP_MATERIALS.has(m));
    if (!isArmMesh) {
      console.log(`[build-cs2-arms] Removing non-arm mesh node: ${node.getName()} (${matNames.join(', ')})`);
      node.setMesh(null);
      node.setSkin(null);
    } else {
      console.log(`[build-cs2-arms] Keeping CS2 arm mesh node: ${node.getName()} (${matNames.join(', ')})`);
    }
  }

  // Prune unreferenced meshes, materials, textures, and accessors (keep all skeleton joints & animations intact)
  await doc.transform(
    prune({
      keepLeaves: true,
      keepSolidTextures: true,
    })
  );

  // Strip unused Background/weapon materials explicitly if still present
  for (const mat of root.listMaterials()) {
    if (!KEEP_MATERIALS.has(mat.getName())) {
      mat.dispose();
    }
  }
  await doc.transform(prune({ keepLeaves: true }));

  await io.write(outPath, doc);

  const inSize = fs.statSync(srcPath).size;
  const outSize = fs.statSync(outPath).size;
  console.log(
    `[build-cs2-arms] Wrote ${path.relative(process.cwd(), outPath)}: ${(outSize / 1024 / 1024).toFixed(2)} MB (down from ${(inSize / 1024 / 1024).toFixed(2)} MB)`
  );
  console.log(
    `[build-cs2-arms] Remaining meshes=${root.listMeshes().length}, materials=${root.listMaterials().map((m) => m.getName()).join(', ')}, textures=${root.listTextures().length}, animations=${root.listAnimations().map((a) => a.getName()).join(', ')}`
  );
}

main().catch((err) => {
  console.error('[build-cs2-arms] Fatal error:', err);
  process.exit(1);
});
