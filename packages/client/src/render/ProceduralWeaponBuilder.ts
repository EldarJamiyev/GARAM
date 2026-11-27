import * as THREE from 'three';

/**
 * High-detail PBR procedural weapon builder for CS2 weapons whose optional Sketchfab GLB
 * is not bundled locally (m4a4, usp-s, glock-18, mp9), built in exact 1:1 canonical
 * metric coordinates with zero double-scaling:
 *   - Right-hand pistol grip core anchored strictly at (0, 0, 0)
 *   - Barrel pointing strictly along +Z (so 1P rotationEuler [0, PI, 0] flips cleanly to -Z,
 *     and 3P canonical mount points directly forward along +Z!)
 *   - Top sight rail along +Y
 */
export function buildProceduralCS2Weapon(weaponId: string): THREE.Group {
  const root = new THREE.Group();
  root.name = `proc_weapon_${weaponId}`;

  const gunmetal = new THREE.MeshStandardMaterial({
    color: 0x262c35,
    roughness: 0.34,
    metalness: 0.84,
    envMapIntensity: 1.55,
  });
  const matteSteel = new THREE.MeshStandardMaterial({
    color: 0x1c2128,
    roughness: 0.42,
    metalness: 0.76,
    envMapIntensity: 1.35,
  });
  const darkPolymer = new THREE.MeshStandardMaterial({
    color: 0x181c22,
    roughness: 0.72,
    metalness: 0.14,
    envMapIntensity: 1.05,
  });
  const brushedSteel = new THREE.MeshStandardMaterial({
    color: 0x626c78,
    roughness: 0.24,
    metalness: 0.92,
    envMapIntensity: 1.8,
  });
  const tanAccent = new THREE.MeshStandardMaterial({
    color: 0x86745a,
    roughness: 0.62,
    metalness: 0.12,
    envMapIntensity: 1.05,
  });
  const gripRubber = new THREE.MeshStandardMaterial({
    color: 0x121519,
    roughness: 0.86,
    metalness: 0.08,
    envMapIntensity: 0.8,
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
    rx = 0,
    rz = 0,
    parent: THREE.Object3D = root
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (rx !== 0) mesh.rotation.x = rx;
    if (rz !== 0) mesh.rotation.z = rz;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const addCyl = (
    rt: number,
    rb: number,
    len: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    segments = 16,
    parent: THREE.Object3D = root
  ) => {
    const geo = new THREE.CylinderGeometry(rt, rb, len, segments);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  let muzzleZ = 0.55;
  let muzzleY = 0.082;

  if (weaponId === 'm4a4') {
    // Vanguard M4A4 — Authentic AR-15 ergonomics: contoured pistol grip at (0,0,0), beveled upper/lower,
    // Picatinny rail teeth, quad-rail RIS handguard with vents, angled STANAG 30-rd mag, collapsible stock
    addBox(0.030, 0.105, 0.042, 0, -0.022, -0.008, gripRubber, 0.28); // Pistol grip centered on right hand
    addBox(0.026, 0.010, 0.046, 0, 0.002, 0.034, matteSteel); // Trigger guard bottom
    addBox(0.006, 0.022, 0.010, 0, 0.018, 0.032, brushedSteel, -0.25); // Curved trigger
    // Lower + beveled upper receiver
    addBox(0.038, 0.042, 0.175, 0, 0.042, 0.058, matteSteel);
    addBox(0.036, 0.038, 0.190, 0, 0.080, 0.056, gunmetal);
    addBox(0.039, 0.014, 0.185, 0, 0.068, 0.056, matteSteel); // Receiver bevel trim
    // Recessed ejection port & bolt carrier
    const bolt = addBox(0.008, 0.018, 0.068, -0.017, 0.080, 0.065, brushedSteel);
    bolt.name = 'v_weapon_m4a4_bolt';
    addBox(0.014, 0.012, 0.020, -0.018, 0.084, 0.012, gunmetal); // Brass deflector
    // Charging handle at rear of upper
    addBox(0.032, 0.010, 0.022, 0, 0.094, -0.044, matteSteel);
    // Top Picatinny rail + machined slots
    addBox(0.022, 0.011, 0.185, 0, 0.104, 0.058, gunmetal);
    for (let i = 0; i < 8; i++) {
      addBox(0.024, 0.005, 0.011, 0, 0.111, -0.022 + i * 0.022, brushedSteel);
    }
    // Flip-up rear aperture sight & triangular A2 front sight post
    addBox(0.022, 0.024, 0.024, 0, 0.122, -0.015, gunmetal);
    addBox(0.008, 0.012, 0.006, 0, 0.125, -0.015, darkPolymer);
    addBox(0.012, 0.040, 0.026, 0, 0.116, 0.395, gunmetal);
    addBox(0.004, 0.014, 0.004, 0, 0.136, 0.395, sightGlow);
    // Quad-rail RIS handguard with ventilated tan covers + delta ring
    addCyl(0.024, 0.026, 0.026, 0, 0.078, 0.162, matteSteel, 14);
    addBox(0.042, 0.046, 0.215, 0, 0.078, 0.278, darkPolymer);
    addBox(0.046, 0.020, 0.185, 0, 0.078, 0.278, tanAccent); // Side rail covers
    addBox(0.022, 0.010, 0.210, 0, 0.104, 0.278, gunmetal); // Top handguard rail
    addBox(0.022, 0.010, 0.195, 0, 0.051, 0.278, gunmetal); // Bottom rail
    // Heavy barrel + gas block + birdcage flash hider
    addCyl(0.009, 0.010, 0.21, 0, 0.080, 0.485, brushedSteel, 14);
    addCyl(0.012, 0.012, 0.048, 0, 0.080, 0.598, matteSteel, 14);
    // Curved STANAG 30-round magazine (two-segment curve)
    const magGroup = new THREE.Group();
    magGroup.name = 'v_weapon_m4a4_mag';
    magGroup.position.set(0, -0.032, 0.122);
    addBox(0.022, 0.085, 0.056, 0, 0.022, 0.0, gunmetal, -0.06, 0, magGroup);
    addBox(0.022, 0.082, 0.056, 0, -0.052, 0.012, matteSteel, -0.22, 0, magGroup);
    root.add(magGroup);
    // Buffer tube + crane buttstock tucked cleanly rearward
    addCyl(0.015, 0.015, 0.19, 0, 0.078, -0.135, matteSteel, 14);
    addBox(0.036, 0.110, 0.135, 0, 0.050, -0.215, darkPolymer);
    addBox(0.038, 0.114, 0.016, 0, 0.050, -0.285, gripRubber); // Rubber buttpad
    muzzleZ = 0.622;
    muzzleY = 0.080;
  } else if (weaponId === 'usp-s') {
    // Vanguard USP-S — Sleek Heckler & Koch tactical profile, contoured grip at (0,0,0),
    // beveled machined slide with rear serrations, ejection port, crisp 3-dot irons, matte silencer
    addBox(0.026, 0.095, 0.040, 0, -0.018, -0.008, gripRubber, 0.22); // Grip centered on right hand
    addBox(0.022, 0.007, 0.038, 0, 0.004, 0.032, darkPolymer); // Squared H&K trigger guard
    addBox(0.005, 0.018, 0.008, 0, 0.016, 0.028, brushedSteel, -0.22); // Trigger
    addBox(0.027, 0.022, 0.168, 0, 0.036, 0.058, darkPolymer); // Polymer lower frame & rail
    addBox(0.018, 0.007, 0.052, 0, 0.024, 0.112, matteSteel); // Underbarrel accessory rail
    // Animated slide group (upper bevel + serrations + ejection port + crisp compact sights)
    const slideGroup = new THREE.Group();
    slideGroup.name = 'v_weapon_usps_slide';
    addBox(0.026, 0.026, 0.174, 0, 0.060, 0.056, gunmetal, 0, 0, slideGroup);
    addBox(0.020, 0.007, 0.172, 0, 0.075, 0.056, matteSteel, 0, 0, slideGroup); // Beveled top crown
    addBox(0.016, 0.012, 0.036, -0.008, 0.068, 0.068, brushedSteel, 0, 0, slideGroup); // Ejection port/chamber
    // Rear slide serrations
    for (let i = 0; i < 4; i++) {
      addBox(0.0275, 0.018, 0.003, 0, 0.058, -0.016 + i * 0.008, darkPolymer, 0, 0, slideGroup);
    }
    // Crisp realistic compact 3-dot tritium ironsights (tiny precision dots, never oversized blocks)
    addBox(0.016, 0.007, 0.008, 0, 0.081, -0.022, matteSteel, 0, 0, slideGroup);
    addBox(0.003, 0.003, 0.003, -0.005, 0.082, -0.025, sightGlow, 0, 0, slideGroup);
    addBox(0.003, 0.003, 0.003, 0.005, 0.082, -0.025, sightGlow, 0, 0, slideGroup);
    addBox(0.004, 0.008, 0.008, 0, 0.081, 0.136, matteSteel, 0, 0, slideGroup);
    addBox(0.0028, 0.0028, 0.003, 0, 0.083, 0.133, sightGlow, 0, 0, slideGroup);
    root.add(slideGroup);
    // Exposed hammer & magazine baseplate
    addBox(0.008, 0.014, 0.012, 0, 0.054, -0.034, brushedSteel, -0.35);
    const mag = addBox(0.024, 0.012, 0.042, 0, -0.066, -0.018, matteSteel, 0.22);
    mag.name = 'v_weapon_usps_mag';
    // Iconic matte-black cylindrical USP-S suppressor with knurled collar & endcap
    addCyl(0.0145, 0.0145, 0.018, 0, 0.060, 0.152, brushedSteel, 16);
    addCyl(0.0138, 0.0138, 0.155, 0, 0.060, 0.238, darkPolymer, 18);
    addCyl(0.0142, 0.0142, 0.008, 0, 0.060, 0.314, matteSteel, 18);
    muzzleZ = 0.320;
    muzzleY = 0.060;
  } else if (weaponId === 'glock-18') {
    // Syndicate Glock-18 — Iconic matte polymer frame, flat beveled Tenifer slide, selector switch, crisp compact sights
    addBox(0.026, 0.095, 0.040, 0, -0.018, -0.010, gripRubber, 0.28); // Grip centered on right hand
    addBox(0.022, 0.007, 0.036, 0, 0.004, 0.030, darkPolymer); // Trigger guard
    addBox(0.005, 0.016, 0.008, 0, 0.015, 0.026, darkPolymer, -0.2); // Safe-action trigger
    addBox(0.027, 0.020, 0.162, 0, 0.035, 0.054, darkPolymer); // Polymer frame
    // Animated slide group
    const slideGroup = new THREE.Group();
    slideGroup.name = 'v_weapon_glock_slide';
    addBox(0.026, 0.026, 0.168, 0, 0.058, 0.052, gunmetal, 0, 0, slideGroup);
    addBox(0.022, 0.005, 0.166, 0, 0.072, 0.052, matteSteel, 0, 0, slideGroup); // Chamfered top
    addBox(0.016, 0.012, 0.034, -0.007, 0.066, 0.064, brushedSteel, 0, 0, slideGroup); // Ejection port
    // Fire-selector switch on left rear of Glock-18 slide
    addCyl(0.004, 0.004, 0.008, 0.015, 0.060, -0.018, brushedSteel, 10, slideGroup);
    // Rear slide serrations
    for (let i = 0; i < 4; i++) {
      addBox(0.0272, 0.018, 0.003, 0, 0.057, -0.012 + i * 0.007, darkPolymer, 0, 0, slideGroup);
    }
    // Crisp realistic Glock U-notch rear & micro dot front sight
    addBox(0.015, 0.006, 0.007, 0, 0.077, -0.024, darkPolymer, 0, 0, slideGroup);
    addBox(0.0028, 0.0028, 0.003, -0.0045, 0.078, -0.027, sightGlow, 0, 0, slideGroup);
    addBox(0.0028, 0.0028, 0.003, 0.0045, 0.078, -0.027, sightGlow, 0, 0, slideGroup);
    addBox(0.004, 0.007, 0.007, 0, 0.077, 0.128, darkPolymer, 0, 0, slideGroup);
    addBox(0.0028, 0.0028, 0.003, 0, 0.079, 0.126, sightGlow, 0, 0, slideGroup);
    root.add(slideGroup);
    // Crowned barrel tip & magazine floorplate
    addCyl(0.007, 0.007, 0.022, 0, 0.058, 0.140, brushedSteel, 12);
    const mag = addBox(0.024, 0.011, 0.040, 0, -0.065, -0.022, darkPolymer, 0.28);
    mag.name = 'v_weapon_glock_mag';
    muzzleZ = 0.152;
    muzzleY = 0.058;
  } else {
    // Tactical B&T MP9 SMG — Compact olive-charcoal polymer chassis, pistol grip at (0,0,0),
    // extended 30-rd translucent/gunmetal stick mag, integrated angled vertical foregrip, micro reflex optic, side-folded stock
    const mp9Olive = new THREE.MeshStandardMaterial({
      color: 0x353e36,
      roughness: 0.62,
      metalness: 0.20,
      envMapIntensity: 1.15,
    });
    addBox(0.028, 0.098, 0.040, 0, -0.018, -0.004, gripRubber, 0.14); // Pistol grip centered on right hand
    addBox(0.024, 0.008, 0.040, 0, 0.004, 0.032, darkPolymer); // Trigger guard
    const mag = addBox(0.022, 0.155, 0.030, 0, -0.088, 0.005, gunmetal, 0.14); // 30-rd stick mag
    mag.name = 'v_weapon_mp9_mag';
    // Contoured MP9 lower + stepped upper receiver
    addBox(0.038, 0.034, 0.235, 0, 0.046, 0.088, darkPolymer);
    addBox(0.036, 0.038, 0.245, 0, 0.078, 0.088, mp9Olive);
    addBox(0.030, 0.010, 0.238, 0, 0.099, 0.088, gunmetal); // Top bevel
    // Bolt handle + recessed ejection port
    const bolt = addBox(0.008, 0.016, 0.052, -0.016, 0.078, 0.095, brushedSteel);
    bolt.name = 'v_weapon_mp9_bolt';
    // Top Picatinny rail + compact micro reflex optic with open frame
    addBox(0.020, 0.008, 0.200, 0, 0.107, 0.088, matteSteel);
    addBox(0.022, 0.007, 0.046, 0, 0.114, 0.068, darkPolymer); // Optic mount base
    addBox(0.004, 0.022, 0.042, -0.011, 0.128, 0.068, darkPolymer); // Optic left wall
    addBox(0.004, 0.022, 0.042, 0.011, 0.128, 0.068, darkPolymer); // Optic right wall
    addBox(0.024, 0.004, 0.042, 0, 0.140, 0.068, darkPolymer); // Optic hood top
    addBox(0.003, 0.003, 0.003, 0, 0.128, 0.068, sightGlow); // Crisp red/green micro dot
    // Integrated B&T vertical foregrip (exact left-hand anchor at z = +0.178!)
    addBox(0.025, 0.082, 0.028, 0, -0.008, 0.178, darkPolymer, -0.08);
    // Stub barrel + 3-lug QD flash suppressor
    addCyl(0.011, 0.012, 0.082, 0, 0.076, 0.248, brushedSteel, 14);
    addCyl(0.014, 0.014, 0.026, 0, 0.076, 0.292, matteSteel, 14);
    // Side-folded skeleton stock tucked along left side of receiver
    addBox(0.010, 0.012, 0.165, -0.023, 0.084, 0.018, darkPolymer);
    addBox(0.010, 0.012, 0.165, -0.023, 0.048, 0.018, darkPolymer);
    addBox(0.012, 0.056, 0.018, -0.023, 0.066, -0.062, gripRubber);
    muzzleZ = 0.308;
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
