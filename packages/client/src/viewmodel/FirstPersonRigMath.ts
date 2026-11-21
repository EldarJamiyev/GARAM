export type WeaponViewId =
  | 'garam-47'
  | 'vanguard-m4'
  | 'sovereign-awp'
  | 'desert-eagle'
  | 'garam-karambit';

export type RigActionState =
  | 'idle'
  | 'walk'
  | 'draw'
  | 'fire'
  | 'reload_tactical'
  | 'reload_empty'
  | 'inspect'
  | 'slash_left'
  | 'slash_right'
  | 'stab';

export interface WeaponMountConfig {
  weaponId: WeaponViewId;
  modelPath: string;
  targetLength: number;
  socketBone: 'PBody' | 'Rif' | 'Hand_R';
  /** Local position inside socketBone (in centimeters/skeleton units where Armature scale=100, or meters if root-compensated) */
  localPos: [number, number, number];
  /** Local Euler rotation [x, y, z] in radians inside socketBone */
  localRot: [number, number, number];
  /** Local muzzle tip offset from the mounted weapon origin (in weapon GLB unscaled meters-ish along +Z barrel) */
  muzzleLocal: [number, number, number];
  /** Viewmodel root offset relative to camera to frame this weapon's authentic CS2 posture */
  rigOffset: [number, number, number];
  /** Viewmodel root Euler adjustment for optimal CS2 sightline & shoulder alignment */
  rigRot: [number, number, number];
}

/**
 * Calibrated weapon sockets onto the unified CC-BY-4.0 fps_arms_tactical.glb skeleton.
 * Note: fps_arms_tactical.glb has Armature scale=100, so child attachments inside skeleton bones
 * operate in bone-local centimeter space (0.01 scale inverse to recover meters).
 */
export const WEAPON_MOUNT_CONFIGS: Record<WeaponViewId, WeaponMountConfig> = {
  'garam-47': {
    weaponId: 'garam-47',
    modelPath: '/models/garam47.glb',
    targetLength: 0.86,
    socketBone: 'PBody',
    // PBody in AK_Idle: +Y points forward down barrel, -Z points up, +X points right
    localPos: [0.0, -0.21, -0.02],
    localRot: [-Math.PI / 2, 0, Math.PI],
    muzzleLocal: [0.0, 0.02, 0.56],
    rigOffset: [0.025, -0.22, -0.28],
    rigRot: [0.0, Math.PI, 0.0],
  },
  'vanguard-m4': {
    weaponId: 'vanguard-m4',
    modelPath: '/models/m4a1s.glb',
    targetLength: 0.94,
    socketBone: 'Rif',
    // M4_Idle Rif bone has +X up, -Z forward; align M4 (+Z barrel, +Y top) cleanly to palm & forend
    localPos: [0.03, 0.0, -0.14],
    localRot: [0.0, Math.PI, -Math.PI / 2],
    muzzleLocal: [0.0, 0.03, 0.68],
    rigOffset: [0.04, -0.22, -0.26],
    rigRot: [0.0, Math.PI, 0.0],
  },
  'sovereign-awp': {
    weaponId: 'sovereign-awp',
    modelPath: '/models/awp.glb',
    targetLength: 1.08,
    socketBone: 'Hand_R',
    // Hand_R across all ccransh clips: +Y forward down barrel, -Z up, +X across palm
    localPos: [0.015, 0.22, 0.055],
    localRot: [-Math.PI / 2, 0, Math.PI],
    muzzleLocal: [0.0, 0.08, 0.78],
    rigOffset: [0.02, -0.27, -0.34],
    rigRot: [0.02, Math.PI - 0.06, 0.0],
  },
  'desert-eagle': {
    weaponId: 'desert-eagle',
    modelPath: '/models/deagle.glb',
    targetLength: 0.29,
    socketBone: 'Hand_R',
    // Gripped snugly inside right palm (Hand_R) while cupped by Hand_L in Pistol_Idle/Fire/Reload
    localPos: [-0.006, 0.045, 0.042],
    localRot: [-Math.PI / 2 + 0.06, 0.02, Math.PI],
    muzzleLocal: [0.0, 0.055, 0.20],
    rigOffset: [0.045, -0.23, -0.11],
    rigRot: [0.0, Math.PI, 0.0],
  },
  'garam-karambit': {
    weaponId: 'garam-karambit',
    modelPath: '/models/karambit.glb',
    targetLength: 0.24,
    socketBone: 'Hand_R',
    // Reverse karambit grip: retention ring anchored near index/palm heel, hawkbill blade sweeping forward
    localPos: [-0.008, 0.058, 0.028],
    localRot: [Math.PI * 0.56, Math.PI * 0.44, -Math.PI * 0.14],
    muzzleLocal: [0.0, 0.0, 0.0],
    rigOffset: [0.05, -0.24, -0.14],
    rigRot: [0.0, Math.PI, 0.0],
  },
};

