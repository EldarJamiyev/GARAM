import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { flatten, dedup, weld, join, prune } from '@gltf-transform/functions';
import { optimizeGlb } from './optimize-glb.mjs';

async function buildOffice() {
  const io = new NodeIO();
  const doc = await io.read('packages/client/public/models/cs_office.glb');

  // 1. Remove distant skybox / background terrain nodes
  for (const node of doc.getRoot().listNodes()) {
    const name = (node.getName() || '').toUpperCase();
    if (name.includes('BACK1') || name.includes('BACK2') || name.includes('TRANS6')) {
      console.log('Disposing non-playable node:', node.getName());
      node.dispose();
    }
  }

  // 2. Flatten transforms into vertex positions
  await doc.transform(flatten(), prune());

  // 3. Measure playable building bounds
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
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

  console.log('Playable Raw Bounds (Feet):');
  console.log('min:', min);
  console.log('max:', max);
  const rawSizeX = max[0] - min[0];
  const rawSizeY = max[1] - min[1];
  const rawSizeZ = max[2] - min[2];
  console.log('Raw Size (Feet):', [rawSizeX, rawSizeY, rawSizeZ]);

  // Target CS_OFFICE width = 76.0m (matching CsOfficeData.ts X in [-38, 38])
  // Or depth = 72.0m (Z in [-34, 38])
  const metricScale = 76.0 / Math.max(rawSizeX, rawSizeZ);
  console.log('Computed Metric Scale:', metricScale);

  const cx = (min[0] + max[0]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;
  const minY = min[1];

  // Bake metric scale, center XZ at 0,0, and ground floor at y = 0.0
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

  // Draw-call reduction: dedup, weld, join materials
  await doc.transform(dedup(), weld(), join({ keepNamed: false }), prune());

  const normMin = [Infinity, Infinity, Infinity];
  const normMax = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const arr = pos.getArray();
      for (let i = 0; i < arr.length; i += 3) {
        if (arr[i] < normMin[0]) normMin[0] = arr[i];
        if (arr[i + 1] < normMin[1]) normMin[1] = arr[i + 1];
        if (arr[i + 2] < normMin[2]) normMin[2] = arr[i + 2];
        if (arr[i] > normMax[0]) normMax[0] = arr[i];
        if (arr[i + 1] > normMax[1]) normMax[1] = arr[i + 1];
        if (arr[i + 2] > normMax[2]) normMax[2] = arr[i + 2];
      }
    }
  }
  console.log('Normalized Metric Bounds (Meters):');
  console.log('min:', normMin);
  console.log('max:', normMax);
  console.log('size:', [normMax[0] - normMin[0], normMax[1] - normMin[1], normMax[2] - normMin[2]]);

  const outPath = 'packages/client/public/models/cs_office.glb';
  await io.write(outPath, doc);
  console.log('Successfully wrote normalized metric cs_office.glb!');
}

buildOffice().catch(console.error);
