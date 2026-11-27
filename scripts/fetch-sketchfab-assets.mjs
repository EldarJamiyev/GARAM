#!/usr/bin/env node
/**
 * GARAM: ZERO HOUR — Sketchfab 3D Asset & Collection Pipeline
 * Queries Sketchfab API v3 for collection 4a662b6f095c4c04aa8473c89eee47f4 (https://skfb.ly/pQKYU)
 * and the core CS2 tactical catalog using SKETCHFAB_API_TOKEN / SKETCHFAB_API_KEY from local .env
 * (never printed or logged), downloads all downloadable GLB archives, and runs @gltf-transform
 * (dedup, prune) + scripts/optimize-glb.py (<= 1024px baseColor, lossless PNG normal maps, <= 16 MiB).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune } from '@gltf-transform/functions';

const COLLECTION_UID = '4a662b6f095c4c04aa8473c89eee47f4';

function resolveToken() {
  for (const k of ['SKETCHFAB_API_TOKEN', 'SKETCHFAB_API_KEY']) {
    if (process.env[k] && process.env[k].trim()) return process.env[k].trim();
  }
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const txt = fs.readFileSync(envPath, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^(?:SKETCHFAB_API_TOKEN|SKETCHFAB_API_KEY|Sketchfab api key)\s*[=:]\s*(.+)$/i);
      if (m && m[1].trim()) {
        return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return '';
}

function classifyModelCategory(name = '') {
  const n = name.toLowerCase();
  if (/grenade|stun|flash|smoke|molotov/.test(n)) return 'utility';
  if (/bomb|c4/.test(n)) return 'prop';
  if (/dust|office|mirage|inferno|map/.test(n)) return 'map';
  if (/agent|sas|balkan|operator|soldier/.test(n)) return 'operator';
  return 'weapon';
}

const CATALOG = [
  { out: 'garam47.glb', uid: '6b2244ba66274c71abdd194d0b04f731', maxAlbedo: 1024, maxData: 1024, label: 'RIFLE | AK-47 (CS2)' },
  { out: 'm4a1s.glb', uid: '4ced85fd77e04b71ade5ab11cb28c529', maxAlbedo: 1024, maxData: 1024, label: 'RIFLE | M4A1-S (CS2)' },
  { out: 'm4a4.glb', uid: 'cfb76a05bfd84ee38ce6663ee3ee5ecf', maxAlbedo: 1024, maxData: 1024, label: 'RIFLE | M4A4 (CS2)' },
  { out: 'awp.glb', uid: '23ad3d7fb46b40e59cab7937654e2691', maxAlbedo: 1024, maxData: 1024, label: 'RIFLE | AWP (CS2)' },
  { out: 'mp9.glb', uid: '3dbcae165cb64385b83bf620b1803c80', maxAlbedo: 1024, maxData: 512, label: 'SMG | MP9 (CS2)' },
  { out: 'deagle.glb', uid: 'ffff93713abe49fbbe62eba3eea2b287', maxAlbedo: 1024, maxData: 1024, label: 'PISTOL | Desert Eagle (CS2)' },
  { out: 'usps.glb', uid: '5e0c452b1e2e4d7c9ea80638a94afaac', maxAlbedo: 1024, maxData: 512, label: 'PISTOL | USP-S (CS2)' },
  { out: 'glock18.glb', uid: 'e28b38177ffb4cbeba93062d2b7fa552', maxAlbedo: 1024, maxData: 512, label: 'PISTOL | Glock-18 (CS2)' },
  { out: 'karambit.glb', uid: 'dfd7606f189a413681305a39b8841ce8', maxAlbedo: 1024, maxData: 1024, label: 'KNIFE | Karambit' },
  { out: 'operator_vanguard.glb', uid: '7f18aaccd0ee4694a36646101a12339e', maxAlbedo: 1024, maxData: 512, label: 'AGENT | SAS Blue (CS2)' },
  { out: 'operator_syndicate.glb', uid: 'a1497ad74c5b41e9a2db063ba1b69aca', maxAlbedo: 1024, maxData: 512, label: 'AGENT | Balkan Dragomir (CS2)' },
  { out: 'c4.glb', uid: 'ca14fcc22cda4b2dbd8bf6c936285bac', maxAlbedo: 512, maxData: 512, label: 'BOMB | C4 Explosive (CS2)' },
  { out: 'grenade.glb', uid: '0a248ad637794f738797e7e2a2325839', maxAlbedo: 512, maxData: 512, label: 'UTILITY | Frag Grenade M67' },
  { out: 'm4a1s_fp.glb', uid: '440c4299f3d64cd897eddcd19400eabb', extractArmsOnly: true, label: 'ARMS | CS2 First-Person Gloved Arms (1Matzh/epal)' },
  { out: 'cs_office.glb', uid: '4e36baec19194164acd47f7cc236d4e6', buildOfficeMap: true, label: 'MAP | CS_OFFICE (CS:GO Real Light version by neominigan)' },
];

async function fetchCollectionModels(collectionUid, headers) {
  const models = [];
  let nextUrl = `https://api.sketchfab.com/v3/collections/${collectionUid}/models`;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) break;
    const data = await res.json();
    if (Array.isArray(data.results)) models.push(...data.results);
    nextUrl = data.next || null;
  }
  return models;
}

async function runGltfTransformPass(filePath) {
  const io = new NodeIO();
  const doc = await io.read(filePath);
  await doc.transform(dedup(), prune());
  await io.write(filePath, doc);
}

async function main() {
  const token = resolveToken();
  const headers = token ? { Authorization: `Token ${token}` } : {};

  console.log(`[Sketchfab] Auditing Collection ${COLLECTION_UID} (https://skfb.ly/pQKYU)...`);
  const collectionModels = await fetchCollectionModels(COLLECTION_UID, headers);
  for (const m of collectionModels) {
    const category = classifyModelCategory(m.name);
    const license = m.license ? m.license.slug || m.license.label : 'standard';
    console.log(
      `  - ${m.name} | uid=${m.uid} | downloadable=${Boolean(m.isDownloadable)} | category=${category} | license=${license}`
    );
  }

  if (!token) {
    console.warn('[Sketchfab] No SKETCHFAB_API_TOKEN found in .env — skipping authenticated /download calls.');
    return;
  }

  const tmpDir = '/tmp/sketchfab_raw';
  const outDir = path.resolve(process.cwd(), 'packages/client/public/models');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const item of CATALOG) {
    const rawPath = path.join(tmpDir, item.out);
    const finalPath = path.join(outDir, item.out);
    console.log(`[Sketchfab] Fetching ${item.label} (${item.uid})...`);
    const metaRes = await fetch(`https://api.sketchfab.com/v3/models/${item.uid}/download`, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    const meta = await metaRes.json();
    const glbUrl = meta?.glb?.url;
    if (!glbUrl) {
      console.warn(`[Sketchfab] Skipping ${item.label}: no GLB archive available.`);
      continue;
    }
    const binRes = await fetch(glbUrl, { signal: AbortSignal.timeout(60000) });
    if (!binRes.ok) {
      console.warn(`[Sketchfab] Download failed for ${item.label}: HTTP ${binRes.status}`);
      continue;
    }
    fs.writeFileSync(rawPath, Buffer.from(await binRes.arrayBuffer()));
    if (item.extractArmsOnly) {
      execFileSync(
        'node',
        ['scripts/build-cs2-arms.mjs', rawPath, path.join(outDir, 'cs2_fps_arms.glb')],
        { stdio: 'inherit' }
      );
    } else if (item.buildOfficeMap) {
      execFileSync(
        'node',
        ['scripts/build-cs-office.mjs', rawPath, finalPath],
        { stdio: 'inherit' }
      );
    } else {
      await runGltfTransformPass(rawPath);
      execFileSync(
        'python3',
        ['scripts/optimize-glb.py', rawPath, finalPath, String(item.maxAlbedo), String(item.maxData)],
        { stdio: 'inherit' }
      );
    }
  }
}

main().catch((err) => {
  console.error('[Sketchfab] Fatal error:', err);
  process.exit(1);
});
