import * as THREE from 'three';
import {
  DE_NUKE_BLOCKS,
  DE_NUKE_COLLIDERS,
  DE_NUKE_LADDERS,
  DE_NUKE_BOMBSITES,
  DE_NUKE_BOTS,
  MapBlockCollider,
} from '@garam/shared';
import { OperatorRig } from '../render/OperatorRig.js';
import type { BotEntity, MapBuildResult } from './CsOfficeMap.js';

function createNukeHazardTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#525b64';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#eab308';
  ctx.fillRect(0, 210, 256, 28);
  ctx.fillStyle = '#111827';
  for (let x = -32; x < 288; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 210);
    ctx.lineTo(x + 18, 210);
    ctx.lineTo(x + 6, 238);
    ctx.lineTo(x - 12, 238);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildDeNukeMap(scene: THREE.Scene): MapBuildResult {
  const root = new THREE.Group();
  root.name = 'de_nuke_map_root';
  root.userData.isMapRoot = true;

  const mats: Record<string, THREE.MeshStandardMaterial> = {
    concrete: new THREE.MeshStandardMaterial({ map: createNukeHazardTex(), roughness: 0.85, metalness: 0.08 }),
    foundry: new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.72, metalness: 0.16 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x3b6e8c, roughness: 0.36, metalness: 0.74 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.78, metalness: 0.05 }),
  };

  // Ground Plane (Basement B-Site Floor y = 0.0m)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(110, 90), mats.foundry);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.matrixAutoUpdate = false;
  floor.updateMatrix();
  root.add(floor);

  for (const b of DE_NUKE_BLOCKS as MapBlockCollider[]) {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const d = b.maxZ - b.minZ;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[b.theme || 'concrete'] || mats.concrete);
    m.position.set((b.minX + b.maxX) * 0.5, (b.minY + b.maxY) * 0.5, (b.minZ + b.maxZ) * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
  }

  // Visible 3D Steel Ladder Rungs for every LadderVolume
  const rungMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.3, metalness: 0.85 });
  for (const l of DE_NUKE_LADDERS) {
    const height = l.maxY - l.minY;
    const cx = (l.minX + l.maxX) * 0.5;
    const cz = (l.minZ + l.maxZ) * 0.5;
    for (let y = l.minY + 0.35; y < l.maxY; y += 0.38) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8), rungMat);
      rung.position.set(cx, y, cz);
      rung.rotation.x = Math.abs(l.normalZ) > 0.5 ? 0 : Math.PI / 2;
      rung.rotation.z = Math.abs(l.normalZ) > 0.5 ? Math.PI / 2 : 0;
      rung.matrixAutoUpdate = false;
      rung.updateMatrix();
      root.add(rung);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, height, 0.05), rungMat);
    rail.position.set(cx, l.minY + height * 0.5, cz);
    rail.matrixAutoUpdate = false;
    rail.updateMatrix();
    root.add(rail);
  }

  // Stencils for Stacked Bombsite A (y=4.22m) & Bombsite B (y=0.03m)
  const addStencil = (label: string, x: number, y: number, z: number, color: string) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.strokeRect(20, 20, 216, 216);
    ctx.fillStyle = color;
    ctx.font = '900 130px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 134);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
  };
  addStencil('A', DE_NUKE_BOMBSITES.A.center.x, DE_NUKE_BOMBSITES.A.center.y + 0.04, DE_NUKE_BOMBSITES.A.center.z, '#ef4444');
  addStencil('B', DE_NUKE_BOMBSITES.B.center.x, DE_NUKE_BOMBSITES.B.center.y + 0.04, DE_NUKE_BOMBSITES.B.center.z, '#f59e0b');

  // Basement B Reactor Glow Light
  const bLight = new THREE.PointLight(0x38bdf8, 2.2, 28);
  bLight.position.set(4, 2.8, -5);
  bLight.matrixAutoUpdate = false;
  bLight.updateMatrix();
  root.add(bLight);

  root.updateMatrixWorld(true);
  scene.add(root);

  const bots: BotEntity[] = DE_NUKE_BOTS.map((cfg) => {
    const rig = new OperatorRig(cfg.team, cfg.name);
    rig.root.position.set(cfg.waypoints[0].x, cfg.waypoints[0].y, cfg.waypoints[0].z);
    scene.add(rig.root);
    return {
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
      patrolTarget: { ...cfg.waypoints[0] },
      lastShotTime: 0,
      vx: 0,
      vz: 0,
      weaponId: cfg.team === 'Vanguard' ? 'm4a4' : 'garam-47',
    };
  });

  return { colliders: DE_NUKE_COLLIDERS, blocks: DE_NUKE_BLOCKS, bots };
}
