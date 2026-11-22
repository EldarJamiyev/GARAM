import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MaterialLibrary } from './MaterialLibrary.js';

/**
 * CS2 Non-Boxy Roman Architecture & Mediterranean Silhouettes
 * Constructs curved Roman extruded stone arches, Mid Watchtower terracotta canopy,
 * sloped stair cheek-walls, and recessed shuttered windows.
 * Zero modification to underlying DE_MERIDIAN_BLOCKS colliders.
 */
export class MeridianArchitecture {
  public static build(scene: THREE.Scene): void {
    const matLib = MaterialLibrary.getInstance();
    const mats = matLib.createMaterials();

    const stoneGeos: THREE.BufferGeometry[] = [];
    const terracottaGeos: THREE.BufferGeometry[] = [];
    const ironGeos: THREE.BufferGeometry[] = [];
    const woodGeos: THREE.BufferGeometry[] = [];

    // 1. Curved Roman Stone Archways (A Main, B Short, Underpass)
    const createRomanArchGeometry = (
      width: number,
      height: number,
      depth: number,
      wallThickness: number
    ): THREE.BufferGeometry => {
      const outerR = width * 0.5 + wallThickness;
      const innerR = width * 0.5;
      const pierH = height - innerR;

      const shape = new THREE.Shape();
      // Outer perimeter
      shape.moveTo(-outerR, 0);
      shape.lineTo(outerR, 0);
      shape.lineTo(outerR, pierH);
      shape.absarc(0, pierH, outerR, 0, Math.PI, false);
      shape.lineTo(-outerR, 0);

      // Inner cutout (arch opening)
      const hole = new THREE.Path();
      hole.moveTo(-innerR, 0);
      hole.lineTo(innerR, 0);
      hole.lineTo(innerR, pierH);
      hole.absarc(0, pierH, innerR, 0, Math.PI, false);
      hole.lineTo(-innerR, 0);
      shape.holes.push(hole);

      const extrudeSettings: THREE.ExtrudeGeometryOptions = {
        depth,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.05,
        bevelThickness: 0.05,
        curveSegments: 16,
      };

      const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geo.translate(0, 0, -depth * 0.5);
      return geo;
    };

    // A Main Portal Arch
    const aMainArch = createRomanArchGeometry(5.2, 5.4, 1.2, 0.8);
    aMainArch.translate(-33.4, 2.1, -6.5);
    stoneGeos.push(aMainArch);

    // B Short Portal Arch
    const bShortArch = createRomanArchGeometry(4.8, 5.2, 1.2, 0.8);
    bShortArch.translate(22.0, 2.1, -14.0);
    stoneGeos.push(bShortArch);

    // Underpass North & South Portal Arches (y = 0.0m sunken aqueduct)
    const underpassArchS = createRomanArchGeometry(4.4, 4.2, 1.0, 0.7);
    underpassArchS.translate(0, 0.0, 18.0);
    stoneGeos.push(underpassArchS);

    const underpassArchN = createRomanArchGeometry(4.4, 4.2, 1.0, 0.7);
    underpassArchN.translate(0, 0.0, -14.0);
    stoneGeos.push(underpassArchN);

    // Keystones for arches
    for (const [kx, ky, kz] of [
      [-33.4, 2.1 + 5.5, -6.5],
      [22.0, 2.1 + 5.3, -14.0],
      [0.0, 0.0 + 4.3, 18.0],
      [0.0, 0.0 + 4.3, -14.0],
    ]) {
      const keystone = new THREE.BoxGeometry(0.55, 0.75, 1.35);
      keystone.translate(kx, ky, kz);
      stoneGeos.push(keystone);
    }

    // 2. Mid Watchtower Roof & Sloped Cheek-Walls
    // Sloped sandstone stair cheek-walls (smooth ramps flanking stairs at x = -7.6 and x = 7.6)
    const cheekShape = new THREE.Shape();
    cheekShape.moveTo(0, 0);
    cheekShape.lineTo(6.5, 0);
    cheekShape.lineTo(6.5, 2.8);
    cheekShape.lineTo(0, 0.8);
    cheekShape.lineTo(0, 0);

    const cheekExtrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.45,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
    };

    const cheekL = new THREE.ExtrudeGeometry(cheekShape, cheekExtrudeSettings);
    cheekL.rotateY(Math.PI / 2);
    cheekL.translate(-7.6, 2.1, -17.0);
    stoneGeos.push(cheekL);

    const cheekR = new THREE.ExtrudeGeometry(cheekShape, cheekExtrudeSettings);
    cheekR.rotateY(Math.PI / 2);
    cheekR.translate(7.6 - 0.45, 2.1, -17.0);
    stoneGeos.push(cheekR);

