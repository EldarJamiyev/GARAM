import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DE_CITADEL_BLOCKS,
  MapBlockCollider,
  TACTICAL_BOTS,
  BOMBSITES,
  Vec3,
  AABBCollider,
} from '@garam/shared';
import { OperatorRig } from '../render/OperatorRig.js';

export interface BotEntity {
  id: string;
  name: string;
  mesh: THREE.Group;
  rig?: OperatorRig;
  headCollider: THREE.Mesh;
  bodyCollider: THREE.Mesh;
  health: number;
  maxHealth: number;
  armor: number;
  hasHelmet: boolean;
  isDead: boolean;
  team: 'Vanguard' | 'Syndicate';
  vx: number;
  vz: number;
  patrolTarget: THREE.Vector3;
  lastShotTime: number;
  patrolWaypoints: THREE.Vector3[];
  waypointIndex: number;
  kills: number;
  deaths: number;
}

export function createProceduralTextures(maxAnisotropy = 8) {
  // 1. Sun-Baked Citadel Limestone Flagstone Courtyard (Warm CS2 Mirage/Dust2 paving)
  const canvasConcrete = document.createElement('canvas');
  canvasConcrete.width = 512;
  canvasConcrete.height = 512;
  const ctxC = canvasConcrete.getContext('2d')!;

  ctxC.fillStyle = '#b9a992';
  ctxC.fillRect(0, 0, 512, 512);

  // Subtle flagstone tile color variation (4x4 stone slabs)
  const slabTones = ['#bdaea0', '#c4b49c', '#b1a089', '#c0af95', '#b6a58d'];
  for (let row = 0; row < 4; row++) {
    const offset = (row % 2) * 64;
    for (let col = -1; col < 5; col++) {
      ctxC.fillStyle = slabTones[(row * 5 + col + 10) % slabTones.length];
      ctxC.fillRect(col * 128 + offset + 2, row * 128 + 2, 124, 124);
    }
  }

  // Organic sandstone mineral speckle & wind-blown dust grain
  for (let i = 0; i < 48000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const val = Math.random();
    ctxC.fillStyle = val > 0.55 ? 'rgba(255,248,235,0.09)' : 'rgba(65,52,38,0.10)';
    ctxC.fillRect(x, y, 2, 2);
  }

  // Grout joints & subtle bevel highlights
  ctxC.strokeStyle = 'rgba(58, 48, 36, 0.42)';
  ctxC.lineWidth = 3;
  for (let row = 0; row < 4; row++) {
    const y = row * 128;
    ctxC.beginPath();
    ctxC.moveTo(0, y);
    ctxC.lineTo(512, y);
    ctxC.stroke();
    const offset = (row % 2) * 64;
    for (let col = 0; col <= 4; col++) {
      const x = (col * 128 + offset) % 512;
      ctxC.beginPath();
      ctxC.moveTo(x, y);
      ctxC.lineTo(x, y + 128);
      ctxC.stroke();
    }
  }

  const concreteTex = new THREE.CanvasTexture(canvasConcrete);
  concreteTex.colorSpace = THREE.SRGBColorSpace;
  concreteTex.wrapS = THREE.RepeatWrapping;
  concreteTex.wrapT = THREE.RepeatWrapping;
  concreteTex.repeat.set(22, 22);
  concreteTex.anisotropy = maxAnisotropy;

  // 2. Fortified Mediterranean Sandstone & Stucco Wall with 1.65m Head-Height Cornice Band
  const canvasWall = document.createElement('canvas');
  canvasWall.width = 512;
  canvasWall.height = 512;
  const ctxW = canvasWall.getContext('2d')!;

  const wallGrad = ctxW.createLinearGradient(0, 0, 0, 512);
  wallGrad.addColorStop(0.0, '#d3c4aa');
  wallGrad.addColorStop(0.65, '#c5b498');
  wallGrad.addColorStop(0.88, '#a6967c');
  wallGrad.addColorStop(1.0, '#786c5a');
  ctxW.fillStyle = wallGrad;
  ctxW.fillRect(0, 0, 512, 512);

  // Subtle ashlar stone masonry courses on lower half
  ctxW.strokeStyle = 'rgba(72, 58, 42, 0.24)';
  ctxW.lineWidth = 2;
  for (let y = 320; y < 480; y += 40) {
    ctxW.beginPath();
    ctxW.moveTo(0, y);
    ctxW.lineTo(512, y);
    ctxW.stroke();
    const shift = ((y / 40) % 2) * 64;
    for (let x = shift; x < 512; x += 128) {
      ctxW.beginPath();
      ctxW.moveTo(x, y);
      ctxW.lineTo(x, y + 40);
      ctxW.stroke();
    }
  }

  // Sun-weathered stucco micro-grain & plaster variation
  for (let i = 0; i < 42000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctxW.fillStyle = Math.random() > 0.5 ? 'rgba(255,250,238,0.08)' : 'rgba(62,48,32,0.09)';
    ctxW.fillRect(x, y, 2, 2);
  }

  // Dark stone protective base plinth (bottom 36px)
  ctxW.fillStyle = '#5a5043';
  ctxW.fillRect(0, 476, 512, 36);
  ctxW.fillStyle = 'rgba(30, 24, 18, 0.45)';
  ctxW.fillRect(0, 474, 512, 4);

  // 1.65m Head-Height Architectural Travertine Molding (CS2 Pro Pre-Aim Datum Line)
  ctxW.fillStyle = '#7b6c58';
  ctxW.fillRect(0, 308, 512, 14);
  ctxW.fillStyle = '#e3d5bc';
  ctxW.fillRect(0, 306, 512, 3);
  ctxW.fillStyle = 'rgba(42, 34, 24, 0.35)';
  ctxW.fillRect(0, 322, 512, 4);

  // Top parapet trim band
  ctxW.fillStyle = '#8b7b65';
  ctxW.fillRect(0, 0, 512, 18);
  ctxW.fillStyle = 'rgba(35, 28, 20, 0.35)';
  ctxW.fillRect(0, 18, 512, 4);

  // Vertical architectural pilaster seam
  ctxW.strokeStyle = 'rgba(58, 46, 34, 0.28)';
  ctxW.lineWidth = 2;
  ctxW.beginPath();
  ctxW.moveTo(256, 0);
  ctxW.lineTo(256, 512);
  ctxW.stroke();

  const wallTex = new THREE.CanvasTexture(canvasWall);
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(4, 1.5);
  wallTex.anisotropy = maxAnisotropy;

  // 3. Detailed Military Timber Supply Crate (Planks, Wood Grain, Steel Corner Plates)
  const canvasCrate = document.createElement('canvas');
  canvasCrate.width = 512;
  canvasCrate.height = 512;
  const ctxCr = canvasCrate.getContext('2d')!;

  ctxCr.fillStyle = '#9a6d42';
  ctxCr.fillRect(0, 0, 512, 512);

  // Wood plank tones & fine horizontal grain
  const plankColors = ['#9c6e42', '#8f6339', '#a37548', '#895e36'];
  for (let p = 0; p < 8; p++) {
    ctxCr.fillStyle = plankColors[p % plankColors.length];
    ctxCr.fillRect(0, p * 64, 512, 62);
    ctxCr.fillStyle = 'rgba(34, 20, 10, 0.55)';
    ctxCr.fillRect(0, p * 64 + 61, 512, 3);
  }
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctxCr.fillStyle = Math.random() > 0.5 ? 'rgba(255,220,175,0.06)' : 'rgba(38,22,10,0.10)';
    ctxCr.fillRect(x, y, 18 + Math.random() * 24, 2);
  }

  // Heavy exterior timber framing & diagonal brace
  ctxCr.strokeStyle = '#6c4726';
  ctxCr.lineWidth = 34;
  ctxCr.strokeRect(17, 17, 478, 478);
  ctxCr.strokeStyle = '#5a3a1e';
  ctxCr.lineWidth = 24;
  ctxCr.beginPath();
  ctxCr.moveTo(32, 32);
  ctxCr.lineTo(480, 480);
  ctxCr.stroke();

  // Inner recessed shadow line
  ctxCr.strokeStyle = 'rgba(20, 12, 6, 0.55)';
  ctxCr.lineWidth = 4;
  ctxCr.strokeRect(34, 34, 444, 444);

  // Galvanized steel corner brackets & bolt rivets
  ctxCr.fillStyle = '#383d42';
  const corners = [
    [0, 0],
    [456, 0],
    [0, 456],
    [456, 456],
  ];
  for (const [cx, cy] of corners) {
    ctxCr.fillRect(cx, cy, 56, 56);
    ctxCr.fillStyle = '#6b727a';
    ctxCr.fillRect(cx + 10, cy + 10, 8, 8);
    ctxCr.fillRect(cx + 38, cy + 38, 8, 8);
    ctxCr.fillStyle = '#383d42';
  }

  // Faded military cargo stencil
  ctxCr.fillStyle = 'rgba(24, 18, 12, 0.55)';
  ctxCr.font = 'bold 34px monospace';
  ctxCr.textAlign = 'center';
  ctxCr.fillText('GARAM // 04', 256, 268);

  const crateTex = new THREE.CanvasTexture(canvasCrate);
  crateTex.colorSpace = THREE.SRGBColorSpace;
  crateTex.anisotropy = maxAnisotropy;

  // 4. Weathered Tactical Hazard Beam
  const canvasHazard = document.createElement('canvas');
  canvasHazard.width = 256;
  canvasHazard.height = 256;
  const ctxH = canvasHazard.getContext('2d')!;

  ctxH.fillStyle = '#d4a31e';
  ctxH.fillRect(0, 0, 256, 256);
  ctxH.fillStyle = '#222428';

  for (let i = -256; i < 512; i += 40) {
    ctxH.beginPath();
    ctxH.moveTo(i, 0);
    ctxH.lineTo(i + 20, 0);
    ctxH.lineTo(i + 20 + 256, 256);
    ctxH.lineTo(i + 256, 256);
    ctxH.fill();
  }
  for (let i = 0; i < 4000; i++) {
    ctxH.fillStyle = 'rgba(0,0,0,0.08)';
    ctxH.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }

  const hazardTex = new THREE.CanvasTexture(canvasHazard);
  hazardTex.colorSpace = THREE.SRGBColorSpace;
  hazardTex.wrapS = THREE.RepeatWrapping;
  hazardTex.wrapT = THREE.RepeatWrapping;
  hazardTex.repeat.set(4, 1);
  hazardTex.anisotropy = maxAnisotropy;

  // 5. Weathered Corrugated Steel Shipping Container (with specular relief & rust streaks)
  const canvasCorrugated = document.createElement('canvas');
  canvasCorrugated.width = 256;
  canvasCorrugated.height = 256;
  const ctxCorr = canvasCorrugated.getContext('2d')!;

  ctxCorr.fillStyle = '#264461';
  ctxCorr.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    ctxCorr.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctxCorr.fillRect(x, 0, 4, 256);
    ctxCorr.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctxCorr.fillRect(x + 8, 0, 8, 256);
  }
  // Subtle lower grime & weathering
  const corrGrime = ctxCorr.createLinearGradient(0, 180, 0, 256);
  corrGrime.addColorStop(0, 'rgba(30, 22, 16, 0.0)');
  corrGrime.addColorStop(1, 'rgba(30, 22, 16, 0.42)');
  ctxCorr.fillStyle = corrGrime;
  ctxCorr.fillRect(0, 180, 256, 76);

  const containerBlueTex = new THREE.CanvasTexture(canvasCorrugated);
  containerBlueTex.colorSpace = THREE.SRGBColorSpace;
  containerBlueTex.wrapS = THREE.RepeatWrapping;
  containerBlueTex.wrapT = THREE.RepeatWrapping;
  containerBlueTex.anisotropy = maxAnisotropy;

  // 6. Paired PBR Bump/Roughness Maps (Linear NoColorSpace for realistic surface relief)
  const makeGrayTex = (srcCanvas: HTMLCanvasElement, repeatX: number, repeatY: number): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(srcCanvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = maxAnisotropy;
    return tex;
  };

  const concreteBump = makeGrayTex(canvasConcrete, 22, 22);
  const wallBump = makeGrayTex(canvasWall, 4, 1.5);
  const crateBump = makeGrayTex(canvasCrate, 1, 1);
  const corrBump = makeGrayTex(canvasCorrugated, 1, 1);

  return {
    concreteTex,
    concreteBump,
    wallTex,
    wallBump,
    crateTex,
    crateBump,
    hazardTex,
    containerBlueTex,
    corrBump,
  };
}