export interface ClipSelection {
  clipName: string;
  loop: boolean;
  timeScale: number;
  startTime: number;
}

/**
 * Deterministic clip selector mapping (weaponId, actionState) to the exact
 * skeletal AnimationClip inside fps_arms_tactical.glb.
 */
export function resolveFirstPersonClip(
  weaponId: WeaponViewId,
  action: RigActionState
): ClipSelection {
  switch (weaponId) {
    case 'garam-47': {
      if (action === 'draw') return { clipName: 'AK_Draw', loop: false, timeScale: 1.35, startTime: 0 };
      if (action === 'fire') return { clipName: 'AK_Shot', loop: false, timeScale: 1.45, startTime: 0 };
      if (action === 'reload_tactical') return { clipName: 'AK_Reload', loop: false, timeScale: 1.25, startTime: 0 };
      if (action === 'reload_empty') return { clipName: 'AK_Reload_full', loop: false, timeScale: 1.35, startTime: 0 };
      if (action === 'walk') return { clipName: 'AK_Walk', loop: true, timeScale: 1.0, startTime: 0 };
      return { clipName: 'AK_Idle', loop: true, timeScale: 1.0, startTime: 0 };
    }
    case 'vanguard-m4': {
      if (action === 'draw') return { clipName: 'M4_Draw', loop: false, timeScale: 1.25, startTime: 0 };
      if (action === 'fire') return { clipName: 'M4_Shoot', loop: false, timeScale: 1.65, startTime: 0 };
      if (action === 'reload_tactical' || action === 'reload_empty') {
        return { clipName: 'M4_Reload_Fast', loop: false, timeScale: 1.0, startTime: 0 };
      }
      if (action === 'inspect') return { clipName: 'M4_rifle_inspect', loop: false, timeScale: 1.0, startTime: 0 };
      if (action === 'walk') return { clipName: 'M4_Walk', loop: true, timeScale: 1.0, startTime: 0 };
      return { clipName: 'M4_Idle', loop: true, timeScale: 1.0, startTime: 0 };
    }
    case 'sovereign-awp': {
      if (action === 'fire') return { clipName: 'SRifle_Shot_nosight', loop: false, timeScale: 1.25, startTime: 0 };
      if (action === 'reload_tactical') return { clipName: 'SRifle_Reload', loop: false, timeScale: 1.15, startTime: 0 };
      if (action === 'reload_empty') return { clipName: 'SRifle_Reload_Full', loop: false, timeScale: 1.35, startTime: 0 };
      if (action === 'walk') return { clipName: 'SRifle_Walk', loop: true, timeScale: 1.0, startTime: 0 };
      return { clipName: 'SRifle_Idle', loop: true, timeScale: 1.0, startTime: 0 };
    }
    case 'desert-eagle': {
      if (action === 'fire') return { clipName: 'Pistol_Fire', loop: false, timeScale: 1.4, startTime: 0 };
      if (action === 'reload_tactical') return { clipName: 'Pistol_Reload_easy', loop: false, timeScale: 1.0, startTime: 0 };
      if (action === 'reload_empty') return { clipName: 'Pistol_Reload_full', loop: false, timeScale: 1.05, startTime: 0 };
      if (action === 'walk') return { clipName: 'Pistol_Walk', loop: true, timeScale: 1.0, startTime: 0 };
      return { clipName: 'Pistol_Idle', loop: true, timeScale: 1.0, startTime: 0 };
    }
    case 'garam-karambit': {
      if (action === 'draw') return { clipName: 'Karambit_Draw', loop: false, timeScale: 1.0, startTime: 0 };
      if (action === 'slash_left') return { clipName: 'Karambit_Slash_L', loop: false, timeScale: 1.0, startTime: 0 };
      if (action === 'slash_right') return { clipName: 'Karambit_Slash_R', loop: false, timeScale: 1.0, startTime: 0 };
      if (action === 'stab') return { clipName: 'Karambit_Stab', loop: false, timeScale: 1.0, startTime: 0 };
      if (action === 'inspect') return { clipName: 'Karambit_Inspect', loop: false, timeScale: 1.0, startTime: 0 };
      if (action === 'walk') return { clipName: 'Karambit_Walk', loop: true, timeScale: 1.0, startTime: 0 };
      return { clipName: 'Karambit_Idle', loop: true, timeScale: 1.0, startTime: 0 };
    }
  }
}

export function normalizeWeaponViewId(id: string): WeaponViewId {
  if (
    id === 'garam-47' ||
    id === 'vanguard-m4' ||
    id === 'sovereign-awp' ||
    id === 'desert-eagle' ||
    id === 'garam-karambit'
  ) {
    return id;
  }
  return 'garam-47';
}
