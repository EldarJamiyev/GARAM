import * as THREE from 'three';

export const CS2_ARMS_MODEL_PATH = '/models/cs2_fps_arms.glb';
export const VIEWMODEL_NEAR_PLANE = 0.05;

/**
 * Authentic Counter-Strike 2 default viewmodel FOV:
 * 60 deg on desktop (aspect >= 1.2), gently clamped up to 66 deg max on narrow/portrait screens.
 */
export function computeViewmodelFov(aspect: number): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  if (safeAspect < 1.2) {
    return THREE.MathUtils.clamp(60 + (1.2 - safeAspect) * 8.1, 60, 66);
  }
  return 60;
}

/**
 * Subtle inward horizontal slide on narrow/portrait viewports (aspect < 1.2) so the weapon
 * receiver and support hand stay cleanly framed without zooming out or exposing bicep cutoffs.
 */
export function computeNarrowAspectOffsetX(aspect: number): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  if (safeAspect < 1.2) {
    return -THREE.MathUtils.clamp((1.2 - safeAspect) * 0.09, 0, 0.065);
  }
  return 0;
}

export type LeftArmPoseMode = 'rifle' | 'pistol' | 'karambit';

export interface WeaponClipSet {
  idle: string;
  walk: string;
  draw?: string;
  fire: string;
  reload: string;
  reloadFull: string;
  inspect?: string;
  altFire?: string;
}

export interface WeaponSocketConfig {
  socketBone: 'weapon_hand_r_5' | 'DEF-handR_357' | 'Rif' | 'Hand_R';
  modelPath: string;
  targetLength: number;
  anchorBoneName?: string;
  rotationEuler: [number, number, number];
  localPos: [number, number, number];
  localRotEuler: [number, number, number];
  localScale: number;
  armsScale: number;
  armsOffset: [number, number, number];
  muzzleLocalPos: [number, number, number];
  requiresPBodyRest: boolean;
  /** Controls CS2 Rigify left-hand posture: baked rifle grip, two-handed pistol cup, or low-left CQC guard */
  leftArmPoseMode: LeftArmPoseMode;
  /** Optional left-hand wrist target anchor in weapon holder local space for firearm grip locking */
  leftHandAnchorLocal?: [number, number, number];
  /** Optional relative Euler rotation for Hand_L in weapon holder space */
  leftHandRelRotEuler?: [number, number, number];
  /** Optional left-hand finger curl factor for wrapping handguard */
  leftFingerCurl?: number;
  /** Optional ring-spin pivot centroid in normalized weapon local space (Karambit) */
  ringPivotLocal?: [number, number, number];
  clips: WeaponClipSet;
}

