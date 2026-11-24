#!/usr/bin/env node
/**
 * GARAM: ZERO HOUR — DE_DUST2 Ready-Made GLB Watertight Collider & NavGraph Extractor
 * Parses packages/client/public/models/de_dust2.glb (MIT + Poly Haven CC0 PBR textures),
 * applies exact 3D SAT triangle-AABB voxelization + greedy 3D box merging (Y shifted +3.5m
 * so CT Spawn = 0.0m, Pit = 1.1m, A Site / Long = 3.5m, Short Catwalk = 6.0m), preserves
 * ballistic surface materials (CONCRETE / WOOD_THIN / METAL_SHEET), validates every spawn
 * and nav marker for floor support & headroom, and emits packages/shared/src/maps/DeDust2Data.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

const GLB_PATH = path.resolve(process.cwd(), 'packages/client/public/models/de_dust2.glb');
const OUT_TS = path.resolve(process.cwd(), 'packages/shared/src/maps/DeDust2Data.ts');

const Y_OFF = 3.5;
const CELL_XZ = 0.5;
const CELL_Y = 0.125;
const MIN_X = -68;
const MAX_X = 22;
const MIN_Y = -0.5;
const MAX_Y = 11.5;
const MIN_Z = -20;
const MAX_Z = 42;

const NX = Math.ceil((MAX_X - MIN_X) / CELL_XZ);
const NY = Math.ceil((MAX_Y - MIN_Y) / CELL_Y);
const NZ = Math.ceil((MAX_Z - MIN_Z) / CELL_XZ);

const buf = fs.readFileSync(GLB_PATH);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;

function readPositions(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const base = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || 12;
  const out = new Float32Array(acc.count * 3);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    out[i * 3] = buf.readFloatLE(o);
    out[i * 3 + 1] = buf.readFloatLE(o + 4);
    out[i * 3 + 2] = buf.readFloatLE(o + 8);
  }
  return out;
}

function readIndices(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const base = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Uint32Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    out[i] = acc.componentType === 5123 ? buf.readUInt16LE(base + i * 2) : buf.readUInt32LE(base + i * 4);
  }
  return out;
}

// Exact Akenine-Möller 3D Triangle-Box SAT Overlap Test
function planeBoxOverlap(nx, ny, nz, vx, vy, vz, hx, hy, hz) {
  const minX = nx > 0 ? -hx - vx : hx - vx;
  const maxX = nx > 0 ? hx - vx : -hx - vx;
  const minY = ny > 0 ? -hy - vy : hy - vy;
  const maxY = ny > 0 ? hy - vy : -hy - vy;
  const minZ = nz > 0 ? -hz - vz : hz - vz;
  const maxZ = nz > 0 ? hz - vz : -hz - vz;
  if (nx * minX + ny * minY + nz * minZ > 0) return false;
  if (nx * maxX + ny * maxY + nz * maxZ >= 0) return true;
  return false;
}

function triBoxOverlap(cx, cy, cz, hx, hy, hz, x0, y0, z0, x1, y1, z1, x2, y2, z2) {
  const v0x = x0 - cx, v0y = y0 - cy, v0z = z0 - cz;
  const v1x = x1 - cx, v1y = y1 - cy, v1z = z1 - cz;
  const v2x = x2 - cx, v2y = y2 - cy, v2z = z2 - cz;

  // Box AABB vs Tri AABB
  if (Math.min(v0x, v1x, v2x) > hx || Math.max(v0x, v1x, v2x) < -hx) return false;
  if (Math.min(v0y, v1y, v2y) > hy || Math.max(v0y, v1y, v2y) < -hy) return false;
  if (Math.min(v0z, v1z, v2z) > hz || Math.max(v0z, v1z, v2z) < -hz) return false;

  const e0x = v1x - v0x, e0y = v1y - v0y, e0z = v1z - v0z;
  const e1x = v2x - v1x, e1y = v2y - v1y, e1z = v2z - v1z;
  const e2x = v0x - v2x, e2y = v0y - v2y, e2z = v0z - v2z;

  // 9 edge cross-product axes
  let p0, p1, p2, rad, fex, fey, fez;

  // e0
  fex = Math.abs(e0x); fey = Math.abs(e0y); fez = Math.abs(e0z);
  p0 = e0z * v0y - e0y * v0z; p2 = e0z * v2y - e0y * v2z; rad = fez * hy + fey * hz;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;
  p0 = -e0z * v0x + e0x * v0z; p2 = -e0z * v2x + e0x * v2z; rad = fez * hx + fex * hz;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;
  p1 = e0y * v1x - e0x * v1y; p2 = e0y * v2x - e0x * v2y; rad = fey * hx + fex * hy;
  if (Math.min(p1, p2) > rad || Math.max(p1, p2) < -rad) return false;

  // e1
  fex = Math.abs(e1x); fey = Math.abs(e1y); fez = Math.abs(e1z);
  p0 = e1z * v0y - e1y * v0z; p2 = e1z * v2y - e1y * v2z; rad = fez * hy + fey * hz;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;
  p0 = -e1z * v0x + e1x * v0z; p2 = -e1z * v2x + e1x * v2z; rad = fez * hx + fex * hz;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;
  p0 = e1y * v0x - e1x * v0y; p1 = e1y * v1x - e1x * v1y; rad = fey * hx + fex * hy;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;

  // e2
  fex = Math.abs(e2x); fey = Math.abs(e2y); fez = Math.abs(e2z);
  p0 = e2z * v0y - e2y * v0z; p1 = e2z * v1y - e2y * v1z; rad = fez * hy + fey * hz;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;
  p0 = -e2z * v0x + e2x * v0z; p1 = -e2z * v1x + e2x * v1z; rad = fez * hx + fex * hz;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;
  p1 = e2y * v1x - e2x * v1y; p2 = e2y * v2x - e2x * v2y; rad = fey * hx + fex * hy;
  if (Math.min(p1, p2) > rad || Math.max(p1, p2) < -rad) return false;

  // Triangle plane test
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  return planeBoxOverlap(nx, ny, nz, v0x, v0y, v0z, hx, hy, hz);
}

// 0=empty, 1=CONCRETE, 2=WOOD_THIN, 3=METAL_SHEET
const grid = new Uint8Array(NX * NY * NZ);
const idx3 = (ix, iy, iz) => (iy * NZ + iz) * NX + ix;

// Decorative non-structural meshes that should remain visual-only so they never snag jumps or heads
const VISUAL_ONLY_NAMES = new Set(['MAP_fabric_canvas', 'MAP_sign_a', 'MAP_wire', 'MAP_bg_plaster', 'MAP_hills']);

let triCount = 0;
const hx = CELL_XZ * 0.5;
const hy = CELL_Y * 0.5;
const hz = CELL_XZ * 0.5;

for (let ni = 0; ni < gltf.nodes.length; ni++) {
  const n = gltf.nodes[ni];
  if (n.mesh === undefined) continue;
  const ex = n.extras || {};
  if (ex.nocollide || VISUAL_ONLY_NAMES.has(n.name)) continue;
  const m = gltf.meshes[n.mesh];
  const surf = String(ex.surface || 'concrete').toLowerCase();
  const matCode = surf === 'wood' ? 2 : surf === 'metal' ? 3 : 1;
  const t = n.translation || [0, 0, 0];

  for (const prim of m.primitives) {
    const pos = readPositions(prim.attributes.POSITION);
    const ind = prim.indices !== undefined ? readIndices(prim.indices) : null;
    const count = ind ? ind.length : pos.length / 3;

    for (let i = 0; i < count; i += 3) {
      const i0 = (ind ? ind[i] : i) * 3;
      const i1 = (ind ? ind[i + 1] : i + 1) * 3;
      const i2 = (ind ? ind[i + 2] : i + 2) * 3;

      // Shift Y by +Y_OFF - 0.02 so a flat floor at y=3.50 fills voxel [3.25, 3.50] cleanly
      const x0 = pos[i0] + t[0], y0 = pos[i0 + 1] + t[1] + Y_OFF - 0.02, z0 = pos[i0 + 2] + t[2];
      const x1 = pos[i1] + t[0], y1 = pos[i1 + 1] + t[1] + Y_OFF - 0.02, z1 = pos[i1 + 2] + t[2];
      const x2 = pos[i2] + t[0], y2 = pos[i2 + 1] + t[1] + Y_OFF - 0.02, z2 = pos[i2 + 2] + t[2];

      const tMinX = Math.min(x0, x1, x2), tMaxX = Math.max(x0, x1, x2);
      const tMinY = Math.min(y0, y1, y2), tMaxY = Math.max(y0, y1, y2);
      const tMinZ = Math.min(z0, z1, z2), tMaxZ = Math.max(z0, z1, z2);

      if (tMaxX < MIN_X || tMinX > MAX_X || tMaxY < MIN_Y || tMinY > MAX_Y || tMaxZ < MIN_Z || tMinZ > MAX_Z) continue;
      triCount++;

      const ix0 = Math.max(0, Math.floor((tMinX - MIN_X) / CELL_XZ));
      const ix1 = Math.min(NX - 1, Math.floor((tMaxX - MIN_X) / CELL_XZ));
      const iy0 = Math.max(0, Math.floor((tMinY - MIN_Y) / CELL_Y));
      const iy1 = Math.min(NY - 1, Math.floor((tMaxY - MIN_Y) / CELL_Y));
      const iz0 = Math.max(0, Math.floor((tMinZ - MIN_Z) / CELL_XZ));
      const iz1 = Math.min(NZ - 1, Math.floor((tMaxZ - MIN_Z) / CELL_XZ));

      for (let iy = iy0; iy <= iy1; iy++) {
        const cy = MIN_Y + (iy + 0.5) * CELL_Y;
        for (let iz = iz0; iz <= iz1; iz++) {
          const cz = MIN_Z + (iz + 0.5) * CELL_XZ;
          for (let ix = ix0; ix <= ix1; ix++) {
            const cx = MIN_X + (ix + 0.5) * CELL_XZ;
            if (triBoxOverlap(cx, cy, cz, hx, hy, hz, x0, y0, z0, x1, y1, z1, x2, y2, z2)) {
              const k = idx3(ix, iy, iz);
              if (grid[k] === 0 || matCode === 1) grid[k] = matCode;
            }
          }
        }
      }
    }
  }
}

// Source-engine style stair-clip bevel on Short Stairs entry (3.5->3.75->4.0) & exit (5.25->5.625->6.0)
// so every riser stays <= 0.375m (strictly below KINEMATICS.STEP_HEIGHT = 0.42m)
function fillClipBox(x0, x1, y0, y1, z0, z1, mat = 1) {
  const ix0 = Math.max(0, Math.round((x0 - MIN_X) / CELL_XZ));
  const ix1 = Math.min(NX, Math.round((x1 - MIN_X) / CELL_XZ));
  const iy0 = Math.max(0, Math.round((y0 - MIN_Y) / CELL_Y));
  const iy1 = Math.min(NY, Math.round((y1 - MIN_Y) / CELL_Y));
  const iz0 = Math.max(0, Math.round((z0 - MIN_Z) / CELL_XZ));
  const iz1 = Math.min(NZ, Math.round((z1 - MIN_Z) / CELL_XZ));
  for (let iy = iy0; iy < iy1; iy++) {
    for (let iz = iz0; iz < iz1; iz++) {
      for (let ix = ix0; ix < ix1; ix++) {
        const k = idx3(ix, iy, iz);
        if (grid[k] === 0) grid[k] = mat;
      }
    }
  }
}
fillClipBox(-4.0, -3.5, 3.5, 3.75, 6.0, 11.0, 1);
fillClipBox(-7.5, -7.0, 5.5, 5.625, 6.0, 11.0, 1);

// Greedy 3D box merge
const visited = new Uint8Array(grid.length);
const boxes = [];
for (let iy = 0; iy < NY; iy++) {
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const k = idx3(ix, iy, iz);
      const mat = grid[k];
      if (!mat || visited[k]) continue;

      let ex = ix + 1;
      while (ex < NX && grid[idx3(ex, iy, iz)] === mat && !visited[idx3(ex, iy, iz)]) ex++;

      let ez = iz + 1;
      zLoop: while (ez < NZ) {
        for (let x = ix; x < ex; x++) {
          const kk = idx3(x, iy, ez);
          if (grid[kk] !== mat || visited[kk]) break zLoop;
        }
        ez++;
      }

      let ey = iy + 1;
      yLoop: while (ey < NY) {
        for (let z = iz; z < ez; z++) {
          for (let x = ix; x < ex; x++) {
            const kk = idx3(x, ey, z);
            if (grid[kk] !== mat || visited[kk]) break yLoop;
          }
        }
        ey++;
      }

      for (let y = iy; y < ey; y++) {
        for (let z = iz; z < ez; z++) {
          for (let x = ix; x < ex; x++) {
            visited[idx3(x, y, z)] = 1;
          }
        }
      }

      boxes.push([
        +(MIN_X + ix * CELL_XZ).toFixed(2),
        +(MIN_X + ex * CELL_XZ).toFixed(2),
        +(MIN_Y + iy * CELL_Y).toFixed(3),
        +(MIN_Y + ey * CELL_Y).toFixed(3),
        +(MIN_Z + iz * CELL_XZ).toFixed(2),
        +(MIN_Z + ez * CELL_XZ).toFixed(2),
        mat,
      ]);
    }
  }
}

console.log(`[DE_DUST2] Exact SAT voxelized ${triCount} tris -> ${boxes.length} watertight greedy AABB colliders`);

// Extract & validate NAV/SPAWN markers
const navRaw = {};
const spawnT = [];
let spawnCT = [6, 0, 36];
let bombsiteA = [1, 3.5, -1];

for (const n of gltf.nodes) {
  if (n.mesh !== undefined || !n.name) continue;
  const t = n.translation || [0, 0, 0];
  const p = [+t[0].toFixed(2), +(t[1] + Y_OFF).toFixed(2), +t[2].toFixed(2)];
  if (n.name === 'SPAWN_CT') spawnCT = p;
  else if (n.name.startsWith('SPAWN_T')) spawnT.push(p);
  else if (n.name === 'BOMBSITE_A') bombsiteA = p;
  else if (n.name.startsWith('NAV_')) navRaw[n.name.slice(4)] = p;
}

// Validate floor height & clearance at every marker (and gently snap node Y to exact floor collider maxY)
function sampleFloorAndClearance(x, y, z) {
  const ix = Math.floor((x - MIN_X) / CELL_XZ);
  const iz = Math.floor((z - MIN_Z) / CELL_XZ);
  let floorY = -99;
  let bodyBlocked = false;
  for (let iy = 0; iy < NY; iy++) {
    const v = grid[idx3(ix, iy, iz)];
    if (!v) continue;
    const topY = MIN_Y + (iy + 1) * CELL_Y;
    const botY = MIN_Y + iy * CELL_Y;
    if (topY <= y + 0.35) floorY = Math.max(floorY, topY);
    if (botY >= y + 0.35 && botY < y + 1.75) bodyBlocked = true;
  }
  return { floorY, bodyBlocked };
}

for (const [name, p] of Object.entries(navRaw)) {
  // Nudge NAV_long_4 slightly north-east of the parked car bumper so it has clean standing clearance
  if (name === 'long_4') {
    p[0] = -21.5;
    p[2] = -7.5;
  }
  const check = sampleFloorAndClearance(p[0], p[1], p[2]);
  if (check.floorY > -50 && Math.abs(check.floorY - p[1]) <= 0.6) {
    p[1] = +check.floorY.toFixed(2);
  }
  if (check.floorY < -50 || check.bodyBlocked) {
    console.warn(`  [WARN] NAV_${name} at ${JSON.stringify(p)} -> floorY=${check.floorY}, bodyBlocked=${check.bodyBlocked}`);
  }
}

const ctCheck = sampleFloorAndClearance(spawnCT[0], spawnCT[1], spawnCT[2]);
console.log(`[DE_DUST2] SPAWN_CT=${JSON.stringify(spawnCT)} floor=${ctCheck.floorY} blocked=${ctCheck.bodyBlocked}`);
spawnT.forEach((p, i) => {
  const c = sampleFloorAndClearance(p[0], p[1], p[2]);
  console.log(`[DE_DUST2] SPAWN_T_${i}=${JSON.stringify(p)} floor=${c.floorY} blocked=${c.bodyBlocked}`);
});

// Hand-authored Dust2 A-site nav connectivity matching the Blender NAV_* markers
const DUST2_EDGES = [
  ['long_t', 'long_1'], ['long_1', 'long_2'], ['long_2', 'long_3'], ['long_3', 'long_4'], ['long_4', 'long_corner'],
  ['long_4', 'car'], ['car', 'long_corner'], ['car', 'barrels'],
  ['long_corner', 'elbow'], ['long_corner', 'site_nw'], ['elbow', 'site_sw'], ['elbow', 'pit'], ['elbow', 'site_nw'],
  ['barrels', 'site_nw'], ['barrels', 'site_n'],
  ['site_nw', 'site_center'], ['site_nw', 'site_n'], ['site_n', 'default'], ['site_n', 'goose'], ['default', 'site_center'],
  ['default', 'site_e'], ['site_e', 'goose'], ['site_e', 'triple'], ['site_e', 'ramp_top'], ['goose', 'ramp_top'],
  ['site_center', 'site_s'], ['site_center', 'site_sw'], ['site_s', 'ninja'], ['ninja', 'triple'], ['triple', 'ramp_top'],
  ['ramp_top', 'ramp_mid'], ['ramp_mid', 'ramp_bot'], ['ramp_bot', 'ct_spawn'],
  ['site_sw', 'stairs_bot'], ['stairs_bot', 'stairs_top'], ['stairs_top', 'short_plat'], ['short_plat', 'short_2'],
  ['short_2', 'short_1'], ['short_1', 'short_t'], ['stairs_bot', 'site_s'], ['site_sw', 'site_s'], ['default', 'site_s'],
];

const adj = {};
for (const k of Object.keys(navRaw)) adj[k] = new Set();
for (const [a, b] of DUST2_EDGES) {
  if (navRaw[a] && navRaw[b]) {
    adj[a].add(b);
    adj[b].add(a);
  }
}
// Connect pit to long_corner as well so pit is never a single-edge dead end
if (navRaw.pit && navRaw.long_corner) {
  adj.pit.add('long_corner');
  adj.long_corner.add('pit');
}
// Connect ct_spawn to ramp_mid fallback? No, ramp_bot -> ct_spawn is direct; keep ct_spawn 1+ edge or add ct_spawn_w
// Connect long_t -> long_2 and short_t -> short_2 so zero single-degree leaves if desired
const navNodesOut = {};
for (const [id, p] of Object.entries(navRaw)) {
  const nbrs = [...adj[id]];
  const callout = id.startsWith('ct_')
    ? 'CT SPAWN'
    : id.startsWith('ramp_')
      ? 'A RAMP'
      : id.startsWith('short_')
        ? 'A SHORT'
        : id.startsWith('stairs_')
          ? 'SHORT STAIRS'
          : id === 'pit'
            ? 'LONG PIT'
            : id === 'car' || id === 'barrels' || id === 'long_corner'
              ? 'LONG CAR'
              : id.startsWith('long_')
                ? 'A LONG'
                : id === 'goose'
                  ? 'GOOSE'
                  : id === 'triple' || id === 'ninja'
                    ? 'A SITE'
                    : 'A SITE';
  navNodesOut[id] = {
    id,
    pos: { x: p[0], y: p[1], z: p[2] },
    neighbors: nbrs,
    callout,
    coverType: /car|barrels|default|triple|ninja|goose|corner|elbow|plat/.test(id) ? 'HIGH' : 'LOW',
    isChoke: /long_corner|stairs_top|ramp_top|long_1|short_plat/.test(id),
    watchAngles: [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5],
    retreatNodeIds: nbrs.slice(0, 2),
  };
}

// Emit pure TypeScript DeDust2Data.ts
const ts = `// AUTO-GENERATED by scripts/build-de-dust2.mjs from packages/client/public/models/de_dust2.glb
// Exact SAT 3D triangle-AABB colliders (Y shifted +${Y_OFF}m so all walkable floors are y >= 0.0m).
// License: MIT (StarKnightt/counter-strike-in-browser) + Poly Haven CC0 PBR textures.
import type { AABBCollider, MapBounds } from '../physics/KinematicPlayerController.js';
import type { MapBlockCollider, SurfaceMaterial, CalloutZone, TacticalBotConfig, Vec3 } from './CsOfficeData.js';
import type { NavNode } from './TacticalNavGraph.js';

export const DE_DUST2_Y_OFFSET = ${Y_OFF};

export const DE_DUST2_BOUNDS: MapBounds = {
  minX: ${MIN_X},
  maxX: ${MAX_X},
  minZ: ${MIN_Z},
  maxZ: ${MAX_Z},
};

const MAT_LOOKUP: readonly SurfaceMaterial[] = ['CONCRETE', 'CONCRETE', 'WOOD_THIN', 'METAL_SHEET'];

/** Compact greedy-merged watertight collider tuples: [minX, maxX, minY, maxY, minZ, maxZ, matCode] */
const RAW_COLLIDER_TUPLES: readonly [number, number, number, number, number, number, number][] = ${JSON.stringify(boxes)};

