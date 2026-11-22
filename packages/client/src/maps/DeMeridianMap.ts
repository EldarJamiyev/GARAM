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
  const size = 512;
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
    // Warm sunlit Dust2/Mirage weathered limestone stucco & sandstone masonry
    cCtx.fillStyle = '#cbb799';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#8a8a8a';
    bCtx.fillRect(0, 0, size, size);

    // Weathered ashlar courses
    const rows = 6;
    const rowH = size / rows;
    for (let r = 0; r < rows; r++) {
      const cols = 3;
      const colW = size / cols;
      const offset = (r % 2) * (colW * 0.45);
      for (let c = -1; c <= cols; c++) {
        const x = c * colW + offset;
        const y = r * rowH;
        const shade = Math.floor((rand() - 0.5) * 16);
        cCtx.fillStyle = `rgb(${203 + shade}, ${183 + shade}, ${153 + shade})`;
        cCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
        bCtx.fillStyle = `rgb(${142 + shade}, ${142 + shade}, ${142 + shade})`;
        bCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
      }
      // Grout line
      cCtx.fillStyle = '#8a7d6d';
      cCtx.fillRect(0, r * rowH, size, 3);
      bCtx.fillStyle = '#303030';
      bCtx.fillRect(0, r * rowH, size, 4);
    }

    // Basal plinth course (0.95m ground stone footing)
    cCtx.fillStyle = '#7a6b57';
    cCtx.fillRect(0, size - 44, size, 44);
    bCtx.fillStyle = '#555555';
    bCtx.fillRect(0, size - 44, size, 44);
    cCtx.fillStyle = '#5c4e3e';
    cCtx.fillRect(0, size - 44, size, 4);

    // Exposed terracotta brick patch peeking through worn plaster
    const brickPatchX = 140;
    const brickPatchY = 220;
    const brickW = 120;
    const brickH = 70;
    cCtx.fillStyle = '#a64f34';
    cCtx.fillRect(brickPatchX, brickPatchY, brickW, brickH);
    bCtx.fillStyle = '#505050';
    bCtx.fillRect(brickPatchX, brickPatchY, brickW, brickH);
    for (let by = brickPatchY + 2; by < brickPatchY + brickH - 4; by += 14) {
      cCtx.fillStyle = '#7a6a58';
      cCtx.fillRect(brickPatchX, by, brickW, 2);
    }
  } else if (kind === 'aqueduct_basalt') {
    // Cool basalt slate masonry with damp dark flagstones
    cCtx.fillStyle = '#5d6773';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    const rows = 8;
    const rowH = size / rows;
    for (let r = 0; r < rows; r++) {
      const cols = 4;
      const colW = size / cols;
      const offset = (r % 2) * (colW * 0.5);
      for (let c = -1; c <= cols; c++) {
        const x = c * colW + offset;
        const y = r * rowH;
        const shade = Math.floor((rand() - 0.5) * 20);
        cCtx.fillStyle = `rgb(${93 + shade}, ${103 + shade}, ${115 + shade})`;
        cCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
        bCtx.fillStyle = `rgb(${130 + shade}, ${130 + shade}, ${130 + shade})`;
        bCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
      }
      cCtx.fillStyle = '#3b434c';
      cCtx.fillRect(0, r * rowH, size, 3);
      bCtx.fillStyle = '#222222';
      bCtx.fillRect(0, r * rowH, size, 4);
    }
  } else if (kind === 'foundry_concrete') {
    // Industrial weathered slate-blue painted concrete with formwork seams & rust streaks
    cCtx.fillStyle = '#566370';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#888888';
    bCtx.fillRect(0, 0, size, size);

    cCtx.strokeStyle = '#3e4b57';
    cCtx.lineWidth = 4;
    cCtx.strokeRect(4, 4, size - 8, size / 2 - 8);
    cCtx.strokeRect(4, size / 2 + 4, size - 8, size / 2 - 8);

    bCtx.strokeStyle = '#2b2b2b';
    bCtx.lineWidth = 4;
    bCtx.strokeRect(4, 4, size - 8, size / 2 - 8);
    bCtx.strokeRect(4, size / 2 + 4, size - 8, size / 2 - 8);

    // Tie-rod dimples
    for (const px of [48, size - 48]) {
      for (const py of [52, size / 2 - 52, size / 2 + 52, size - 52]) {
        cCtx.fillStyle = '#343f49';
        cCtx.beginPath();
        cCtx.arc(px, py, 5, 0, Math.PI * 2);
        cCtx.fill();
        bCtx.fillStyle = '#181818';
        bCtx.beginPath();
        bCtx.arc(px, py, 6, 0, Math.PI * 2);
        bCtx.fill();
      }
    }

    // Subtle dark vertical moisture / rust streaks
    cCtx.fillStyle = 'rgba(70, 52, 42, 0.22)';
    cCtx.fillRect(96, 0, 18, size);
    cCtx.fillRect(360, 0, 14, size);
  } else if (kind === 'deck_paving') {
    // Sun-baked Mediterranean warm sandy stone courtyard paving (NEVER blinding white!)
    cCtx.fillStyle = '#b39f84';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#8c8c8c';
    bCtx.fillRect(0, 0, size, size);

    const tile = 128;
    for (let ty = 0; ty < size; ty += tile) {
      for (let tx = 0; tx < size; tx += tile) {
        const shade = Math.floor((rand() - 0.5) * 16);
        cCtx.fillStyle = `rgb(${179 + shade}, ${159 + shade}, ${132 + shade})`;
        cCtx.fillRect(tx + 3, ty + 3, tile - 6, tile - 6);
        bCtx.fillStyle = `rgb(${145 + shade}, ${145 + shade}, ${145 + shade})`;
        bCtx.fillRect(tx + 3, ty + 3, tile - 6, tile - 6);
      }
    }
    // Sand-filled grout lines
    cCtx.fillStyle = '#7a6b57';
    for (let x = 0; x <= size; x += tile) cCtx.fillRect(x - 2, 0, 4, size);
    for (let y = 0; y <= size; y += tile) cCtx.fillRect(0, y - 2, size, 4);
    bCtx.fillStyle = '#262626';
    for (let x = 0; x <= size; x += tile) bCtx.fillRect(x - 2, 0, 4, size);
    for (let y = 0; y <= size; y += tile) bCtx.fillRect(0, y - 2, size, 4);
  } else if (kind === 'wood') {
    // Heavy sun-bleached oak timber planks with wrought-iron hinge straps & studs
    cCtx.fillStyle = '#785333';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#848484';
    bCtx.fillRect(0, 0, size, size);

    const planks = 8;
    const ph = size / planks;
    for (let i = 0; i < planks; i++) {
      const shade = Math.floor((rand() - 0.5) * 22);
      cCtx.fillStyle = `rgb(${120 + shade}, ${83 + shade}, ${51 + shade})`;
      cCtx.fillRect(0, i * ph + 3, size, ph - 6);
      bCtx.fillStyle = `rgb(${140 + shade}, ${140 + shade}, ${140 + shade})`;
      bCtx.fillRect(0, i * ph + 3, size, ph - 6);
      cCtx.fillStyle = '#422c19';
      cCtx.fillRect(0, i * ph, size, 3);
      bCtx.fillStyle = '#1c1c1c';
      bCtx.fillRect(0, i * ph, size, 4);
    }
    // Iron corner straps & rivets
    cCtx.fillStyle = '#2b2927';
    cCtx.fillRect(16, 24, size - 32, 28);
    cCtx.fillRect(16, size - 52, size - 32, 28);
    bCtx.fillStyle = '#d0d0d0';
    bCtx.fillRect(16, 24, size - 32, 28);
    bCtx.fillRect(16, size - 52, size - 32, 28);
  } else if (kind === 'drywall') {
    // Matte gypsum panels with vertical aluminum framing studs
    cCtx.fillStyle = '#c5bfb4';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#949494';
    bCtx.fillRect(0, 0, size, size);

    for (let x = 0; x < size; x += 128) {
      cCtx.fillStyle = '#969085';
      cCtx.fillRect(x, 0, 4, size);
      bCtx.fillStyle = '#3c3c3c';
      bCtx.fillRect(x, 0, 4, size);
    }
  } else {
    // METAL_SHEET — Galvanized corrugated industrial steel with cobalt tint
    cCtx.fillStyle = '#546574';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    for (let x = 0; x < size; x += 32) {
      cCtx.fillStyle = '#657a8c';
      cCtx.fillRect(x, 0, 16, size);
      cCtx.fillStyle = '#42515e';
      cCtx.fillRect(x + 16, 0, 16, size);
      bCtx.fillStyle = '#c8c8c8';
      bCtx.fillRect(x, 0, 16, size);
      bCtx.fillStyle = '#383838';
      bCtx.fillRect(x + 16, 0, 16, size);
    }
    // Dark steel rivet bands
    cCtx.fillStyle = '#26343e';
    cCtx.fillRect(0, 24, size, 10);
    cCtx.fillRect(0, size - 34, size, 10);
  }

  // Micro-grain stone & stucco wear
  for (let i = 0; i < 1800; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const a = rand() * 0.08;
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

function createWallStencilTexture(text: string, accentHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);

  // High-contrast tactical wall stencil paint (organic weathered decal, zero solid black box)
  ctx.fillStyle = accentHex;
  ctx.font = '900 48px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Weathered double-pass paint simulation with soft surface contact shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;
  ctx.fillText(text, 256, 64);

  // Reset shadow for crisp stencil mask cutouts
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Stencil cutouts: subtle weathered distressing gaps across the lettering
  ctx.globalCompositeOperation = 'destination-out';
  let seed = text.length * 43;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 48; i++) {
    const rx = 24 + rand() * 464;
    const ry = 16 + rand() * 96;
    ctx.fillRect(rx, ry, 2 + rand() * 3, 2 + rand() * 4);
  }
  ctx.globalCompositeOperation = 'source-over';

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
    metalness: number,
    castShadow = false
  ) => {
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  // Carved Stone Archways & Headers across Tactical Chokepoints
  // A Main Arch Header
  const aArchBeam = new THREE.BoxGeometry(6.6, 1.2, 3.1);
  aArchBeam.translate(-33.4, DE_MERIDIAN_DECK_Y + 5.8, -6.5);
  corniceGeosSanctum.push(aArchBeam);

  // A Connector Arch Header
  const aConnBeam = new THREE.BoxGeometry(5.2, 1.2, 2.8);
  aConnBeam.translate(-17.5, DE_MERIDIAN_DECK_Y + 5.8, -14.5);
  corniceGeosSanctum.push(aConnBeam);

  // CT Spawn Promenade Grand Arch Header
  const ctSpawnArch = new THREE.BoxGeometry(14.2, 1.0, 1.4);
  ctSpawnArch.translate(0, DE_MERIDIAN_DECK_Y + 5.6, -22.0);
  corniceGeosSanctum.push(ctSpawnArch);

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
  addMergedAccent(corniceGeosSanctum, 0xb85c3c, 0.72, 0.06, true); // Warm Terracotta

  // Site B Foundry Cobalt-Teal Structural Trim & Overhead Gantry
  const bArchBeam = new THREE.BoxGeometry(6.4, 1.1, 3.1);
  bArchBeam.translate(29.5, DE_MERIDIAN_DECK_Y + 5.85, -6.5);
  trimGeosFoundry.push(bArchBeam);

  const bShortBeam = new THREE.BoxGeometry(5.4, 1.2, 2.8);
  bShortBeam.translate(22.0, DE_MERIDIAN_DECK_Y + 5.8, -14.0);
  trimGeosFoundry.push(bShortBeam);

  const bGantry = new THREE.BoxGeometry(22.0, 0.45, 0.65);
  bGantry.translate(29.5, DE_MERIDIAN_UPPER_Y + 3.4, -20.0);
  trimGeosFoundry.push(bGantry);
  addMergedAccent(trimGeosFoundry, 0x1c7a8c, 0.44, 0.52, true); // Industrial Cobalt-Teal

  // Mid Watchtower Nest Architecture (Canopy, Support Columns, Stair Cheek-walls, Window Lintel)
  const watchtowerGeos: THREE.BufferGeometry[] = [];
  // Canopy roof slab at y = 8.5
  const canopySlab = new THREE.BoxGeometry(10.2, 0.45, 6.8);
  canopySlab.translate(0, 8.5, -16.35);
  watchtowerGeos.push(canopySlab);

  // 4 Canopy Corner Columns
  for (const [px, pz] of [
    [-4.6, -19.2],
    [4.6, -19.2],
    [-4.6, -13.5],
    [4.6, -13.5],
  ]) {
    const post = new THREE.BoxGeometry(0.35, 3.8, 0.35);
    post.translate(px, 6.6, pz);
    watchtowerGeos.push(post);
  }

  // Stone Stair Cheek-walls flanking Mid stairs
  const cheekL = new THREE.BoxGeometry(0.45, 2.8, 6.2);
  cheekL.translate(-7.6, DE_MERIDIAN_DECK_Y + 1.4, -20.0);
  watchtowerGeos.push(cheekL);

  const cheekR = new THREE.BoxGeometry(0.45, 2.8, 6.2);
  cheekR.translate(7.6, DE_MERIDIAN_DECK_Y + 1.4, -20.0);
  watchtowerGeos.push(cheekR);

  // Sniper Window Lintel Beam
  const lintel = new THREE.BoxGeometry(6.8, 0.35, 0.6);
  lintel.translate(0, DE_MERIDIAN_UPPER_Y + 2.4, -13.2);
  watchtowerGeos.push(lintel);

  addMergedAccent(watchtowerGeos, 0x9e886c, 0.82, 0.05, true); // Weathered Ashlar Stone

  // Overhead Wooden Pergola Beams Spanning CT Spawn -> A/B Approach (Casts Slatted Shadows)
  const pergolaGeos: THREE.BufferGeometry[] = [];
  const corbelGeos: THREE.BufferGeometry[] = [];
  for (const z of [-28.0, -26.5, -25.0, -23.5, -22.0]) {
    const slat = new THREE.BoxGeometry(14.8, 0.22, 0.38);
    slat.translate(0.0, 6.9, z);
    pergolaGeos.push(slat);

    // Stone wall corbels/brackets supporting each slat at East (Sanctum x=-7.0) & West (Foundry x=+7.0) wall junctions
    const corbelL = new THREE.BoxGeometry(0.55, 0.50, 0.42);
    corbelL.translate(6.75, 6.55, z);
    corbelGeos.push(corbelL);

    const corbelR = new THREE.BoxGeometry(0.55, 0.50, 0.42);
    corbelR.translate(-6.75, 6.55, z);
    corbelGeos.push(corbelR);
  }
  for (const x of [-6.4, 6.4]) {
    const runner = new THREE.BoxGeometry(0.32, 0.24, 7.2);
    runner.translate(x, 7.05, -25.0);
    pergolaGeos.push(runner);
  }
  if (corbelGeos.length > 0) {
    const mergedCorbels = mergeGeometries(corbelGeos, false);
    corbelGeos.forEach((g) => g.dispose());
    if (mergedCorbels) {
      const corbelMesh = new THREE.Mesh(mergedCorbels, materials.sanctum);
      corbelMesh.castShadow = true;
      corbelMesh.receiveShadow = true;
      scene.add(corbelMesh);
    }
  }
  if (pergolaGeos.length > 0) {
    const mergedPergola = mergeGeometries(pergolaGeos, false);
    pergolaGeos.forEach((g) => g.dispose());
    if (mergedPergola) {
      const pergolaMesh = new THREE.Mesh(mergedPergola, materials.wood);
      pergolaMesh.castShadow = true;
      pergolaMesh.receiveShadow = true;
      scene.add(pergolaMesh);
    }
  }

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

  // 6. Directional Tactical Wall Stencils (Organic weathered paint, zero solid black boxes)
  const addWallStencil = (text: string, color: string, x: number, y: number, z: number, rotY: number) => {
    const stencil = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 0.9),
      new THREE.MeshBasicMaterial({
        map: createWallStencilTexture(text, color),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1.5,
      })
    );
    stencil.position.set(x, y, z);
    stencil.rotation.y = rotY;
    scene.add(stencil);
  };

  // Visible from CT Spawn (looking South +Z across flanking pillars & Mid Nest)
  addWallStencil('← B FOUNDRY', '#27a3b8', 6.94, DE_MERIDIAN_DECK_Y + 3.2, -25.8, -Math.PI / 2);
  addWallStencil('A SANCTUM →', '#d9483b', -6.94, DE_MERIDIAN_DECK_Y + 3.2, -25.8, Math.PI / 2);
  addWallStencil('▲ MID NEST', '#d99b38', 0, DE_MERIDIAN_DECK_Y + 1.95, -19.56, Math.PI);
  // Visible from T Spawn (looking North -Z)
  addWallStencil('← A SANCTUM', '#d9483b', -24.0, DE_MERIDIAN_DECK_Y + 3.4, 22.08, 0);
  addWallStencil('B FOUNDRY →', '#27a3b8', 24.0, DE_MERIDIAN_DECK_Y + 3.4, 22.08, 0);
  addWallStencil('▲ AQUEDUCT MID', '#d99b38', 0, DE_MERIDIAN_DECK_Y + 2.6, 32.58, 0);

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