export const WEAPON_SOCKET_CONFIGS: Record<string, WeaponSocketConfig> = {
  'garam-47': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/garam47.glb',
    targetLength: 0.72,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0, 0, 0],
    localRotEuler: [-Math.PI / 2, 0, Math.PI],
    localScale: 1.85,
    armsScale: 1.0,
    armsOffset: [0.082, -0.904, 0.026],
    muzzleLocalPos: [0.008, 0.058, -0.565],
    requiresPBodyRest: false,
    leftArmPoseMode: 'rifle',
    leftHandAnchorLocal: [0.0, -0.018, -0.22],
    leftHandRelRotEuler: [0.6216, 0.8027, -2.1408],
    leftFingerCurl: 0.9,
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Fire',
      reload: 'CS2_Reload',
      reloadFull: 'CS2_Reload',
      inspect: 'CS2_Inspect',
    },
  },
  'vanguard-m4': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/m4a1s.glb',
    targetLength: 0.78,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0, 0, 0],
    localRotEuler: [-Math.PI / 2, 0, Math.PI],
    localScale: 1.85,
    armsScale: 1.0,
    armsOffset: [0.080, -0.924, 0.040],
    muzzleLocalPos: [0.007, 0.081, -0.6525],
    requiresPBodyRest: false,
    leftArmPoseMode: 'rifle',
    leftHandAnchorLocal: [0.002, 0.024, -0.228],
    leftHandRelRotEuler: [0.6216, 0.8027, -2.1408],
    leftFingerCurl: 0.9,
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Fire',
      reload: 'CS2_Reload',
      reloadFull: 'CS2_Reload',
      inspect: 'CS2_Inspect',
    },
  },
  'm4a4': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/m4a4.glb',
    targetLength: 0.76,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0, 0, 0],
    localRotEuler: [-Math.PI / 2, 0, Math.PI],
    localScale: 1.85,
    armsScale: 1.0,
    armsOffset: [0.080, -0.930, 0.044],
    muzzleLocalPos: [0.006, 0.080, -0.62],
    requiresPBodyRest: false,
    leftArmPoseMode: 'rifle',
    leftHandAnchorLocal: [0.002, 0.018, -0.236],
    leftHandRelRotEuler: [0.6216, 0.8027, -2.1408],
    leftFingerCurl: 0.9,
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Fire',
      reload: 'CS2_Reload',
      reloadFull: 'CS2_Reload',
      inspect: 'CS2_Inspect',
    },
  },
  'mp9': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/mp9.glb',
    targetLength: 0.44,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0, 0, 0],
    localRotEuler: [-Math.PI / 2, 0, Math.PI],
    localScale: 1.85,
    armsScale: 1.0,
    armsOffset: [0.076, -0.904, 0.022],
    muzzleLocalPos: [0.004, 0.076, -0.325],
    requiresPBodyRest: false,
    leftArmPoseMode: 'rifle',
    leftHandAnchorLocal: [0.0, -0.008, -0.178],
    leftHandRelRotEuler: [0.55, 0.72, -1.95],
    leftFingerCurl: 0.92,
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Fire',
      reload: 'CS2_Reload',
      reloadFull: 'CS2_Reload',
      inspect: 'CS2_Inspect',
    },
  },
  'sovereign-awp': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/awp.glb',
    targetLength: 0.86,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0, 0, 0],
    localRotEuler: [-Math.PI / 2, 0, Math.PI],
    localScale: 1.80,
    armsScale: 1.0,
    armsOffset: [0.084, -0.926, 0.044],
    muzzleLocalPos: [0.0114, 0.114, -0.8357],
    requiresPBodyRest: false,
    leftArmPoseMode: 'rifle',
    leftHandAnchorLocal: [0.0, 0.018, -0.236],
    leftHandRelRotEuler: [0.6216, 0.8027, -2.1408],
    leftFingerCurl: 0.9,
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Fire',
      reload: 'CS2_Reload',
      reloadFull: 'CS2_Reload',
      inspect: 'CS2_Inspect',
    },
  },
  'desert-eagle': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/deagle.glb',
    targetLength: 0.24,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0, 0, 0],
    localRotEuler: [-Math.PI / 2, 0, Math.PI],
    localScale: 1.85,
    armsScale: 1.0,
    armsOffset: [0.052, -0.922, 0.020],
    muzzleLocalPos: [0.0001, 0.064, -0.2348],
    requiresPBodyRest: false,
    leftArmPoseMode: 'pistol',
    leftHandAnchorLocal: [-0.014, -0.018, 0.002],
    leftHandRelRotEuler: [0.25, 0.12, -0.45],
    leftFingerCurl: 0.95,
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Fire',
      reload: 'CS2_Reload',
      reloadFull: 'CS2_Reload',
      inspect: 'CS2_Inspect',
    },
  },
  'usp-s': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/usps.glb',
    targetLength: 0.34,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0, 0, 0],
    localRotEuler: [-Math.PI / 2, 0, Math.PI],
    localScale: 1.85,
    armsScale: 1.0,
    armsOffset: [0.080, -0.934, 0.032],
    muzzleLocalPos: [0.0, 0.062, -0.32],
    requiresPBodyRest: false,
    leftArmPoseMode: 'pistol',
    leftHandAnchorLocal: [-0.014, -0.018, 0.002],
    leftHandRelRotEuler: [0.25, 0.12, -0.45],
    leftFingerCurl: 0.95,
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Fire',
      reload: 'CS2_Reload',
      reloadFull: 'CS2_Reload',
      inspect: 'CS2_Inspect',
    },
  },
  'glock-18': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/glock18.glb',
    targetLength: 0.21,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0, 0, 0],
    localRotEuler: [-Math.PI / 2, 0, Math.PI],
    localScale: 1.85,
    armsScale: 1.0,
    armsOffset: [0.052, -0.918, 0.020],
    muzzleLocalPos: [0.0, 0.060, -0.195],
    requiresPBodyRest: false,
    leftArmPoseMode: 'pistol',
    leftHandAnchorLocal: [-0.014, -0.018, 0.002],
    leftHandRelRotEuler: [0.25, 0.12, -0.45],
    leftFingerCurl: 0.95,
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Fire',
      reload: 'CS2_Reload',
      reloadFull: 'CS2_Reload',
      inspect: 'CS2_Inspect',
    },
  },
  'garam-karambit': {
    socketBone: 'weapon_hand_r_5',
    modelPath: '/models/karambit.glb',
    targetLength: 0.22,
    rotationEuler: [0, 0, 0],
    localPos: [0.0186, -0.0680, 0.0221],
    localRotEuler: [-2.6927, -0.1020, 2.3615],
    localScale: 1.75,
    armsScale: 1.0,
    armsOffset: [0.044, -0.908, 0.014],
    muzzleLocalPos: [0, -0.050, -0.105],
    requiresPBodyRest: false,
    leftArmPoseMode: 'karambit',
    ringPivotLocal: [0, 0.018, 0.085],
    clips: {
      idle: 'CS2_Idle',
      walk: 'CS2_Walk',
      draw: 'CS2_Draw',
      fire: 'CS2_Idle',
      altFire: 'CS2_Idle',
      reload: 'CS2_Idle',
      reloadFull: 'CS2_Idle',
      inspect: 'CS2_Inspect',
    },
  },
};

