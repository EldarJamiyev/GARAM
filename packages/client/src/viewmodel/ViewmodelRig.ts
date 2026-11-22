import * as THREE from 'three';

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
  socketBone: 'Rif' | 'Hand_R';
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
  /** Optional left-hand wrist target anchor in weapon holder local space for firearm grip locking */
  leftHandAnchorLocal?: [number, number, number];
  /** Optional relative Euler rotation for Hand_L in weapon holder space (matched to AK_Idle palm cradle) */
  leftHandRelRotEuler?: [number, number, number];
  /** Optional left-hand finger curl factor for wrapping handguard */
  leftFingerCurl?: number;
  /** Optional ring-spin pivot centroid in normalized weapon local space (Karambit) */
  ringPivotLocal?: [number, number, number];
  clips: WeaponClipSet;
}

export const WEAPON_SOCKET_CONFIGS: Record<string, WeaponSocketConfig> = {
  'garam-47': {
    socketBone: 'Rif',
    modelPath: '/models/garam47.glb',
    targetLength: 0.69,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [-0.038, 0.395, -0.125],
    localRotEuler: [-1.710, -0.095, 3.060],
    localScale: 0.90,
    armsScale: 0.40,
    armsOffset: [0.065, -0.32, -0.34],
    muzzleLocalPos: [0.008, 0.058, -0.565],
    requiresPBodyRest: false,
    leftHandAnchorLocal: [0.000, -0.018, -0.220],
    leftHandRelRotEuler: [0.6216, 0.8027, -2.1408],
    leftFingerCurl: 0.90,
    clips: {
      idle: 'AK_Idle',
      walk: 'AK_Walk',
      draw: 'AK_Draw',
      fire: 'AK_Shot',
      reload: 'AK_Reload',
      reloadFull: 'AK_Reload_full',
    },
  },
  'vanguard-m4': {
    socketBone: 'Rif',
    modelPath: '/models/m4a1s.glb',
    targetLength: 0.78,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [0.0258, -0.0616, 0.2806],
    localRotEuler: [0.0327, 0.3605, -1.6931],
    localScale: 0.94,
    armsScale: 0.40,
    armsOffset: [0.055, -0.32, -0.34],
    muzzleLocalPos: [0.007, 0.081, -0.6525],
    requiresPBodyRest: true,
    leftHandAnchorLocal: [0.002, 0.028, -0.240],
    leftHandRelRotEuler: [0.6216, 0.8027, -2.1408],
    leftFingerCurl: 0.90,
    clips: {
      idle: 'M4_Idle',
      walk: 'M4_Walk',
      draw: 'M4_Draw',
      fire: 'M4_Shoot',
      reload: 'M4_Reload_Fast',
      reloadFull: 'M4_Reload_Fast',
      inspect: 'M4_rifle_inspect',
    },
  },
  'sovereign-awp': {
    socketBone: 'Rif',
    modelPath: '/models/awp.glb',
    targetLength: 0.80,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [-0.082, 0.038, 0.092],
    localRotEuler: [-0.985, -0.015, 3.045],
    localScale: 0.92,
    armsScale: 0.40,
    armsOffset: [0.045, -0.31, -0.33],
    muzzleLocalPos: [0.0114, 0.114, -0.8357],
    requiresPBodyRest: false,
    leftHandAnchorLocal: [0.000, 0.020, -0.250],
    leftHandRelRotEuler: [0.6216, 0.8027, -2.1408],
    leftFingerCurl: 0.90,
    clips: {
      idle: 'SRifle_Idle',
      walk: 'SRifle_Walk',
      fire: 'SRifle_Shot_nosight',
      reload: 'SRifle_Reload',
      reloadFull: 'SRifle_Reload_Full',
    },
  },
  'desert-eagle': {
    socketBone: 'Rif',
    modelPath: '/models/deagle.glb',
    targetLength: 0.22,
    anchorBoneName: 'weapon_hand_r',
    rotationEuler: [0, Math.PI, 0],
    localPos: [-0.1433, 0.0041, -0.0161],
    localRotEuler: [1.3226, -1.4991, 2.6492],
    localScale: 0.95,
    armsScale: 0.40,
    armsOffset: [0.025, -0.31, -0.32],
    muzzleLocalPos: [0.0001, 0.064, -0.2348],
    requiresPBodyRest: false,
    leftHandAnchorLocal: [-0.014, -0.018, 0.002],
    leftHandRelRotEuler: [0.25, 0.12, -0.45],
    leftFingerCurl: 0.95,
    clips: {
      idle: 'Pistol_Idle',
      walk: 'Pistol_Walk',
      fire: 'Pistol_Fire',
      reload: 'Pistol_Reload_easy',
      reloadFull: 'Pistol_Reload_full',
    },
  },
  'garam-karambit': {
    socketBone: 'Hand_R',
    modelPath: '/models/karambit.glb',
    targetLength: 0.22,
    rotationEuler: [0, 0, 0],
    localPos: [0.015, 0.045, -0.018],
    localRotEuler: [-3.05, -3.12, -2.58],
    localScale: 1.02,
    armsScale: 0.40,
    armsOffset: [0.025, -0.26, -0.34],
    muzzleLocalPos: [0, -0.0427, -0.115],
    requiresPBodyRest: true,
    ringPivotLocal: [0, 0.02, 0.085],
    clips: {
      idle: 'Karambit_Idle',
      walk: 'Karambit_Walk',
      draw: 'Karambit_Draw',
      fire: 'Karambit_Slash',
      altFire: 'Karambit_Stab',
      reload: 'Karambit_Idle',
      reloadFull: 'Karambit_Idle',
      inspect: 'Karambit_Inspect',
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

export interface BoneTransformSnapshot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export function captureBindPose(root: THREE.Object3D): Map<string, BoneTransformSnapshot> {
  const map = new Map<string, BoneTransformSnapshot>();
  root.traverse((node) => {
    if (node.name) {
      map.set(node.name, {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
      });
    }
  });
  return map;
}

export function restoreBindPose(
  root: THREE.Object3D,
  snapshot: Map<string, BoneTransformSnapshot>
): void {
  root.traverse((node) => {
    const saved = snapshot.get(node.name);
    if (saved) {
      node.position.copy(saved.position);
      node.quaternion.copy(saved.quaternion);
      node.scale.copy(saved.scale);
    }
  });
}

function mulQuatEuler(base: number[], rx: number, ry: number, rz: number): number[] {
  const qBase = new THREE.Quaternion(base[0], base[1], base[2], base[3]);
  const qDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  qBase.multiply(qDelta);
  return [qBase.x, qBase.y, qBase.z, qBase.w];
}

/**
 * Synthesizes 6 skeletal AnimationClips for the Garam Crimson Karambit on the
 * unified fps_arms_tactical.glb skeleton (combining curled right-hand reverse-grip
 * finger wrap from Pistol_Idle with a left-hand tactical guard pose).
 */
export function buildKarambitAnimationClips(
  existingClips: THREE.AnimationClip[]
): THREE.AnimationClip[] {
  const pistolIdle = existingClips.find((c) => c.name === 'Pistol_Idle');
  const akIdle = existingClips.find((c) => c.name === 'AK_Idle');
  if (!pistolIdle) return [];

  // Extract first-keyframe pose from Pistol_Idle (curled right-hand grip + fingers)
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

  // Position left hand in low-left tactical CQC guard so it stays clear of HUD and center screen (ndcY <= -0.85)
  basePos.set('IK_Hand_Cntrl_L', [0.260, 0.080, 0.260]);
  baseQuats.set('IK_Hand_Cntrl_L', [-0.05, 0.12, 0.85, 0.51]);
  // Position right hand on the right side for crisp reverse-grip Karambit framing
  basePos.set('IK_Hand_Cntrl_R', [-0.180, 0.220, 0.230]);

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

  // 1. Karambit_Idle (1.8s gentle breathing sway)
  const idleDur = 1.8;
  const idleSkip = new Set(['IK_Hand_Cntrl_R', 'IK_Hand_Cntrl_L', 'Hand_R']);
  const idleTracks = buildStaticFingerAndArmTracks(idleDur, idleSkip);
  idleTracks.push(
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_R.position',
      [0, 0.9, idleDur],
      [
        ikRPos[0], ikRPos[1], ikRPos[2],
        ikRPos[0] - 0.003, ikRPos[1] + 0.006, ikRPos[2] + 0.004,
        ikRPos[0], ikRPos[1], ikRPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'IK_Hand_Cntrl_R.quaternion',
      [0, 0.9, idleDur],
      [
        ...ikRQuat,
        ...mulQuatEuler(ikRQuat, 0.03, -0.02, 0.02),
        ...ikRQuat,
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'Hand_R.quaternion',
      [0, 0.9, idleDur],
      [...handRQuat, ...mulQuatEuler(handRQuat, 0.02, 0.02, 0), ...handRQuat]
    ),
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_L.position',
      [0, 0.9, idleDur],
      [
        ikLPos[0], ikLPos[1], ikLPos[2],
        ikLPos[0] + 0.003, ikLPos[1] + 0.005, ikLPos[2] + 0.003,
        ikLPos[0], ikLPos[1], ikLPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'IK_Hand_Cntrl_L.quaternion',
      [0, 0.9, idleDur],
      [...ikLQuat, ...mulQuatEuler(ikLQuat, -0.02, 0.02, 0.02), ...ikLQuat]
    )
  );
  const clipIdle = new THREE.AnimationClip('Karambit_Idle', idleDur, idleTracks);

  // 2. Karambit_Walk (0.72s rhythmic CQC stride)
  const walkDur = 0.72;
  const walkTracks = buildStaticFingerAndArmTracks(walkDur, idleSkip);
  walkTracks.push(
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_R.position',
      [0, 0.18, 0.36, 0.54, walkDur],
      [
        ikRPos[0], ikRPos[1], ikRPos[2],
        ikRPos[0] - 0.01, ikRPos[1] + 0.012, ikRPos[2] + 0.008,
        ikRPos[0], ikRPos[1] - 0.006, ikRPos[2],
        ikRPos[0] + 0.01, ikRPos[1] + 0.012, ikRPos[2] - 0.008,
        ikRPos[0], ikRPos[1], ikRPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'IK_Hand_Cntrl_R.quaternion',
      [0, 0.36, walkDur],
      [...ikRQuat, ...mulQuatEuler(ikRQuat, 0.06, -0.05, 0.04), ...ikRQuat]
    ),
    new THREE.QuaternionKeyframeTrack(
      'Hand_R.quaternion',
      [0, 0.36, walkDur],
      [...handRQuat, ...mulQuatEuler(handRQuat, 0.04, 0.03, 0), ...handRQuat]
    ),
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_L.position',
      [0, 0.18, 0.36, 0.54, walkDur],
      [
        ikLPos[0], ikLPos[1], ikLPos[2],
        ikLPos[0] + 0.008, ikLPos[1] - 0.008, ikLPos[2] - 0.006,
        ikLPos[0], ikLPos[1] + 0.006, ikLPos[2],
        ikLPos[0] - 0.008, ikLPos[1] - 0.008, ikLPos[2] + 0.006,
        ikLPos[0], ikLPos[1], ikLPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'IK_Hand_Cntrl_L.quaternion',
      [0, 0.36, walkDur],
      [...ikLQuat, ...mulQuatEuler(ikLQuat, -0.05, 0.04, 0.03), ...ikLQuat]
    )
  );
  const clipWalk = new THREE.AnimationClip('Karambit_Walk', walkDur, walkTracks);

  // 3. Karambit_Draw (0.48s upward snap & wrist flick)
  const drawDur = 0.48;
  const drawTracks = buildStaticFingerAndArmTracks(drawDur, idleSkip);
  drawTracks.push(
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_R.position',
      [0, 0.24, drawDur],
      [
        ikRPos[0] - 0.03, ikRPos[1] - 0.14, ikRPos[2] - 0.08,
        ikRPos[0] + 0.015, ikRPos[1] + 0.03, ikRPos[2] + 0.03,
        ikRPos[0], ikRPos[1], ikRPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'IK_Hand_Cntrl_R.quaternion',
      [0, 0.24, drawDur],
      [
        ...mulQuatEuler(ikRQuat, -0.55, 0.35, -0.35),
        ...mulQuatEuler(ikRQuat, 0.18, -0.14, 0.12),
        ...ikRQuat,
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'Hand_R.quaternion',
      [0, 0.24, drawDur],
      [
        ...mulQuatEuler(handRQuat, -0.45, 0.25, 0),
        ...mulQuatEuler(handRQuat, 0.15, -0.1, 0),
        ...handRQuat,
      ]
    ),
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_L.position',
      [0, 0.26, drawDur],
      [
        ikLPos[0] + 0.03, ikLPos[1] - 0.11, ikLPos[2] - 0.06,
        ikLPos[0], ikLPos[1] + 0.015, ikLPos[2] + 0.01,
        ikLPos[0], ikLPos[1], ikLPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack('IK_Hand_Cntrl_L.quaternion', [0, drawDur], [...ikLQuat, ...ikLQuat])
  );
  const clipDraw = new THREE.AnimationClip('Karambit_Draw', drawDur, drawTracks);

  // 4. Karambit_Slash (0.34s fast horizontal reverse-grip claw sweep across centerline)
  const slashDur = 0.34;
  const slashTracks = buildStaticFingerAndArmTracks(slashDur, idleSkip);
  slashTracks.push(
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_R.position',
      [0, 0.08, 0.19, slashDur],
      [
        ikRPos[0], ikRPos[1], ikRPos[2],
        ikRPos[0] - 0.045, ikRPos[1] + 0.035, ikRPos[2] - 0.02,
        ikRPos[0] + 0.095, ikRPos[1] - 0.015, ikRPos[2] + 0.085,
        ikRPos[0], ikRPos[1], ikRPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'IK_Hand_Cntrl_R.quaternion',
      [0, 0.08, 0.19, slashDur],
      [
        ...ikRQuat,
        ...mulQuatEuler(ikRQuat, 0.25, 0.35, -0.25),
        ...mulQuatEuler(ikRQuat, -0.38, -0.68, 0.45),
        ...ikRQuat,
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'Hand_R.quaternion',
      [0, 0.08, 0.19, slashDur],
      [
        ...handRQuat,
        ...mulQuatEuler(handRQuat, 0.2, 0.25, 0),
        ...mulQuatEuler(handRQuat, -0.45, -0.35, 0.3),
        ...handRQuat,
      ]
    ),
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_L.position',
      [0, 0.14, slashDur],
      [
        ikLPos[0], ikLPos[1], ikLPos[2],
        ikLPos[0] + 0.025, ikLPos[1] - 0.02, ikLPos[2] - 0.03,
        ikLPos[0], ikLPos[1], ikLPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack('IK_Hand_Cntrl_L.quaternion', [0, slashDur], [...ikLQuat, ...ikLQuat])
  );
  const clipSlash = new THREE.AnimationClip('Karambit_Slash', slashDur, slashTracks);

  // 5. Karambit_Stab (0.46s heavy windup + forward hawkbill hook lunge)
  const stabDur = 0.46;
  const stabTracks = buildStaticFingerAndArmTracks(stabDur, idleSkip);
  stabTracks.push(
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_R.position',
      [0, 0.11, 0.23, 0.33, stabDur],
      [
        ikRPos[0], ikRPos[1], ikRPos[2],
        ikRPos[0] - 0.03, ikRPos[1] + 0.045, ikRPos[2] - 0.055,
        ikRPos[0] + 0.045, ikRPos[1] + 0.01, ikRPos[2] + 0.14,
        ikRPos[0] + 0.03, ikRPos[1] - 0.02, ikRPos[2] + 0.09,
        ikRPos[0], ikRPos[1], ikRPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'IK_Hand_Cntrl_R.quaternion',
      [0, 0.11, 0.23, stabDur],
      [
        ...ikRQuat,
        ...mulQuatEuler(ikRQuat, 0.38, 0.22, -0.2),
        ...mulQuatEuler(ikRQuat, -0.62, -0.35, 0.32),
        ...ikRQuat,
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'Hand_R.quaternion',
      [0, 0.11, 0.23, stabDur],
      [
        ...handRQuat,
        ...mulQuatEuler(handRQuat, 0.25, 0.15, 0),
        ...mulQuatEuler(handRQuat, -0.55, -0.25, 0.25),
        ...handRQuat,
      ]
    ),
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_L.position',
      [0, 0.2, stabDur],
      [
        ikLPos[0], ikLPos[1], ikLPos[2],
        ikLPos[0] + 0.03, ikLPos[1] - 0.025, ikLPos[2] - 0.04,
        ikLPos[0], ikLPos[1], ikLPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack('IK_Hand_Cntrl_L.quaternion', [0, stabDur], [...ikLQuat, ...ikLQuat])
  );
  const clipStab = new THREE.AnimationClip('Karambit_Stab', stabDur, stabTracks);

  // 6. Karambit_Inspect (1.8s wrist showcase + index-ring spin sync)
  const inspDur = 1.8;
  const inspTracks = buildStaticFingerAndArmTracks(inspDur, idleSkip);
  inspTracks.push(
    new THREE.VectorKeyframeTrack(
      'IK_Hand_Cntrl_R.position',
      [0, 0.45, 0.9, 1.35, inspDur],
      [
        ikRPos[0], ikRPos[1], ikRPos[2],
        ikRPos[0] + 0.035, ikRPos[1] + 0.045, ikRPos[2] + 0.03,
        ikRPos[0] + 0.02, ikRPos[1] + 0.055, ikRPos[2] + 0.04,
        ikRPos[0] + 0.035, ikRPos[1] + 0.035, ikRPos[2] + 0.02,
        ikRPos[0], ikRPos[1], ikRPos[2],
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'IK_Hand_Cntrl_R.quaternion',
      [0, 0.45, 0.9, 1.35, inspDur],
      [
        ...ikRQuat,
        ...mulQuatEuler(ikRQuat, 0.28, -0.35, 0.22),
        ...mulQuatEuler(ikRQuat, 0.18, 0.28, -0.18),
        ...mulQuatEuler(ikRQuat, 0.25, -0.2, 0.15),
        ...ikRQuat,
      ]
    ),
    new THREE.QuaternionKeyframeTrack(
      'Hand_R.quaternion',
      [0, 0.6, 1.2, inspDur],
      [
        ...handRQuat,
        ...mulQuatEuler(handRQuat, 0.25, -0.3, 0.2),
        ...mulQuatEuler(handRQuat, -0.15, 0.25, -0.15),
        ...handRQuat,
      ]
    ),
    new THREE.VectorKeyframeTrack('IK_Hand_Cntrl_L.position', [0, inspDur], [...ikLPos, ...ikLPos]),
    new THREE.QuaternionKeyframeTrack('IK_Hand_Cntrl_L.quaternion', [0, inspDur], [...ikLQuat, ...ikLQuat])
  );
  const clipInspect = new THREE.AnimationClip('Karambit_Inspect', inspDur, inspTracks);

  return [clipIdle, clipWalk, clipDraw, clipSlash, clipStab, clipInspect];
}

/**
 * Patches `M4_Idle` on load by injecting missing `Hand_L` quaternion and left-finger curl
 * (`Bone_L*`) tracks sampled from `M4_Walk` frame 0 so the left hand cups the M4 handguard
 * instead of freezing in flat bind pose.
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

