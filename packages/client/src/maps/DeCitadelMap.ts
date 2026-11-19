import * as THREE from 'three';
import {
  DE_CITADEL_BLOCKS,
  MapBlockCollider,
  TACTICAL_BOTS,
  BOMBSITES,
  Vec3,
  resolveHorizontalAABB,
  AABBCollider,
  KINEMATICS,
  hasLineOfSight
} from '@garam/shared';

export interface BotEntity {
  id: string;
  name: string;
  mesh: THREE.Group;
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

export function createProceduralTextures() {
  // 1. Tactical Concrete Ground (512x512 with expansion joints & grit)
  const canvasConcrete = document.createElement('canvas');
  canvasConcrete.width = 512;
  canvasConcrete.height = 512;
  const ctxC = canvasConcrete.getContext('2d')!;

  ctxC.fillStyle = '#3a3f45';
  ctxC.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const val = Math.random();
    ctxC.fillStyle = val > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.14)';
    ctxC.fillRect(x, y, 2, 2);
  }

  ctxC.strokeStyle = 'rgba(12, 14, 18, 0.6)';
  ctxC.lineWidth = 4;
  ctxC.strokeRect(0, 0, 512, 512);
  ctxC.strokeRect(0, 0, 256, 256);
  ctxC.strokeRect(256, 256, 256, 256);

  const concreteTex = new THREE.CanvasTexture(canvasConcrete);
  concreteTex.wrapS = THREE.RepeatWrapping;
  concreteTex.wrapT = THREE.RepeatWrapping;
  concreteTex.repeat.set(16, 16);

  // 2. Fortified Citadel Wall
  const canvasWall = document.createElement('canvas');
  canvasWall.width = 512;
  canvasWall.height = 512;
  const ctxW = canvasWall.getContext('2d')!;

  ctxW.fillStyle = '#656b73';
  ctxW.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctxW.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';
    ctxW.fillRect(x, y, 3, 3);
  }

  ctxW.fillStyle = '#1e2226';
  ctxW.fillRect(0, 484, 512, 28);
  ctxW.fillRect(0, 0, 512, 20);

  ctxW.strokeStyle = 'rgba(10, 12, 15, 0.55)';
  ctxW.lineWidth = 3;
  ctxW.strokeRect(0, 0, 512, 512);

  const wallTex = new THREE.CanvasTexture(canvasWall);
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.wrapT = THREE.RepeatWrapping;

  // 3. Military Wooden Crate
  const canvasCrate = document.createElement('canvas');
  canvasCrate.width = 256;
  canvasCrate.height = 256;
  const ctxCr = canvasCrate.getContext('2d')!;

  ctxCr.fillStyle = '#8a5c36';
  ctxCr.fillRect(0, 0, 256, 256);

  ctxCr.fillStyle = '#704626';
  for (let y = 0; y < 256; y += 32) {
    ctxCr.fillRect(0, y, 256, 3);
  }

  ctxCr.strokeStyle = '#221e1a';
  ctxCr.lineWidth = 16;
  ctxCr.strokeRect(0, 0, 256, 256);
  ctxCr.beginPath();
  ctxCr.moveTo(0, 0);
  ctxCr.lineTo(256, 256);
  ctxCr.stroke();

  ctxCr.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctxCr.font = 'bold 20px monospace';
  ctxCr.textAlign = 'center';
  ctxCr.fillText('GARAM SEC', 128, 140);

  const crateTex = new THREE.CanvasTexture(canvasCrate);

  // 4. Industrial Hazard Stripes
  const canvasHazard = document.createElement('canvas');
  canvasHazard.width = 256;
  canvasHazard.height = 256;
  const ctxH = canvasHazard.getContext('2d')!;

  ctxH.fillStyle = '#f0c000';
  ctxH.fillRect(0, 0, 256, 256);
  ctxH.fillStyle = '#141414';

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

  // 5. Corrugated Shipping Container
  const canvasCorrugated = document.createElement('canvas');
  canvasCorrugated.width = 256;
  canvasCorrugated.height = 256;
  const ctxCorr = canvasCorrugated.getContext('2d')!;

  ctxCorr.fillStyle = '#223d57';
  ctxCorr.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    ctxCorr.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctxCorr.fillRect(x, 0, 4, 256);
    ctxCorr.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctxCorr.fillRect(x + 8, 0, 8, 256);
  }
  const containerBlueTex = new THREE.CanvasTexture(canvasCorrugated);
  containerBlueTex.wrapS = THREE.RepeatWrapping;
  containerBlueTex.wrapT = THREE.RepeatWrapping;

  return { concreteTex, wallTex, crateTex, hazardTex, containerBlueTex };
}

