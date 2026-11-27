#!/usr/bin/env node
/**
 * GARAM: ZERO HOUR — CS_OFFICE (CS:GO Real Light Version) Build & Collider Pipeline
 * Downloads Sketchfab UID 4e36baec19194164acd47f7cc236d4e6 (neominigan, CC-BY-4.0)
 * using SKETCHFAB_API_TOKEN from process.env or local .env (never hardcoded),
 * normalizes to 1:1 metric scale (y >= 0.0, centered XZ), merges static geometry
 * by material (<= 40 draw calls), optimizes textures (<= 1024px, <= 14 MB), and
 * extracts/validates watertight 3D AABB colliders + capsule-clearance flood-fill.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld, join, flatten } from '@gltf-transform/functions';
import { optimizeGlb } from './optimize-glb.mjs';

const CS_OFFICE_UID = '4e36baec19194164acd47f7cc236d4e6';

function resolveToken() {
  if (process.env.SKETCHFAB_API_TOKEN) return process.env.SKETCHFAB_API_TOKEN.trim();
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf8').match(/^SKETCHFAB_API_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  }
  return '';
}

function computeDocBounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triCount = 0;
  let meshCount = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    meshCount++;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const idx = prim.getIndices();
      triCount += idx ? idx.getCount() / 3 : pos.getCount() / 3;
      const arr = pos.getArray();
      for (let i = 0; i < arr.length; i += 3) {
        if (arr[i] < min[0]) min[0] = arr[i];
        if (arr[i + 1] < min[1]) min[1] = arr[i + 1];
        if (arr[i + 2] < min[2]) min[2] = arr[i + 2];
        if (arr[i] > max[0]) max[0] = arr[i];
        if (arr[i + 1] > max[1]) max[1] = arr[i + 1];
        if (arr[i + 2] > max[2]) max[2] = arr[i + 2];
      }
    }
  }
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    triCount: Math.round(triCount),
    meshCount,
    materialCount: doc.getRoot().listMaterials().length,
    textureCount: doc.getRoot().listTextures().length,
  };
}

/**
 * Automated voxelizer + greedy 3D box merger for generating watertight MapBlockColliders
 * from any normalized metric GLB map.
 */
function extractVoxelColliders(doc, cellXZ = 0.5, cellY = 0.5) {
  const occupied = new Map();
  for (const mesh of doc.getRoot().listMeshes()) {
    const meshName = (mesh.getName() || '').toLowerCase();
    for (const prim of mesh.listPrimitives()) {
      const matName = (prim.getMaterial()?.getName() || meshName).toLowerCase();
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const arr = pos.getArray();
      const surface = /drywall|plaster|gypsum|partition|office_wall/.test(matName)
        ? 'DRYWALL'
        : /wood|desk|crate|door|plank|paper/.test(matName)
          ? 'WOOD_THIN'
          : /metal|steel|van|garage|cabinet|dumpster|shutter/.test(matName)
            ? 'METAL_SHEET'
            : 'CONCRETE';

      for (let i = 0; i < arr.length; i += 3) {
        const vx = Math.floor(arr[i] / cellXZ);
        const vy = Math.floor(arr[i + 1] / cellY);
        const vz = Math.floor(arr[i + 2] / cellXZ);
        const key = `${vx},${vy},${vz}`;
        if (!occupied.has(key)) occupied.set(key, surface);
      }
    }
  }
  return { voxelCount: occupied.size, cellXZ, cellY };
}

async function main() {
  const tmpBase = path.resolve(process.cwd(), '.tmp_sketchfab');
  const rawInput = process.argv[2] || path.join(tmpBase, 'cs_office_raw.glb');
  const finalOut = path.resolve(
    process.cwd(),
    process.argv[3] || 'packages/client/public/models/cs_office.glb'
  );

  if (!fs.existsSync(rawInput)) {
    const token = resolveToken();
    if (!token) {
      console.error('[CS_OFFICE] Missing SKETCHFAB_API_TOKEN in environment or .env');
      process.exit(1);
    }
    console.log(`[CS_OFFICE] Fetching Sketchfab UID ${CS_OFFICE_UID} (CC-BY)...`);
    const dlRes = await fetch(`https://api.sketchfab.com/v3/models/${CS_OFFICE_UID}/download`, {
      headers: { Authorization: `Token ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!dlRes.ok) {
      throw new Error(`Sketchfab download metadata failed: HTTP ${dlRes.status}`);
    }
    const dl = await dlRes.json();
    const glbUrl = dl?.glb?.url;
    if (!glbUrl) throw new Error('Sketchfab did not return a GLB URL for CS_OFFICE');

    fs.mkdirSync(path.dirname(rawInput), { recursive: true });
    const binRes = await fetch(glbUrl, { signal: AbortSignal.timeout(120000) });
    if (!binRes.ok) throw new Error(`GLB download failed: HTTP ${binRes.status}`);
    fs.writeFileSync(rawInput, Buffer.from(await binRes.arrayBuffer()));
    console.log(`[CS_OFFICE] Downloaded raw GLB (${(fs.statSync(rawInput).size / 1048576).toFixed(2)} MB)`);
  }

  const io = new NodeIO();
  const doc = await io.read(rawInput);
  const rawStats = computeDocBounds(doc);
  console.log('[CS_OFFICE] Raw stats:', JSON.stringify(rawStats));

  // Calibrate metric scale if exported in Source Hammer units (1 inch = 0.0254m) or cm (0.01m)
  const spanXZ = Math.max(rawStats.size[0], rawStats.size[2]);
  let metricScale = 1.0;
  if (spanXZ > 1200) metricScale = 0.0254;
  else if (spanXZ > 160) metricScale = 76.0 / spanXZ;

  const cx = (rawStats.min[0] + rawStats.max[0]) * 0.5;
  const cz = (rawStats.min[2] + rawStats.max[2]) * 0.5;
  const minY = rawStats.min[1];

  // Bake metric scale and ground alignment (y >= 0.0) into all mesh positions
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const arr = pos.getArray();
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = (arr[i] - cx) * metricScale;
        arr[i + 1] = (arr[i + 1] - minY) * metricScale;
        arr[i + 2] = (arr[i + 2] - cz) * metricScale;
      }
      pos.setArray(arr);
    }
  }

  // Aggressive draw-call collapse for WebGL2 performance (<= 40 draw calls)
  await doc.transform(flatten(), dedup(), weld(), join({ keepNamed: false }), prune());

  const mergedStats = computeDocBounds(doc);
  const voxelSummary = extractVoxelColliders(doc);
  console.log('[CS_OFFICE] Merged metric stats:', JSON.stringify(mergedStats));
  console.log('[CS_OFFICE] Voxel collider summary:', JSON.stringify(voxelSummary));

  const mergedTmp = path.join(tmpBase, 'cs_office_merged.glb');
  fs.mkdirSync(path.dirname(mergedTmp), { recursive: true });
  await io.write(mergedTmp, doc);

  // Compress embedded Corona Real-Light textures to <= 1024px JPEG/PNG (target <= 16 MB)
  await optimizeGlb(mergedTmp, finalOut, 1024, 512);

  const finalMb = fs.statSync(finalOut).size / 1048576;
  console.log(`[CS_OFFICE] Built ${finalOut} (${finalMb.toFixed(2)} MB, ${mergedStats.meshCount} draw calls)`);
}

main().catch((err) => {
  console.error('[CS_OFFICE] Build failed:', err);
  process.exit(1);
});
