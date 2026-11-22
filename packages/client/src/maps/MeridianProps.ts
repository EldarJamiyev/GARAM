import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MaterialLibrary } from './MaterialLibrary.js';

/**
 * CS2 Instanced Clutter Props & Environmental Detailing
 * Emits non-colliding street curbs, wooden wine/oil barrels, strapped pallets,
 * sandbags, rooftop AC units, water tanks, and catenary power cables
 * batched into <= 5 draw calls using THREE.InstancedMesh and merged geometries.
 */
export class MeridianProps {
  public static build(scene: THREE.Scene): void {
    const matLib = MaterialLibrary.getInstance();
    const mats = matLib.createMaterials();

    // 1. Instanced Sandstone Street Curbs (Framing courtyard walkways at y = 2.1m)
    const curbGeo = new THREE.BoxGeometry(0.24, 0.18, 1.8);
    const curbMat = mats.sanctum;
    const curbCoords: [number, number, number, number][] = [
      // CT Promenade curb line
      [-14.0, 2.1 + 0.09, -24.0, 0],
      [-14.0, 2.1 + 0.09, -22.2, 0],
      [-14.0, 2.1 + 0.09, -20.4, 0],
      [14.0, 2.1 + 0.09, -24.0, 0],
      [14.0, 2.1 + 0.09, -22.2, 0],
      [14.0, 2.1 + 0.09, -20.4, 0],
      // A Courtyard curbs
      [-26.0, 2.1 + 0.09, -8.0, Math.PI / 2],
      [-24.2, 2.1 + 0.09, -8.0, Math.PI / 2],
      [-22.4, 2.1 + 0.09, -8.0, Math.PI / 2],
      [-20.6, 2.1 + 0.09, -8.0, Math.PI / 2],
      // B Foundry curbs
      [26.0, 2.1 + 0.09, -8.0, Math.PI / 2],
      [24.2, 2.1 + 0.09, -8.0, Math.PI / 2],
      [22.4, 2.1 + 0.09, -8.0, Math.PI / 2],
      [20.6, 2.1 + 0.09, -8.0, Math.PI / 2],
      // T Spawn curbs
      [-10.0, 2.1 + 0.09, 24.0, 0],
      [-10.0, 2.1 + 0.09, 25.8, 0],
      [10.0, 2.1 + 0.09, 24.0, 0],
      [10.0, 2.1 + 0.09, 25.8, 0],
    ];

    const curbInst = new THREE.InstancedMesh(curbGeo, curbMat, curbCoords.length);
    curbInst.castShadow = true;
    curbInst.receiveShadow = true;
    const dummy = new THREE.Object3D();
    curbCoords.forEach(([cx, cy, cz, rotY], i) => {
      dummy.position.set(cx, cy, cz);
      dummy.rotation.set(0, rotY, 0);
      dummy.updateMatrix();
      curbInst.setMatrixAt(i, dummy.matrix);
    });
    curbInst.instanceMatrix.needsUpdate = true;
    scene.add(curbInst);

    // 2. Instanced Weathered Wooden Barrels (with iron bands)
    const barrelBody = new THREE.CylinderGeometry(0.42, 0.36, 1.15, 12);
    const barrelMat = mats.wood;
    const barrelCoords: [number, number, number, number][] = [
      [-32.0, 2.1 + 0.575, -16.0, 0.2],
      [-31.2, 2.1 + 0.575, -16.4, -0.4],
      [-31.6, 2.1 + 0.575, -15.2, 0.8],
      [28.0, 2.1 + 0.575, -14.0, 0.1],
      [27.3, 2.1 + 0.575, -14.6, 0.6],
      [-5.0, 2.1 + 0.575, -26.0, 0.3],
      [5.0, 2.1 + 0.575, -26.0, -0.2],
      [2.0, 0.0 + 0.575, 8.0, 0.5],
      [-2.0, 0.0 + 0.575, -6.0, -0.3],
    ];
    const barrelInst = new THREE.InstancedMesh(barrelBody, barrelMat, barrelCoords.length);
    barrelInst.castShadow = true;
    barrelInst.receiveShadow = true;
    barrelCoords.forEach(([bx, by, bz, rotY], i) => {
      dummy.position.set(bx, by, bz);
      dummy.rotation.set(0, rotY, 0);
      dummy.updateMatrix();
      barrelInst.setMatrixAt(i, dummy.matrix);
    });
    barrelInst.instanceMatrix.needsUpdate = true;
    scene.add(barrelInst);

    // 3. Merged Clutter: Pallets, Sandbags, Rooftop AC Units & Catenary Cables
    const palletGeos: THREE.BufferGeometry[] = [];
    const sandbagGeos: THREE.BufferGeometry[] = [];
    const metalClutterGeos: THREE.BufferGeometry[] = [];

    // Wooden Pallets
    const palletCoords = [
      { x: -30.0, y: 2.1, z: -15.5, rotY: 0.15 },
      { x: 26.5, y: 2.1, z: -15.0, rotY: -0.22 },
      { x: 0.0, y: 2.1, z: -12.0, rotY: 0.0 },
    ];
    for (const p of palletCoords) {
      const topDeck = new THREE.BoxGeometry(1.2, 0.06, 1.2);
      topDeck.rotateY(p.rotY);
      topDeck.translate(p.x, p.y + 0.12, p.z);
      palletGeos.push(topDeck);

      for (let s = -0.5; s <= 0.5; s += 0.5) {
        const stringer = new THREE.BoxGeometry(0.1, 0.12, 1.2);
        stringer.rotateY(p.rotY);
        stringer.translate(p.x + s * Math.cos(p.rotY), p.y + 0.06, p.z + s * Math.sin(p.rotY));
        palletGeos.push(stringer);
      }
    }

    // Stacked Sandbags (Rounded chamfer boxes along B Bench and A Firebox)
    const sandbagCoords = [
      { x: -28.0, y: 2.1, z: -25.0, rotY: 0 },
      { x: -27.2, y: 2.1, z: -25.0, rotY: 0 },
      { x: -26.4, y: 2.1, z: -25.0, rotY: 0 },
      { x: -27.6, y: 2.1 + 0.22, z: -25.0, rotY: 0 },
      { x: -26.8, y: 2.1 + 0.22, z: -25.0, rotY: 0 },
      { x: 25.0, y: 2.1, z: -24.0, rotY: 0 },
      { x: 25.8, y: 2.1, z: -24.0, rotY: 0 },
      { x: 26.6, y: 2.1, z: -24.0, rotY: 0 },
      { x: 25.4, y: 2.1 + 0.22, z: -24.0, rotY: 0 },
      { x: 26.2, y: 2.1 + 0.22, z: -24.0, rotY: 0 },
    ];
    for (const sb of sandbagCoords) {
      const bag = new THREE.BoxGeometry(0.75, 0.22, 0.42);
      bag.rotateY(sb.rotY);
      bag.translate(sb.x, sb.y + 0.11, sb.z);
      sandbagGeos.push(bag);
    }

    // Rooftop AC Units & Galvanized Water Tanks
    const acCoords = [
      { x: -33.4, y: 7.4, z: -18.0 },
      { x: -25.0, y: 7.4, z: -26.0 },
      { x: 28.0, y: 7.4, z: -18.0 },
      { x: 34.0, y: 7.4, z: -24.0 },
    ];
    for (const ac of acCoords) {
      const unit = new THREE.BoxGeometry(1.4, 0.9, 0.85);
      unit.translate(ac.x, ac.y + 0.45, ac.z);
      metalClutterGeos.push(unit);

      // Fan cylinder on top
      const fan = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12);
      fan.translate(ac.x, ac.y + 0.94, ac.z);
      metalClutterGeos.push(fan);
    }

