import * as THREE from 'three';
import {
  DE_INFERNO_BLOCKS,
  DE_INFERNO_COLLIDERS,
  DE_INFERNO_LADDERS,
  DE_INFERNO_BOMBSITES,
  DE_INFERNO_BOTS,
  MapBlockCollider,
} from '@garam/shared';
import { OperatorRig } from '../render/OperatorRig.js';
import type { BotEntity, MapBuildResult } from './CsOfficeMap.js';

export function buildDeInfernoMap(scene: THREE.Scene): MapBuildResult {
  const root = new THREE.Group();
  root.name = 'de_inferno_map_root';
  root.userData.isMapRoot = true;

  const cobbleMat = new THREE.MeshStandardMaterial({ color: 0x9b8b76, roughness: 0.88, metalness: 0.03 });
  const stuccoMat = new THREE.MeshStandardMaterial({ color: 0xdecbb0, roughness: 0.86, metalness: 0.02 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4e2a, roughness: 0.74, metalness: 0.04 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x4c5866, roughness: 0.44, metalness: 0.65 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 90), cobbleMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.matrixAutoUpdate = false;
  floor.updateMatrix();
  root.add(floor);

  for (const b of DE_INFERNO_BLOCKS as MapBlockCollider[]) {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const d = b.maxZ - b.minZ;
    const mat = b.theme === 'wood' ? woodMat : b.theme === 'metal' ? metalMat : stuccoMat;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set((b.minX + b.maxX) * 0.5, (b.minY + b.maxY) * 0.5, (b.minZ + b.maxZ) * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
  }

  // Balcony Ladder Visual Rungs
  for (const l of DE_INFERNO_LADDERS) {
    for (let y = l.minY + 0.35; y < l.maxY; y += 0.38) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8), metalMat);
      rung.position.set((l.minX + l.maxX) * 0.5, y, (l.minZ + l.maxZ) * 0.5);
      rung.rotation.x = Math.PI / 2;
      rung.matrixAutoUpdate = false;
      rung.updateMatrix();
      root.add(rung);
    }
  }

  // B-Site Fountain Water Plane
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.1, 20),
    new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.85 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(6.5, 1.27, 26.5);
  water.matrixAutoUpdate = false;
  water.updateMatrix();
  root.add(water);

  // Bombsite A & B Stencils
  const addMark = (ch: string, p: { x: number; y: number; z: number }, col: string) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = col;
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, 220, 220);
    ctx.fillStyle = col;
    ctx.font = '900 130px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 128, 134);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, p.y + 0.04, p.z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
  };
  addMark('A', DE_INFERNO_BOMBSITES.A.center, '#f97316');
  addMark('B', DE_INFERNO_BOMBSITES.B.center, '#ef4444');

  root.updateMatrixWorld(true);
  scene.add(root);

  const bots: BotEntity[] = DE_INFERNO_BOTS.map((cfg) => {
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
      weaponId: cfg.team === 'Vanguard' ? 'clarion-famas' : 'defender-galil',
    };
  });

  return { colliders: DE_INFERNO_COLLIDERS, blocks: DE_INFERNO_BLOCKS, bots };
}