export function buildTacticalCitadelMap(scene: THREE.Scene): {
  bots: BotEntity[];
  blocks: MapBlockCollider[];
  colliders: AABBCollider[];
  bombsites: { A: THREE.Vector3; B: THREE.Vector3 };
} {
  const {
    concreteTex,
    concreteBump,
    wallTex,
    wallBump,
    crateTex,
    crateBump,
    hazardTex,
    containerBlueTex,
    corrBump,
  } = createProceduralTextures();

  // 120m x 120m Sun-Baked Sandstone Flagstone Floor
  const floorGeo = new THREE.PlaneGeometry(124, 124);
  const floorMat = new THREE.MeshStandardMaterial({
    map: concreteTex,
    bumpMap: concreteBump,
    bumpScale: 0.045,
    roughnessMap: concreteBump,
    roughness: 0.86,
    metalness: 0.04,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Shared authoritative map colliders (100% locked to DE_CITADEL_BLOCKS)
  const blocks = DE_CITADEL_BLOCKS;
  const colliders: AABBCollider[] = [];

  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    bumpMap: wallBump,
    bumpScale: 0.055,
    roughnessMap: wallBump,
    roughness: 0.86,
    metalness: 0.04,
  });
  const copingMat = new THREE.MeshStandardMaterial({
    color: 0x8f7e68,
    bumpMap: wallBump,
    bumpScale: 0.03,
    roughness: 0.9,
    metalness: 0.05,
  });
  const timberMat = new THREE.MeshStandardMaterial({
    color: 0x5c3e24,
    bumpMap: crateBump,
    bumpScale: 0.04,
    roughness: 0.88,
    metalness: 0.04,
  });
  const crateMat = new THREE.MeshStandardMaterial({
    map: crateTex,
    bumpMap: crateBump,
    bumpScale: 0.06,
    roughness: 0.84,
    metalness: 0.08,
  });
  const hazardMat = new THREE.MeshStandardMaterial({
    map: hazardTex,
    roughness: 0.48,
    metalness: 0.32,
  });
  const containerBlueMat = new THREE.MeshStandardMaterial({
    map: containerBlueTex,
    bumpMap: corrBump,
    bumpScale: 0.065,
    roughness: 0.42,
    metalness: 0.68,
    envMapIntensity: 1.35,
  });
  const containerRedMat = new THREE.MeshStandardMaterial({
    color: 0x8e3028,
    bumpMap: corrBump,
    bumpScale: 0.065,
    roughness: 0.44,
    metalness: 0.65,
    envMapIntensity: 1.35,
  });

  // Contact AO floor gradient for wall & crate bases
  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = 64; aoCanvas.height = 64;
  const aoCtx = aoCanvas.getContext('2d')!;
  const aoGrad = aoCtx.createLinearGradient(0, 0, 0, 64);
  aoGrad.addColorStop(0, 'rgba(28, 20, 12, 0.58)');
  aoGrad.addColorStop(0.5, 'rgba(28, 20, 12, 0.22)');
  aoGrad.addColorStop(1, 'rgba(28, 20, 12, 0.0)');
  aoCtx.fillStyle = aoGrad;
  aoCtx.fillRect(0, 0, 64, 64);
  const aoTex = new THREE.CanvasTexture(aoCanvas);
  aoTex.colorSpace = THREE.SRGBColorSpace;
  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const wallGeos: THREE.BufferGeometry[] = [];
  const copingGeos: THREE.BufferGeometry[] = [];
  const timberGeos: THREE.BufferGeometry[] = [];
  const crateGeos: THREE.BufferGeometry[] = [];
  const containerBlueGeos: THREE.BufferGeometry[] = [];
  const containerRedGeos: THREE.BufferGeometry[] = [];
  const hazardGeos: THREE.BufferGeometry[] = [];
  const aoGeos: THREE.BufferGeometry[] = [];

  for (const b of blocks) {
    colliders.push({
      minX: b.minX,
      maxX: b.maxX,
      minY: b.minY,
      maxY: b.maxY,
      minZ: b.minZ,
      maxZ: b.maxZ,
    });

    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    geo.translate(b.x, b.y + b.h / 2, b.z);

    if (b.material === 'WOOD_THIN') {
      crateGeos.push(geo);
    } else if (b.id.includes('container_blue')) {
      containerBlueGeos.push(geo);
    } else if (b.id.includes('container_red')) {
      containerRedGeos.push(geo);
    } else if (b.id.includes('lintel')) {
      hazardGeos.push(geo);
    } else {
      wallGeos.push(geo);
      // Flush stone parapet coping cap atop walls (zero collision overhang, high CS2 silhouette polish)
      if (b.h >= 2.2 && b.w <= 62 && b.d <= 62) {
        const cap = new THREE.BoxGeometry(b.w + 0.12, 0.18, b.d + 0.12);
        cap.translate(b.x, b.y + b.h + 0.09, b.z);
        copingGeos.push(cap);
      }
    }

    // Grounded Contact AO Floor Strips along all 4 wall & crate base edges
    if (b.y <= 0.1 && b.h >= 1.5 && b.w <= 50 && b.d <= 50) {
      const gFront = new THREE.PlaneGeometry(b.w, 0.48);
      gFront.rotateX(-Math.PI / 2);
      gFront.translate(b.x, 0.014, b.z + b.d / 2 + 0.24);
      aoGeos.push(gFront);

      const gBack = new THREE.PlaneGeometry(b.w, 0.48);
      gBack.rotateX(Math.PI / 2);
      gBack.translate(b.x, 0.014, b.z - b.d / 2 - 0.24);
      aoGeos.push(gBack);

      const gRight = new THREE.PlaneGeometry(b.d, 0.48);
      gRight.rotateX(-Math.PI / 2);
      gRight.rotateY(Math.PI / 2);
      gRight.translate(b.x + b.w / 2 + 0.24, 0.014, b.z);
      aoGeos.push(gRight);

      const gLeft = new THREE.PlaneGeometry(b.d, 0.48);
      gLeft.rotateX(-Math.PI / 2);
      gLeft.rotateY(-Math.PI / 2);
      gLeft.translate(b.x - b.w / 2 - 0.24, 0.014, b.z);
      aoGeos.push(gLeft);
    }
  }

  // Overhead CS2 Mirage-Style Timber Sun-Pergola Rafters spanning Mid Choke (y=6.2m, clear of gameplay)
  for (let i = 0; i < 7; i++) {
    const beam = new THREE.BoxGeometry(10.5, 0.22, 0.24);
    beam.translate(3.0, 6.35, -3.5 + i * 1.15);
    timberGeos.push(beam);
  }
  const sideRunnerL = new THREE.BoxGeometry(0.28, 0.28, 8.2);
  sideRunnerL.translate(-2.0, 6.2, 0.0);
  timberGeos.push(sideRunnerL);
  const sideRunnerR = new THREE.BoxGeometry(0.28, 0.28, 8.2);
  sideRunnerR.translate(8.0, 6.2, 0.0);
  timberGeos.push(sideRunnerR);

  // Catwalk Steel Support Trusses (Merged into existing batches = 0 extra draw calls)
  const catwalkTruss = new THREE.BoxGeometry(0.22, 0.22, 14.0);
  catwalkTruss.translate(-26.5, 3.4, -26.0);
  hazardGeos.push(catwalkTruss);

  const catwalkCross1 = new THREE.BoxGeometry(0.16, 0.16, 4.2);
  catwalkCross1.rotateY(Math.PI / 4);
  catwalkCross1.translate(-26.5, 2.2, -22.0);
  hazardGeos.push(catwalkCross1);

  const catwalkCross2 = new THREE.BoxGeometry(0.16, 0.16, 4.2);
  catwalkCross2.rotateY(-Math.PI / 4);
  catwalkCross2.translate(-26.5, 2.2, -30.0);
  hazardGeos.push(catwalkCross2);

  const addMerged = (geos: THREE.BufferGeometry[], mat: THREE.Material, castShadow: boolean) => {
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    geos.forEach(g => g.dispose());
  };

  addMerged(wallGeos, wallMat, true);
  addMerged(copingGeos, copingMat, true);
  addMerged(timberGeos, timberMat, true);
  addMerged(crateGeos, crateMat, true);
  addMerged(containerBlueGeos, containerBlueMat, true);
  addMerged(containerRedGeos, containerRedMat, true);
  addMerged(hazardGeos, hazardMat, true);

  if (aoGeos.length > 0) {
    const mergedAo = mergeGeometries(aoGeos, false);
    const aoMesh = new THREE.Mesh(mergedAo, aoMat);
    aoMesh.receiveShadow = false;
    aoMesh.castShadow = false;
    scene.add(aoMesh);
    aoGeos.forEach(g => g.dispose());
  }

  // Subtle Warm Sunbeam Dust Cones in Covered Connectors (1 draw call)
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xffe4b8,
    transparent: true,
    opacity: 0.065,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const coneGeos: THREE.BufferGeometry[] = [];
  const cone1 = new THREE.ConeGeometry(2.4, 4.8, 16, 1, true);
  cone1.rotateX(Math.PI);
  cone1.translate(24, 2.8, 0);
  coneGeos.push(cone1);

  const cone2 = new THREE.ConeGeometry(2.6, 5.2, 16, 1, true);
  cone2.rotateX(Math.PI);
  cone2.translate(0, 3.2, -8);
  coneGeos.push(cone2);

  const mergedCones = mergeGeometries(coneGeos, false);
  const lightConesMesh = new THREE.Mesh(mergedCones, coneMat);
  scene.add(lightConesMesh);
  coneGeos.forEach(g => g.dispose());

  // Weathered CS2-Style Spray-Painted Bombsite Floor Stencils (A & B)
  const buildBombsiteDecal = (label: string, colorHex: string, center: Vec3) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 8;
    ctx.setLineDash([28, 14]);
    ctx.strokeRect(18, 18, 220, 220);
    ctx.setLineDash([]);
    ctx.fillStyle = colorHex;
    ctx.font = '900 132px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 134);
    // Subtle paint scuffing so stencil sits naturally on stone
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = `rgba(0,0,0,${(0.18 + Math.random() * 0.32).toFixed(2)})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 6, 3 + Math.random() * 6);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 10.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.78, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, 0.024, center.z);
    scene.add(mesh);
  };

  buildBombsiteDecal('A', '#c82828', BOMBSITES.A.center);
  buildBombsiteDecal('B', '#2b6cb8', BOMBSITES.B.center);

  // Weathered CS2-Style Painted Directional Wall Stencils
  const createSign = (text: string, pos: THREE.Vector3, rotY: number, color = '#d62828') => {
    const sCanvas = document.createElement('canvas');
    sCanvas.width = 256; sCanvas.height = 64;
    const sCtx = sCanvas.getContext('2d')!;
    sCtx.fillStyle = 'rgba(28, 24, 20, 0.68)';
    sCtx.fillRect(4, 6, 248, 52);
    sCtx.strokeStyle = color;
    sCtx.lineWidth = 3;
    sCtx.strokeRect(4, 6, 248, 52);
    sCtx.fillStyle = color;
    sCtx.font = '900 26px sans-serif';
    sCtx.textAlign = 'center';
    sCtx.textBaseline = 'middle';
    sCtx.fillText(text, 128, 33);
    const sTex = new THREE.CanvasTexture(sCanvas);
    sTex.colorSpace = THREE.SRGBColorSpace;
    const sMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.84),
      new THREE.MeshBasicMaterial({ map: sTex, transparent: true, depthWrite: false })
    );
    sMesh.position.copy(pos);
    sMesh.rotation.y = rotY;
    scene.add(sMesh);
  };

  createSign('SITE A →', new THREE.Vector3(-1.6, 3.8, 1.8), 0, '#e04838');
  createSign('← SITE B', new THREE.Vector3(7.6, 3.8, 1.8), 0, '#55a6f5');
  createSign('MID COURTYARD', new THREE.Vector3(3.0, 5.75, 1.8), 0, '#f0d698');

  // Covered B Tunnel Industrial Ceiling Lights
  const tunnelLight1 = new THREE.PointLight(0xffb566, 1.8, 16);
  tunnelLight1.position.set(44, 3.8, -14);
  scene.add(tunnelLight1);

  const tunnelLight2 = new THREE.PointLight(0xffb566, 1.8, 16);
  tunnelLight2.position.set(44, 3.8, -4);
  scene.add(tunnelLight2);

  // Spawn Full 5v5 Roster Bots with Articulated Humanoid Operator Rigs
  const bots: BotEntity[] = [];

  for (const botDef of TACTICAL_BOTS) {
    const rig = new OperatorRig(botDef.team, botDef.name);
    rig.root.position.set(botDef.startPos.x, botDef.startPos.y, botDef.startPos.z);
    scene.add(rig.root);

    const waypoints = botDef.waypoints.map((w: Vec3) => new THREE.Vector3(w.x, w.y, w.z));

    bots.push({
      id: botDef.id,
      name: botDef.name,
      mesh: rig.root,
      rig,
      headCollider: rig.headCollider,
      bodyCollider: rig.bodyCollider,
      health: 100,
      maxHealth: 100,
      armor: 100,
      hasHelmet: true,
      isDead: false,
      team: botDef.team,
      vx: 0,
      vz: 0,
      patrolTarget: waypoints[0] || new THREE.Vector3(botDef.startPos.x, botDef.startPos.y, botDef.startPos.z),
      lastShotTime: 0,
      patrolWaypoints: waypoints,
      waypointIndex: 0,
      kills: 0,
      deaths: 0,
    });
  }

  return {
    bots,
    blocks,
    colliders,
    bombsites: {
      A: new THREE.Vector3(BOMBSITES.A.center.x, BOMBSITES.A.center.y, BOMBSITES.A.center.z),
      B: new THREE.Vector3(BOMBSITES.B.center.x, BOMBSITES.B.center.y, BOMBSITES.B.center.z),
    },
  };
}
