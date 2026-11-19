import * as THREE from 'three';

export interface BotEntity {
  id: string;
  name: string;
  mesh: THREE.Group;
  headCollider: THREE.Mesh;
  bodyCollider: THREE.Mesh;
  health: number;
  maxHealth: number;
  isDead: boolean;
  team: 'Vanguard' | 'Syndicate';
  vx: number;
  vz: number;
  patrolTarget: THREE.Vector3;
  lastShotTime: number;
  patrolWaypoints: THREE.Vector3[];
  waypointIndex: number;
}

export function createProceduralTextures() {
  // 1. Weathered Concrete Tile Texture (512x512)
  const canvasConcrete = document.createElement('canvas');
  canvasConcrete.width = 512;
  canvasConcrete.height = 512;
  const ctxC = canvasConcrete.getContext('2d')!;

  ctxC.fillStyle = '#4c5258';
  ctxC.fillRect(0, 0, 512, 512);

  // Subtle noise & grime
  for (let i = 0; i < 35000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const val = Math.floor(Math.random() * 35) - 17;
    ctxC.fillStyle = val > 0 ? `rgba(255,255,255,0.08)` : `rgba(0,0,0,0.12)`;
    ctxC.fillRect(x, y, 2, 2);
  }
  // Tactical grid seams
  ctxC.strokeStyle = 'rgba(20, 24, 28, 0.45)';
  ctxC.lineWidth = 4;
  ctxC.strokeRect(0, 0, 512, 512);
  ctxC.strokeRect(0, 0, 256, 256);
  ctxC.strokeRect(256, 256, 256, 256);

  const concreteTex = new THREE.CanvasTexture(canvasConcrete);
  concreteTex.wrapS = THREE.RepeatWrapping;
  concreteTex.wrapT = THREE.RepeatWrapping;
  concreteTex.repeat.set(12, 12);

  // 2. Tactical Sandstone / Plaster Wall with Top Baseboard
  const canvasWall = document.createElement('canvas');
  canvasWall.width = 512;
  canvasWall.height = 512;
  const ctxW = canvasWall.getContext('2d')!;
  ctxW.fillStyle = '#73787f';
  ctxW.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 22000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctxW.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)';
    ctxW.fillRect(x, y, 3, 3);
  }
  // Dark bottom baseboard & top architectural coping
  ctxW.fillStyle = '#22262a';
  ctxW.fillRect(0, 480, 512, 32);
  ctxW.fillRect(0, 0, 512, 24);
  ctxW.strokeStyle = 'rgba(15, 18, 22, 0.5)';
  ctxW.lineWidth = 3;
  ctxW.strokeRect(0, 0, 512, 512);

  const wallTex = new THREE.CanvasTexture(canvasWall);
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.wrapT = THREE.RepeatWrapping;

  // 3. Wooden Crate with Steel Brackets
  const canvasCrate = document.createElement('canvas');
  canvasCrate.width = 256;
  canvasCrate.height = 256;
  const ctxCr = canvasCrate.getContext('2d')!;
  ctxCr.fillStyle = '#94633b';
  ctxCr.fillRect(0, 0, 256, 256);
  ctxCr.fillStyle = '#7a4f2d';
  for (let y = 0; y < 256; y += 32) {
    ctxCr.fillRect(0, y, 256, 2);
  }
  ctxCr.strokeStyle = '#2b2622';
  ctxCr.lineWidth = 14;
  ctxCr.strokeRect(0, 0, 256, 256);
  ctxCr.beginPath();
  ctxCr.moveTo(0, 0);
  ctxCr.lineTo(256, 256);
  ctxCr.stroke();

  const crateTex = new THREE.CanvasTexture(canvasCrate);

  // 4. Yellow & Black Industrial Hazard Stripes
  const canvasHazard = document.createElement('canvas');
  canvasHazard.width = 256;
  canvasHazard.height = 256;
  const ctxH = canvasHazard.getContext('2d')!;
  ctxH.fillStyle = '#ffd700';
  ctxH.fillRect(0, 0, 256, 256);
  ctxH.fillStyle = '#111111';
  for (let i = -256; i < 512; i += 40) {
    ctxH.beginPath();
    ctxH.moveTo(i, 0);
    ctxH.lineTo(i + 20, 0);
    ctxH.lineTo(i + 20 + 256, 256);
    ctxH.lineTo(i + 256, 256);
    ctxH.fill();
  }
  const hazardTex = new THREE.CanvasTexture(canvasHazard);
  hazardTex.wrapS = THREE.RepeatWrapping;
  hazardTex.wrapT = THREE.RepeatWrapping;
  hazardTex.repeat.set(4, 1);

  return { concreteTex, wallTex, crateTex, hazardTex };
}