export function getWeaponSocketConfig(weaponId: string): WeaponSocketConfig {
  return WEAPON_SOCKET_CONFIGS[weaponId] || WEAPON_SOCKET_CONFIGS['garam-47'];
}

export function resolveWeaponClipName(
  weaponId: string,
  state: 'idle' | 'walk' | 'draw' | 'fire' | 'altFire' | 'reload' | 'reloadFull' | 'inspect'
): string {
  const cfg = getWeaponSocketConfig(weaponId);
  switch (state) {
    case 'idle':
      return cfg.clips.idle;
    case 'walk':
      return cfg.clips.walk;
    case 'draw':
      return cfg.clips.draw || cfg.clips.idle;
    case 'fire':
      return cfg.clips.fire;
    case 'altFire':
      return cfg.clips.altFire || cfg.clips.fire;
    case 'reload':
      return cfg.clips.reload;
    case 'reloadFull':
      return cfg.clips.reloadFull;
    case 'inspect':
      return cfg.clips.inspect || cfg.clips.idle;
  }
}

function stabilizeCS2ClipToShoulderPocket(
  clip: THREE.AnimationClip,
  idleClip: THREE.AnimationClip,
  pocketBlendWeight: number
): THREE.AnimationClip {
  const dur = Math.max(0.1, clip.duration);
  const clipTracksByName = new Map<string, THREE.KeyframeTrack>();
  for (const t of clip.tracks) {
    clipTracksByName.set(t.name, t);
  }

  const stabilizedTracks: THREE.KeyframeTrack[] = [];
  const isAnimatedSubPart = (trackName: string): boolean =>
    /DEF-f_.*R_|v_weapon_|clip|bolt|slide/i.test(trackName);
  const isBlendedSocketTrack = (trackName: string): boolean =>
    /weapon_hand_r_5|DEF-handR_357/i.test(trackName);

  const blendW = THREE.MathUtils.clamp(pocketBlendWeight, 0, 0.35);
  const qIdle = new THREE.Quaternion();
  const qClip = new THREE.Quaternion();
  const qOut = new THREE.Quaternion();

  for (const idleTrack of idleClip.tracks) {
    if (isAnimatedSubPart(idleTrack.name)) {
      continue;
    }

    const srcTrack = clipTracksByName.get(idleTrack.name);
    if (srcTrack && isBlendedSocketTrack(idleTrack.name) && blendW > 0.001) {
      if (idleTrack.name.endsWith('.position') && idleTrack.values.length >= 3 && srcTrack.values.length >= 3) {
        const b0 = idleTrack.values[0];
        const b1 = idleTrack.values[1];
        const b2 = idleTrack.values[2];
        const times = Array.from(srcTrack.times);
        const vals = new Float32Array(srcTrack.values.length);
        for (let i = 0; i < srcTrack.values.length; i += 3) {
          vals[i] = b0 + (srcTrack.values[i] - b0) * blendW;
          vals[i + 1] = b1 + (srcTrack.values[i + 1] - b1) * blendW;
          vals[i + 2] = b2 + (srcTrack.values[i + 2] - b2) * blendW;
        }
        stabilizedTracks.push(new THREE.VectorKeyframeTrack(idleTrack.name, times, vals));
        continue;
      }
      if (idleTrack.name.endsWith('.quaternion') && idleTrack.values.length >= 4 && srcTrack.values.length >= 4) {
        qIdle.set(idleTrack.values[0], idleTrack.values[1], idleTrack.values[2], idleTrack.values[3]).normalize();
        const times = Array.from(srcTrack.times);
        const vals = new Float32Array(srcTrack.values.length);
        for (let i = 0; i < srcTrack.values.length; i += 4) {
          qClip.set(srcTrack.values[i], srcTrack.values[i + 1], srcTrack.values[i + 2], srcTrack.values[i + 3]).normalize();
          qOut.copy(qIdle).slerp(qClip, blendW);
          vals[i] = qOut.x;
          vals[i + 1] = qOut.y;
          vals[i + 2] = qOut.z;
          vals[i + 3] = qOut.w;
        }
        stabilizedTracks.push(new THREE.QuaternionKeyframeTrack(idleTrack.name, times, vals));
        continue;
      }
    }

    if (idleTrack.name.endsWith('.position') && idleTrack.values.length >= 3) {
      const p0 = idleTrack.values[0];
      const p1 = idleTrack.values[1];
      const p2 = idleTrack.values[2];
      stabilizedTracks.push(
        new THREE.VectorKeyframeTrack(idleTrack.name, [0, dur], [p0, p1, p2, p0, p1, p2])
      );
    } else if (idleTrack.name.endsWith('.quaternion') && idleTrack.values.length >= 4) {
      const q = new THREE.Quaternion(
        idleTrack.values[0],
        idleTrack.values[1],
        idleTrack.values[2],
        idleTrack.values[3]
      ).normalize();
      stabilizedTracks.push(
        new THREE.QuaternionKeyframeTrack(
          idleTrack.name,
          [0, dur],
          [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w]
        )
      );
    }
  }

  for (const [name, track] of clipTracksByName.entries()) {
    if (!isAnimatedSubPart(name)) continue;
    stabilizedTracks.push(track.clone());
  }

  return new THREE.AnimationClip(clip.name, dur, stabilizedTracks);
}

