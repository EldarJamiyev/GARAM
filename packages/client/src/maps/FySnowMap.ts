import * as THREE from 'three';
import {
  FY_SNOW_BLOCKS,
  FY_SNOW_COLLIDERS,
  FY_SNOW_BOTS,
  FY_SNOW_FLOOR_WEAPONS,
  MapBlockCollider,
} from '@garam/shared';
import { OperatorRig } from '../render/OperatorRig.js';
import { DroppedWeaponManager } from '../combat/DroppedWeaponManager.js';
import type { BotEntity, MapBuildResult } from './CsOfficeMap.js';

export function buildFySnowMap(scene: THREE.Scene, droppedWeapons?: DroppedWeaponManager): MapBuildResult {
  const root = new THREE.Group();
  root.name = 'fy_snow_map_root';
  root.userData.isMapRoot = true;

  const snowMat = new THREE.MeshStandardMaterial({ color: 0xe6eff8, roughness: 0.78, metalness: 0.02 });
  const iceWallMat = new THREE.MeshStandardMaterial({ color: 0xc2d5e8, roughness: 0.55, metalness: 0.12 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x825937, roughness: 0.80, metalness: 0.04 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), snowMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.matrixAutoUpdate = false;
  floor.updateMatrix();
  root.add(floor);

  for (const b of FY_SNOW_BLOCKS as MapBlockCollider[]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ),
      b.theme === 'wood' ? woodMat : b.theme === 'snow' ? snowMat : iceWallMat
    );
    m.position.set((b.minX + b.maxX) * 0.5, (b.minY + b.maxY) * 0.5, (b.minZ + b.maxZ) * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
  }

  // Spawn signature CS 1.6 fy_snow floor weapons along CT & T spawn lines
  if (droppedWeapons) {
    const dir = new THREE.Vector3(0, 0, 1);
    for (const fw of FY_SNOW_FLOOR_WEAPONS) {
      droppedWeapons.dropWeapon(fw.weaponId, 30, 90, new THREE.Vector3(fw.pos.x, fw.pos.y + 0.25, fw.pos.z), dir);
    }
  }

  root.updateMatrixWorld(true);
  scene.add(root);

  const bots: BotEntity[] = FY_SNOW_BOTS.map((cfg) => {
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
      weaponId: cfg.team === 'Vanguard' ? 'mp5-navy' : 'garam-47',
    };
  });

  return { colliders: FY_SNOW_COLLIDERS, blocks: FY_SNOW_BLOCKS, bots };
}
