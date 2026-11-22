import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DE_MERIDIAN_BLOCKS,
  DE_MERIDIAN_COLLIDERS,
  DE_MERIDIAN_DECK_Y,
  DE_MERIDIAN_UPPER_Y,
  TACTICAL_BOTS,
  BOMBSITES,
  MapBlockCollider,
  AABBCollider,
  Vec3,
  SurfaceMaterial,
} from '@garam/shared';
import { OperatorRig } from '../render/OperatorRig.js';
import { AssetManager } from '../render/AssetManager.js';

export interface BotEntity {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  mesh: THREE.Group;
  rig?: OperatorRig;
  health: number;
  maxHealth: number;
  armor: number;
  hasHelmet: boolean;
  isDead: boolean;
  kills: number;
  deaths: number;
  patrolWaypoints: Vec3[];
  waypointIndex: number;
  patrolTarget: Vec3;
  lastShotTime: number;
  vx: number;
  vz: number;
}

export interface MapBuildResult {
  colliders: AABBCollider[];
  blocks: MapBlockCollider[];
  bots: BotEntity[];
}

interface PBRMapPair {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

/**
 * Generates paired procedural CanvasTexture (albedo in sRGB + height bump in linear)
 * calibrated for ACESFilmicToneMapping and maxAnisotropy without external 404 assets.
 */
function createProceduralSurface(
  kind: 'sanctum_stone' | 'aqueduct_basalt' | 'foundry_concrete' | 'deck_paving' | 'wood' | 'drywall' | 'metal',
  anisotropy: number
): PBRMapPair {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  let seed = kind.length * 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  if (kind === 'sanctum_stone') {
    // Warm ivory travertine limestone ashlar courses
    cCtx.fillStyle = '#c8beac';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#909090';
    bCtx.fillRect(0, 0, size, size);

    const rows = 4;
    const rowH = size / rows;
    for (let r = 0; r < rows; r++) {
      const cols = 2;
      const colW = size / cols;
      const offset = (r % 2) * (colW * 0.5);
      for (let c = -1; c <= cols; c++) {
        const x = c * colW + offset;
        const y = r * rowH;
        const shade = Math.floor((rand() - 0.5) * 14);
        cCtx.fillStyle = `rgb(${202 + shade}, ${191 + shade}, ${172 + shade})`;
        cCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
        bCtx.fillStyle = `rgb(${155 + shade}, ${155 + shade}, ${155 + shade})`;
        bCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
      }
      // Subtle mortar line
      cCtx.fillStyle = '#9d917f';
      cCtx.fillRect(0, r * rowH, size, 2);
      bCtx.fillStyle = '#383838';
      bCtx.fillRect(0, r * rowH, size, 3);
    }
  } else if (kind === 'aqueduct_basalt') {
    // Cool basalt slate masonry with subtle bronze mineral flecks
    cCtx.fillStyle = '#6f7782';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    const rows = 6;
    const rowH = size / rows;
    for (let r = 0; r < rows; r++) {
      const cols = 3;
      const colW = size / cols;
      const offset = (r % 2) * (colW * 0.45);
      for (let c = -1; c <= cols; c++) {
        const x = c * colW + offset;
        const y = r * rowH;
        const shade = Math.floor((rand() - 0.5) * 18);
        cCtx.fillStyle = `rgb(${112 + shade}, ${120 + shade}, ${130 + shade})`;
        cCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
        bCtx.fillStyle = `rgb(${145 + shade}, ${145 + shade}, ${145 + shade})`;
        bCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
      }
      cCtx.fillStyle = '#4c535c';
      cCtx.fillRect(0, r * rowH, size, 2);
      bCtx.fillStyle = '#2c2c2c';
      bCtx.fillRect(0, r * rowH, size, 3);
    }
  } else if (kind === 'foundry_concrete') {
    // Clean architectural cast-concrete panels with tie-rod dimples and subtle cobalt-slate tone
    cCtx.fillStyle = '#7c858e';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#888888';
    bCtx.fillRect(0, 0, size, size);

    cCtx.strokeStyle = '#5f6871';
    cCtx.lineWidth = 3;
    cCtx.strokeRect(2, 2, size - 4, size / 2 - 4);
    cCtx.strokeRect(2, size / 2 + 2, size - 4, size / 2 - 4);

    bCtx.strokeStyle = '#3a3a3a';
    bCtx.lineWidth = 3;
    bCtx.strokeRect(2, 2, size - 4, size / 2 - 4);
    bCtx.strokeRect(2, size / 2 + 2, size - 4, size / 2 - 4);

    for (const px of [28, size - 28]) {
      for (const py of [32, size / 2 - 32, size / 2 + 32, size - 32]) {
        cCtx.fillStyle = '#525b64';
        cCtx.beginPath();
        cCtx.arc(px, py, 3.5, 0, Math.PI * 2);
        cCtx.fill();
        bCtx.fillStyle = '#202020';
        bCtx.beginPath();
        bCtx.arc(px, py, 4, 0, Math.PI * 2);
        bCtx.fill();
      }
    }
  } else if (kind === 'deck_paving') {
    // High-contrast silhouette-friendly warm neutral limestone pavers
    cCtx.fillStyle = '#b4ab9c';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#8c8c8c';
    bCtx.fillRect(0, 0, size, size);

    const tile = 64;
    for (let ty = 0; ty < size; ty += tile) {
      for (let tx = 0; tx < size; tx += tile) {
        const shade = Math.floor((rand() - 0.5) * 12);
        cCtx.fillStyle = `rgb(${180 + shade}, ${172 + shade}, ${158 + shade})`;
        cCtx.fillRect(tx + 2, ty + 2, tile - 4, tile - 4);
        bCtx.fillStyle = `rgb(${150 + shade}, ${150 + shade}, ${150 + shade})`;
        bCtx.fillRect(tx + 2, ty + 2, tile - 4, tile - 4);
      }
    }
  } else if (kind === 'wood') {
    // Wallbangable slatted timber crates / shutters / market door
    cCtx.fillStyle = '#9c6e44';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#848484';
    bCtx.fillRect(0, 0, size, size);

    const planks = 6;
    const ph = size / planks;
    for (let i = 0; i < planks; i++) {
      const shade = Math.floor((rand() - 0.5) * 20);
      cCtx.fillStyle = `rgb(${156 + shade}, ${108 + shade}, ${66 + shade})`;
      cCtx.fillRect(0, i * ph + 2, size, ph - 4);
      bCtx.fillStyle = `rgb(${145 + shade}, ${145 + shade}, ${145 + shade})`;
      bCtx.fillRect(0, i * ph + 2, size, ph - 4);
      cCtx.fillStyle = '#5c3c1e';
      cCtx.fillRect(0, i * ph, size, 2);
      bCtx.fillStyle = '#222222';
      bCtx.fillRect(0, i * ph, size, 3);
    }
    // Reinforced wood frame border
    cCtx.strokeStyle = '#6c4828';
    cCtx.lineWidth = 10;
    cCtx.strokeRect(5, 5, size - 10, size - 10);
  } else if (kind === 'drywall') {
    // Wallbangable plasterboard partitions with subtle vertical stud seams
    cCtx.fillStyle = '#c8c4bc';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#949494';
    bCtx.fillRect(0, 0, size, size);

    for (let x = 0; x < size; x += 64) {
      cCtx.fillStyle = '#a4a097';
      cCtx.fillRect(x, 0, 3, size);
      bCtx.fillStyle = '#484848';
      bCtx.fillRect(x, 0, 3, size);
    }
    // Subtle tactical warning stripe near bottom
    cCtx.fillStyle = '#7a638e';
    cCtx.fillRect(0, size - 22, size, 8);
  } else {
    // METAL_SHEET — brushed corrugated industrial steel with cobalt-teal tint
    cCtx.fillStyle = '#5b6d7c';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    for (let x = 0; x < size; x += 16) {
      cCtx.fillStyle = '#6d8192';
      cCtx.fillRect(x, 0, 8, size);
      cCtx.fillStyle = '#495866';
      cCtx.fillRect(x + 8, 0, 8, size);
      bCtx.fillStyle = '#d0d0d0';
      bCtx.fillRect(x, 0, 8, size);
      bCtx.fillStyle = '#383838';
      bCtx.fillRect(x + 8, 0, 8, size);
    }
    // Rivet band
    cCtx.fillStyle = '#2d93a3';
    cCtx.fillRect(0, 14, size, 6);
    cCtx.fillRect(0, size - 20, size, 6);
  }

  // Subtle surface micro-grain
  for (let i = 0; i < 650; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const a = rand() * 0.07;
    cCtx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    cCtx.fillRect(x, y, 2, 2);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = anisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = anisotropy;

  return { map, bumpMap };
}

function createBombsiteStencil(letter: 'A' | 'B', accentHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 512);

  // Dashed tactical plant perimeter ring
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 14;
  ctx.setLineDash([36, 20]);
  ctx.beginPath();
  ctx.arc(256, 256, 224, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Corner hazard brackets
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 8;
  ctx.strokeRect(110, 110, 292, 292);

  // Bold site letter
  ctx.fillStyle = accentHex;
  ctx.font = '900 240px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 256, 266);

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '700 32px "Segoe UI", Arial, sans-serif';
  ctx.fillText(letter === 'A' ? 'SANCTUM' : 'FOUNDRY', 256, 420);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createDirectionalSignTexture(text: string, accentHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(22, 26, 33, 0.88)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 14, 128);
  ctx.fillRect(498, 0, 14, 128);

  ctx.fillStyle = '#f4f0e8';
  ctx.font = '800 44px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactAoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(10, 12, 16, 0.42)');
  grad.addColorStop(0.55, 'rgba(10, 12, 16, 0.14)');
  grad.addColorStop(1, 'rgba(10, 12, 16, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, tileSize = 3.2): void {
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x (d×h), -x (d×h), +y (w×d), -y (w×d), +z (w×h), -z (w×h)
  const faceScales: [number, number][] = [
    [d / tileSize, h / tileSize],
    [d / tileSize, h / tileSize],
    [w / tileSize, d / tileSize],
    [w / tileSize, d / tileSize],
    [w / tileSize, h / tileSize],
    [w / tileSize, h / tileSize],
  ];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = faceScales[face];
    for (let v = 0; v < 4; v++) {
      const idx = face * 4 + v;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
}

function resolveMaterialBucket(block: MapBlockCollider): string {
  if (block.id.startsWith('deck_')) return 'deck';
  if (block.material === 'WOOD_THIN') return 'wood';
  if (block.material === 'DRYWALL') return 'drywall';
  if (block.material === 'METAL_SHEET') return 'metal';
  if (block.theme === 'sanctum') return 'sanctum';
  if (block.theme === 'foundry') return 'foundry';
  if (block.theme === 'aqueduct') return 'aqueduct';
  return 'sanctum';
}

export function buildTacticalMeridianMap(scene: THREE.Scene): MapBuildResult {
  const aniso = AssetManager.getInstance().getMaxAnisotropy();

  // 1. Procedural PBR Materials for all 3 Architectural Quadrants + 4 Wallbang Surface Types
  const sanctumPair = createProceduralSurface('sanctum_stone', aniso);
  const aqueductPair = createProceduralSurface('aqueduct_basalt', aniso);
  const foundryPair = createProceduralSurface('foundry_concrete', aniso);
  const deckPair = createProceduralSurface('deck_paving', aniso);
  const woodPair = createProceduralSurface('wood', aniso);
  const drywallPair = createProceduralSurface('drywall', aniso);
  const metalPair = createProceduralSurface('metal', aniso);

  const materials: Record<string, THREE.MeshStandardMaterial> = {
    deck: new THREE.MeshStandardMaterial({
      map: deckPair.map,
      bumpMap: deckPair.bumpMap,
      bumpScale: 0.04,
      roughness: 0.86,
      metalness: 0.03,
    }),
    sanctum: new THREE.MeshStandardMaterial({
      map: sanctumPair.map,
      bumpMap: sanctumPair.bumpMap,
      bumpScale: 0.055,
      roughness: 0.84,
      metalness: 0.04,
    }),
    aqueduct: new THREE.MeshStandardMaterial({
      map: aqueductPair.map,
      bumpMap: aqueductPair.bumpMap,
      bumpScale: 0.06,
      roughness: 0.78,
      metalness: 0.08,
    }),
    foundry: new THREE.MeshStandardMaterial({
      map: foundryPair.map,
      bumpMap: foundryPair.bumpMap,
      bumpScale: 0.05,
      roughness: 0.74,
      metalness: 0.14,
    }),
    wood: new THREE.MeshStandardMaterial({
      map: woodPair.map,
      bumpMap: woodPair.bumpMap,
      bumpScale: 0.06,
      roughness: 0.82,
      metalness: 0.04,
    }),
    drywall: new THREE.MeshStandardMaterial({
      map: drywallPair.map,
      bumpMap: drywallPair.bumpMap,
      bumpScale: 0.03,
      roughness: 0.9,
      metalness: 0.02,
    }),
    metal: new THREE.MeshStandardMaterial({
      map: metalPair.map,
      bumpMap: metalPair.bumpMap,
      bumpScale: 0.05,
      roughness: 0.36,
      metalness: 0.72,
    }),
  };

  // 2. Sunken Aqueduct Floor at y = 0.0m (Dark Wet Basalt Stone)
  const underpassFloorGeo = new THREE.PlaneGeometry(18, 36);
  underpassFloorGeo.rotateX(-Math.PI / 2);
  const underpassFloorMat = new THREE.MeshStandardMaterial({
    map: aqueductPair.map,
    bumpMap: aqueductPair.bumpMap,
    bumpScale: 0.05,
    color: 0x58626e,
    roughness: 0.56,
    metalness: 0.16,
  });
  const underpassFloor = new THREE.Mesh(underpassFloorGeo, underpassFloorMat);
  underpassFloor.position.set(1.5, 0.0, 5.0);
  underpassFloor.receiveShadow = true;
  scene.add(underpassFloor);

  // Subtle recessed aqueduct water channel strip running down center of y = 0.0m trench
  const canalStripGeo = new THREE.PlaneGeometry(1.4, 27.5);
  canalStripGeo.rotateX(-Math.PI / 2);
  const canalStripMat = new THREE.MeshStandardMaterial({
    color: 0x1e5c66,
    roughness: 0.16,
    metalness: 0.65,
  });
  const canalStrip = new THREE.Mesh(canalStripGeo, canalStripMat);
  canalStrip.position.set(0, 0.008, 3.8);
  scene.add(canalStrip);

  // 3. Batch All Map Collider Blocks by Material using mergeGeometries (7 draw calls total!)
  const buckets: Record<string, THREE.BufferGeometry[]> = {
    deck: [],
    sanctum: [],
    aqueduct: [],
    foundry: [],
    wood: [],
    drywall: [],
    metal: [],
  };

  const aoGeos: THREE.BufferGeometry[] = [];
  const corniceGeosSanctum: THREE.BufferGeometry[] = [];
  const trimGeosFoundry: THREE.BufferGeometry[] = [];
  const trimGeosBronze: THREE.BufferGeometry[] = [];

  for (const block of DE_MERIDIAN_BLOCKS) {
    const w = block.maxX - block.minX;
    const h = block.maxY - block.minY;
    const d = block.maxZ - block.minZ;
    const cx = (block.minX + block.maxX) * 0.5;
    const cy = (block.minY + block.maxY) * 0.5;
    const cz = (block.minZ + block.maxZ) * 0.5;

    const geo = new THREE.BoxGeometry(w, h, d);
    const tileScale = block.id.startsWith('deck_') ? 4.0 : block.material === 'WOOD_THIN' ? 2.0 : 3.2;
    scaleBoxUVs(geo, w, h, d, tileScale);
    geo.translate(cx, cy, cz);

    const bucketKey = resolveMaterialBucket(block);
    buckets[bucketKey].push(geo);

    // 1.65m Crosshair Placement Cornice Line on tall Sanctum / Foundry walls above Main Deck
    const isWall =
      !block.id.startsWith('deck_') &&
      !block.id.includes('_stairs_') &&
      block.minY >= DE_MERIDIAN_DECK_Y - 0.05 &&
      h >= 3.2 &&
      (w >= 3.0 || d >= 3.0);

    if (isWall) {
      const corniceY = DE_MERIDIAN_DECK_Y + 1.65;
      const band = new THREE.BoxGeometry(w + 0.08, 0.12, d + 0.08);
      band.translate(cx, corniceY, cz);
      if (block.theme === 'foundry') {
        trimGeosFoundry.push(band);
      } else if (block.theme === 'aqueduct') {
        trimGeosBronze.push(band);
      } else {
        corniceGeosSanctum.push(band);
      }

      // Grounded Contact AO strip around wall base at y = DE_MERIDIAN_DECK_Y + 0.012
      const aoPad = 0.55;
      const aoY = DE_MERIDIAN_DECK_Y + 0.012;
      const northStrip = new THREE.PlaneGeometry(w + aoPad * 2, aoPad);
      northStrip.rotateX(-Math.PI / 2);
      northStrip.rotateY(Math.PI);
      northStrip.translate(cx, aoY, block.minZ - aoPad * 0.5);
      aoGeos.push(northStrip);

      const southStrip = new THREE.PlaneGeometry(w + aoPad * 2, aoPad);
      southStrip.rotateX(-Math.PI / 2);
      southStrip.translate(cx, aoY, block.maxZ + aoPad * 0.5);
      aoGeos.push(southStrip);

      const eastStrip = new THREE.PlaneGeometry(d, aoPad);
      eastStrip.rotateX(-Math.PI / 2);
      eastStrip.rotateY(Math.PI / 2);
      eastStrip.translate(block.maxX + aoPad * 0.5, aoY, cz);
      aoGeos.push(eastStrip);

      const westStrip = new THREE.PlaneGeometry(d, aoPad);
      westStrip.rotateX(-Math.PI / 2);
      westStrip.rotateY(-Math.PI / 2);
      westStrip.translate(block.minX - aoPad * 0.5, aoY, cz);
      aoGeos.push(westStrip);
    }
  }

  // Emit merged static meshes per material bucket
  for (const [key, geos] of Object.entries(buckets)) {
    if (geos.length === 0) continue;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials[key]);
    mesh.castShadow = key !== 'deck';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // 4. Architectural Trim & Wayfinding Color Identity (Terracotta, Cobalt-Teal, Weathered Bronze)
  const addMergedAccent = (
    geos: THREE.BufferGeometry[],
    color: number,
    roughness: number,
    metalness: number
  ) => {
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  // Site A Terracotta Cornices & Arch Headers
  const aArchBeam = new THREE.BoxGeometry(6.6, 1.2, 3.1);
  aArchBeam.translate(-33.4, DE_MERIDIAN_DECK_Y + 5.8, -6.5);
  corniceGeosSanctum.push(aArchBeam);

  // Site A Sunlit Limestone Columns around Sanctum
  for (const [colX, colZ] of [
    [-25.6, -26.5],
    [-17.4, -26.5],
    [-38.2, -5.0],
    [-30.5, -5.0],
  ]) {
    const col = new THREE.BoxGeometry(0.65, 5.2, 0.65);
    col.translate(colX, DE_MERIDIAN_DECK_Y + 2.6, colZ);
    corniceGeosSanctum.push(col);
  }
  addMergedAccent(corniceGeosSanctum, 0xb85c3c, 0.72, 0.06); // Warm Terracotta

  // Site B Foundry Cobalt-Teal Structural Trim & Overhead Gantry
  const bArchBeam = new THREE.BoxGeometry(6.4, 1.1, 3.1);
  bArchBeam.translate(29.5, DE_MERIDIAN_DECK_Y + 5.85, -6.5);
  trimGeosFoundry.push(bArchBeam);

  const bGantry = new THREE.BoxGeometry(22.0, 0.45, 0.65);
  bGantry.translate(29.5, DE_MERIDIAN_UPPER_Y + 3.4, -20.0);
  trimGeosFoundry.push(bGantry);
  addMergedAccent(trimGeosFoundry, 0x1c7a8c, 0.44, 0.52); // Industrial Cobalt-Teal

  // Mid Sunken Aqueduct Overhead Bronze Arch Spans & Railings
  for (const archZ of [-6.0, 2.0, 10.0]) {
    const beam = new THREE.BoxGeometry(7.8, 0.55, 0.75);
    beam.translate(0, DE_MERIDIAN_DECK_Y + 3.9, archZ);
    trimGeosBronze.push(beam);
  }
  // Aqueduct East rim weathered bronze rail south of stairs
  const eastRail = new THREE.BoxGeometry(0.18, 0.9, 23.0);
  eastRail.translate(3.6, DE_MERIDIAN_DECK_Y + 0.45, 5.2);
  trimGeosBronze.push(eastRail);
  addMergedAccent(trimGeosBronze, 0x8b6b43, 0.48, 0.64); // Weathered Bronze

  // Site A Crimson Silk Banners (Instant 0.2s Quadrant Wayfinding)
  const bannerMat = new THREE.MeshStandardMaterial({
    color: 0xa62632,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  for (const [bx, by, bz, rotY] of [
    [-33.4, DE_MERIDIAN_DECK_Y + 4.3, -4.92, 0],
    [-21.5, DE_MERIDIAN_UPPER_Y + 0.55, -26.42, 0],
    [-38.02, DE_MERIDIAN_DECK_Y + 4.4, 5.0, Math.PI / 2],
  ]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.6), bannerMat);
    banner.position.set(bx, by, bz);
    banner.rotation.y = rotY;
    scene.add(banner);
  }

  // Contact AO batch
  if (aoGeos.length > 0) {
    const mergedAo = mergeGeometries(aoGeos, false);
    aoGeos.forEach((g) => g.dispose());
    if (mergedAo) {
      const aoMat = new THREE.MeshBasicMaterial({
        map: createContactAoTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      scene.add(new THREE.Mesh(mergedAo, aoMat));
    }
  }

  // 5. Grounded Bombsite Floor Stencils (y = DE_MERIDIAN_DECK_Y + 0.024)
  const stencilA = new THREE.Mesh(
    new THREE.PlaneGeometry(9.2, 9.2),
    new THREE.MeshBasicMaterial({
      map: createBombsiteStencil('A', '#d9483b'),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  );
  stencilA.rotation.x = -Math.PI / 2;
  stencilA.position.set(BOMBSITES.A.center.x, DE_MERIDIAN_DECK_Y + 0.024, BOMBSITES.A.center.z);
  scene.add(stencilA);

  const stencilB = new THREE.Mesh(
    new THREE.PlaneGeometry(9.2, 9.2),
    new THREE.MeshBasicMaterial({
      map: createBombsiteStencil('B', '#27a3b8'),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  );
  stencilB.rotation.x = -Math.PI / 2;
  stencilB.position.set(BOMBSITES.B.center.x, DE_MERIDIAN_DECK_Y + 0.024, BOMBSITES.B.center.z);
  scene.add(stencilB);

  // 6. Directional Tactical Wall Signage (CT Spawn & T Spawn Wayfinding)
  const addSign = (text: string, color: string, x: number, y: number, z: number, rotY: number) => {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 0.95),
      new THREE.MeshBasicMaterial({
        map: createDirectionalSignTexture(text, color),
        transparent: true,
      })
    );
    sign.position.set(x, y, z);
    sign.rotation.y = rotY;
    scene.add(sign);
  };

  // Visible from CT Spawn (looking South +Z across flanking pillars & Mid Nest)
  addSign('← B FOUNDRY', '#27a3b8', 6.94, DE_MERIDIAN_DECK_Y + 3.2, -25.8, -Math.PI / 2);
  addSign('A SANCTUM →', '#d9483b', -6.94, DE_MERIDIAN_DECK_Y + 3.2, -25.8, Math.PI / 2);
  addSign('▲ MID SNIPER NEST', '#d99b38', 0, DE_MERIDIAN_DECK_Y + 1.95, -19.56, Math.PI);
  addSign('← B FOUNDRY', '#27a3b8', 9.1, DE_MERIDIAN_DECK_Y + 3.2, -30.08, Math.PI);
  addSign('A SANCTUM →', '#d9483b', -8.8, DE_MERIDIAN_DECK_Y + 3.2, -30.08, Math.PI);
  // Visible from T Spawn (looking North -Z)
  addSign('← A SANCTUM', '#d9483b', -24.0, DE_MERIDIAN_DECK_Y + 3.4, 22.08, 0);
  addSign('B FOUNDRY →', '#27a3b8', 24.0, DE_MERIDIAN_DECK_Y + 3.4, 22.08, 0);
  addSign('▲ AQUEDUCT MID', '#d99b38', 0, DE_MERIDIAN_DECK_Y + 2.6, 32.58, 0);

  // 7. Warm Amber Tactical Accent PointLights (Sunken Aqueduct, A Palace, B Apartments, Foundry)
  const lightPositions: [number, number, number, number, number][] = [
    [0, 3.2, 4.0, 0xffb35c, 22], // Sunken Aqueduct Underpass warm lantern glow
    [-41.5, DE_MERIDIAN_UPPER_Y + 2.4, 4.0, 0xffaa55, 18], // A Palace interior
    [41.5, DE_MERIDIAN_UPPER_Y + 2.4, -2.0, 0xffa84c, 20], // B Apartments interior
    [29.5, DE_MERIDIAN_DECK_Y + 5.2, -20.5, 0xffbc6b, 24], // B Foundry overhead amber fixture
  ];
  for (const [lx, ly, lz, color, dist] of lightPositions) {
    const pt = new THREE.PointLight(color, 1.35, dist, 1.6);
    pt.position.set(lx, ly, lz);
    scene.add(pt);

    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.14, 0.35),
      new THREE.MeshBasicMaterial({ color: 0xffe4b5 })
    );
    fixture.position.set(lx, ly + 0.18, lz);
    scene.add(fixture);
  }

  // 8. Spawn Grounded 5v5 Tactical Bots on DE_MERIDIAN Deck
  const bots: BotEntity[] = [];
  for (const cfg of TACTICAL_BOTS) {
    const rig = new OperatorRig(cfg.team, cfg.name);
    const wp0 = cfg.waypoints[0];
    rig.root.position.set(wp0.x, wp0.y, wp0.z);
    // Vanguard (North) faces South (+Z, yaw=0 in mesh space); Syndicate (South) faces North (-Z, yaw=Math.PI)
    rig.root.rotation.y = cfg.team === 'Vanguard' ? 0 : Math.PI;
    scene.add(rig.root);

    bots.push({
      id: cfg.id,
      name: cfg.name,
      team: cfg.team,
      mesh: rig.root,
      rig,
      health: 100,
      maxHealth: 100,
      armor: 100,
      hasHelmet: true,
      isDead: false,
      kills: 0,
      deaths: 0,
      patrolWaypoints: cfg.waypoints.map((w) => ({ ...w })),
      waypointIndex: 0,
      patrolTarget: { ...wp0 },
      lastShotTime: 0,
      vx: 0,
      vz: 0,
    });
  }

  return {
    colliders: DE_MERIDIAN_COLLIDERS,
    blocks: DE_MERIDIAN_BLOCKS,
    bots,
  };
}

export const buildTacticalCitadelMap = buildTacticalMeridianMap;
export type { SurfaceMaterial };