export function buildTacticalCitadelMap(scene: THREE.Scene): {
  bots: BotEntity[];
  colliders: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }[];
  bombsites: { A: THREE.Vector3; B: THREE.Vector3 };
} {
  const colliders: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }[] = [];
  const bots: BotEntity[] = [];

  const { concreteTex, wallTex, crateTex, hazardTex } = createProceduralTextures();

  // Floor (120m x 120m Arena with PBR Concrete)
  const floorGeo = new THREE.PlaneGeometry(120, 120);
  const floorMat = new THREE.MeshStandardMaterial({
    map: concreteTex,
    roughness: 0.65,
    metalness: 0.1,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Solid block builder with true bounding-box collision
  const addBlock = (
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    mat: THREE.Material
  ) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    colliders.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minY: y,
      maxY: y + h,
      minZ: z - d / 2,
      maxZ: z + d / 2,
    });
    return mesh;
  };

  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.15 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.8, metalness: 0.05 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.4, metalness: 0.3 });

  const containerBlue = new THREE.MeshStandardMaterial({ color: 0x24547e, roughness: 0.45, metalness: 0.75 });
  const containerRed = new THREE.MeshStandardMaterial({ color: 0x9e2c2c, roughness: 0.45, metalness: 0.75 });

  // --- Outer Perimeter Walls (DE_CITADEL Fortress) ---
  addBlock(0, 0, -60, 120, 9, 3, wallMat); // North Wall
  addBlock(0, 0, 60, 120, 9, 3, wallMat);  // South Wall (CT Spawn)
  addBlock(-60, 0, 0, 3, 9, 120, wallMat); // West Wall (A Long)
  addBlock(60, 0, 0, 3, 9, 120, wallMat);  // East Wall (B Warehouse)

  // Architectural Concrete Parapets / Roof Trims
  addBlock(0, 9, -60, 122, 1.2, 4.2, crateMat);
  addBlock(0, 9, 60, 122, 1.2, 4.2, crateMat);
  addBlock(-60, 9, 0, 4.2, 1.2, 122, crateMat);
  addBlock(60, 9, 0, 4.2, 1.2, 122, crateMat);

  // --- Bombsite A: Armory Courtyard (x: -32, z: -30) ---
  const siteAGround = new THREE.Mesh(
    new THREE.RingGeometry(4.8, 5.4, 32),
    new THREE.MeshBasicMaterial({ color: 0xff3344, side: THREE.DoubleSide })
  );
  siteAGround.rotation.x = -Math.PI / 2;
  siteAGround.position.set(-32, 0.02, -30);
  scene.add(siteAGround);

  // A Site Stencil Indicator
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
  const aMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: aTex, transparent: true, side: THREE.DoubleSide }));
  aMesh.rotation.x = -Math.PI / 2;
  aMesh.position.set(-32, 0.03, -30);
  scene.add(aMesh);

  // Armory building back wall & sniper balcony (Heaven)
  addBlock(-32, 0, -42, 28, 7, 3, wallMat);
  addBlock(-44, 0, -25, 3, 6, 25, wallMat);

  // A Site Triple Stack Wood Crates (Tactical cover positions)
  addBlock(-34, 0, -28, 3.2, 2.5, 3.2, crateMat);
  addBlock(-30.5, 0, -28, 3.0, 2.0, 3.0, crateMat);
  addBlock(-32.5, 2.2, -28, 2.5, 2.0, 2.5, crateMat);

  // --- Mid: Double Doors & Archway Choke Point (z: 0) ---
  addBlock(-12, 0, 0, 22, 7, 3, wallMat);
  addBlock(20, 0, 0, 26, 7, 3, wallMat);

  // Mid Door Wooden Frame Pillars + Hazard Warning Stripes
  addBlock(-1.5, 0, 0, 1.2, 7, 3.5, crateMat);
  addBlock(7.5, 0, 0, 1.2, 7, 3.5, crateMat);
  addBlock(3.0, 6.2, 0, 9.0, 0.8, 3.5, hazardMat); // Overhead Hazard lintel

  // Mid Sniper Window / Connector Crate
  addBlock(12, 0, 14, 4, 3, 4, crateMat);

  // --- Bombsite B: Reactor Vault (x: +35, z: -32) ---
  const siteBGround = new THREE.Mesh(
    new THREE.RingGeometry(4.8, 5.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x3388ff, side: THREE.DoubleSide })
  );
  siteBGround.rotation.x = -Math.PI / 2;
  siteBGround.position.set(35, 0.02, -32);
  scene.add(siteBGround);

  // B Site Stencil Indicator
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
  const bMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: bTex, transparent: true, side: THREE.DoubleSide }));
  bMesh.rotation.x = -Math.PI / 2;
  bMesh.position.set(35, 0.03, -32);
  scene.add(bMesh);

  // Industrial Cargo Shipping Containers with Hazard Markings
  addBlock(32, 0, -32, 14, 4.2, 5.5, containerBlue);
  addBlock(42, 0, -20, 5.5, 4.2, 14, containerRed);
  addBlock(26, 0, -18, 4.0, 3.0, 4.0, crateMat);

  // --- Tactical Bot Spawns ---
  const spawnBot = (
    id: string,
    name: string,
    startPos: THREE.Vector3,
    team: 'Vanguard' | 'Syndicate',
    waypoints: THREE.Vector3[]
  ) => {
    const botGroup = new THREE.Group();

    // Body
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.15, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: team === 'Syndicate' ? 0x4f545a : 0x16181b,
      roughness: 0.5,
      metalness: 0.2,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.95;
    bodyMesh.castShadow = true;
    botGroup.add(bodyMesh);

    // Tactical vest
    const vestGeo = new THREE.BoxGeometry(0.65, 0.65, 0.45);
    const vestMat = new THREE.MeshStandardMaterial({
      color: team === 'Syndicate' ? 0x8a7052 : 0x24282c,
      roughness: 0.7,
    });
    const vest = new THREE.Mesh(vestGeo, vestMat);
    vest.position.set(0, 1.05, 0);
    botGroup.add(vest);

    // Ballistic helmet
    const headGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c1e,
      roughness: 0.3,
      metalness: 0.8,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.y = 1.68;
    headMesh.castShadow = true;
    botGroup.add(headMesh);

    // Tactical visor
    const visorGeo = new THREE.BoxGeometry(0.24, 0.08, 0.15);
    const visorMat = new THREE.MeshStandardMaterial({
      color: team === 'Syndicate' ? 0xffaa00 : 0xd91438,
      emissive: team === 'Syndicate' ? 0x664400 : 0x660011,
      roughness: 0.1,
      metalness: 0.9,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.68, 0.12);
    botGroup.add(visor);

    // Gun
    const gunGeo = new THREE.BoxGeometry(0.06, 0.08, 0.5);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.22, 1.1, 0.25);
    botGroup.add(gun);

    botGroup.position.copy(startPos);
    scene.add(botGroup);

    bots.push({
      id,
      name,
      mesh: botGroup,
      headCollider: headMesh,
      bodyCollider: bodyMesh,
      health: 100,
      maxHealth: 100,
      isDead: false,
      team,
      vx: 0,
      vz: 0,
      patrolTarget: waypoints[0] || startPos,
      lastShotTime: 0,
      patrolWaypoints: waypoints,
      waypointIndex: 0,
    });
  };

  spawnBot(
    'bot_eclipse_1',
    'Syndicate Kaine',
    new THREE.Vector3(3, 0, -20),
    'Syndicate',
    [
      new THREE.Vector3(3, 0, -4),
      new THREE.Vector3(6, 0, -2),
      new THREE.Vector3(1, 0, -12),
      new THREE.Vector3(4, 0, -22),
    ]
  );

  spawnBot(
    'bot_eclipse_2',
    'Syndicate Ghost',
    new THREE.Vector3(-30, 0, -38),
    'Syndicate',
    [
      new THREE.Vector3(-32, 0, -22),
      new THREE.Vector3(-25, 0, -18),
      new THREE.Vector3(-36, 0, -28),
    ]
  );

  spawnBot(
    'bot_eclipse_3',
    'Syndicate Viper',
    new THREE.Vector3(36, 0, -38),
    'Syndicate',
    [
      new THREE.Vector3(34, 0, -22),
      new THREE.Vector3(44, 0, -15),
      new THREE.Vector3(28, 0, -25),
    ]
  );

  spawnBot(
    'bot_vanguard_1',
    'Vanguard Alex',
    new THREE.Vector3(12, 0, 20),
    'Vanguard',
    [
      new THREE.Vector3(10, 0, 8),
      new THREE.Vector3(4, 0, 5),
      new THREE.Vector3(14, 0, 16),
    ]
  );

  return {
    bots,
    colliders,
    bombsites: {
      A: new THREE.Vector3(-32, 0, -30),
      B: new THREE.Vector3(35, 0, -32),
    },
  };
}
