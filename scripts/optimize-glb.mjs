#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

export async function optimizeGlb(inPath, outPath, maxAlbedo = 1024, maxData = 512) {
  const io = new NodeIO();
  const doc = await io.read(inPath);

  // Find materials and their texture usages to distinguish albedo vs data
  const dataTextures = new Set();
  const albedoTextures = new Set();
  for (const mat of doc.getRoot().listMaterials()) {
    const bc = mat.getBaseColorTexture();
    if (bc) albedoTextures.add(bc);
    const em = mat.getEmissiveTexture();
    if (em) albedoTextures.add(em);
    const mr = mat.getMetallicRoughnessTexture();
    if (mr) dataTextures.add(mr);
    const norm = mat.getNormalTexture();
    if (norm) dataTextures.add(norm);
    const occ = mat.getOcclusionTexture();
    if (occ) dataTextures.add(occ);
  }

  for (const tex of doc.getRoot().listTextures()) {
    const raw = tex.getImage();
    if (!raw || raw.length === 0) continue;
    const isData = dataTextures.has(tex) && !albedoTextures.has(tex);
    const maxDim = isData ? maxData : maxAlbedo;
    const origMime = tex.getMimeType() || 'image/png';
    const isPng = origMime.includes('png');

    try {
      const pipeline = sharp(Buffer.from(raw)).resize({
        width: maxDim,
        height: maxDim,
        fit: 'inside',
        withoutEnlargement: true,
      });
      let outBuf;
      let outMime;
      if (isPng && isData) {
        outBuf = await pipeline.png({ compressionLevel: 9 }).toBuffer();
        outMime = 'image/png';
      } else {
        outBuf = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
        outMime = 'image/jpeg';
      }
      if (outBuf.length < raw.length) {
        tex.setImage(new Uint8Array(outBuf));
        tex.setMimeType(outMime);
      }
    } catch {
      // keep original on any format error
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
  const sizeMb = (fs.statSync(outPath).size / 1048576).toFixed(2);
  console.log(`[optimize-glb] Wrote ${outPath} (${sizeMb} MB)`);
}

if (process.argv[1] && process.argv[1].endsWith('optimize-glb.mjs')) {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  const maxA = parseInt(process.argv[4] || '1024', 10);
  const maxD = parseInt(process.argv[5] || '512', 10);
  if (!inPath || !outPath) {
    console.error('Usage: node optimize-glb.mjs <in.glb> <out.glb> [maxAlbedo=1024] [maxData=512]');
    process.exit(1);
  }
  optimizeGlb(inPath, outPath, maxA, maxD).catch((err) => {
    console.error('[optimize-glb] Failed:', err);
    process.exit(1);
  });
}
