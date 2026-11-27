import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  DE_DUST2_BLOCKS,
  DE_DUST2_COLLIDERS,
  DE_DUST2_BOTS,
  DE_DUST2_BOMBSITES,
  DE_DUST2_Y_OFFSET,
} from '@garam/shared';
import { OperatorRig } from '../render/OperatorRig.js';
import { AssetManager } from '../render/AssetManager.js';
import type { BotEntity, MapBuildResult } from './CsOfficeMap.js';

export type { BotEntity, MapBuildResult };

function createSiteStencilTexture(label: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.setLineDash([24, 14]);
  ctx.strokeRect(18, 18, 220, 220);

  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = '900 132px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 134);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tuneDust2Material(mat: THREE.Material, maxAniso: number): void {
  if (!(mat instanceof THREE.MeshStandardMaterial)) return;

  const tint = mat.userData?.tint;
  if (Array.isArray(tint) && tint.length >= 3) {
    mat.color.setRGB(Number(tint[0]), Number(tint[1]), Number(tint[2]));
  }

  for (const map of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap]) {
    if (map) {
      map.anisotropy = maxAniso;
    }
  }

  mat.envMapIntensity = 0.78;
  const name = mat.name || '';
  if (/ground_/i.test(name)) {
    mat.roughness = 0.76;
    mat.envMapIntensity = 0.72;
  } else if (/barrel|iron|metal/i.test(name)) {
    mat.metalness = 0.62;
    mat.roughness = Math.min(mat.roughness, 0.42);
    mat.envMapIntensity = 1.15;
  } else if (/glass/i.test(name)) {
    mat.roughness = 0.16;
    mat.metalness = 0.35;
    mat.envMapIntensity = 1.45;
  } else {
    mat.roughness = Math.min(mat.roughness, 0.86);
  }
  mat.needsUpdate = true;
}

/**
 * Loads the real 3D PBR-textured de_dust2.glb arena (MIT geometry + Poly Haven CC0 WebP textures)
 * aligned 1:1 with the exact SAT watertight colliders in DE_DUST2_BLOCKS (shifted +3.5m on Y).
 */
export function buildDeDust2Map(scene: THREE.Scene, onGlbReady?: () => void): MapBuildResult {
  const assetMgr = AssetManager.getInstance();
  const maxAniso = assetMgr.getMaxAnisotropy();
  const loader = new GLTFLoader();

  const mapRoot = new THREE.Group();
  mapRoot.name = 'de_dust2_map_root';
  mapRoot.userData.isMapRoot = true;
  scene.add(mapRoot);

  assetMgr.reportProgress(15, 'STREAMING DE_DUST2 (A-SITE) 3D ARENA...');

  loader.load(
    '/models/de_dust2.glb',
    (gltf) => {
      if (!mapRoot.parent) {
        AssetManager.disposeObject3D(gltf.scene, true);
        return;
      }
      const root = gltf.scene;
      root.name = 'de_dust2_world';
      root.position.set(0, DE_DUST2_Y_OFFSET, 0);

      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const isBackdrop = Boolean(obj.userData?.nocollide);
          if (isBackdrop) {
            obj.userData.isSkyBackdrop = true;
          }
          obj.castShadow = !isBackdrop;
          obj.receiveShadow = true;
          if (obj.geometry && !obj.geometry.boundingSphere) {
            obj.geometry.computeBoundingSphere();
          }
          obj.frustumCulled = true;

          if (Array.isArray(obj.material)) {
            for (const m of obj.material) tuneDust2Material(m, maxAniso);
          } else if (obj.material) {
            tuneDust2Material(obj.material, maxAniso);
          }
        }
      });

      mapRoot.add(root);
      mapRoot.updateMatrixWorld(true);
      root.traverse((obj) => {
        obj.matrixAutoUpdate = false;
      });
      assetMgr.reportProgress(100, 'DE_DUST2 (A-SITE) ARENA READY');
      onGlbReady?.();
    },
    (xhr) => {
      if (xhr && xhr.total > 0) {
        const pct = Math.min(96, Math.round(15 + (xhr.loaded / xhr.total) * 81));
        assetMgr.reportProgress(pct, 'STREAMING DE_DUST2 (A-SITE) 3D ARENA...');
      }
    },
    (err) => {
      console.error('[DeDust2Map] Failed to load /models/de_dust2.glb:', err);
      assetMgr.reportProgress(100, 'DE_DUST2 (A-SITE) COLLIDERS READY');
    }
  );

  // Crisp grounded bombsite A floor stencil (flush with concrete deck, no box geometry)
  const siteATex = createSiteStencilTexture('A', 'rgba(235, 82, 34, 0.78)');
  const siteAMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 3.8),
    new THREE.MeshBasicMaterial({
      map: siteATex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  );
  siteAMesh.rotation.x = -Math.PI / 2;
  siteAMesh.position.set(
    DE_DUST2_BOMBSITES.A.center.x,
    DE_DUST2_BOMBSITES.A.center.y + 0.03,
    DE_DUST2_BOMBSITES.A.center.z
  );
  siteAMesh.geometry.computeBoundingSphere();
  siteAMesh.frustumCulled = true;
  mapRoot.add(siteAMesh);
  mapRoot.updateMatrixWorld(true);
  siteAMesh.matrixAutoUpdate = false;
  mapRoot.matrixAutoUpdate = false;

  // Spawn 9 grounded 5v5 tactical operators on verified Dust2 spawn & split positions
  const bots: BotEntity[] = [];
  for (const cfg of DE_DUST2_BOTS) {
    const rig = new OperatorRig(cfg.team, cfg.name);
    const wp0 = cfg.waypoints[0];
    const wp1 = cfg.waypoints[1];
    rig.root.position.set(wp0.x, wp0.y, wp0.z);
    if (wp1 && (Math.abs(wp1.x - wp0.x) > 0.05 || Math.abs(wp1.z - wp0.z) > 0.05)) {
      rig.root.rotation.y = Math.atan2(wp1.x - wp0.x, wp1.z - wp0.z);
    } else {
      rig.root.rotation.y = cfg.team === 'Vanguard' ? Math.PI : Math.PI * 0.5;
    }
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
      weaponId: cfg.team === 'Vanguard' ? 'vanguard-m4' : 'garam-47',
    });
  }

  return {
    colliders: DE_DUST2_COLLIDERS,
    blocks: DE_DUST2_BLOCKS,
    bots,
  };
}
