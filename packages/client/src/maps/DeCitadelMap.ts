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
  // 1. Tactical Concrete Ground (High-albedo sunlit concrete with sRGB color space)
  const canvasConcrete = document.createElement('canvas');
  canvasConcrete.width = 512;
  canvasConcrete.height = 512;
  const ctxC = canvasConcrete.getContext('2d')!;

  ctxC.fillStyle = '#8e939a';
  ctxC.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 45000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const val = Math.random();
    ctxC.fillStyle = val > 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.10)';
    ctxC.fillRect(x, y, 2, 2);
  }

  // Expansion joint grid
  ctxC.strokeStyle = 'rgba(20, 24, 30, 0.45)';
  ctxC.lineWidth = 3;
  ctxC.strokeRect(0, 0, 512, 512);
  ctxC.strokeRect(0, 0, 256, 256);
  ctxC.strokeRect(256, 256, 256, 256);

  const concreteTex = new THREE.CanvasTexture(canvasConcrete);
  concreteTex.colorSpace = THREE.SRGBColorSpace;
  concreteTex.wrapS = THREE.RepeatWrapping;
  concreteTex.wrapT = THREE.RepeatWrapping;
  concreteTex.repeat.set(24, 24);
  concreteTex.anisotropy = maxAnisotropy;

  // 2. Fortified Citadel Travertine Wall with 1.65m Head-Height Architectural Band
  const canvasWall = document.createElement('canvas');
  canvasWall.width = 512;
  canvasWall.height = 512;
  const ctxW = canvasWall.getContext('2d')!;

  ctxW.fillStyle = '#88857e';
  ctxW.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 35000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctxW.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';
    ctxW.fillRect(x, y, 2, 2);
  }

  // Dark protective base kick-plate (bottom 36px)
  ctxW.fillStyle = '#2b2e34';
  ctxW.fillRect(0, 476, 512, 36);

  // 1.65m Head-Height Architectural Datum Line (CS2 Pro Pre-Aim Reference)
  ctxW.fillStyle = '#3a3e46';
  ctxW.fillRect(0, 310, 512, 14);
  ctxW.fillStyle = 'rgba(212, 175, 55, 0.45)'; // Subtle gold accent stripe
  ctxW.fillRect(0, 308, 512, 2);

  // Subtle vertical panel seams
  ctxW.strokeStyle = 'rgba(15, 18, 22, 0.35)';
  ctxW.lineWidth = 2;
  ctxW.beginPath();
  ctxW.moveTo(256, 0); ctxW.lineTo(256, 512);
  ctxW.stroke();
  ctxW.strokeRect(0, 0, 512, 512);

  const wallTex = new THREE.CanvasTexture(canvasWall);
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(4, 2);
  wallTex.anisotropy = maxAnisotropy;

  // 3. Military Wooden Crate
  const canvasCrate = document.createElement('canvas');
  canvasCrate.width = 256;
  canvasCrate.height = 256;
  const ctxCr = canvasCrate.getContext('2d')!;

  ctxCr.fillStyle = '#94663d';
  ctxCr.fillRect(0, 0, 256, 256);

  ctxCr.fillStyle = '#7a4e28';
  for (let y = 0; y < 256; y += 32) {
    ctxCr.fillRect(0, y, 256, 3);
  }

  ctxCr.strokeStyle = '#241f1a';
  ctxCr.lineWidth = 14;
  ctxCr.strokeRect(0, 0, 256, 256);
  ctxCr.beginPath();
  ctxCr.moveTo(0, 0);
  ctxCr.lineTo(256, 256);
  ctxCr.stroke();

  ctxCr.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctxCr.font = 'bold 20px monospace';
  ctxCr.textAlign = 'center';
  ctxCr.fillText('GARAM SEC', 128, 140);

  const crateTex = new THREE.CanvasTexture(canvasCrate);
  crateTex.colorSpace = THREE.SRGBColorSpace;
  crateTex.anisotropy = maxAnisotropy;

  // 4. Industrial Hazard Stripes
  const canvasHazard = document.createElement('canvas');
  canvasHazard.width = 256;
  canvasHazard.height = 256;
  const ctxH = canvasHazard.getContext('2d')!;

  ctxH.fillStyle = '#f5c518';
  ctxH.fillRect(0, 0, 256, 256);
  ctxH.fillStyle = '#141618';

  for (let i = -256; i < 512; i += 40) {
    ctxH.beginPath();
    ctxH.moveTo(i, 0);
    ctxH.lineTo(i + 20, 0);
    ctxH.lineTo(i + 20 + 256, 256);
    ctxH.lineTo(i + 256, 256);
    ctxH.fill();
  }

  const hazardTex = new THREE.CanvasTexture(canvasHazard);
  hazardTex.colorSpace = THREE.SRGBColorSpace;
  hazardTex.wrapS = THREE.RepeatWrapping;
  hazardTex.wrapT = THREE.RepeatWrapping;
  hazardTex.repeat.set(4, 1);
  hazardTex.anisotropy = maxAnisotropy;

  // 5. Corrugated Shipping Container
  const canvasCorrugated = document.createElement('canvas');
  canvasCorrugated.width = 256;
  canvasCorrugated.height = 256;
  const ctxCorr = canvasCorrugated.getContext('2d')!;

  ctxCorr.fillStyle = '#26425e';
  ctxCorr.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    ctxCorr.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctxCorr.fillRect(x, 0, 4, 256);
    ctxCorr.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctxCorr.fillRect(x + 8, 0, 8, 256);
  }
  const containerBlueTex = new THREE.CanvasTexture(canvasCorrugated);
  containerBlueTex.colorSpace = THREE.SRGBColorSpace;
  containerBlueTex.wrapS = THREE.RepeatWrapping;
  containerBlueTex.wrapT = THREE.RepeatWrapping;
  containerBlueTex.anisotropy = maxAnisotropy;

  return { concreteTex, wallTex, crateTex, hazardTex, containerBlueTex };
}