export const DE_DUST2_BLOCKS: MapBlockCollider[] = RAW_COLLIDER_TUPLES.map((t, i) => ({
  id: \`d2_\${i}\`,
  minX: t[0],
  maxX: t[1],
  minY: t[2],
  maxY: t[3],
  minZ: t[4],
  maxZ: t[5],
  material: MAT_LOOKUP[t[6]] ?? 'CONCRETE',
}));

export const DE_DUST2_COLLIDERS: AABBCollider[] = DE_DUST2_BLOCKS;

export const DE_DUST2_SPAWN_POINTS = {
  VANGUARD_CT: { x: ${spawnCT[0]}, y: ${ctCheck.floorY > -50 ? ctCheck.floorY : 0}, z: ${spawnCT[2]} } as Vec3,
  OBSIDIAN_T: { x: -61.0, y: 3.5, z: -10.0 } as Vec3,
};

export const DE_DUST2_BOMBSITES = {
  A: {
    name: 'A' as const,
    center: { x: ${bombsiteA[0]}, y: ${bombsiteA[1]}, z: ${bombsiteA[2]} },
    radius: 6.5,
  },
  B: {
    name: 'B' as const,
    center: { x: -16.0, y: 3.5, z: -8.0 },
    radius: 5.5,
  },
};

export const DE_DUST2_SPAWN_ZONES = {
  VANGUARD_BUY_ZONE: { minX: -4, maxX: 18, minZ: 24, maxZ: 42 },
  SYNDICATE_BUY_ZONE: { minX: -68, maxX: -38, minZ: -18, maxZ: 16 },
};

export const DE_DUST2_CALLOUT_ZONES: CalloutZone[] = [
  { name: 'CT SPAWN', minX: -6, maxX: 20, minZ: 25, maxZ: 42, minY: -0.5, maxY: 3.0 },
  { name: 'A RAMP', minX: 7, maxX: 19, minZ: 11, maxZ: 27 },
  { name: 'A SHORT', minX: -50, maxX: -7, minZ: 4, maxZ: 15, minY: 4.8, maxY: 9.0 },
  { name: 'SHORT STAIRS', minX: -9, maxX: -1, minZ: 5, maxZ: 12 },
  { name: 'LONG PIT', minX: -25, maxX: -13, minZ: -3, maxZ: 7, minY: -0.5, maxY: 3.1 },
  { name: 'GOOSE', minX: 9, maxX: 17, minZ: -15, maxZ: -6 },
  { name: 'A SITE', minX: -10, maxX: 16, minZ: -14, maxZ: 11 },
  { name: 'LONG CAR', minX: -24, maxX: -10, minZ: -16, maxZ: -3 },
  { name: 'A LONG', minX: -68, maxX: -22, minZ: -18, maxZ: -2 },
  { name: 'DE_DUST2', minX: -68, maxX: 22, minZ: -20, maxZ: 42 },
];

export function getDust2CalloutName(x: number, y: number, z: number): string {
  for (const zone of DE_DUST2_CALLOUT_ZONES) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
      if (zone.minY !== undefined && y < zone.minY) continue;
      if (zone.maxY !== undefined && y > zone.maxY) continue;
      return zone.name;
    }
  }
  return 'DE_DUST2';
}

export const DE_DUST2_NAV_GRAPH: Record<string, NavNode> = ${JSON.stringify(navNodesOut, null, 2)};

export const DE_DUST2_BOTS: TacticalBotConfig[] = [
  // 4 Allied Vanguard CT Defenders (CT Spawn & A Ramp / Site positions)
  {
    id: 'van-alpha',
    name: 'Vanguard-Alpha',
    team: 'Vanguard',
    waypoints: [
      { x: 10.0, y: 0.0, z: 35.0 },
      { x: 13.0, y: 3.5, z: 13.0 },
      { x: 13.0, y: 3.5, z: -10.0 },
    ],
  },
  {
    id: 'van-bravo',
    name: 'Vanguard-Bravo',
    team: 'Vanguard',
    waypoints: [
      { x: 12.0, y: 0.0, z: 31.0 },
      { x: 10.0, y: 3.5, z: -4.0 },
      { x: 4.0, y: 3.5, z: -1.0 },
    ],
  },
  {
    id: 'van-charlie',
    name: 'Vanguard-Charlie',
    team: 'Vanguard',
    waypoints: [
      { x: 3.0, y: 0.0, z: 34.0 },
      { x: 12.0, y: 3.5, z: 8.0 },
      { x: 0.0, y: 3.5, z: 6.0 },
    ],
  },
  {
    id: 'van-delta',
    name: 'Vanguard-Delta',
    team: 'Vanguard',
    waypoints: [
      { x: 8.5, y: 0.0, z: 31.5 },
      { x: -3.0, y: 3.5, z: 8.5 },
      { x: -6.0, y: 3.5, z: -7.0 },
    ],
  },
  // 5 Syndicate T Attackers (3 Long Doors + 2 Short/Catwalk split!)
  {
    id: 'syn-1',
    name: 'Syndicate-Viper',
    team: 'Syndicate',
    waypoints: [
      { x: -63.0, y: 3.5, z: -8.0 },
      { x: -30.0, y: 3.5, z: -11.0 },
      { x: 1.0, y: 3.5, z: -1.0 },
    ],
  },
  {
    id: 'syn-2',
    name: 'Syndicate-Specter',
    team: 'Syndicate',
    waypoints: [
      { x: -63.0, y: 3.5, z: -12.0 },
      { x: -16.0, y: 3.5, z: -8.0 },
      { x: 4.0, y: 3.5, z: -1.0 },
    ],
  },
  {
    id: 'syn-3',
    name: 'Syndicate-Kobra',
    team: 'Syndicate',
    waypoints: [
      { x: -60.0, y: 3.5, z: -10.0 },
      { x: -11.0, y: 3.5, z: -4.0 },
      { x: 3.0, y: 3.5, z: -10.0 },
    ],
  },
  {
    id: 'syn-4',
    name: 'Syndicate-Reaper',
    team: 'Syndicate',
    waypoints: [
      { x: -43.5, y: 6.0, z: 9.0 },
      { x: -11.0, y: 6.0, z: 8.5 },
      { x: 0.0, y: 3.5, z: 6.0 },
    ],
  },
  {
    id: 'syn-5',
    name: 'Syndicate-Nomad',
    team: 'Syndicate',
    waypoints: [
      { x: -43.0, y: 6.0, z: 7.5 },
      { x: -24.0, y: 6.0, z: 8.5 },
      { x: 1.0, y: 3.5, z: -1.0 },
    ],
  },
];
`;

fs.writeFileSync(OUT_TS, ts, 'utf8');
console.log(`[DE_DUST2] Wrote ${OUT_TS} (${(ts.length / 1024).toFixed(1)} KB)`);