/**
 * Slices the CS2 First-Person Arms Sketchfab GLB clips (Equip, Shots, Reload, Inspect)
 * into clean, responsive game-ready clips (CS2_Idle, CS2_Walk, CS2_Draw, CS2_Fire,
 * CS2_Reload, CS2_Inspect) at 30 FPS while anchoring upper arms to the authentic CS2
 * 60-66 deg FOV shoulder pocket and preserving lively receiver/bolt/magazine motion.
 */
export function buildCS2AnimationClips(
  sourceClips: THREE.AnimationClip[]
): THREE.AnimationClip[] {
  const out: THREE.AnimationClip[] = [];
  const shots = sourceClips.find((c) => c.name === 'Shots');
  const equip = sourceClips.find((c) => c.name === 'Equip');
  const reload = sourceClips.find((c) => c.name === 'Reload');
  const inspect = sourceClips.find((c) => c.name === 'Inspect');

  let idleClip: THREE.AnimationClip | null = null;

  if (shots) {
    // Calm breathing idle window (0.80s .. 1.80s = frames 24..54 at 30fps)
    idleClip = THREE.AnimationUtils.subclip(shots, 'CS2_Idle', 24, 54, 30);
    out.push(idleClip);

    // Subtle walk sway loop (0.80s .. 1.80s)
    const walkClip = THREE.AnimationUtils.subclip(shots, 'CS2_Walk', 24, 54, 30);
    out.push(walkClip);

    // Crisp single-shot recoil impulse (0.03s .. 0.43s = frames 1..13 at 30fps)
    const fireClip = THREE.AnimationUtils.subclip(shots, 'CS2_Fire', 1, 13, 30);
    out.push(idleClip ? stabilizeCS2ClipToShoulderPocket(fireClip, idleClip, 0.20) : fireClip);
  }

  if (equip) {
    // Snappy CS2 tactical raise into firing stance (2.53s .. 3.10s = frames 76..93 at 30fps)
    const drawClip = THREE.AnimationUtils.subclip(equip, 'CS2_Draw', 76, 93, 30);
    out.push(idleClip ? stabilizeCS2ClipToShoulderPocket(drawClip, idleClip, 0.16) : drawClip);
  }

  if (reload) {
    // Full CS2 mag-swap & bolt-release reload (0.00s .. 4.40s = frames 0..132 at 30fps)
    const reloadClip = THREE.AnimationUtils.subclip(reload, 'CS2_Reload', 0, 132, 30);
    out.push(idleClip ? stabilizeCS2ClipToShoulderPocket(reloadClip, idleClip, 0.06) : reloadClip);
  }

  if (inspect) {
    // Full CS2 weapon inspection sweep (0.00s .. 7.60s = frames 0..228 at 30fps)
    const inspectClip = THREE.AnimationUtils.subclip(inspect, 'CS2_Inspect', 0, 228, 30);
    out.push(idleClip ? stabilizeCS2ClipToShoulderPocket(inspectClip, idleClip, 0.24) : inspectClip);
  }

  return out;
}

