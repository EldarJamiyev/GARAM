#!/usr/bin/env node
/**
 * GARAM: ZERO HOUR — Sketchfab 3D Asset Pipeline
 * Downloads curated CC-BY CS2 / tactical 3D GLB models from Sketchfab using
 * SKETCHFAB_API_TOKEN from process.env or local .env (never hardcoded),
 * then runs scripts/optimize-glb.py to produce lean, web-ready PBR GLBs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function resolveToken() {
  if (process.env.SKETCHFAB_API_TOKEN) return process.env.SKETCHFAB_API_TOKEN.trim();
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf8').match(/^SKETCHFAB_API_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  }
  return '';
}

const CATALOG = [
  { out: 'garam47.glb', uid: '6b2244ba66274c71abdd194d0b04f731', maxAlbedo: 1024, maxData: 1024, label: 'RIFLE | AK-47 (CS2)' },
  { out: 'm4a1s.glb', uid: '4ced85fd77e04b71ade5ab11cb28c529', maxAlbedo: 1024, maxData: 1024, label: 'RIFLE | M4A1-S (CS2)' },
  { out: 'awp.glb', uid: '23ad3d7fb46b40e59cab7937654e2691', maxAlbedo: 1024, maxData: 1024, label: 'RIFLE | AWP (CS2)' },
  { out: 'deagle.glb', uid: 'ffff93713abe49fbbe62eba3eea2b287', maxAlbedo: 1024, maxData: 1024, label: 'PISTOL | Desert Eagle (CS2)' },
  { out: 'karambit.glb', uid: 'dfd7606f189a413681305a39b8841ce8', maxAlbedo: 1024, maxData: 1024, label: 'KNIFE | Karambit' },
  { out: 'operator_vanguard.glb', uid: '7f18aaccd0ee4694a36646101a12339e', maxAlbedo: 1024, maxData: 512, label: 'AGENT | SAS Blue (CS2)' },
  { out: 'operator_syndicate.glb', uid: 'a1497ad74c5b41e9a2db063ba1b69aca', maxAlbedo: 1024, maxData: 512, label: 'AGENT | Balkan Dragomir (CS2)' },
  { out: 'c4.glb', uid: 'ca14fcc22cda4b2dbd8bf6c936285bac', maxAlbedo: 512, maxData: 512, label: 'BOMB | C4 Explosive (CS2)' },
  { out: 'grenade.glb', uid: '0a248ad637794f378797e7e2a2325839', maxAlbedo: 512, maxData: 512, label: 'UTILITY | Frag Grenade M67' },
];

async function main() {
  const token = resolveToken();
  if (!token) {
    console.error('Missing SKETCHFAB_API_TOKEN in environment or .env');
    process.exit(1);
  }
  const headers = { Authorization: `Token ${token}` };
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
    execFileSync(
      'python3',
      ['scripts/optimize-glb.py', rawPath, finalPath, String(item.maxAlbedo), String(item.maxData)],
      { stdio: 'inherit' }
    );
  }
}

main().catch((err) => {
  console.error('[Sketchfab] Fatal error:', err);
  process.exit(1);
});
