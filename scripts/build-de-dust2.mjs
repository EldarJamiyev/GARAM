#!/usr/bin/env node
/**
 * GARAM: ZERO HOUR — DE_DUST2 Real Baked-Lightmap GLB Watertight Collider & NavGraph Extractor
 * Parses packages/client/public/models/de_dust2.glb (de_dust_2_with_real_light.glb),
 * recursively evaluates the 4x4 GLTF node transform hierarchy, applies exact 3D SAT
 * triangle-AABB voxelization + greedy 3D box merging (Y shifted +3.3m so CT Spawn
 * underpass = 1.125m, Long Pit = 0.625–1.375m, Mid / Long / T Spawn = 3.375m,
 * A Site / Short Platform = 5.0m, Goose = 5.25m), assigns ballistic surface materials
 * (CONCRETE / WOOD_THIN / METAL_SHEET), validates every spawn and nav marker for
 * floor support & headroom, and emits packages/shared/src/maps/DeDust2Data.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

const GLB_PATH = path.resolve(process.cwd(), 'packages/client/public/models/de_dust2.glb');
const OUT_TS = path.resolve(process.cwd(), 'packages/shared/src/maps/DeDust2Data.ts');

const WORLD_SCALE = 1.48;
const Y_OFF = +(3.3 * WORLD_SCALE).toFixed(3); // 4.884m so CT underpass ~1.67m, Long/Mid/T ~5.0m, A Site ~7.4m
const CELL_XZ = 0.32;
const CELL_Y = 0.125;
const MIN_X = Math.floor(-45 * WORLD_SCALE);
const MAX_X = Math.ceil(34 * WORLD_SCALE);
const MIN_Y = -0.5;
const MAX_Y = Math.ceil(11.0 * WORLD_SCALE);
const MIN_Z = Math.floor(-66 * WORLD_SCALE);
const MAX_Z = Math.ceil(27 * WORLD_SCALE);

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
    out[i] =
      acc.componentType === 5121
        ? buf.readUInt8(base + i)
        : acc.componentType === 5123
          ? buf.readUInt16LE(base + i * 2)
          : buf.readUInt32LE(base + i * 4);
  }
  return out;
}

// Column-major 4x4 matrix helpers matching GLTF 2.0 specification
function mulMat4(a, b) {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[k * 4 + r] * b[c * 4 + k];
      }
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function trsToMat4(n) {
  if (n.matrix) return Float64Array.from(n.matrix);
  const t = n.translation || [0, 0, 0];
  const s = n.scale || [1, 1, 1];
  const q = n.rotation || [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[0], sy = s[1], sz = s[2];
  return Float64Array.from([
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ]);
}

function applyMat4(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

const worldMats = new Array(gltf.nodes.length);
function computeWorldMatrices(nodeIdx, parentMat) {
  const n = gltf.nodes[nodeIdx];
  const local = trsToMat4(n);
  const world = parentMat ? mulMat4(parentMat, local) : local;
  worldMats[nodeIdx] = world;
  for (const childIdx of n.children || []) {
    computeWorldMatrices(childIdx, world);
  }
}
const rootNodes = gltf.scenes?.[0]?.nodes || [0];
for (const rn of rootNodes) {
  computeWorldMatrices(rn, null);
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

  if (Math.min(v0x, v1x, v2x) > hx || Math.max(v0x, v1x, v2x) < -hx) return false;
  if (Math.min(v0y, v1y, v2y) > hy || Math.max(v0y, v1y, v2y) < -hy) return false;
  if (Math.min(v0z, v1z, v2z) > hz || Math.max(v0z, v1z, v2z) < -hz) return false;

  const e0x = v1x - v0x, e0y = v1y - v0y, e0z = v1z - v0z;
  const e1x = v2x - v1x, e1y = v2y - v1y, e1z = v2z - v1z;
  const e2x = v0x - v2x, e2y = v0y - v2y, e2z = v0z - v2z;

  let p0, p1, p2, rad, fex, fey, fez;

  fex = Math.abs(e0x); fey = Math.abs(e0y); fez = Math.abs(e0z);
  p0 = e0z * v0y - e0y * v0z; p2 = e0z * v2y - e0y * v2z; rad = fez * hy + fey * hz;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;
  p0 = -e0z * v0x + e0x * v0z; p2 = -e0z * v2x + e0x * v2z; rad = fez * hx + fex * hz;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;
  p1 = e0y * v1x - e0x * v1y; p2 = e0y * v2x - e0x * v2y; rad = fey * hx + fex * hy;
  if (Math.min(p1, p2) > rad || Math.max(p1, p2) < -rad) return false;

  fex = Math.abs(e1x); fey = Math.abs(e1y); fez = Math.abs(e1z);
  p0 = e1z * v0y - e1y * v0z; p2 = e1z * v2y - e1y * v2z; rad = fez * hy + fey * hz;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;
  p0 = -e1z * v0x + e1x * v0z; p2 = -e1z * v2x + e1x * v2z; rad = fez * hx + fex * hz;
  if (Math.min(p0, p2) > rad || Math.max(p0, p2) < -rad) return false;
  p0 = e1y * v0x - e1x * v0y; p1 = e1y * v1x - e1x * v1y; rad = fey * hx + fex * hy;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;

  fex = Math.abs(e2x); fey = Math.abs(e2y); fez = Math.abs(e2z);
  p0 = e2z * v0y - e2y * v0z; p1 = e2z * v1y - e2y * v1z; rad = fez * hy + fey * hz;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;
  p0 = -e2z * v0x + e2x * v0z; p1 = -e2z * v1x + e2x * v1z; rad = fez * hx + fex * hz;
  if (Math.min(p0, p1) > rad || Math.max(p0, p1) < -rad) return false;
  p1 = e2y * v1x - e2x * v1y; p2 = e2y * v2x - e2x * v2y; rad = fey * hx + fex * hy;
  if (Math.min(p1, p2) > rad || Math.max(p1, p2) < -rad) return false;

  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  return planeBoxOverlap(nx, ny, nz, v0x, v0y, v0z, hx, hy, hz);
}

// 0=empty, 1=CONCRETE, 2=WOOD_THIN, 3=METAL_SHEET
const grid = new Uint8Array(NX * NY * NZ);
const idx3 = (ix, iy, iz) => (iy * NZ + iz) * NX + ix;

function classifyVoxelMaterial(cx, cy, cz) {
  const ux = cx / WORLD_SCALE;
  const uy = cy / WORLD_SCALE;
  const uz = cz / WORLD_SCALE;
  // Elevated crates & double-door frames on A-Site, B-Site, and Mid/Long Doors -> WOOD_THIN (2)
  if (uy >= 3.45 && ux >= 13 && ux <= 22 && uz >= -48 && uz <= -40) return 2;
  if (uy >= 3.45 && ux >= -38 && ux <= -24 && uz >= -46 && uz <= -32) return 2;
  if (uy >= 1.25 && ux >= -9 && ux <= -4 && uz >= -29 && uz <= -24) return 2;
  // Long A Car, Dumpsters & Barrels -> METAL_SHEET (3)
  if (uy >= 3.45 && ux >= 19 && ux <= 28 && uz >= -32 && uz <= -14) return 3;
  return 1;
}

let triCount = 0;
const hy = CELL_Y * 0.5;

for (let ni = 0; ni < gltf.nodes.length; ni++) {
  const n = gltf.nodes[ni];
  if (n.mesh === undefined) continue;
  const m = gltf.meshes[n.mesh];
  const wm = worldMats[ni] || trsToMat4(n);

  for (const prim of m.primitives) {
    const pos = readPositions(prim.attributes.POSITION);
    const ind = prim.indices !== undefined ? readIndices(prim.indices) : null;
    const count = ind ? ind.length : pos.length / 3;

    for (let i = 0; i < count; i += 3) {
      const i0 = (ind ? ind[i] : i) * 3;
      const i1 = (ind ? ind[i + 1] : i + 1) * 3;
      const i2 = (ind ? ind[i + 2] : i + 2) * 3;

      const p0 = applyMat4(wm, pos[i0], pos[i0 + 1], pos[i0 + 2]);
      const p1 = applyMat4(wm, pos[i1], pos[i1 + 1], pos[i1 + 2]);
      const p2 = applyMat4(wm, pos[i2], pos[i2 + 1], pos[i2 + 2]);

      const x0 = p0[0] * WORLD_SCALE, y0 = p0[1] * WORLD_SCALE + Y_OFF - 0.02, z0 = p0[2] * WORLD_SCALE;
      const x1 = p1[0] * WORLD_SCALE, y1 = p1[1] * WORLD_SCALE + Y_OFF - 0.02, z1 = p1[2] * WORLD_SCALE;
      const x2 = p2[0] * WORLD_SCALE, y2 = p2[1] * WORLD_SCALE + Y_OFF - 0.02, z2 = p2[2] * WORLD_SCALE;

      const tMinX = Math.min(x0, x1, x2), tMaxX = Math.max(x0, x1, x2);
      const tMinY = Math.min(y0, y1, y2), tMaxY = Math.max(y0, y1, y2);
      const tMinZ = Math.min(z0, z1, z2), tMaxZ = Math.max(z0, z1, z2);

      if (tMaxX < MIN_X || tMinX > MAX_X || tMaxY < MIN_Y || tMinY > MAX_Y || tMaxZ < MIN_Z || tMinZ > MAX_Z) continue;
      triCount++;

      // Keep watertight full XZ half-extent on floors/ramps (|ny| >= 0.45),
      // but use tight half-extent on near-vertical walls/door leaves so thin angled doors never bloat shut!
      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
      const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      const cnx = uy * vz - uz * vy;
      const cny = uz * vx - ux * vz;
      const cnz = ux * vy - uy * vx;
      const cnLen = Math.hypot(cnx, cny, cnz) || 1;
      const isVerticalWall = Math.abs(cny / cnLen) < 0.45;
      const hx = isVerticalWall ? CELL_XZ * 0.28 : CELL_XZ * 0.5;
      const hz = isVerticalWall ? CELL_XZ * 0.28 : CELL_XZ * 0.5;

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
              const matCode = classifyVoxelMaterial(cx, cy, cz);
              if (grid[k] === 0) grid[k] = matCode;
            }
          }
        }
      }
    }
  }
}

// Smooth Short Stairs risers at 1.48x scale so every step stays strictly <= 0.25m (well below STEP_HEIGHT = 0.42m)
{
  const sx0 = Math.max(0, Math.floor((6.0 - MIN_X) / CELL_XZ));
  const sx1 = Math.min(NX - 1, Math.floor((10.6 - MIN_X) / CELL_XZ));
  const sz0 = Math.max(0, Math.floor((-46.8 - MIN_Z) / CELL_XZ));
  const sz1 = Math.min(NZ - 1, Math.floor((-40.2 - MIN_Z) / CELL_XZ));
  const topFloorIy = (ix, iz) => {
    for (let iy = Math.floor((7.6 - MIN_Y) / CELL_Y); iy >= Math.floor((4.5 - MIN_Y) / CELL_Y); iy--) {
      if (grid[idx3(ix, iy, iz)]) return iy;
    }
    return -1;
  };
  for (let ix = sx0; ix <= sx1; ix++) {
    for (let iz = sz1; iz > sz0; iz--) {
      const lo = topFloorIy(ix, iz);
      const hi = topFloorIy(ix, iz - 1);
      if (lo > 0 && hi > lo && hi - lo >= 4 && hi - lo <= 6) {
        const mid = lo + Math.floor((hi - lo) / 2);
        for (let iy = lo + 1; iy <= mid; iy++) {
          if (grid[idx3(ix, iy, iz)] === 0) grid[idx3(ix, iy, iz)] = 1;
        }
      }
    }
  }
}

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

function sampleFloorAndClearance(x, y, z) {
  const ix = Math.floor((x - MIN_X) / CELL_XZ);
  const iz = Math.floor((z - MIN_Z) / CELL_XZ);
  let floorY = -99;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const cix = ix + dx;
      const ciz = iz + dz;
      if (cix < 0 || cix >= NX || ciz < 0 || ciz >= NZ) continue;
      const cellMinX = MIN_X + cix * CELL_XZ;
      const cellMaxX = cellMinX + CELL_XZ;
      const cellMinZ = MIN_Z + ciz * CELL_XZ;
      const cellMaxZ = cellMinZ + CELL_XZ;
      const distX = Math.max(cellMinX - x, 0, x - cellMaxX);
      const distZ = Math.max(cellMinZ - z, 0, z - cellMaxZ);
      if (distX * distX + distZ * distZ >= 0.38 * 0.38) continue;
      for (let iy = 0; iy < NY; iy++) {
        if (!grid[idx3(cix, iy, ciz)]) continue;
        const topY = MIN_Y + (iy + 1) * CELL_Y;
        if (topY <= y + 0.55) floorY = Math.max(floorY, topY);
      }
    }
  }
  const fy = floorY > -50 ? floorY : y;
  let bodyBlocked = floorY < -50;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const cix = ix + dx;
      const ciz = iz + dz;
      if (cix < 0 || cix >= NX || ciz < 0 || ciz >= NZ) continue;
      const cellMinX = MIN_X + cix * CELL_XZ;
      const cellMaxX = cellMinX + CELL_XZ;
      const cellMinZ = MIN_Z + ciz * CELL_XZ;
      const cellMaxZ = cellMinZ + CELL_XZ;
      const distX = Math.max(cellMinX - x, 0, x - cellMaxX);
      const distZ = Math.max(cellMinZ - z, 0, z - cellMaxZ);
      if (distX * distX + distZ * distZ >= 0.38 * 0.38) continue;
      for (let iy = 0; iy < NY; iy++) {
        if (!grid[idx3(cix, iy, ciz)]) continue;
        const botY = MIN_Y + iy * CELL_Y;
        const topY = MIN_Y + (iy + 1) * CELL_Y;
        if (topY > fy + 0.05 && botY < fy + 1.85) bodyBlocked = true;
      }
    }
  }
  return { floorY: +fy.toFixed(3), bodyBlocked };
}

function snapToCleanCapsule(p) {
  const c0 = sampleFloorAndClearance(p[0], p[1], p[2]);
  if (!c0.bodyBlocked) {
    p[1] = c0.floorY;
    return c0;
  }
  for (let r = 0.25; r <= 3.0; r += 0.25) {
    for (let dx = -r; dx <= r; dx += 0.25) {
      for (let dz = -r; dz <= r; dz += 0.25) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const tx = +(p[0] + dx).toFixed(2);
        const tz = +(p[2] + dz).toFixed(2);
        const c = sampleFloorAndClearance(tx, p[1], tz);
        if (!c.bodyBlocked) {
          p[0] = tx;
          p[1] = c.floorY;
          p[2] = tz;
          return c;
        }
      }
    }
  }
  p[1] = c0.floorY;
  return c0;
}

const sp = (x, y, z) => [+(x * WORLD_SCALE).toFixed(2), +(y * WORLD_SCALE).toFixed(3), +(z * WORLD_SCALE).toFixed(2)];
const s1 = (v) => +(v * WORLD_SCALE).toFixed(2);

// 30 capsule-verified Dust 2 tactical navigation nodes scaled 1.48x to true CS 1:1 human scale
const navRaw = {
  ct_spawn: sp(2.0, 1.125, -38.0),
  ramp_bot: sp(9.5, 1.5, -38.0),
  ramp_mid: sp(13.5, 2.5, -38.0),
  ramp_top: sp(19.0, 3.375, -38.0),
  site_e: sp(24.25, 3.625, -40.25),
  triple: sp(24.25, 4.375, -43.25),
  goose: sp(24.25, 5.25, -46.75),
  site_n: sp(19.25, 5.0, -45.25),
  default: sp(14.5, 5.0, -44.5),
  site_center: sp(11.5, 5.0, -44.5),
  site_nw: sp(8.0, 5.0, -44.5),
  site_s: sp(13.25, 5.0, -43.25),
  ninja: sp(17.25, 5.0, -44.25),
  site_sw: sp(7.5, 5.0, -40.5),
  short_plat: sp(6.5, 5.0, -36.5),
  stairs_top: sp(5.5, 5.0, -32.0),
  stairs_bot: sp(5.5, 3.375, -27.0),
  short_2: sp(2.0, 3.375, -26.0),
  short_1: sp(-2.5, 3.375, -25.5),
  short_t: sp(-4.0, 3.375, -10.0),
  long_corner: sp(24.5, 3.375, -33.0),
  car: sp(25.0, 3.375, -26.5),
  barrels: sp(24.5, 3.375, -20.5),
  elbow: sp(20.5, 3.375, -17.5),
  pit: sp(24.25, 1.125, -8.25),
  long_4: sp(17.5, 3.375, -14.0),
  long_3: sp(11.0, 3.375, -9.0),
  long_2: sp(11.0, 3.375, -2.0),
  long_1: sp(6.5, 3.375, 4.0),
  long_t: sp(5.0, 3.375, 12.5),
};

for (const [name, p] of Object.entries(navRaw)) {
  const check = snapToCleanCapsule(p);
  if (check.bodyBlocked) {
    console.warn(`  [WARN] NAV_${name} at ${JSON.stringify(p)} -> floorY=${check.floorY}, bodyBlocked=${check.bodyBlocked}`);
  }
}

const spawnCT = sp(2.0, 1.125, -38.0);
const ctCheck = snapToCleanCapsule(spawnCT);

const spawnT = sp(3.5, 3.375, 12.5);
const tCheck = snapToCleanCapsule(spawnT);

console.log(`[DE_DUST2] SPAWN_CT=${JSON.stringify(spawnCT)} blocked=${ctCheck.bodyBlocked}`);
console.log(`[DE_DUST2] SPAWN_T=${JSON.stringify(spawnT)} blocked=${tCheck.bodyBlocked}`);

const DUST2_EDGES = [
  ['long_t', 'long_1'], ['long_1', 'long_2'], ['long_2', 'long_3'], ['long_3', 'long_4'],
  ['long_4', 'elbow'], ['long_4', 'pit'], ['pit', 'elbow'], ['pit', 'barrels'],
  ['elbow', 'barrels'], ['barrels', 'car'], ['car', 'long_corner'], ['elbow', 'long_corner'],
  ['long_corner', 'ramp_top'], ['long_corner', 'site_e'],
  ['ct_spawn', 'ramp_bot'], ['ramp_bot', 'ramp_mid'], ['ramp_mid', 'ramp_top'],
  ['ramp_top', 'site_e'], ['site_e', 'triple'], ['triple', 'goose'],
  ['triple', 'site_n'], ['site_e', 'ninja'],
  ['goose', 'site_n'], ['site_n', 'default'], ['site_n', 'ninja'], ['ninja', 'default'],
  ['default', 'site_center'], ['default', 'site_s'], ['site_s', 'site_center'],
  ['site_center', 'site_nw'], ['site_center', 'site_sw'], ['site_nw', 'site_sw'],
  ['site_sw', 'short_plat'], ['short_plat', 'stairs_top'], ['stairs_top', 'stairs_bot'],
  ['stairs_bot', 'short_2'], ['short_2', 'short_1'], ['short_1', 'short_t'],
  ['short_t', 'long_1'], ['short_t', 'long_t'],
];

const adj = {};
for (const k of Object.keys(navRaw)) adj[k] = new Set();
for (const [a, b] of DUST2_EDGES) {
  if (navRaw[a] && navRaw[b]) {
    adj[a].add(b);
    adj[b].add(a);
  }
}

const navNodesOut = {};
for (const [id, p] of Object.entries(navRaw)) {
  const nbrs = [...adj[id]];
  const callout = id.startsWith('ct_')
    ? 'CT SPAWN'
    : id.startsWith('ramp_') || id === 'site_e' || id === 'triple'
      ? 'A RAMP'
      : id.startsWith('short_')
        ? 'A SHORT'
        : id.startsWith('stairs_')
          ? 'SHORT STAIRS'
          : id === 'pit'
            ? 'LONG PIT'
            : id === 'car' || id === 'barrels' || id === 'long_corner'
              ? 'LONG CAR'
              : id.startsWith('long_') || id === 'elbow'
                ? 'A LONG'
                : id === 'goose'
                  ? 'GOOSE'
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

const botConfigs = [
  // 4 Allied Vanguard CT Defenders (CT Spawn -> CT Ramp -> A Site / Long / Short / Goose)
  {
    id: 'van-alpha',
    name: 'Vanguard-Alpha',
    team: 'Vanguard',
    waypoints: [
      sp(4.5, 1.125, -38.0),
      sp(19.0, 3.375, -38.0),
      sp(24.25, 5.25, -46.75),
    ],
  },
  {
    id: 'van-bravo',
    name: 'Vanguard-Bravo',
    team: 'Vanguard',
    waypoints: [
      sp(-0.5, 1.125, -38.0),
      sp(24.25, 3.625, -40.25),
      sp(14.5, 5.0, -44.5),
    ],
  },
  {
    id: 'van-charlie',
    name: 'Vanguard-Charlie',
    team: 'Vanguard',
    waypoints: [
      sp(-4.5, 1.125, -38.0),
      sp(11.5, 5.0, -44.5),
      sp(6.5, 5.0, -36.5),
    ],
  },
  {
    id: 'van-delta',
    name: 'Vanguard-Delta',
    team: 'Vanguard',
    waypoints: [
      sp(6.5, 1.125, -38.5),
      sp(24.5, 3.375, -33.0),
      sp(25.0, 3.375, -26.5),
    ],
  },
  // 5 Syndicate T Attackers (3 Long Doors + 2 Short/Catwalk split!)
  {
    id: 'syn-1',
    name: 'Syndicate-Viper',
    team: 'Syndicate',
    waypoints: [
      sp(5.0, 3.375, 12.5),
      sp(11.0, 3.375, -2.0),
      sp(14.5, 5.0, -44.5),
    ],
  },
  {
    id: 'syn-2',
    name: 'Syndicate-Specter',
    team: 'Syndicate',
    waypoints: [
      sp(2.0, 3.375, 12.5),
      sp(17.5, 3.375, -14.0),
      sp(19.25, 5.0, -45.25),
    ],
  },
  {
    id: 'syn-3',
    name: 'Syndicate-Kobra',
    team: 'Syndicate',
    waypoints: [
      sp(4.0, 3.375, 10.0),
      sp(20.5, 3.375, -17.5),
      sp(24.25, 5.25, -46.75),
    ],
  },
  {
    id: 'syn-4',
    name: 'Syndicate-Reaper',
    team: 'Syndicate',
    waypoints: [
      sp(-2.5, 3.375, -25.5),
      sp(5.5, 5.0, -32.0),
      sp(11.5, 5.0, -44.5),
    ],
  },
  {
    id: 'syn-5',
    name: 'Syndicate-Nomad',
    team: 'Syndicate',
    waypoints: [
      sp(2.0, 3.375, -26.0),
      sp(6.5, 5.0, -36.5),
      sp(14.5, 5.0, -44.5),
    ],
  },
];

for (const b of botConfigs) {
  for (const wp of b.waypoints) {
    const c = snapToCleanCapsule(wp);
    if (c.bodyBlocked) {
      console.warn(`  [WARN] BOT ${b.id} wp ${JSON.stringify(wp)} blocked=${c.bodyBlocked}`);
    }
  }
}

const botsTs = botConfigs.map((b) => ({
  id: b.id,
  name: b.name,
  team: b.team,
  waypoints: b.waypoints.map((w) => ({ x: w[0], y: w[1], z: w[2] })),
}));

const siteA = sp(14.5, 5.0, -44.5);
snapToCleanCapsule(siteA);
const siteB = sp(-31.0, 3.375, -40.0);
snapToCleanCapsule(siteB);

const ts = `// AUTO-GENERATED by scripts/build-de-dust2.mjs from packages/client/public/models/de_dust2.glb
// Exact SAT 3D triangle-AABB colliders scaled ${WORLD_SCALE}x to authentic 1:1 CS human proportions (Y shifted +${Y_OFF}m).
import type { AABBCollider, MapBounds } from '../physics/KinematicPlayerController.js';
import type { MapBlockCollider, SurfaceMaterial, CalloutZone, TacticalBotConfig, Vec3 } from './CsOfficeData.js';
import type { NavNode } from './TacticalNavGraph.js';

export const DE_DUST2_WORLD_SCALE = ${WORLD_SCALE};
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
  VANGUARD_CT: { x: ${spawnCT[0]}, y: ${spawnCT[1]}, z: ${spawnCT[2]} } as Vec3,
  OBSIDIAN_T: { x: ${spawnT[0]}, y: ${spawnT[1]}, z: ${spawnT[2]} } as Vec3,
};

export const DE_DUST2_BOMBSITES = {
  A: {
    name: 'A' as const,
    center: { x: ${siteA[0]}, y: ${siteA[1]}, z: ${siteA[2]} },
    radius: ${s1(6.5)},
  },
  B: {
    name: 'B' as const,
    center: { x: ${siteB[0]}, y: ${siteB[1]}, z: ${siteB[2]} },
    radius: ${s1(6.0)},
  },
};

export const DE_DUST2_SPAWN_ZONES = {
  VANGUARD_BUY_ZONE: { minX: ${s1(-12)}, maxX: ${s1(12)}, minZ: ${s1(-44)}, maxZ: ${s1(-34)} },
  SYNDICATE_BUY_ZONE: { minX: ${s1(-16)}, maxX: ${s1(16)}, minZ: ${s1(4)}, maxZ: ${s1(24)} },
};

export const DE_DUST2_CALLOUT_ZONES: CalloutZone[] = [
  { name: 'CT SPAWN', minX: ${s1(-12)}, maxX: ${s1(10)}, minZ: ${s1(-43)}, maxZ: ${s1(-34)}, minY: -0.5, maxY: ${s1(2.6)} },
  { name: 'A RAMP', minX: ${s1(9)}, maxX: ${s1(28)}, minZ: ${s1(-45)}, maxZ: ${s1(-35)}, minY: ${s1(1.2)}, maxY: ${s1(4.9)} },
  { name: 'GOOSE', minX: ${s1(21)}, maxX: ${s1(28)}, minZ: ${s1(-50)}, maxZ: ${s1(-45)}, minY: ${s1(4.8)}, maxY: ${s1(8.5)} },
  { name: 'A SITE', minX: ${s1(7)}, maxX: ${s1(23)}, minZ: ${s1(-49)}, maxZ: ${s1(-40)}, minY: ${s1(4.5)}, maxY: ${s1(8.5)} },
  { name: 'SHORT STAIRS', minX: ${s1(3)}, maxX: ${s1(8)}, minZ: ${s1(-33)}, maxZ: ${s1(-26)} },
  { name: 'A SHORT', minX: ${s1(-6)}, maxX: ${s1(9)}, minZ: ${s1(-41)}, maxZ: ${s1(-8)}, minY: ${s1(3.0)}, maxY: ${s1(8.0)} },
  { name: 'LONG PIT', minX: ${s1(21)}, maxX: ${s1(28)}, minZ: ${s1(-13)}, maxZ: ${s1(-4)}, minY: -0.5, maxY: ${s1(2.8)} },
  { name: 'LONG CAR', minX: ${s1(22)}, maxX: ${s1(28)}, minZ: ${s1(-35)}, maxZ: ${s1(-19)} },
  { name: 'A LONG', minX: ${s1(2)}, maxX: ${s1(28)}, minZ: ${s1(-20)}, maxZ: ${s1(16)} },
  { name: 'B SITE', minX: ${s1(-40)}, maxX: ${s1(-22)}, minZ: ${s1(-48)}, maxZ: ${s1(-30)} },
  { name: 'DE_DUST2', minX: ${MIN_X}, maxX: ${MAX_X}, minZ: ${MIN_Z}, maxZ: ${MAX_Z} },
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

export const DE_DUST2_BOTS: TacticalBotConfig[] = ${JSON.stringify(botsTs, null, 2)};
`;

fs.writeFileSync(OUT_TS, ts, 'utf8');
console.log(`[DE_DUST2] Wrote ${OUT_TS} (${(ts.length / 1024).toFixed(1)} KB)`);