    // Rooftop Galvanized Water Tanks
    for (const [tx, ty, tz] of [
      [-36.0, 7.4, -12.0],
      [36.0, 7.4, -12.0],
    ]) {
      const tank = new THREE.CylinderGeometry(0.85, 0.85, 2.2, 16);
      tank.translate(tx, ty + 1.1, tz);
      metalClutterGeos.push(tank);

      const stand = new THREE.BoxGeometry(1.8, 0.4, 1.8);
      stand.translate(tx, ty + 0.2, tz);
      metalClutterGeos.push(stand);
    }

    // Overhead Catenary Power Cables (Suspended catenary arcs across CT courtyard)
    const cablePoints: THREE.Vector3[] = [];
    const cableStart = new THREE.Vector3(-18.0, 7.8, -20.0);
    const cableEnd = new THREE.Vector3(18.0, 7.8, -20.0);
    for (let t = 0; t <= 1.0; t += 0.05) {
      const p = new THREE.Vector3().lerpVectors(cableStart, cableEnd, t);
      // Catenary sag equation: sag = 4 * maxSag * t * (1 - t)
      p.y -= 4 * 1.6 * t * (1.0 - t);
      cablePoints.push(p);
    }
    const cableCurve = new THREE.CatmullRomCurve3(cablePoints);
    const cableGeo = new THREE.TubeGeometry(cableCurve, 24, 0.024, 6, false);
    metalClutterGeos.push(cableGeo);

    // Merge and emit batches
    const emitMesh = (
      geos: THREE.BufferGeometry[],
      material: THREE.Material,
      castShadow: boolean,
      receiveShadow: boolean
    ) => {
      if (geos.length === 0) return;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      scene.add(mesh);
    };

    emitMesh(palletGeos, mats.wood, true, true);
    emitMesh(
      sandbagGeos,
      new THREE.MeshStandardMaterial({ color: 0xb5a48b, roughness: 0.95, metalness: 0.01 }),
      true,
      true
    );
    emitMesh(metalClutterGeos, mats.metal, true, true);
  }
}