export interface BoneTransformSnapshot {
  node: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export function captureBindPose(root: THREE.Object3D): Map<THREE.Object3D, BoneTransformSnapshot> {
  const map = new Map<THREE.Object3D, BoneTransformSnapshot>();
  const visit = (node: THREE.Object3D) => {
    if (node.userData?.isWeaponAttachment) return;
    map.set(node, {
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
    for (let i = 0; i < node.children.length; i++) {
      visit(node.children[i]);
    }
  };
  visit(root);
  return map;
}

export function restoreBindPose(
  root: THREE.Object3D,
  snapshot: Map<THREE.Object3D, BoneTransformSnapshot>
): void {
  const visit = (node: THREE.Object3D) => {
    if (node.userData?.isWeaponAttachment) return;
    const saved = snapshot.get(node);
    if (saved) {
      node.position.copy(saved.position);
      node.quaternion.copy(saved.quaternion);
      node.scale.copy(saved.scale);
    }
    for (let i = 0; i < node.children.length; i++) {
      visit(node.children[i]);
    }
  };
  visit(root);
}

function mulQuatEuler(base: number[], rx: number, ry: number, rz: number): number[] {
  const qBase = new THREE.Quaternion(base[0], base[1], base[2], base[3]);
  const qDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  qBase.multiply(qDelta);
  return [qBase.x, qBase.y, qBase.z, qBase.w];
}

/**
 * Legacy helper retained for backward compatibility with unit tests and fallback skeletons.
 */
export function buildKarambitAnimationClips(
  existingClips: THREE.AnimationClip[]
): THREE.AnimationClip[] {
  const pistolIdle = existingClips.find((c) => c.name === 'Pistol_Idle');
  if (!pistolIdle) return [];

  const baseQuats = new Map<string, number[]>();
  const basePos = new Map<string, number[]>();

  for (const track of pistolIdle.tracks) {
    const dot = track.name.lastIndexOf('.');
    const boneName = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    if (prop === 'quaternion' && track.values.length >= 4) {
      baseQuats.set(boneName, [
        track.values[0],
        track.values[1],
        track.values[2],
        track.values[3],
      ]);
    } else if (prop === 'position' && track.values.length >= 3) {
      basePos.set(boneName, [track.values[0], track.values[1], track.values[2]]);
    }
  }

  basePos.set('IK_Hand_Cntrl_L', [0.32, -0.22, 0.14]);
  baseQuats.set('IK_Hand_Cntrl_L', [-0.05, 0.12, 0.85, 0.51]);
  basePos.set('IK_Hand_Cntrl_R', [-0.18, 0.22, 0.23]);

  const ikRPos = basePos.get('IK_Hand_Cntrl_R') || [-0.088, 0.036, 0.225];
  const ikRQuat = baseQuats.get('IK_Hand_Cntrl_R') || [-0.0572, 0.0106, 0.5295, 0.8463];
  const handRQuat = baseQuats.get('Hand_R') || [-0.4733, 0.5626, 0.514, -0.4419];
  const ikLPos = basePos.get('IK_Hand_Cntrl_L')!;
  const ikLQuat = baseQuats.get('IK_Hand_Cntrl_L')!;

  const buildStaticFingerAndArmTracks = (duration: number, skipBones: Set<string>): THREE.KeyframeTrack[] => {
    const tracks: THREE.KeyframeTrack[] = [];
    baseQuats.forEach((q, bone) => {
      if (skipBones.has(bone)) return;
      tracks.push(
        new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, duration], [...q, ...q])
      );
    });
    basePos.forEach((p, bone) => {
      if (skipBones.has(bone)) return;
      tracks.push(
        new THREE.VectorKeyframeTrack(`${bone}.position`, [0, duration], [...p, ...p])
      );
    });
    return tracks;
  };

  const idleDur = 1.8;
  const idleSkip = new Set(['IK_Hand_Cntrl_R', 'IK_Hand_Cntrl_L', 'Hand_R']);
  const idleTracks = buildStaticFingerAndArmTracks(idleDur, idleSkip);
  idleTracks.push(
    new THREE.VectorKeyframeTrack('IK_Hand_Cntrl_R.position', [0, 0.9, idleDur], [
      ikRPos[0], ikRPos[1], ikRPos[2],
      ikRPos[0] - 0.003, ikRPos[1] + 0.006, ikRPos[2] + 0.004,
      ikRPos[0], ikRPos[1], ikRPos[2],
    ]),
    new THREE.QuaternionKeyframeTrack('IK_Hand_Cntrl_R.quaternion', [0, 0.9, idleDur], [
      ...ikRQuat, ...mulQuatEuler(ikRQuat, 0.03, -0.02, 0.02), ...ikRQuat,
    ]),
    new THREE.QuaternionKeyframeTrack('Hand_R.quaternion', [0, 0.9, idleDur], [
      ...handRQuat, ...mulQuatEuler(handRQuat, 0.02, 0.02, 0), ...handRQuat,
    ]),
    new THREE.VectorKeyframeTrack('IK_Hand_Cntrl_L.position', [0, 0.9, idleDur], [
      ikLPos[0], ikLPos[1], ikLPos[2],
      ikLPos[0] + 0.003, ikLPos[1] + 0.005, ikLPos[2] + 0.003,
      ikLPos[0], ikLPos[1], ikLPos[2],
    ]),
    new THREE.QuaternionKeyframeTrack('IK_Hand_Cntrl_L.quaternion', [0, 0.9, idleDur], [
      ...ikLQuat, ...mulQuatEuler(ikLQuat, -0.02, 0.02, 0.02), ...ikLQuat,
    ])
  );
  const clipIdle = new THREE.AnimationClip('Karambit_Idle', idleDur, idleTracks);

  const walkDur = 0.72;
  const clipWalk = new THREE.AnimationClip('Karambit_Walk', walkDur, buildStaticFingerAndArmTracks(walkDur, idleSkip));
  const drawDur = 0.48;
  const clipDraw = new THREE.AnimationClip('Karambit_Draw', drawDur, buildStaticFingerAndArmTracks(drawDur, idleSkip));
  const slashDur = 0.34;
  const clipSlash = new THREE.AnimationClip('Karambit_Slash', slashDur, buildStaticFingerAndArmTracks(slashDur, idleSkip));
  const stabDur = 0.46;
  const clipStab = new THREE.AnimationClip('Karambit_Stab', stabDur, buildStaticFingerAndArmTracks(stabDur, idleSkip));
  const inspDur = 1.8;
  const clipInspect = new THREE.AnimationClip('Karambit_Inspect', inspDur, buildStaticFingerAndArmTracks(inspDur, idleSkip));

  return [clipIdle, clipWalk, clipDraw, clipSlash, clipStab, clipInspect];
}

/**
 * Legacy helper retained for backward compatibility with unit tests.
 */
export function patchM4IdleClip(clips: THREE.AnimationClip[]): number {
  const m4Idle = clips.find((c) => c.name === 'M4_Idle');
  const m4Walk = clips.find((c) => c.name === 'M4_Walk');
  if (!m4Idle || !m4Walk) return 0;

  const existingTrackNames = new Set(m4Idle.tracks.map((t) => t.name));
  const dur = Math.max(0.1, m4Idle.duration);
  let patchedCount = 0;

  for (const walkTrack of m4Walk.tracks) {
    if (existingTrackNames.has(walkTrack.name)) continue;
    const isLeftHandOrFinger =
      walkTrack.name.startsWith('Hand_L.') ||
      walkTrack.name.startsWith('IK_Hand_Cntrl_L.') ||
      /^Bone_L/.test(walkTrack.name);
    if (!isLeftHandOrFinger) continue;

    if (walkTrack.name.endsWith('.quaternion') && walkTrack.values.length >= 4) {
      const q0 = [
        walkTrack.values[0],
        walkTrack.values[1],
        walkTrack.values[2],
        walkTrack.values[3],
      ];
      m4Idle.tracks.push(
        new THREE.QuaternionKeyframeTrack(walkTrack.name, [0, dur], [...q0, ...q0])
      );
      patchedCount++;
    } else if (walkTrack.name.endsWith('.position') && walkTrack.values.length >= 3) {
      const p0 = [walkTrack.values[0], walkTrack.values[1], walkTrack.values[2]];
      m4Idle.tracks.push(
        new THREE.VectorKeyframeTrack(walkTrack.name, [0, dur], [...p0, ...p0])
      );
      patchedCount++;
    }
  }

  return patchedCount;
}
