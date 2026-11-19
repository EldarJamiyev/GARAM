import * as THREE from 'three';

export interface TargetEntity {
  mesh: THREE.Group;
  headCollider: THREE.Mesh;
  bodyCollider: THREE.Mesh;
  health: number;
  isDead: boolean;
  team: 'Vanguard' | 'Syndicate';
}

export function buildTacticalMap(scene: THREE.Scene): { targets: TargetEntity[]; colliders: THREE.Box3[] } {
  const colliders: THREE.Box3[] = [];
  const targets: TargetEntity[] = [];

  // Floor (Main Arena - Weathered concrete style)
  const floorGeo = new THREE.PlaneGeometry(100, 100);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x22262a,
    roughness: 0.85,
    metalness: 0.15,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Helper to place walls with collision bounds
  const addWall = (x: number, y: number, z: number, w: number, h: number, d: number, color = 0x3d4349) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const box = new THREE.Box3().setFromObject(mesh);
    colliders.push(box);
    return mesh;
  };

  // Outer Map Boundaries (DE_CITADEL Courtyard perimeter)
  addWall(0, 0, -50, 100, 8, 2); // North Wall
  addWall(0, 0, 50, 100, 8, 2);  // South Wall (CT Spawn)
  addWall(-50, 0, 0, 2, 8, 100); // West Wall (A Long)
  addWall(50, 0, 0, 2, 8, 100);  // East Wall (B Tunnels)

  // Bombsite A: Armory Courtyard (Elevated Heaven & Triple Crates)
  addWall(-24, 0, -22, 14, 5, 2); // A site wall
  addWall(-32, 0, -26, 4, 3, 4, 0x8b5a2b); // Wooden crate 1
  addWall(-28, 0, -26, 3, 2, 3, 0x8b5a2b); // Wooden crate 2
  addWall(-30, 2, -26, 2.5, 2, 2.5, 0x8b5a2b); // Triple-stack top crate

  // Mid: Double Doors & Sniper Archway
  addWall(-4, 0, 0, 8, 6, 1.5);  // Mid left divider
  addWall(12, 0, 0, 16, 6, 1.5); // Mid right divider
  // The choke point between (x = 4 to 8) represents Mid Double Doors

  // Bombsite B: Reactor Vault (Industrial shipping containers)
  addWall(28, 0, -28, 12, 3.5, 4.5, 0x224466); // Blue cargo container
  addWall(34, 0, -18, 4.5, 3.5, 12, 0x882222); // Red cargo container

  // Spawn Target Dummies / Bots for Ballistics & Hitbox testing
  const spawnDummy = (x: number, z: number, team: 'Vanguard' | 'Syndicate') => {
    const dummyGroup = new THREE.Group();

    // Body (Upper + Lower chest)
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.1, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: team === 'Syndicate' ? 0x6e737a : 0x181c20,
      roughness: 0.6,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.95;
    bodyMesh.castShadow = true;
    dummyGroup.add(bodyMesh);

    // Head (Sphere for 4x metallic dink hit detection)
    const headGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x202428,
      metalness: 0.8,
      roughness: 0.3,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.y = 1.68;
    headMesh.castShadow = true;
    dummyGroup.add(headMesh);

    dummyGroup.position.set(x, 0, z);
    scene.add(dummyGroup);

    targets.push({
      mesh: dummyGroup,
      headCollider: headMesh,
      bodyCollider: bodyMesh,
      health: 100,
      isDead: false,
      team,
    });
  };

  // Place Syndicate bot dummies around Mid and Site A
  spawnDummy(-28, -20, 'Syndicate');
  spawnDummy(4, -15, 'Syndicate');
  spawnDummy(30, -22, 'Syndicate');

  return { targets, colliders };
}