export function buildTacticalCitadelMap(scene: THREE.Scene): {
  bots: BotEntity[];
  blocks: MapBlockCollider[];
  colliders: AABBCollider[];
  bombsites: { A: THREE.Vector3; B: THREE.Vector3 };
} {
  const { concreteTex, wallTex, crateTex, hazardTex, containerBlueTex } = createProceduralTextures();

  // 120m x 120m PBR Concrete Floor (SceneManager provides the 450m atmospheric shader sky dome)
  const floorGeo = new THREE.PlaneGeometry(124, 124);
  const floorMat = new THREE.MeshStandardMaterial({
    map: concreteTex,
    roughness: 0.75,
    metalness: 0.1,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Shared map colliders
  const blocks = DE_CITADEL_BLOCKS;
  const colliders: AABBCollider[] = [];

  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.72, metalness: 0.12 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.82, metalness: 0.05 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.45, metalness: 0.25 });
  const containerBlueMat = new THREE.MeshStandardMaterial({ map: containerBlueTex, roughness: 0.45, metalness: 0.7 });
  const containerRedMat = new THREE.MeshStandardMaterial({ color: 0x8a2828, roughness: 0.45, metalness: 0.7 });

  // Contact AO floor gradient for wall & crate bases
  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = 64; aoCanvas.height = 64;
  const aoCtx = aoCanvas.getContext('2d')!;
  const aoGrad = aoCtx.createLinearGradient(0, 0, 0, 64);
  aoGrad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  aoGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.25)');
  aoGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
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
    }

    // Grounded Contact AO Floor Strips along wall & crate bases
    if (b.y <= 0.1 && b.h >= 1.5 && b.w <= 50) {
      const gFront = new THREE.PlaneGeometry(b.w, 0.42);
      gFront.rotateX(-Math.PI / 2);
      gFront.translate(b.x, 0.015, b.z + b.d / 2 + 0.21);
      aoGeos.push(gFront);

      const gBack = new THREE.PlaneGeometry(b.w, 0.42);
      gBack.rotateX(Math.PI / 2);
      gBack.translate(b.x, 0.015, b.z - b.d / 2 - 0.21);
      aoGeos.push(gBack);
    }
  }

  // Catwalk Steel Support Trusses & Jersey Barrier Detailing (Merged into existing batches = 0 extra draw calls)
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

  // Note: jersey_b1 & jersey_b2 are authoritative solid blocks in DE_CITADEL_BLOCKS (merged above)

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

  // Volumetric Tunnel & Connector Dust Light Cones (Merged into 1 draw call)
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xffeedd,
    transparent: true,
    opacity: 0.08,
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

  // Bombsite A Ground Ring
  const siteAGround = new THREE.Mesh(
    new THREE.RingGeometry(5.2, 5.8, 32),
    new THREE.MeshBasicMaterial({ color: 0xff3344, side: THREE.DoubleSide })
  );
  siteAGround.rotation.x = -Math.PI / 2;
  siteAGround.position.set(BOMBSITES.A.center.x, 0.02, BOMBSITES.A.center.z);
  scene.add(siteAGround);

  const canvasA = document.createElement('canvas');
  canvasA.width = 128; canvasA.height = 128;
  const ctxA = canvasA.getContext('2d')!;
  ctxA.fillStyle = 'rgba(0,0,0,0)';
  ctxA.fillRect(0, 0, 128, 128);
  ctxA.fillStyle = '#ff3344';
  ctxA.font = 'bold 96px sans-serif';
  ctxA.textAlign = 'center';
  ctxA.textBaseline = 'middle';
  ctxA.fillText('A', 64, 64);
  const aTex = new THREE.CanvasTexture(canvasA);
  aTex.colorSpace = THREE.SRGBColorSpace;
  const aMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: aTex, transparent: true, side: THREE.DoubleSide }));
  aMesh.rotation.x = -Math.PI / 2;
  aMesh.position.set(BOMBSITES.A.center.x, 0.03, BOMBSITES.A.center.z);
  scene.add(aMesh);

  // Bombsite B Ground Ring
  const siteBGround = new THREE.Mesh(
    new THREE.RingGeometry(5.2, 5.8, 32),
    new THREE.MeshBasicMaterial({ color: 0x3388ff, side: THREE.DoubleSide })
  );
  siteBGround.rotation.x = -Math.PI / 2;
  siteBGround.position.set(BOMBSITES.B.center.x, 0.02, BOMBSITES.B.center.z);
  scene.add(siteBGround);

  const canvasB = document.createElement('canvas');
  canvasB.width = 128; canvasB.height = 128;
  const ctxB = canvasB.getContext('2d')!;
  ctxB.fillStyle = 'rgba(0,0,0,0)';
  ctxB.fillRect(0, 0, 128, 128);
  ctxB.fillStyle = '#3388ff';
  ctxB.font = 'bold 96px sans-serif';
  ctxB.textAlign = 'center';
  ctxB.textBaseline = 'middle';
  ctxB.fillText('B', 64, 64);
  const bTex = new THREE.CanvasTexture(canvasB);
  bTex.colorSpace = THREE.SRGBColorSpace;
  const bMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: bTex, transparent: true, side: THREE.DoubleSide }));
  bMesh.rotation.x = -Math.PI / 2;
  bMesh.position.set(BOMBSITES.B.center.x, 0.03, BOMBSITES.B.center.z);
  scene.add(bMesh);

  // Directional Wall Signage
  const createSign = (text: string, pos: THREE.Vector3, rotY: number, color = '#ffffff') => {
    const sCanvas = document.createElement('canvas');
    sCanvas.width = 256; sCanvas.height = 64;
    const sCtx = sCanvas.getContext('2d')!;
    sCtx.fillStyle = 'rgba(10, 14, 20, 0.85)';
    sCtx.fillRect(0, 0, 256, 64);
    sCtx.strokeStyle = color;
    sCtx.lineWidth = 4;
    sCtx.strokeRect(2, 2, 252, 60);
    sCtx.fillStyle = color;
    sCtx.font = 'bold 24px sans-serif';
    sCtx.textAlign = 'center';
    sCtx.textBaseline = 'middle';
    sCtx.fillText(text, 128, 32);
    const sTex = new THREE.CanvasTexture(sCanvas);
    sTex.colorSpace = THREE.SRGBColorSpace;
    const sMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 0.88), new THREE.MeshBasicMaterial({ map: sTex, transparent: true }));
    sMesh.position.copy(pos);
    sMesh.rotation.y = rotY;
    scene.add(sMesh);
  };

  createSign('SITE A ->', new THREE.Vector3(-1.6, 3.8, 1.8), 0, '#ff3344');
  createSign('<- SITE B', new THREE.Vector3(7.6, 3.8, 1.8), 0, '#3b9eff');
  createSign('<- MID CHOKE ->', new THREE.Vector3(3.0, 5.8, 1.8), 0, '#00ff88');

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