export function buildTacticalCitadelMap(scene: THREE.Scene): {
  bots: BotEntity[];
  blocks: MapBlockCollider[];
  colliders: AABBCollider[];
  bombsites: { A: THREE.Vector3; B: THREE.Vector3 };
} {
  const { concreteTex, wallTex, crateTex, hazardTex, containerBlueTex } = createProceduralTextures();

  // Sky Dome Gradient
  const skyGeo = new THREE.SphereGeometry(300, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x82b2d6,
    side: THREE.BackSide,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // 120m x 120m PBR Concrete Floor
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

  for (const b of blocks) {
    colliders.push({
      minX: b.minX,
      maxX: b.maxX,
      minY: b.minY,
      maxY: b.maxY,
      minZ: b.minZ,
      maxZ: b.maxZ,
    });

    let chosenMat: THREE.Material = wallMat;
    if (b.material === 'WOOD_THIN') {
      chosenMat = crateMat;
    } else if (b.id.includes('container_blue')) {
      chosenMat = containerBlueMat;
    } else if (b.id.includes('container_red')) {
      chosenMat = containerRedMat;
    } else if (b.id.includes('lintel')) {
      chosenMat = hazardMat;
    }

    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    const mesh = new THREE.Mesh(geo, chosenMat);
    mesh.position.set(b.x, b.y + b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = b.id;
    scene.add(mesh);
  }

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
  const bMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: bTex, transparent: true, side: THREE.DoubleSide }));
  bMesh.rotation.x = -Math.PI / 2;
  bMesh.position.set(BOMBSITES.B.center.x, 0.03, BOMBSITES.B.center.z);
  scene.add(bMesh);

  // Spawn Full 5v5 Roster Bots
  const bots: BotEntity[] = [];

  for (const botDef of TACTICAL_BOTS) {
    const botGroup = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.15, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: botDef.team === 'Syndicate' ? 0x444950 : 0x181a1d,
      roughness: 0.5,
      metalness: 0.2,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.95;
    bodyMesh.castShadow = true;
    botGroup.add(bodyMesh);

    const vestGeo = new THREE.BoxGeometry(0.66, 0.68, 0.46);
    const vestMat = new THREE.MeshStandardMaterial({
      color: botDef.team === 'Syndicate' ? 0x7a6245 : 0x22262a,
      roughness: 0.7,
    });
    const vest = new THREE.Mesh(vestGeo, vestMat);
    vest.position.set(0, 1.05, 0);
    botGroup.add(vest);

    const headGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x141618,
      roughness: 0.3,
      metalness: 0.85,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.y = 1.68;
    headMesh.castShadow = true;
    botGroup.add(headMesh);

    const visorGeo = new THREE.BoxGeometry(0.24, 0.08, 0.15);
    const visorMat = new THREE.MeshStandardMaterial({
      color: botDef.team === 'Syndicate' ? 0xffaa00 : 0xd91438,
      emissive: botDef.team === 'Syndicate' ? 0x664400 : 0x770011,
      roughness: 0.1,
      metalness: 0.9,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.68, 0.12);
    botGroup.add(visor);

    const gunGeo = new THREE.BoxGeometry(0.06, 0.08, 0.5);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.3 });
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.22, 1.1, 0.25);
    botGroup.add(gun);

    botGroup.position.set(botDef.startPos.x, botDef.startPos.y, botDef.startPos.z);
    scene.add(botGroup);

    const waypoints = botDef.waypoints.map((w: Vec3) => new THREE.Vector3(w.x, w.y, w.z));

    bots.push({
      id: botDef.id,
      name: botDef.name,
      mesh: botGroup,
      headCollider: headMesh,
      bodyCollider: bodyMesh,
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

/**
 * Update bot movement and team combat with mandatory wall collision and line of sight checks
 */
export function updateBotSystem(
  bots: BotEntity[],
  dt: number,
  colliders: AABBCollider[],
  blocks: MapBlockCollider[],
  playerPos: THREE.Vector3,
  playerEye: THREE.Vector3,
  onBotShootPlayer: (bot: BotEntity, dmg: number) => void,
  onBotShootBot: (shooter: BotEntity, victim: BotEntity, dmg: number) => void
): void {
  const now = performance.now();

  for (const bot of bots) {
    if (bot.isDead) continue;

    // 1. Patrol movement with strict AABB wall collision
    const target = bot.patrolTarget;
    const toTarget = new THREE.Vector3().subVectors(target, bot.mesh.position);
    toTarget.y = 0;
    const distToTarget = toTarget.length();

    if (distToTarget < 1.2) {
      bot.waypointIndex = (bot.waypointIndex + 1) % bot.patrolWaypoints.length;
      bot.patrolTarget = bot.patrolWaypoints[bot.waypointIndex];
    } else {
      toTarget.normalize();
      const patrolSpeed = 3.2;
      const vx = toTarget.x * patrolSpeed;
      const vz = toTarget.z * patrolSpeed;

      // Apply resolveHorizontalAABB to bot movement so bots NEVER walk through walls or crates!
      const resolved = resolveHorizontalAABB(
        bot.mesh.position.x,
        bot.mesh.position.y,
        bot.mesh.position.z,
        vx,
        vz,
        dt,
        KINEMATICS.CAPSULE_RADIUS,
        KINEMATICS.CAPSULE_HEIGHT_STAND,
        colliders,
        true,
        KINEMATICS.STEP_HEIGHT
      );

      bot.mesh.position.set(resolved.x, resolved.y, resolved.z);
      bot.mesh.lookAt(target.x, bot.mesh.position.y, target.z);
    }

    // 2. Team Combat: Syndicate vs Player & Vanguard Allies with strict Line of Sight
    const botEye = bot.mesh.position.clone().add(new THREE.Vector3(0, 1.68, 0));

    if (bot.team === 'Syndicate') {
      // Check target Player
      const distToPlayer = bot.mesh.position.distanceTo(playerPos);
      if (distToPlayer <= 36) {
        const losPlayer = hasLineOfSight(botEye, playerEye, blocks, []);

        if (losPlayer) {
          bot.mesh.lookAt(playerPos.x, bot.mesh.position.y, playerPos.z);
          if (now - bot.lastShotTime > 920) {
            bot.lastShotTime = now;
            if (Math.random() < 0.32) {
              onBotShootPlayer(bot, 24);
            }
          }
          continue;
        }
      }

      // Check target Vanguard AI allies
      for (const ally of bots) {
        if (ally.team === 'Vanguard' && !ally.isDead) {
          const distToAlly = bot.mesh.position.distanceTo(ally.mesh.position);
          if (distToAlly <= 30) {
            const allyEye = ally.mesh.position.clone().add(new THREE.Vector3(0, 1.68, 0));
            const losAlly = hasLineOfSight(botEye, allyEye, blocks, []);

            if (losAlly) {
              bot.mesh.lookAt(ally.mesh.position.x, bot.mesh.position.y, ally.mesh.position.z);
              if (now - bot.lastShotTime > 950) {
                bot.lastShotTime = now;
                if (Math.random() < 0.35) {
                  onBotShootBot(bot, ally, 26);
                }
              }
              break;
            }
          }
        }
      }
    } else if (bot.team === 'Vanguard') {
      // Vanguard AI ally fights Syndicate enemies
      for (const enemy of bots) {
        if (enemy.team === 'Syndicate' && !enemy.isDead) {
          const distToEnemy = bot.mesh.position.distanceTo(enemy.mesh.position);
          if (distToEnemy <= 30) {
            const enemyEye = enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.68, 0));
            const losEnemy = hasLineOfSight(botEye, enemyEye, blocks, []);

            if (losEnemy) {
              bot.mesh.lookAt(enemy.mesh.position.x, bot.mesh.position.y, enemy.mesh.position.z);
              if (now - bot.lastShotTime > 950) {
                bot.lastShotTime = now;
                if (Math.random() < 0.35) {
                  onBotShootBot(bot, enemy, 26);
                }
              }
              break;
            }
          }
        }
      }
    }
  }
}
