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
  const woodStockMat = new THREE.MeshStandardMaterial({
    color: 0x6b3e22,
    roughness: 0.54,
    metalness: 0.06,
    envMapIntensity: 0.72,
  });
  const opticGlassMat = new THREE.MeshStandardMaterial({
    color: 0x0b3d2c,
    roughness: 0.06,
    metalness: 0.25,
    envMapIntensity: 2.1,
  });
  const olivePolymer = new THREE.MeshStandardMaterial({
    color: 0x384539,
    roughness: 0.65,
    metalness: 0.12,
    envMapIntensity: 0.95,
  });
  const shieldGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x99ccff,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
    envMapIntensity: 1.8,
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
    const suppressorGroup = new THREE.Group();
    suppressorGroup.name = 'v_weapon_silencer';
    addCyl(0.0145, 0.0145, 0.018, 0, 0.060, 0.152, brushedSteel, 16, suppressorGroup);
    addCyl(0.0138, 0.0138, 0.155, 0, 0.060, 0.238, darkPolymer, 18, suppressorGroup);
    addCyl(0.0142, 0.0142, 0.008, 0, 0.060, 0.314, matteSteel, 18, suppressorGroup);
    root.add(suppressorGroup);
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
  } else if (weaponId === 'mp5-navy') {
    // Classic H&K MP5A3 Navy — Stamped gunmetal upper, curved 30-rd steel mag, sloped tropical handguard,
    // hooded ring front sight, rotary diopter rear drum, 3-lug flash hider, collapsed wire stock
    addBox(0.028, 0.098, 0.040, 0, -0.020, -0.004, gripRubber, 0.22);
    addBox(0.026, 0.010, 0.044, 0, 0.002, 0.032, darkPolymer);
    addBox(0.038, 0.034, 0.210, 0, 0.045, 0.064, darkPolymer);
    addBox(0.036, 0.038, 0.260, 0, 0.078, 0.082, gunmetal);
    addCyl(0.014, 0.014, 0.220, 0, 0.098, 0.135, matteSteel, 14);
    const cockingHandle = addBox(0.024, 0.010, 0.012, 0.016, 0.100, 0.215, brushedSteel, 0, 0.35);
    cockingHandle.name = 'v_weapon_mp5_bolt';
    addBox(0.042, 0.046, 0.155, 0, 0.068, 0.245, darkPolymer, 0.04);
    addCyl(0.010, 0.010, 0.016, 0, 0.104, 0.008, matteSteel, 10);
    addCyl(0.012, 0.012, 0.018, 0, 0.108, 0.315, gunmetal, 14);
    addBox(0.003, 0.010, 0.004, 0, 0.108, 0.315, sightGlow);
    addCyl(0.009, 0.010, 0.095, 0, 0.076, 0.345, brushedSteel, 12);
    addCyl(0.012, 0.012, 0.022, 0, 0.076, 0.398, matteSteel, 12);
    const mag = new THREE.Group();
    mag.name = 'v_weapon_mp5_mag';
    mag.position.set(0, -0.025, 0.145);
    addBox(0.020, 0.082, 0.034, 0, 0.018, 0, matteSteel, -0.08, 0, mag);
    addBox(0.020, 0.085, 0.034, 0, -0.056, 0.014, gunmetal, -0.26, 0, mag);
    root.add(mag);
    addBox(0.006, 0.010, 0.210, -0.021, 0.074, -0.055, brushedSteel);
    addBox(0.006, 0.010, 0.210, 0.021, 0.074, -0.055, brushedSteel);
    addBox(0.036, 0.095, 0.022, 0, 0.055, -0.165, gripRubber);
    muzzleZ = 0.415;
    muzzleY = 0.076;
  } else if (weaponId === 'clarion-famas') {
    // Clarion 5.56 (FAMAS F1) — French bullpup: forward pistol grip, elevated carry handle,
    // rear-mounted straight 25-rd magazine, integrated folding bipod legs, steel flash hider
    addBox(0.030, 0.102, 0.042, 0, -0.022, -0.006, gripRubber, 0.20);
    addBox(0.026, 0.068, 0.010, 0, -0.008, 0.054, darkPolymer, 0.12);
    addBox(0.042, 0.068, 0.460, 0, 0.058, -0.035, darkPolymer);
    addBox(0.038, 0.030, 0.260, 0, 0.064, 0.215, matteSteel);
    addBox(0.024, 0.016, 0.042, 0, 0.108, -0.115, darkPolymer);
    addBox(0.024, 0.016, 0.042, 0, 0.108, 0.165, darkPolymer);
    addBox(0.028, 0.016, 0.310, 0, 0.122, 0.025, darkPolymer);
    addBox(0.004, 0.012, 0.004, 0, 0.135, 0.165, sightGlow);
    const bolt = addBox(0.014, 0.012, 0.034, 0, 0.102, 0.065, brushedSteel);
    bolt.name = 'v_weapon_famas_bolt';
    const mag = addBox(0.022, 0.138, 0.056, 0, -0.028, -0.175, gunmetal, 0.05);
    mag.name = 'v_weapon_famas_mag';
    addCyl(0.006, 0.006, 0.220, -0.024, 0.072, 0.205, matteSteel, 10);
    addCyl(0.006, 0.006, 0.220, 0.024, 0.072, 0.205, matteSteel, 10);
    addCyl(0.009, 0.010, 0.180, 0, 0.066, 0.425, brushedSteel, 14);
    addCyl(0.012, 0.012, 0.048, 0, 0.066, 0.520, matteSteel, 14);
    muzzleZ = 0.548;
    muzzleY = 0.066;
  } else if (weaponId === 'defender-galil') {
    // IDF Defender (Galil ARM) — Stamped steel receiver, wood handguard, 35-rd curved steel mag, skeletal stock
    addBox(0.030, 0.104, 0.042, 0, -0.020, -0.006, gripRubber, 0.24);
    addBox(0.024, 0.010, 0.046, 0, 0.002, 0.030, matteSteel);
    addBox(0.038, 0.052, 0.235, 0, 0.055, 0.068, matteSteel);
    addBox(0.034, 0.028, 0.215, 0, 0.088, 0.066, gunmetal);
    const bolt = addBox(0.012, 0.020, 0.054, -0.020, 0.072, 0.078, brushedSteel);
    bolt.name = 'v_weapon_galil_bolt';
    addBox(0.042, 0.046, 0.185, 0, 0.058, 0.265, woodStockMat);
    addCyl(0.010, 0.010, 0.165, 0, 0.092, 0.255, gunmetal, 12);
    addBox(0.004, 0.014, 0.004, 0, 0.118, 0.375, sightGlow);
    addCyl(0.009, 0.010, 0.210, 0, 0.072, 0.455, brushedSteel, 14);
    addCyl(0.012, 0.012, 0.042, 0, 0.072, 0.568, matteSteel, 14);
    const mag = new THREE.Group();
    mag.name = 'v_weapon_galil_mag';
    mag.position.set(0, -0.026, 0.132);
    addBox(0.023, 0.095, 0.056, 0, 0.020, 0, gunmetal, -0.08, 0, mag);
    addBox(0.023, 0.095, 0.056, 0, -0.062, 0.016, matteSteel, -0.26, 0, mag);
    root.add(mag);
    addCyl(0.008, 0.008, 0.220, 0, 0.078, -0.145, brushedSteel, 10);
    addCyl(0.008, 0.008, 0.225, 0, 0.025, -0.145, brushedSteel, 10);
    addBox(0.032, 0.105, 0.024, 0, 0.048, -0.258, gripRubber);
    muzzleZ = 0.592;
    muzzleY = 0.072;
  } else if (weaponId === 'schmidt-scout') {
    // Schmidt Scout (Steyr Scout) — Sleek lightweight olive synthetic chassis, fluted barrel, forward telescopic optic
    addBox(0.032, 0.102, 0.044, 0, -0.016, -0.004, olivePolymer, 0.26);
    addBox(0.040, 0.056, 0.540, 0, 0.052, 0.045, olivePolymer);
    addBox(0.036, 0.095, 0.195, 0, 0.038, -0.225, olivePolymer);
    addBox(0.038, 0.098, 0.018, 0, 0.038, -0.325, gripRubber);
    const bolt = addBox(0.010, 0.014, 0.048, -0.022, 0.080, 0.025, brushedSteel, 0, -0.35);
    bolt.name = 'v_weapon_scout_bolt';
    addCyl(0.010, 0.012, 0.420, 0, 0.082, 0.470, brushedSteel, 14);
    addBox(0.022, 0.024, 0.018, 0, 0.096, 0.045, matteSteel);
    addBox(0.022, 0.024, 0.018, 0, 0.096, 0.185, matteSteel);
    addCyl(0.015, 0.015, 0.220, 0, 0.120, 0.115, gunmetal, 16);
    addCyl(0.020, 0.016, 0.045, 0, 0.120, 0.235, matteSteel, 16);
    addCyl(0.017, 0.017, 0.006, 0, 0.120, 0.258, opticGlassMat, 16);
    addCyl(0.018, 0.015, 0.038, 0, 0.120, -0.008, matteSteel, 16);
    const mag = addBox(0.024, 0.068, 0.060, 0, 0.008, 0.110, darkPolymer);
    mag.name = 'v_weapon_scout_mag';
    muzzleZ = 0.685;
    muzzleY = 0.082;
  } else if (weaponId === 'p90') {
    // ES C90 (FN P90) — Compact bullpup PDW with top horizontal 50-rd magazine & elevated sight bridge
    addBox(0.032, 0.104, 0.042, 0, -0.015, -0.002, gripRubber, 0.16);
    addBox(0.044, 0.072, 0.365, 0, 0.048, 0.005, darkPolymer);
    addBox(0.040, 0.056, 0.080, 0, 0.052, 0.215, gunmetal);
    const p90MagMat = new THREE.MeshStandardMaterial({
      color: 0x3b444e,
      roughness: 0.26,
      metalness: 0.22,
      transparent: true,
      opacity: 0.82,
      envMapIntensity: 1.4,
    });
    const mag = addBox(0.042, 0.026, 0.235, 0, 0.096, 0.025, p90MagMat);
    mag.name = 'v_weapon_p90_mag';
    addBox(0.030, 0.012, 0.195, 0, 0.096, 0.020, tanAccent);
    addBox(0.024, 0.042, 0.068, 0, 0.124, 0.155, gunmetal);
    addBox(0.004, 0.004, 0.004, 0, 0.132, 0.155, sightGlow);
    addCyl(0.010, 0.010, 0.068, 0, 0.066, 0.280, brushedSteel, 14);
    addCyl(0.013, 0.013, 0.028, 0, 0.066, 0.318, matteSteel, 14);
    muzzleZ = 0.338;
    muzzleY = 0.066;
  } else if (weaponId === 'leone-m3') {
    // Leone 12G Super (Benelli M3) — 12-gauge combat pump shotgun with ribbed pump forend
    addBox(0.032, 0.102, 0.044, 0, -0.018, -0.005, gripRubber, 0.28);
    addBox(0.040, 0.056, 0.220, 0, 0.056, 0.072, matteSteel);
    const bolt = addBox(0.008, 0.018, 0.062, -0.018, 0.064, 0.088, brushedSteel);
    bolt.name = 'v_weapon_m3_bolt';
    addCyl(0.013, 0.014, 0.440, 0, 0.076, 0.395, gunmetal, 16);
    addCyl(0.012, 0.012, 0.410, 0, 0.046, 0.375, matteSteel, 14);
    const pump = new THREE.Group();
    pump.name = 'v_weapon_m3_pump';
    addCyl(0.022, 0.022, 0.175, 0, 0.046, 0.295, gripRubber, 14, pump);
    for (let i = 0; i < 6; i++) {
      addCyl(0.0235, 0.0235, 0.008, 0, 0.046, 0.232 + i * 0.024, darkPolymer, 14, pump);
    }
    root.add(pump);
    addBox(0.006, 0.012, 0.008, 0, 0.094, 0.600, sightGlow);
    addBox(0.036, 0.092, 0.245, 0, 0.036, -0.155, darkPolymer, -0.06);
    muzzleZ = 0.618;
    muzzleY = 0.076;
  } else if (weaponId === 'xm1014') {
    // Leone YG1265 Auto (Benelli M4 / XM1014) — Semi-auto combat shotgun
    addBox(0.032, 0.100, 0.044, 0, -0.018, -0.005, gripRubber, 0.22);
    addBox(0.040, 0.056, 0.225, 0, 0.058, 0.074, gunmetal);
    addBox(0.020, 0.010, 0.175, 0, 0.090, 0.070, matteSteel);
    addCyl(0.010, 0.010, 0.012, 0, 0.102, 0.005, matteSteel, 12);
    const bolt = addBox(0.010, 0.016, 0.054, -0.018, 0.066, 0.088, brushedSteel);
    bolt.name = 'v_weapon_xm1014_bolt';
    addCyl(0.013, 0.014, 0.415, 0, 0.076, 0.382, matteSteel, 16);
    addCyl(0.012, 0.012, 0.390, 0, 0.046, 0.365, gunmetal, 14);
    addBox(0.044, 0.044, 0.185, 0, 0.052, 0.275, darkPolymer);
    addBox(0.005, 0.012, 0.008, 0, 0.094, 0.578, sightGlow);
    addCyl(0.014, 0.014, 0.200, 0, 0.058, -0.145, matteSteel, 12);
    addBox(0.036, 0.105, 0.095, 0, 0.042, -0.225, darkPolymer);
    muzzleZ = 0.592;
    muzzleY = 0.076;
  } else if (weaponId === 'dual-elites') {
    // .40 Dual Elites (Twin Beretta 92G) — Symmetrical left + right stainless/matte pistols
    const buildSingleElite = (offsetX: number, slideName: string) => {
      const p = new THREE.Group();
      p.position.set(offsetX, 0, 0);
      addBox(0.025, 0.092, 0.038, 0, -0.018, -0.008, gripRubber, 0.22, 0, p);
      addBox(0.024, 0.020, 0.162, 0, 0.034, 0.056, matteSteel, 0, 0, p);
      const slide = new THREE.Group();
      slide.name = slideName;
      addBox(0.024, 0.022, 0.164, 0, 0.056, 0.054, brushedSteel, 0, 0, slide);
      addCyl(0.007, 0.007, 0.042, 0, 0.060, 0.150, gunmetal, 12, slide);
      addBox(0.003, 0.003, 0.003, 0, 0.071, 0.132, sightGlow, 0, 0, slide);
      p.add(slide);
      addBox(0.022, 0.010, 0.038, 0, -0.064, -0.018, darkPolymer, 0.22, 0, p);
      root.add(p);
    };
    buildSingleElite(-0.115, 'v_weapon_elite_slide_r');
    buildSingleElite(0.115, 'v_weapon_elite_slide_l');
    muzzleZ = 0.172;
    muzzleY = 0.060;
  } else if (weaponId === 'tactical-shield') {
    // Vanguard Ballistic Riot Shield — Armored plate, polycarbonate viewport glass, Vanguard cobalt stripe
    const vanguardStripe = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.45,
      metalness: 0.3,
    });
    addBox(0.56, 0.52, 0.035, 0, -0.14, 0.26, gunmetal);
    addBox(0.56, 0.16, 0.035, 0, 0.36, 0.26, gunmetal);
    addBox(0.11, 0.24, 0.035, -0.225, 0.16, 0.26, matteSteel);
    addBox(0.11, 0.24, 0.035, 0.225, 0.16, 0.26, matteSteel);
    addBox(0.34, 0.22, 0.018, 0, 0.16, 0.26, shieldGlassMat);
    addBox(0.46, 0.055, 0.008, 0, 0.02, 0.28, vanguardStripe);
    addCyl(0.014, 0.014, 0.18, 0, 0.0, 0.16, gripRubber, 10);
    muzzleZ = 0.30;
    muzzleY = 0.08;
  } else if (weaponId === 'smoke-grenade') {
    // CS2 M18 Tactical Smoke Grenade — Olive-slate cylindrical canister, red hazard band, steel fuze head & spoon lever
    const smokeCanMat = new THREE.MeshStandardMaterial({ color: 0x4b584d, roughness: 0.48, metalness: 0.38 });
    const hazardBandMat = new THREE.MeshStandardMaterial({ color: 0xb8382c, roughness: 0.45, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.125, 18), smokeCanMat);
    body.position.set(0, 0.018, 0.006);
    root.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0298, 0.0298, 0.022, 18), hazardBandMat);
    band.position.set(0, 0.044, 0.006);
    root.add(band);
    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.029, 0.012, 18), brushedSteel);
    topCap.position.set(0, 0.084, 0.006);
    root.add(topCap);
    const fuze = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.024, 14), matteSteel);
    fuze.position.set(0, 0.100, 0.006);
    root.add(fuze);
    addBox(0.010, 0.088, 0.006, 0, 0.048, -0.026, brushedSteel, -0.08); // Spoon lever
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0022, 8, 16), brushedSteel);
    ring.position.set(0.014, 0.102, 0.012);
    ring.rotation.y = Math.PI * 0.35;
    root.add(ring);
    muzzleZ = 0.14;
    muzzleY = 0.04;
  } else if (weaponId === 'flashbang') {
    // CS2 M84 Stun Grenade (Flashbang) — Perforated steel hexagonal body with cobalt-blue tactical identification band
    const flashBandMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.4, metalness: 0.35 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.115, 14), brushedSteel);
    core.position.set(0, 0.018, 0.006);
    root.add(core);
    const outerShell = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.088, 8), gunmetal);
    outerShell.position.set(0, 0.018, 0.006);
    root.add(outerShell);
    const blueBand = new THREE.Mesh(new THREE.CylinderGeometry(0.0278, 0.0278, 0.014, 8), flashBandMat);
    blueBand.position.set(0, 0.036, 0.006);
    root.add(blueBand);
    const fuze = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.024, 12), matteSteel);
    fuze.position.set(0, 0.086, 0.006);
    root.add(fuze);
    addBox(0.010, 0.082, 0.005, 0, 0.042, -0.025, brushedSteel, -0.08);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.002, 8, 16), brushedSteel);
    ring.position.set(0.013, 0.090, 0.010);
    root.add(ring);
    muzzleZ = 0.14;
    muzzleY = 0.04;
  } else if (weaponId === 'he-grenade') {
    // CS2 M67 High-Explosive Frag Grenade — Olive-drab spherical fragmentation body, yellow marking ring & M213 fuze spoon
    const fragBodyMat = new THREE.MeshStandardMaterial({ color: 0x3b4932, roughness: 0.55, metalness: 0.35 });
    const yellowRingMat = new THREE.MeshStandardMaterial({ color: 0xd99b26, roughness: 0.4, metalness: 0.25 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.034, 18, 14), fragBodyMat);
    sphere.scale.set(1.0, 1.12, 1.0);
    sphere.position.set(0, 0.016, 0.006);
    root.add(sphere);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.014, 14), yellowRingMat);
    collar.position.set(0, 0.056, 0.006);
    root.add(collar);
    const fuze = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.022, 14), brushedSteel);
    fuze.position.set(0, 0.072, 0.006);
    root.add(fuze);
    addBox(0.010, 0.070, 0.005, 0, 0.038, -0.027, matteSteel, -0.14);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.002, 8, 16), brushedSteel);
    ring.position.set(0.013, 0.075, 0.010);
    root.add(ring);
    muzzleZ = 0.14;
    muzzleY = 0.04;
  } else if (weaponId === 'molotov') {
    // CS2 Incendiary / Molotov Cocktail — Dark amber glass bottle, fuel liquid level, taped grip & cloth rag wick
    const bottleGlassMat = new THREE.MeshStandardMaterial({ color: 0x5c2e14, roughness: 0.18, metalness: 0.15 });
    const clothWickMat = new THREE.MeshStandardMaterial({ color: 0xd6c7b2, roughness: 0.85, metalness: 0.05 });
    const emberMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff3b00, emissiveIntensity: 2.2, roughness: 0.4 });
    const bottleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.030, 0.115, 16), bottleGlassMat);
    bottleBody.position.set(0, 0.005, 0.006);
    root.add(bottleBody);
    const gripTape = new THREE.Mesh(new THREE.CylinderGeometry(0.0308, 0.0308, 0.042, 16), gripRubber);
    gripTape.position.set(0, 0.005, 0.006);
    root.add(gripTape);
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.028, 0.036, 16), bottleGlassMat);
    shoulder.position.set(0, 0.080, 0.006);
    root.add(shoulder);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.045, 14), bottleGlassMat);
    neck.position.set(0, 0.118, 0.006);
    root.add(neck);
    addBox(0.018, 0.042, 0.014, 0.004, 0.148, 0.012, clothWickMat, 0.25, 0.15);
    addBox(0.008, 0.012, 0.008, 0.008, 0.166, 0.018, emberMat);
    muzzleZ = 0.16;
    muzzleY = 0.05;
  } else if (weaponId === 'pulse-core') {
    // CS2 C4 IED Explosive Pack — Dual olive C4 plastique bricks, electrical tape straps, digital keypad & glowing red LED
    const c4BrickMat = new THREE.MeshStandardMaterial({ color: 0x7c745c, roughness: 0.65, metalness: 0.12 });
    const ledRedMat = new THREE.MeshStandardMaterial({ color: 0xff1e27, emissive: 0xff1e27, emissiveIntensity: 2.5 });
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a1c12, emissive: 0x166534, emissiveIntensity: 0.8, roughness: 0.2 });
    addBox(0.048, 0.155, 0.038, -0.026, 0.022, 0.014, c4BrickMat);
    addBox(0.048, 0.155, 0.038, 0.026, 0.022, 0.014, c4BrickMat);
    addBox(0.104, 0.018, 0.042, 0, 0.068, 0.014, gripRubber); // Upper tape strap
    addBox(0.104, 0.018, 0.042, 0, -0.024, 0.014, gripRubber); // Lower tape strap
    addBox(0.068, 0.092, 0.018, 0, 0.024, -0.012, darkPolymer); // Keypad housing facing operator
    addBox(0.048, 0.024, 0.004, 0, 0.052, -0.021, screenMat); // Digital LCD readout
    addBox(0.008, 0.008, 0.006, 0.022, 0.064, -0.022, ledRedMat); // Armed status LED
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        addBox(0.010, 0.010, 0.004, (c - 1) * 0.015, 0.022 - r * 0.015, -0.021, brushedSteel);
      }
    }
    muzzleZ = 0.18;
    muzzleY = 0.05;
  } else {
    // Tactical B&T MP9 SMG (default fallback) — Compact olive-charcoal polymer chassis, pistol grip at (0,0,0),
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
