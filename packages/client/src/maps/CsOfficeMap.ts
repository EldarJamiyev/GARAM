import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CS_OFFICE_BLOCKS,
  CS_OFFICE_COLLIDERS,
  CS_OFFICE_FLOOR_Y,
  CS_OFFICE_UPPER_Y,
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
  weaponId?: string;
}

export interface MapBuildResult {
  colliders: AABBCollider[];
  blocks: MapBlockCollider[];
  bots: BotEntity[];
}

interface OfficePBRPair {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

type OfficeSurfaceKind =
  | 'snow_courtyard'
  | 'office_carpet'
  | 'brick_facade'
  | 'office_drywall'
  | 'garage_concrete'
  | 'office_wood'
  | 'office_metal'
  | 'stair_concrete';

function createOfficeSurface(kind: OfficeSurfaceKind, anisotropy: number): OfficePBRPair {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  let seed = kind.length * 2971 + kind.charCodeAt(0) * 131;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  if (kind === 'snow_courtyard') {
    // Crisp winter packed snow with cool sky-blue shadows & subtle salted tarmac patches
    cCtx.fillStyle = '#dde5ee';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#909090';
    bCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 42; i++) {
      const rx = rand() * size;
      const ry = rand() * size;
      const rad = 28 + rand() * 72;
      const grad = cCtx.createRadialGradient(rx, ry, 4, rx, ry, rad);
      const cool = rand() > 0.45;
      grad.addColorStop(0, cool ? 'rgba(182, 200, 220, 0.34)' : 'rgba(245, 249, 255, 0.45)');
      grad.addColorStop(1, 'rgba(220, 229, 238, 0)');
      cCtx.fillStyle = grad;
      cCtx.fillRect(rx - rad, ry - rad, rad * 2, rad * 2);

      const bGrad = bCtx.createRadialGradient(rx, ry, 2, rx, ry, rad);
      bGrad.addColorStop(0, cool ? 'rgba(105,105,105,0.4)' : 'rgba(180,180,180,0.4)');
      bGrad.addColorStop(1, 'rgba(140,140,140,0)');
      bCtx.fillStyle = bGrad;
      bCtx.fillRect(rx - rad, ry - rad, rad * 2, rad * 2);
    }
    // Subtle dark wheel-track slush seams
    cCtx.fillStyle = 'rgba(84, 96, 110, 0.16)';
    cCtx.fillRect(92, 0, 56, size);
    cCtx.fillRect(344, 0, 56, size);
  } else if (kind === 'office_carpet') {
    // CS_OFFICE signature slate-blue commercial carpet tiles with crisp micro-weave
    cCtx.fillStyle = '#536273';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    const tile = 128;
    for (let y = 0; y < size; y += tile) {
      for (let x = 0; x < size; x += tile) {
        const delta = Math.floor((rand() - 0.5) * 14);
        const checker = ((x / tile + y / tile) % 2) === 0 ? 4 : -4;
        cCtx.fillStyle = `rgb(${83 + delta + checker}, ${98 + delta + checker}, ${115 + delta + checker})`;
        cCtx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
        // Subtle weave lines
        cCtx.fillStyle = 'rgba(255,255,255,0.035)';
        for (let w = 4; w < tile - 4; w += 8) {
          if (checker > 0) cCtx.fillRect(x + w, y + 2, 2, tile - 4);
          else cCtx.fillRect(x + 2, y + w, tile - 4, 2);
        }
        bCtx.fillStyle = `rgb(${132 + delta}, ${132 + delta}, ${132 + delta})`;
        bCtx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      }
    }
    cCtx.fillStyle = '#3d4a58';
    bCtx.fillStyle = '#383838';
    for (let p = 0; p < size; p += tile) {
      cCtx.fillRect(0, p, size, 2);
      cCtx.fillRect(p, 0, 2, size);
      bCtx.fillRect(0, p, size, 2);
      bCtx.fillRect(p, 0, 2, size);
    }
  } else if (kind === 'brick_facade') {
    // Iconic CS_OFFICE warm architectural reddish-tan exterior brickwork with pale mortar
    cCtx.fillStyle = '#9a8f84';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#363636';
    bCtx.fillRect(0, 0, size, size);

    const rows = 16;
    const cols = 8;
    const bh = size / rows;
    const bw = size / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw * 0.5);
      for (let c = -1; c <= cols; c++) {
        const x = c * bw + off;
        const y = r * bh;
        const s = Math.floor((rand() - 0.5) * 28);
        cCtx.fillStyle = `rgb(${156 + s}, ${96 + Math.floor(s * 0.65)}, ${74 + Math.floor(s * 0.5)})`;
        cCtx.fillRect(x + 3, y + 3, bw - 5, bh - 5);
        bCtx.fillStyle = `rgb(${165 + Math.floor(s * 0.5)}, ${165 + Math.floor(s * 0.5)}, ${165 + Math.floor(s * 0.5)})`;
        bCtx.fillRect(x + 3, y + 3, bw - 5, bh - 5);
      }
    }
    // Lower concrete winter plinth band
    cCtx.fillStyle = '#8b9298';
    cCtx.fillRect(0, size - 48, size, 48);
    cCtx.fillStyle = '#687078';
    cCtx.fillRect(0, size - 52, size, 4);
  } else if (kind === 'office_drywall') {
    // Bright Corona Real-Light painted cream/warm-white gypsum drywall with lower wainscot & baseboard
    cCtx.fillStyle = '#dfd9cc';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#929292';
    bCtx.fillRect(0, 0, size, size);

    // Subtle lower painted slate-beige wainscot
    cCtx.fillStyle = '#cbc4b6';
    cCtx.fillRect(0, Math.floor(size * 0.62), size, Math.floor(size * 0.38));

    // Vertical panel joint accents
    for (let x = 0; x < size; x += 128) {
      cCtx.fillStyle = 'rgba(130, 122, 110, 0.25)';
      cCtx.fillRect(x, 0, 2, size);
      bCtx.fillStyle = '#5c5c5c';
      bCtx.fillRect(x, 0, 2, size);
    }
    // Dark charcoal vinyl baseboard
    cCtx.fillStyle = '#383e46';
    cCtx.fillRect(0, size - 22, size, 22);
    bCtx.fillStyle = '#b4b4b4';
    bCtx.fillRect(0, size - 22, size, 22);
  } else if (kind === 'garage_concrete') {
    // Painted industrial concrete garage wall with safety yellow hazard band
    cCtx.fillStyle = '#8e969e';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#888888';
    bCtx.fillRect(0, 0, size, size);

    cCtx.strokeStyle = '#6c747c';
    cCtx.lineWidth = 3;
    cCtx.strokeRect(6, 6, size - 12, size / 2 - 12);
    cCtx.strokeRect(6, size / 2 + 6, size - 12, size / 2 - 12);

    // Subtle dark lower grime skirt
    cCtx.fillStyle = '#6c747c';
    cCtx.fillRect(0, size - 64, size, 64);
    // Subtle tactical hazard stripe
    cCtx.fillStyle = '#d4a63a';
    cCtx.fillRect(0, size - 72, size, 8);
  } else if (kind === 'office_wood') {
    // Warm honey-oak office desks, reception trim & copy-box shipping timber
    cCtx.fillStyle = '#9a6e45';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#888888';
    bCtx.fillRect(0, 0, size, size);

    const planks = 10;
    const ph = size / planks;
    for (let i = 0; i < planks; i++) {
      const s = Math.floor((rand() - 0.5) * 20);
      cCtx.fillStyle = `rgb(${156 + s}, ${112 + Math.floor(s * 0.7)}, ${70 + Math.floor(s * 0.5)})`;
      cCtx.fillRect(0, i * ph + 2, size, ph - 4);
      cCtx.fillStyle = '#6d4a2a';
      cCtx.fillRect(0, i * ph, size, 2);
      bCtx.fillStyle = '#404040';
      bCtx.fillRect(0, i * ph, size, 2);
    }
  } else if (kind === 'office_metal') {
    // Painted steel cabinets, copiers, vending machines & van panels
    cCtx.fillStyle = '#4b6178';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#888888';
    bCtx.fillRect(0, 0, size, size);

    for (let x = 0; x < size; x += 64) {
      cCtx.fillStyle = '#576f88';
      cCtx.fillRect(x + 2, 0, 58, size);
      cCtx.fillStyle = '#36495c';
      cCtx.fillRect(x, 0, 3, size);
      bCtx.fillStyle = '#383838';
      bCtx.fillRect(x, 0, 3, size);
    }
    // Horizontal drawer/vent seams
    for (let y = 64; y < size; y += 128) {
      cCtx.fillStyle = '#2d3d4d';
      cCtx.fillRect(10, y, size - 20, 4);
      bCtx.fillStyle = '#242424';
      bCtx.fillRect(10, y, size - 20, 4);
    }
  } else {
    // stair_concrete — textured brushed architectural stone steps with anti-slip nosing
    cCtx.fillStyle = '#9aa0a6';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 64) {
      cCtx.fillStyle = '#7c8288';
      cCtx.fillRect(0, y, size, 4);
      cCtx.fillStyle = '#4a5058';
      cCtx.fillRect(0, y + 4, size, 6);
      bCtx.fillStyle = '#c8c8c8';
      bCtx.fillRect(0, y + 4, size, 6);
    }
  }

  // Fine Corona-like micro-grain across all surfaces
  for (let i = 0; i < 1600; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const a = rand() * 0.065;
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

function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number, tileSize = 3.2): void {
  const uv = geo.attributes.uv;
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

function createBombsiteStencil(letter: 'A' | 'B', title: string, accentHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 512);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 14;
  ctx.setLineDash([34, 18]);
  ctx.beginPath();
  ctx.arc(256, 256, 224, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 7;
  ctx.strokeRect(112, 112, 288, 288);

  ctx.fillStyle = accentHex;
  ctx.font = '900 232px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 256, 260);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 30px "Segoe UI", Arial, sans-serif';
  ctx.fillText(title, 256, 422);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSignTexture(text: string, accentHex: string, bgHex = 'rgba(18, 26, 38, 0.88)'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(8, 12, 496, 104);
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 5;
  ctx.strokeRect(12, 16, 488, 96);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 42px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 65);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createProjectorSlideTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, '#0d2547');
  grad.addColorStop(1, '#1c4d8c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = 'rgba(120, 195, 255, 0.35)';
  ctx.lineWidth = 2;
  for (let x = 32; x < 512; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
  }
  ctx.fillStyle = '#e2f1ff';
  ctx.font = '800 30px "Segoe UI", Arial, sans-serif';
  ctx.fillText('CS_OFFICE // SECTOR A', 34, 58);

  // Clean bar chart bars
  const bars = [95, 130, 82, 154, 118, 142];
  bars.forEach((h, idx) => {
    ctx.fillStyle = idx === 3 ? '#38bdf8' : 'rgba(147, 197, 253, 0.72)';
    ctx.fillRect(42 + idx * 66, 224 - h, 42, h);
  });

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
  grad.addColorStop(0, 'rgba(12, 16, 24, 0.38)');
  grad.addColorStop(0.55, 'rgba(12, 16, 24, 0.12)');
  grad.addColorStop(1, 'rgba(12, 16, 24, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function resolveOfficeBucket(block: MapBlockCollider): OfficeSurfaceKind {
  if (block.id.startsWith('deck_')) return 'office_carpet';
  if (block.id.includes('_stairs_')) return 'stair_concrete';
  if (block.theme === 'brick') return 'brick_facade';
  if (block.theme === 'garage') return 'garage_concrete';
  if (block.material === 'DRYWALL') return 'office_drywall';
  if (block.material === 'WOOD_THIN') return 'office_wood';
  if (block.material === 'METAL_SHEET') return 'office_metal';
  return 'garage_concrete';
}

/**
 * Optionally auto-upgrades the world shell if `packages/client/public/models/cs_office.glb`
 * was downloaded via `scripts/build-cs-office.mjs` and flagged in `asset-manifest.json`.
 * Never triggers 404 console errors when absent.
 */
async function tryAttachOptionalCsOfficeGlb(scene: THREE.Scene, proceduralGroup: THREE.Group): Promise<void> {
  try {
    const res = await fetch('/models/asset-manifest.json');
    if (!res.ok) return;
    const manifest = (await res.json()) as Record<string, boolean>;
    if (!manifest.cs_office) return;

    const root = await AssetManager.getInstance().loadModel('/models/cs_office.glb', {
      castShadow: false,
      receiveShadow: true,
      envMapIntensity: 0.25,
    });
    if (!root) return;

    root.name = 'cs_office_glb_world';

    // 1. Remove distant skybox / background terrain nodes
    const toRemove: THREE.Object3D[] = [];
    root.traverse((c) => {
      const n = (c.name || '').toUpperCase();
      if (n.includes('BACK1') || n.includes('BACK2') || n.includes('TRANS6')) {
        toRemove.push(c);
      }
    });
    toRemove.forEach((c) => c.parent?.remove(c));
    root.updateMatrixWorld(true);

    // 2. Wrap and normalize into Three.js Y-up metric space (76m span, grounded at y = 0.0m)
    const wrapper = new THREE.Group();
    wrapper.name = 'cs_office_glb_world';
    wrapper.add(root);

    // Rotate Sketchfab Z-up to Three.js Y-up, aligning Courtyard at -Z and Back Office at +Z
    root.rotation.x = -Math.PI / 2;
    root.rotation.y = Math.PI;
    root.updateMatrixWorld(true);

    const initialBox = new THREE.Box3().setFromObject(wrapper);
    const size = new THREE.Vector3();
    initialBox.getSize(size);
    const scale = 76.0 / Math.max(size.x, size.z);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    const scaledBox = new THREE.Box3().setFromObject(wrapper);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);

    wrapper.position.x = -center.x;
    wrapper.position.z = -center.z;
    wrapper.position.y = -scaledBox.min.y;
    wrapper.updateMatrixWorld(true);

    // 3. Corona Real-Light calibration
    root.traverse((obj: THREE.Object3D) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (std && std.isMeshStandardMaterial) {
            std.roughness = 0.92;
            std.metalness = 0.0;
            std.envMapIntensity = 0.25;
            if (std.map) {
              std.emissive = new THREE.Color(0xffffff);
              std.emissiveMap = std.map;
              std.emissiveIntensity = 0.42;
            }
            std.needsUpdate = true;
          }
        }
      }
    });

    // 4. Hide procedural fallback geometry now that real 3D mesh is mounted
    proceduralGroup.visible = false;
    scene.add(wrapper);
    (window as unknown as { csOfficeGlbLoaded?: boolean }).csOfficeGlbLoaded = true;
  } catch {
    // Stay seamlessly on Corona Real-Light architectural build
  }
}

