import * as THREE from 'three';

/**
 * High-detail PBR procedural weapon builder for CS2 weapons whose optional Sketchfab GLB
 * is not yet downloaded locally (m4a4, usp-s, glock-18, mp9), matching exact canonical
 * metric coordinates:
 *   - Pistol grip origin at (0, 0, 0)
 *   - Barrel pointing strictly along +Z (so 1P rotationEuler [0, PI, 0] flips cleanly to -Z,
 *     and 3P canonical mount points directly forward along +Z!)
 *   - Top sight rail along +Y
 */
export function buildProceduralCS2Weapon(weaponId: string): THREE.Group {
  const root = new THREE.Group();
  root.name = `proc_weapon_${weaponId}`;

  const gunmetal = new THREE.MeshStandardMaterial({
    color: 0x262b33,
    roughness: 0.34,
    metalness: 0.84,
    envMapIntensity: 1.5,
  });
  const darkPolymer = new THREE.MeshStandardMaterial({
    color: 0x1a1e24,
    roughness: 0.68,
    metalness: 0.16,
    envMapIntensity: 1.1,
  });
  const brushedSteel = new THREE.MeshStandardMaterial({
    color: 0x5c6672,
    roughness: 0.26,
    metalness: 0.92,
    envMapIntensity: 1.7,
  });
  const tanAccent = new THREE.MeshStandardMaterial({
    color: 0x8c785c,
    roughness: 0.58,
    metalness: 0.14,
    envMapIntensity: 1.1,
  });
  const sightGlow = new THREE.MeshBasicMaterial({ color: 0x38ff9c });

  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rx = 0
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (rx !== 0) mesh.rotation.x = rx;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  const addCyl = (
    rt: number,
    rb: number,
    len: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material
  ) => {
    const geo = new THREE.CylinderGeometry(rt, rb, len, 12);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  let muzzleZ = 0.55;
  let muzzleY = 0.085;

  if (weaponId === 'm4a4') {
    // Vanguard M4A4 — Iconic flat-top Picatinny rail, quad-rail handguard, angled STANAG 30-rd mag, collapsible stock
    addBox(0.036, 0.115, 0.044, 0, -0.02, -0.01, darkPolymer, 0.28); // Pistol grip
    addBox(0.046, 0.086, 0.22, 0, 0.068, 0.06, gunmetal); // Upper + lower receiver
    addBox(0.028, 0.016, 0.20, 0, 0.118, 0.06, brushedSteel); // Top Picatinny rail
    // Rear & front iron sights
    addBox(0.026, 0.032, 0.032, 0, 0.136, -0.015, gunmetal);
    addBox(0.016, 0.042, 0.022, 0, 0.138, 0.42, gunmetal);
    // Quad-rail RIS handguard with tan rail covers
    addBox(0.052, 0.058, 0.24, 0, 0.080, 0.28, darkPolymer);
    addBox(0.058, 0.026, 0.20, 0, 0.080, 0.28, tanAccent);
    // Heavy barrel + birdcage flash hider
    addCyl(0.011, 0.012, 0.22, 0, 0.084, 0.49, brushedSteel);
    addCyl(0.015, 0.015, 0.055, 0, 0.084, 0.60, gunmetal);
    // Curved STANAG 30-round magazine
    addBox(0.026, 0.175, 0.066, 0, -0.035, 0.125, gunmetal, -0.14);
    // Buffer tube + crane buttstock
    addCyl(0.017, 0.017, 0.20, 0, 0.084, -0.14, gunmetal);
    addBox(0.042, 0.125, 0.15, 0, 0.052, -0.22, darkPolymer);
    muzzleZ = 0.63;
    muzzleY = 0.084;
  } else if (weaponId === 'usp-s') {
    // Vanguard USP-S — Crisp tactical polymer frame, angular stainless-dark slide, long cylindrical suppressor
    addBox(0.030, 0.105, 0.044, 0, -0.015, -0.008, darkPolymer, 0.22); // Grip
    addBox(0.032, 0.034, 0.19, 0, 0.046, 0.068, darkPolymer); // Lower frame & underrail
    const slide = addBox(0.030, 0.032, 0.195, 0, 0.072, 0.065, gunmetal); // Slide
    slide.name = 'v_weapon_usps_slide';
    addBox(0.012, 0.010, 0.012, 0, 0.092, -0.02, sightGlow); // Tritium rear sight
    addBox(0.008, 0.010, 0.010, 0, 0.092, 0.155, sightGlow); // Front sight
    // Iconic matte-black cylindrical USP-S silencer
    addCyl(0.016, 0.016, 0.19, 0, 0.068, 0.255, darkPolymer);
    addCyl(0.017, 0.017, 0.018, 0, 0.068, 0.168, brushedSteel); // Silencer collar
    muzzleZ = 0.355;
    muzzleY = 0.068;
  } else if (weaponId === 'glock-18') {
    // Syndicate Glock-18 — Blocky iconic matte slide, angled polymer grip, tritium sights
    addBox(0.031, 0.105, 0.045, 0, -0.015, -0.01, darkPolymer, 0.28); // Grip
    addBox(0.032, 0.030, 0.185, 0, 0.044, 0.062, darkPolymer); // Polymer frame
    const slide = addBox(0.031, 0.034, 0.192, 0, 0.070, 0.060, brushedSteel); // Metallic slide
    slide.name = 'v_weapon_glock_slide';
    addBox(0.012, 0.008, 0.010, 0, 0.090, -0.025, sightGlow);
    addBox(0.008, 0.009, 0.010, 0, 0.090, 0.148, sightGlow);
    addCyl(0.009, 0.009, 0.03, 0, 0.068, 0.165, gunmetal); // Crowned barrel tip
    muzzleZ = 0.185;
    muzzleY = 0.068;
  } else {
    // Tactical MP9 SMG — Compact olive/charcoal polymer chassis, integrated foregrip, tall stick mag, side-folded stock
    const mp9Olive = new THREE.MeshStandardMaterial({
      color: 0x3b443b,
      roughness: 0.62,
      metalness: 0.22,
      envMapIntensity: 1.15,
    });
    addBox(0.034, 0.11, 0.044, 0, -0.015, -0.005, darkPolymer, 0.14); // Pistol grip
    addBox(0.026, 0.17, 0.034, 0, -0.095, 0.005, gunmetal, 0.14); // Extended 30-rd stick mag inside grip
    addBox(0.048, 0.088, 0.29, 0, 0.072, 0.095, mp9Olive); // Compact receiver body
    addBox(0.028, 0.014, 0.24, 0, 0.122, 0.095, gunmetal); // Top rail
    // Compact red-dot optic housing
    addBox(0.032, 0.036, 0.056, 0, 0.145, 0.06, darkPolymer);
    addBox(0.010, 0.010, 0.004, 0, 0.146, 0.06, sightGlow);
    // Integrated vertical foregrip
    addBox(0.030, 0.092, 0.034, 0, -0.005, 0.195, darkPolymer, -0.08);
    // Stub barrel + flash suppressor
    addCyl(0.014, 0.014, 0.095, 0, 0.076, 0.275, brushedSteel);
    // Folded skeleton stock tucked cleanly behind receiver
    addBox(0.020, 0.068, 0.16, -0.026, 0.062, -0.10, darkPolymer);
    muzzleZ = 0.325;
    muzzleY = 0.076;
  }

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.userData.normalizationScale = 1.0;
  root.userData.normalizedBounds = box;
  root.userData.barrelAxisLocal = new THREE.Vector3(0, 0, 1);
  root.userData.muzzleTipLocal = new THREE.Vector3(0, muzzleY, muzzleZ);
  root.userData.anchorBoneFound = true;
  return root;
}