    // Pitched Terracotta Tile Roof Canopy over Mid Nest
    const roofPitchedL = new THREE.BoxGeometry(5.8, 0.28, 8.2);
    roofPitchedL.rotateZ(0.18);
    roofPitchedL.translate(-2.6, 8.95, -16.35);
    terracottaGeos.push(roofPitchedL);

    const roofPitchedR = new THREE.BoxGeometry(5.8, 0.28, 8.2);
    roofPitchedR.rotateZ(-0.18);
    roofPitchedR.translate(2.6, 8.95, -16.35);
    terracottaGeos.push(roofPitchedR);

    // Terracotta ridge cap
    const ridgeCap = new THREE.BoxGeometry(0.45, 0.35, 8.4);
    ridgeCap.translate(0, 9.45, -16.35);
    terracottaGeos.push(ridgeCap);

    // Dark Wrought-Iron Window Trim / Security Grills for Mid Sniper Nest
    for (let gx = -2.4; gx <= 2.4; gx += 0.8) {
      const bar = new THREE.CylinderGeometry(0.025, 0.025, 1.8, 8);
      bar.translate(gx, 6.2, -13.2);
      ironGeos.push(bar);
    }
    const barFrameH1 = new THREE.BoxGeometry(5.4, 0.06, 0.08);
    barFrameH1.translate(0, 5.4, -13.2);
    ironGeos.push(barFrameH1);

    const barFrameH2 = new THREE.BoxGeometry(5.4, 0.06, 0.08);
    barFrameH2.translate(0, 7.0, -13.2);
    ironGeos.push(barFrameH2);

    // 3. Recessed Mediterranean Windows with Louvered Shutters & Limestone Sills
    const windowLocs = [
      { x: -33.4, y: 5.4, z: -14.2, rotY: 0 },
      { x: -28.0, y: 5.4, z: -26.5, rotY: 0 },
      { x: -18.0, y: 5.4, z: -26.5, rotY: 0 },
      { x: 24.0, y: 5.4, z: -25.5, rotY: 0 },
      { x: 34.0, y: 5.4, z: -14.5, rotY: 0 },
      { x: -38.2, y: 5.4, z: 2.0, rotY: Math.PI / 2 },
      { x: 38.2, y: 5.4, z: 2.0, rotY: -Math.PI / 2 },
    ];

    for (const w of windowLocs) {
      // Limestone Sill
      const sill = new THREE.BoxGeometry(1.45, 0.16, 0.35);
      sill.rotateY(w.rotY);
      sill.translate(w.x, w.y - 0.9, w.z);
      stoneGeos.push(sill);

      // Window Lintel / Header
      const lintel = new THREE.BoxGeometry(1.45, 0.18, 0.32);
      lintel.rotateY(w.rotY);
      lintel.translate(w.x, w.y + 0.9, w.z);
      stoneGeos.push(lintel);

      // Recessed Interior Glass / Dark Void
      const voidGlass = new THREE.BoxGeometry(1.15, 1.6, 0.1);
      voidGlass.rotateY(w.rotY);
      voidGlass.translate(w.x, w.y, w.z - 0.08);
      ironGeos.push(voidGlass);

      // Louvered Wooden Shutters (Left & Right)
      const shutterL = new THREE.BoxGeometry(0.38, 1.55, 0.08);
      shutterL.rotateY(w.rotY + 0.25);
      shutterL.translate(w.x - 0.65 * Math.cos(w.rotY), w.y, w.z - 0.65 * Math.sin(w.rotY));
      woodGeos.push(shutterL);

      const shutterR = new THREE.BoxGeometry(0.38, 1.55, 0.08);
      shutterR.rotateY(w.rotY - 0.25);
      shutterR.translate(w.x + 0.65 * Math.cos(w.rotY), w.y, w.z + 0.65 * Math.sin(w.rotY));
      woodGeos.push(shutterR);
    }

    // Merge and emit batches
    const emitMesh = (
      geos: THREE.BufferGeometry[],
      material: THREE.Material,
      castShadow: boolean,
      receiveShadow: boolean
    ) => {
      if (geos.length === 0) return;
      for (const g of geos) {
        if (!g.index) {
          const count = g.attributes.position.count;
          const indices = Array.from({ length: count }, (_, i) => i);
          g.setIndex(indices);
        }
      }
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      scene.add(mesh);
    };

    emitMesh(stoneGeos, mats.sanctum, true, true);
    emitMesh(terracottaGeos, new THREE.MeshStandardMaterial({ color: 0xb85236, roughness: 0.85, metalness: 0.04 }), true, true);
    emitMesh(ironGeos, new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.45, metalness: 0.85 }), true, false);
    emitMesh(woodGeos, mats.wood, true, true);
  }
}