export function buildCsOfficeMap(scene: THREE.Scene): MapBuildResult {
  const aniso = AssetManager.getInstance().getMaxAnisotropy();
  const proceduralRoot = new THREE.Group();
  proceduralRoot.name = 'cs_office_procedural_world';
  scene.add(proceduralRoot);

  // 1. Corona Real-Light Calibrated PBR Material Set (Self-illuminated gentle GI bounce so indoor rooms never turn pitch black)
  const makeMat = (
    kind: OfficeSurfaceKind,
    roughness: number,
    metalness: number,
    emissiveBoost: number
  ): THREE.MeshStandardMaterial => {
    const { map, bumpMap } = createOfficeSurface(kind, aniso);
    return new THREE.MeshStandardMaterial({
      map,
      bumpMap,
      bumpScale: kind === 'snow_courtyard' ? 0.04 : 0.03,
      roughness,
      metalness,
      envMapIntensity: 0.28,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: map,
      emissiveIntensity: emissiveBoost,
    });
  };

  const materials: Record<OfficeSurfaceKind, THREE.MeshStandardMaterial> = {
    snow_courtyard: makeMat('snow_courtyard', 0.88, 0.02, 0.34),
    office_carpet: makeMat('office_carpet', 0.94, 0.0, 0.30),
    brick_facade: makeMat('brick_facade', 0.88, 0.02, 0.22),
    office_drywall: makeMat('office_drywall', 0.90, 0.0, 0.36),
    garage_concrete: makeMat('garage_concrete', 0.86, 0.05, 0.24),
    office_wood: makeMat('office_wood', 0.72, 0.04, 0.24),
    office_metal: makeMat('office_metal', 0.42, 0.58, 0.16),
    stair_concrete: makeMat('stair_concrete', 0.85, 0.05, 0.24),
  };

  // 2. Snowy Front Courtyard & Garage Concrete Floor (y = 0.0m, z in [-34, -12])
  const snowFloorGeo = new THREE.PlaneGeometry(54, 24);
  snowFloorGeo.rotateX(-Math.PI / 2);
  scalePlaneUVs(snowFloorGeo, 54 / 6, 24 / 6);
  const snowFloor = new THREE.Mesh(snowFloorGeo, materials.snow_courtyard);
  snowFloor.position.set(-11.5, 0.0, -23.0);
  snowFloor.receiveShadow = true;
  proceduralRoot.add(snowFloor);

  const garageFloorGeo = new THREE.PlaneGeometry(24, 24);
  garageFloorGeo.rotateX(-Math.PI / 2);
  scalePlaneUVs(garageFloorGeo, 24 / 4, 24 / 4);
  const garageFloor = new THREE.Mesh(garageFloorGeo, materials.garage_concrete);
  garageFloor.position.set(26.5, 0.0, -23.0);
  garageFloor.receiveShadow = true;
  proceduralRoot.add(garageFloor);

  // Dark salted tarmac drive lane leading into Garage bay
  const tarmacMat = new THREE.MeshStandardMaterial({
    color: 0x38414a,
    roughness: 0.78,
    metalness: 0.05,
    emissive: new THREE.Color(0x1f252b),
    emissiveIntensity: 0.22,
  });
  const tarmacStrip = new THREE.Mesh(new THREE.PlaneGeometry(14, 18), tarmacMat);
  tarmacStrip.rotation.x = -Math.PI / 2;
  tarmacStrip.position.set(4.5, 0.008, -24.5);
  tarmacStrip.receiveShadow = true;
  proceduralRoot.add(tarmacStrip);

  // 3. Batch All Map Collider Blocks by Material (<= 8 draw calls!)
  const buckets: Record<OfficeSurfaceKind, THREE.BufferGeometry[]> = {
    snow_courtyard: [],
    office_carpet: [],
    brick_facade: [],
    office_drywall: [],
    garage_concrete: [],
    office_wood: [],
    office_metal: [],
    stair_concrete: [],
  };

  const chairRailGeos: THREE.BufferGeometry[] = [];
  const steelTrimGeos: THREE.BufferGeometry[] = [];
  const aoGeos: THREE.BufferGeometry[] = [];

  for (const block of CS_OFFICE_BLOCKS) {
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

    buckets[resolveOfficeBucket(block)].push(geo);

    // 1.65m Oak Crosshair-Placement Chair Rail + Grounded Contact AO on Interior Drywall Walls
    if (block.material === 'DRYWALL' && h >= 3.2) {
      const rail = new THREE.BoxGeometry(w + 0.06, 0.11, d + 0.06);
      rail.translate(cx, CS_OFFICE_FLOOR_Y + 1.65, cz);
      chairRailGeos.push(rail);

      // Doorway header / ceiling crown trim
      const crown = new THREE.BoxGeometry(w + 0.05, 0.14, d + 0.05);
      crown.translate(cx, block.maxY - 0.08, cz);
      steelTrimGeos.push(crown);

      const aoPad = 0.45;
      const aoY = CS_OFFICE_FLOOR_Y + 0.012;
      const nStrip = new THREE.PlaneGeometry(w + aoPad * 2, aoPad);
      nStrip.rotateX(-Math.PI / 2);
      nStrip.rotateY(Math.PI);
      nStrip.translate(cx, aoY, block.minZ - aoPad * 0.5);
      aoGeos.push(nStrip);

      const sStrip = new THREE.PlaneGeometry(w + aoPad * 2, aoPad);
      sStrip.rotateX(-Math.PI / 2);
      sStrip.translate(cx, aoY, block.maxZ + aoPad * 0.5);
      aoGeos.push(sStrip);
    }
  }

  for (const [key, geos] of Object.entries(buckets) as [OfficeSurfaceKind, THREE.BufferGeometry[]][]) {
    if (geos.length === 0) continue;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials[key]);
    mesh.castShadow = false; // Corona Real-Light style: keep static baked light bright & crisp
    mesh.receiveShadow = true;
    proceduralRoot.add(mesh);
  }

  const addBatch = (
    geos: THREE.BufferGeometry[],
    mat: THREE.Material,
    isRoof = false
  ): void => {
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    if (isRoof) mesh.userData.isOfficeRoof = true;
    proceduralRoot.add(mesh);
  };

  // Oak Chair Rails + Entryway Door Frames
  addBatch(
    chairRailGeos,
    new THREE.MeshStandardMaterial({ color: 0x7c5332, roughness: 0.65, metalness: 0.04, emissive: 0x2a1c10, emissiveIntensity: 0.35 })
  );

  // Exterior Office Facade Steel-Mullioned Windows & Entry Portals
  const windowGlassGeos: THREE.BufferGeometry[] = [];
  const windowSpecs: [number, number, number, number][] = [
    [-20.5, 3.6, -12.66, 9.5],
    [-10.5, 3.6, -12.66, 7.5],
    [10.2, 3.6, -12.66, 7.8],
    [18.2, 3.6, -12.66, 6.2],
    [33.5, 3.6, -12.66, 6.4],
  ];
  for (const [wx, wy, wz, ww] of windowSpecs) {
    const pane = new THREE.BoxGeometry(ww, 2.2, 0.08);
    pane.translate(wx, wy, wz);
    windowGlassGeos.push(pane);

    const frameTop = new THREE.BoxGeometry(ww + 0.3, 0.22, 0.24);
    frameTop.translate(wx, wy + 1.18, wz);
    steelTrimGeos.push(frameTop);

    const frameBot = new THREE.BoxGeometry(ww + 0.3, 0.24, 0.28);
    frameBot.translate(wx, wy - 1.18, wz);
    steelTrimGeos.push(frameBot);
  }

  // Entry Portal Archway Lintels (Long Entry, Main Front Entry, Garage Entry)
  for (const [ex, ew] of [[-30, 6.4], [0, 10.4], [26, 6.4]]) {
    const lintel = new THREE.BoxGeometry(ew, 0.9, 0.8);
    lintel.translate(ex, 5.15, -12.3);
    steelTrimGeos.push(lintel);
  }

  // Sniper Mezzanine Safety Handrail (y = 3.5 -> 4.35m)
  const mezzRailFront = new THREE.BoxGeometry(14.0, 0.12, 0.12);
  mezzRailFront.translate(0, CS_OFFICE_UPPER_Y + 0.85, -8.55);
  steelTrimGeos.push(mezzRailFront);
  for (let rx = -6.5; rx <= 6.5; rx += 2.6) {
    const post = new THREE.BoxGeometry(0.08, 0.85, 0.08);
    post.translate(rx, CS_OFFICE_UPPER_Y + 0.425, -8.55);
    steelTrimGeos.push(post);
  }

  // Delivery Van Accent Details (Blue Cab Hood, Windshield, Wheels)
  const vanWindshield = new THREE.BoxGeometry(4.6, 0.85, 0.14);
  vanWindshield.translate(-17.0, 1.85, -21.92);
  windowGlassGeos.push(vanWindshield);

  addBatch(
    steelTrimGeos,
    new THREE.MeshStandardMaterial({ color: 0x333c48, roughness: 0.48, metalness: 0.62, emissive: 0x10141a, emissiveIntensity: 0.25 })
  );
  addBatch(
    windowGlassGeos,
    new THREE.MeshStandardMaterial({
      color: 0xcbe6ff,
      roughness: 0.12,
      metalness: 0.22,
      emissive: new THREE.Color(0x9bd1ff),
      emissiveIntensity: 0.55,
    })
  );

  // 4. Acoustic Drop-Ceiling Grid + Glowing Fluorescent Troffers (Tagged isOfficeRoof = true for top-down radar!)
  const roofPanelGeos: THREE.BufferGeometry[] = [];
  const trofferGeos: THREE.BufferGeometry[] = [];

  // Structural ceiling beams across interior office (z in [-12, 38])
  for (let bz = -10; bz <= 36; bz += 8) {
    const beam = new THREE.BoxGeometry(76, 0.22, 0.42);
    beam.translate(0, 5.52, bz);
    roofPanelGeos.push(beam);
  }
  for (let bx = -32; bx <= 32; bx += 16) {
    const crossBeam = new THREE.BoxGeometry(0.42, 0.22, 50);
    crossBeam.translate(bx, 5.52, 13);
    roofPanelGeos.push(crossBeam);
  }
  // Subtle recessed light-grey acoustic ceiling deck
  const ceilingDeck = new THREE.BoxGeometry(76, 0.12, 50);
  ceilingDeck.translate(0, 5.66, 13);
  roofPanelGeos.push(ceilingDeck);

  // Glowing Fluorescent Office Ceiling Light Troffers (Corona Real-Light feel!)
  const trofferCoords: [number, number][] = [
    [-30, -4], [-30, 8], [-30, 20],
    [-15, -7], [-15, 2], [-15, 10], [-15, 20],
    [0, -7], [2, 3], [2, 13], [2, 22], [0, 32],
    [22, -7], [22, 1], [24, 9], [24, 20], [22, 32],
    [-14, 32],
  ];
  for (const [tx, tz] of trofferCoords) {
    const lamp = new THREE.BoxGeometry(2.6, 0.08, 1.1);
    lamp.translate(tx, 5.44, tz);
    trofferGeos.push(lamp);
  }

  addBatch(
    roofPanelGeos,
    new THREE.MeshStandardMaterial({ color: 0xd4d9df, roughness: 0.92, metalness: 0.02, emissive: 0x5c6470, emissiveIntensity: 0.35 }),
    true
  );
  addBatch(
    trofferGeos,
    new THREE.MeshBasicMaterial({ color: 0xf4f9ff }),
    true
  );

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
      proceduralRoot.add(new THREE.Mesh(mergedAo, aoMat));
    }
  }

  // 5. Iconic CS_OFFICE Landmarks: Projector Screen (Site A), Stacked Paper Crates (Site B), Vending Machine & Monitors
  const projScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 2.8),
    new THREE.MeshBasicMaterial({ map: createProjectorSlideTexture() })
  );
  projScreen.position.set(25.0, CS_OFFICE_FLOOR_Y + 2.45, -2.92);
  proceduralRoot.add(projScreen);

  // Glowing Red/White Soda Vending Machine Front Panel (Main Hall)
  const vendingPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.75),
    new THREE.MeshBasicMaterial({ color: 0xe64949 })
  );
  vendingPanel.rotation.y = Math.PI / 2;
  vendingPanel.position.set(-3.96, CS_OFFICE_FLOOR_Y + 1.15, 17.2);
  proceduralRoot.add(vendingPanel);

  // Reception Desk Glowing Twin Monitors
  const monitorMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
  for (const mx of [-4.9, -3.6]) {
    const mon = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.42, 0.06), monitorMat);
    mon.position.set(mx, CS_OFFICE_FLOOR_Y + 1.42, -5.95);
    proceduralRoot.add(mon);
  }

  // 6. Grounded Bombsite Floor Stencils (y = CS_OFFICE_FLOOR_Y + 0.024)
  const stencilA = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 7.2),
    new THREE.MeshBasicMaterial({
      map: createBombsiteStencil('A', 'PROJECTOR', '#f97316'),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  );
  stencilA.rotation.x = -Math.PI / 2;
  stencilA.position.set(BOMBSITES.A.center.x, CS_OFFICE_FLOOR_Y + 0.024, BOMBSITES.A.center.z);
  proceduralRoot.add(stencilA);

  const stencilB = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 7.2),
    new THREE.MeshBasicMaterial({
      map: createBombsiteStencil('B', 'PAPER ROOM', '#38bdf8'),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  );
  stencilB.rotation.x = -Math.PI / 2;
  stencilB.position.set(BOMBSITES.B.center.x, CS_OFFICE_FLOOR_Y + 0.024, BOMBSITES.B.center.z);
  proceduralRoot.add(stencilB);

  // 7. Crisp CS_OFFICE Wayfinding Signs (Instant 0.2s Sector Readability)
  const addSign = (text: string, color: string, x: number, y: number, z: number, rotY: number) => {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.85),
      new THREE.MeshBasicMaterial({ map: createSignTexture(text, color) })
    );
    sign.position.set(x, y, z);
    sign.rotation.y = rotY;
    proceduralRoot.add(sign);
  };

  addSign('CS_OFFICE // MAIN ENTRY', '#38bdf8', 0, 4.45, -12.68, Math.PI);
  addSign('LONG HALL / PAPER B →', '#38bdf8', -30, 4.45, -12.68, Math.PI);
  addSign('← GARAGE / PROJECTOR A', '#f97316', 26, 4.45, -12.68, Math.PI);
  addSign('← PAPER ROOM [B]', '#38bdf8', -6.8, CS_OFFICE_FLOOR_Y + 3.2, -3.68, Math.PI);
  addSign('PROJECTOR [A] →', '#f97316', 9.2, CS_OFFICE_FLOOR_Y + 3.2, -3.68, Math.PI);
  addSign('▲ FRONT HALL / COURTYARD', '#38bdf8', 0, CS_OFFICE_FLOOR_Y + 3.2, 24.92, Math.PI);

  // 8. Balanced Real-Light Interior Fluorescent & Window Bounce PointLights (Light-count budget <= 6)
  const interiorLights: [number, number, number, number, number, number][] = [
    [0, 4.9, -7.0, 0xedf6ff, 1.25, 26],     // Front Hall / Reception fluorescent wash
    [-15, 4.9, 4.5, 0xf2f7ff, 1.25, 26],    // Paper Room (Bombsite B)
    [24, 4.9, 2.5, 0xfff4e4, 1.35, 28],     // Projector / Conference (Bombsite A)
    [2, 4.9, 12.0, 0xedf5ff, 1.15, 26],     // Main Hall
    [-30, 4.9, 8.0, 0xe8f3ff, 1.10, 24],    // Long Hall
    [0, 4.9, 31.0, 0xfff0dd, 1.20, 26],     // Syndicate T Back Office
  ];
  for (const [lx, ly, lz, color, intensity, dist] of interiorLights) {
    const pt = new THREE.PointLight(color, intensity, dist, 1.5);
    pt.position.set(lx, ly, lz);
    scene.add(pt);
  }

  // Trigger optional Sketchfab GLB auto-upgrade if present in asset-manifest.json
  void tryAttachOptionalCsOfficeGlb(scene, proceduralRoot);

  // 9. Spawn Grounded 5v5 Tactical Bots on CS_OFFICE
  const bots: BotEntity[] = [];
  for (const cfg of TACTICAL_BOTS) {
    const rig = new OperatorRig(cfg.team, cfg.name);
    const wp0 = cfg.waypoints[0];
    rig.root.position.set(wp0.x, wp0.y, wp0.z);
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
      weaponId: cfg.team === 'Vanguard' ? 'm4a1-s' : 'garam-47',
    });
  }

  return {
    colliders: CS_OFFICE_COLLIDERS,
    blocks: CS_OFFICE_BLOCKS,
    bots,
  };
}

function scalePlaneUVs(geo: THREE.PlaneGeometry, uScale: number, vScale: number): void {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
  }
  uv.needsUpdate = true;
}

export type { SurfaceMaterial };
