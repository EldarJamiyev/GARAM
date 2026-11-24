import { describe, it, expect } from 'vitest';
import {
  KinematicPlayerController,
  SPAWN_ZONES,
  ECONOMY,
  KINEMATICS,
  SpatialGrid,
  DE_CITADEL_BLOCKS,
} from '@garam/shared';
import { computeRadarRotationRad } from '../ui/RadarRenderer.js';
import { stepMolotovBurnAccumulator } from '../utility/UtilityManager.js';
import { EconomyManager } from '../match/EconomyManager.js';
import { reconcilePredictedState, UnackInput } from '../net/NetworkClient.js';
import { resolveDroppedWeaponCollision } from '../combat/DroppedWeaponManager.js';

describe('@garam/client Pure Gameplay & Prediction Systems', () => {
  describe('RadarRenderer Rotation Orientation', () => {
    it('maps player forward direction (-sin(yaw), -cos(yaw)) to canvas UP (0, -1) and right to (+1, 0) for all cardinal yaws', () => {
      const yaws = [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.73, -1.91];

      for (const yaw of yaws) {
        const rot = computeRadarRotationRad(yaw);
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);

        // In Three.js: forward = (-sin(yaw), -cos(yaw)), right = (cos(yaw), -sin(yaw))
        const fwdDx = -Math.sin(yaw);
        const fwdDz = -Math.cos(yaw);
        const rightDx = Math.cos(yaw);
        const rightDz = -Math.sin(yaw);

        // Canvas 2D ctx.rotate(rot) transforms (dx, dz) -> (dx*cos - dz*sin, dx*sin + dz*cos)
        const radarFwdX = fwdDx * cosR - fwdDz * sinR;
        const radarFwdY = fwdDx * sinR + fwdDz * cosR;
        expect(radarFwdX).toBeCloseTo(0, 6);
        expect(radarFwdY).toBeCloseTo(-1, 6);

        const radarRightX = rightDx * cosR - rightDz * sinR;
        const radarRightY = rightDx * sinR + rightDz * cosR;
        expect(radarRightX).toBeCloseTo(1, 6);
        expect(radarRightY).toBeCloseTo(0, 6);
      }
    });
  });

  describe('Molotov Burn Accumulator FPS-Independence', () => {
    it('deals exact 40 DPS (80 HP over 2.0s) identically at 30, 60, 120, and 240 FPS', () => {
      const frameRates = [30, 60, 120, 240];
      const durationSec = 2.0;

      for (const fps of frameRates) {
        const dt = 1 / fps;
        const frames = Math.round(durationSec * fps);
        let accum = 0;
        let totalDamage = 0;

        for (let i = 0; i < frames; i++) {
          const res = stepMolotovBurnAccumulator(accum, dt);
          accum = res.nextAccumulator;
          totalDamage += res.damage;
        }

        // Handle floating-point rounding epsilon on exact boundary (e.g. 240 * (1/240) = 1.9999999999999)
        if (accum > 0.24999) {
          const finalTick = stepMolotovBurnAccumulator(accum, 1e-5);
          totalDamage += finalTick.damage;
        }

        expect(totalDamage, `Total damage at ${fps} FPS`).toBe(80);
      }
    });
  });

  describe('EconomyManager Faction Buy Zones & Utility Inventory', () => {
    it('enforces distinct Vanguard (CT) and Syndicate (T) buy zone bounds', () => {
      const econ = new EconomyManager();
      const ctCenter = {
        x: (SPAWN_ZONES.VANGUARD_BUY_ZONE.minX + SPAWN_ZONES.VANGUARD_BUY_ZONE.maxX) / 2,
        z: (SPAWN_ZONES.VANGUARD_BUY_ZONE.minZ + SPAWN_ZONES.VANGUARD_BUY_ZONE.maxZ) / 2,
      };
      const tCenter = {
        x: (SPAWN_ZONES.SYNDICATE_BUY_ZONE.minX + SPAWN_ZONES.SYNDICATE_BUY_ZONE.maxX) / 2,
        z: (SPAWN_ZONES.SYNDICATE_BUY_ZONE.minZ + SPAWN_ZONES.SYNDICATE_BUY_ZONE.maxZ) / 2,
      };

      expect(econ.isInsideBuyZone(ctCenter, 'Vanguard')).toBe(true);
      expect(econ.isInsideBuyZone(ctCenter, 'Syndicate')).toBe(false);
      expect(econ.isInsideBuyZone(tCenter, 'Syndicate')).toBe(true);
      expect(econ.isInsideBuyZone(tCenter, 'Vanguard')).toBe(false);

      // Inside live buy window (5s elapsed -> roundTimer = roundLiveSec - 5)
      const ok = econ.canBuy('ROUND_LIVE', ECONOMY.roundLiveSec - 5, tCenter, 'Syndicate');
      expect(ok.canBuy).toBe(true);

      // Expired buy window (25s elapsed)
      const expired = econ.canBuy('ROUND_LIVE', ECONOMY.roundLiveSec - 25, tCenter, 'Syndicate');
      expect(expired.canBuy).toBe(false);
    });

    it('tracks grenade ownership caps (2 flashbangs, 1 smoke/HE/molotov) and consumption', () => {
      const econ = new EconomyManager();
      expect(econ.hasUtility('smoke-grenade')).toBe(true);
      expect(econ.hasUtility('flashbang')).toBe(false);

      econ.addUtility('flashbang');
      econ.addUtility('flashbang');
      econ.addUtility('flashbang');
      expect(econ.ownedUtilities['flashbang']).toBe(2);

      expect(econ.consumeUtility('flashbang')).toBe(true);
      expect(econ.ownedUtilities['flashbang']).toBe(1);
      expect(econ.consumeUtility('flashbang')).toBe(true);
      expect(econ.consumeUtility('flashbang')).toBe(false);

      econ.devPracticeMoney();
      expect(econ.practiceInfiniteUtility).toBe(true);
      expect(econ.cash).toBe(ECONOMY.maxCash);
    });
  });

  describe('NetworkClient Deterministic Prediction Reconciliation', () => {
    it('replays unacknowledged inputs from authoritative server state and corrects divergence > 0.04m', () => {
      const dt = KINEMATICS.FIXED_DT;
      const moveInput = {
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        walk: false,
        yaw: 0,
        pitch: 0,
      };

      // Client runs 5 frames starting from (0, 0, 0)
      const clientPlayer = new KinematicPlayerController(0, 0, 0);
      const unack: UnackInput[] = [];
      for (let seq = 1; seq <= 5; seq++) {
        clientPlayer.update(moveInput, dt, 6.2, []);
        unack.push({
          seq,
          input: moveInput,
          dt,
          weaponSpeed: 6.2,
          x: clientPlayer.state.x,
          y: clientPlayer.state.y,
          z: clientPlayer.state.z,
        });
      }

      // Authoritative server acknowledges seq 2, but with a 0.5m rubberband shift along X
      const serverSim = new KinematicPlayerController(0.5, 0, 0);
      serverSim.update(moveInput, dt, 6.2, []);
      serverSim.update(moveInput, dt, 6.2, []);

      const result = reconcilePredictedState(
        clientPlayer,
        {
          x: serverSim.state.x,
          y: serverSim.state.y,
          z: serverSim.state.z,
          vx: serverSim.state.vx,
          vy: serverSim.state.vy,
          vz: serverSim.state.vz,
          isCrouching: false,
        },
        2,
        unack,
        []
      );

      expect(result.corrected).toBe(true);
      expect(result.remainingInputs.length).toBe(3); // seq 3, 4, 5
      expect(result.errorMagnitude).toBeCloseTo(0.5, 2);
      expect(clientPlayer.state.x).toBeCloseTo(0.5, 2);
      expect(result.offsetX).toBeCloseTo(-0.5, 2);
    });

    it('produces zero correction when client prediction matches server state within 0.04m', () => {
      const dt = KINEMATICS.FIXED_DT;
      const moveInput = {
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: false,
        crouch: false,
        walk: false,
        yaw: 0,
        pitch: 0,
      };

      const clientPlayer = new KinematicPlayerController(0, 0, 0);
      const serverSim = new KinematicPlayerController(0, 0, 0);
      const unack: UnackInput[] = [];

      for (let seq = 1; seq <= 4; seq++) {
        clientPlayer.update(moveInput, dt, 6.2, []);
        if (seq <= 2) serverSim.update(moveInput, dt, 6.2, []);
        unack.push({
          seq,
          input: moveInput,
          dt,
          weaponSpeed: 6.2,
          x: clientPlayer.state.x,
          y: clientPlayer.state.y,
          z: clientPlayer.state.z,
        });
      }

      const result = reconcilePredictedState(
        clientPlayer,
        {
          x: serverSim.state.x,
          y: serverSim.state.y,
          z: serverSim.state.z,
          vx: serverSim.state.vx,
          vy: serverSim.state.vy,
          vz: serverSim.state.vz,
          isCrouching: false,
        },
        2,
        unack,
        []
      );

      expect(result.corrected).toBe(false);
      expect(result.remainingInputs.length).toBe(2);
      expect(result.errorMagnitude).toBeLessThan(0.001);
    });

    it('restores authoritative crouch state and supports SpatialGrid broadphase during reconciliation', () => {
      const dt = KINEMATICS.FIXED_DT;
      const grid = new SpatialGrid(DE_CITADEL_BLOCKS, 10);
      const clientPlayer = new KinematicPlayerController(0, 0, 35);
      clientPlayer.state.isCrouching = false;
      clientPlayer.actualCrouching = false;

      const result = reconcilePredictedState(
        clientPlayer,
        { x: 0.4, y: 0, z: 35, vx: 0, vy: 0, vz: 0, isCrouching: true },
        0,
        [],
        DE_CITADEL_BLOCKS,
        grid
      );

      expect(result.corrected).toBe(true);
      expect(clientPlayer.state.isCrouching).toBe(true);
      expect(clientPlayer.actualCrouching).toBe(true);
      expect(dt).toBeCloseTo(1 / 128, 6);
    });
  });

  describe('DroppedWeaponManager Side-Wall Deflection', () => {
    it('deflects horizontally off tall side walls instead of teleporting weapons onto the roof', () => {
      const tallWall = {
        minX: 2.0,
        maxX: 3.0,
        minY: 0,
        maxY: 4.0,
        minZ: -5,
        maxZ: 5,
      };
      const pos = { x: 1.95, y: 1.0, z: 0 };
      const vel = { x: 4.0, y: 0.5, z: 0 };

      const grounded = resolveDroppedWeaponCollision(pos, vel, [tallWall]);
      expect(grounded).toBe(false);
      expect(pos.y).toBeCloseTo(1.0, 3); // Did NOT teleport to y = 4.12!
      expect(pos.x).toBeLessThanOrEqual(2.0 - 0.12 + 1e-4);
      expect(vel.x).toBeLessThan(0); // Reflected backward
    });

    it('lands cleanly on top of a crate when descending near the top plane', () => {
      const crate = {
        minX: -1,
        maxX: 1,
        minY: 0,
        maxY: 1.0,
        minZ: -1,
        maxZ: 1,
      };
      const pos = { x: 0, y: 0.98, z: 0 };
      const vel = { x: 1.0, y: -2.0, z: 0 };

      const grounded = resolveDroppedWeaponCollision(pos, vel, [crate]);
      expect(grounded).toBe(true);
      expect(pos.y).toBeCloseTo(1.12, 3);
      expect(vel.y).toBe(0);
    });
  });

  describe('ViewmodelRig Unified CS2 Gloved Hands Socket & Clip System', () => {
    it('provides calibrated CS2 socket configurations and clip sets for all 5 weapons (including pistol and karambit)', async () => {
      const THREE = await import('three');
      const {
        CS2_ARMS_MODEL_PATH,
        WEAPON_SOCKET_CONFIGS,
        resolveWeaponClipName,
        buildCS2AnimationClips,
        captureBindPose,
        restoreBindPose,
        buildKarambitAnimationClips,
      } = await import('../viewmodel/ViewmodelRig.js');

      expect(CS2_ARMS_MODEL_PATH).toBe('/models/cs2_fps_arms.glb');

      const expectedWeapons = [
        'garam-47',
        'vanguard-m4',
        'sovereign-awp',
        'desert-eagle',
        'garam-karambit',
      ];
      for (const id of expectedWeapons) {
        const cfg = WEAPON_SOCKET_CONFIGS[id];
        expect(cfg, `Config for ${id}`).toBeDefined();
        expect(cfg.modelPath.startsWith('/models/')).toBe(true);
        expect(cfg.modelPath).not.toContain('m4a1s_fp.glb');
        expect(['weapon_hand_r_5', 'DEF-handR_357', 'Rif', 'Hand_R']).toContain(cfg.socketBone);
        expect(cfg.armsScale).toBeGreaterThanOrEqual(0.35);
        expect(cfg.armsScale).toBeLessThanOrEqual(1.1);
        expect(cfg.armsOffset[2]).toBeLessThan(-0.05);
        expect(cfg.armsOffset[2]).toBeGreaterThan(-0.55);
        expect(resolveWeaponClipName(id, 'idle').length).toBeGreaterThan(3);
        expect(resolveWeaponClipName(id, 'walk').length).toBeGreaterThan(3);
        expect(resolveWeaponClipName(id, 'fire').length).toBeGreaterThan(3);
        expect(resolveWeaponClipName(id, 'reload').length).toBeGreaterThan(3);
      }

      // Verify CS2 animation clip slicer builds all 6 gameplay clips from Equip/Shots/Reload/Inspect
      const makeTrack = () =>
        new THREE.QuaternionKeyframeTrack(
          'weapon_hand_r_5.quaternion',
          [0, 1, 2, 4, 8],
          [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]
        );
      const cs2Clips = buildCS2AnimationClips([
        new THREE.AnimationClip('Shots', 2.5, [makeTrack()]),
        new THREE.AnimationClip('Equip', 3.5, [makeTrack()]),
        new THREE.AnimationClip('Reload', 4.6, [makeTrack()]),
        new THREE.AnimationClip('Inspect', 8.0, [makeTrack()]),
      ]);
      expect(cs2Clips.map((c) => c.name)).toEqual([
        'CS2_Idle',
        'CS2_Walk',
        'CS2_Fire',
        'CS2_Draw',
        'CS2_Reload',
        'CS2_Inspect',
      ]);

      // Verify bind-pose snapshot and restoration prevents unkeyed bone bleed
      const root = new THREE.Group();
      root.name = 'Root';
      const pBody = new THREE.Object3D();
      pBody.name = 'PBody';
      pBody.position.set(-0.0442, 0.1206, 0.2668);
      pBody.quaternion.set(0.7049, -0.0294, -0.0475, 0.7071);
      root.add(pBody);

      const snapshot = captureBindPose(root);
      pBody.position.set(99, -99, 42);
      pBody.quaternion.set(0, 1, 0, 0);
      restoreBindPose(root, snapshot);
      expect(pBody.position.x).toBeCloseTo(-0.0442, 5);
      expect(pBody.quaternion.w).toBeCloseTo(0.7071, 5);

      // Verify legacy Karambit animation clip generator remains intact
      const mockPistolIdle = new THREE.AnimationClip('Pistol_Idle', 1.98, [
        new THREE.VectorKeyframeTrack('IK_Hand_Cntrl_R.position', [0, 1], [-0.08, 0.03, 0.22, -0.08, 0.03, 0.22]),
        new THREE.QuaternionKeyframeTrack('IK_Hand_Cntrl_R.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
        new THREE.QuaternionKeyframeTrack('Hand_R.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
        new THREE.QuaternionKeyframeTrack('Bone_R005.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      ]);
      const mockAkIdle = new THREE.AnimationClip('AK_Idle', 1.98, [
        new THREE.QuaternionKeyframeTrack('UpArm_L.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
        new THREE.QuaternionKeyframeTrack('Forearm_L.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      ]);
      const karClips = buildKarambitAnimationClips([mockPistolIdle, mockAkIdle]);
      expect(karClips.map((c) => c.name)).toEqual([
        'Karambit_Idle',
        'Karambit_Walk',
        'Karambit_Draw',
        'Karambit_Slash',
        'Karambit_Stab',
        'Karambit_Inspect',
      ]);
    });
  });

  describe('BotAISystem End-to-End Anti-Prefire, FOV & Flash Blindness', () => {
    it('never prefires across any difficulty tier, never spots players behind its back, and immediately re-scales on setDifficulty', async () => {
      const THREE = await import('three');
      const { BotAISystem } = await import('../match/BotAISystem.js');

      const makeBot = (yaw: number) => {
        const mesh = new THREE.Group();
        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, yaw, 0);
        const dummyCollider = new THREE.Mesh();
        return {
          id: 'bot_viper_test',
          name: 'Syndicate Viper',
          team: 'Syndicate' as const,
          mesh,
          headCollider: dummyCollider,
          bodyCollider: dummyCollider,
          patrolTarget: new THREE.Vector3(0, 0, 12),
          patrolWaypoints: [new THREE.Vector3(0, 0, 12)],
          waypointIndex: 0,
          health: 100,
          maxHealth: 100,
          armor: 100,
          hasHelmet: true,
          isDead: false,
          vx: 0,
          vz: 0,
          lastShotTime: 0,
          kills: 0,
          deaths: 0,
        };
      };

      // 1. Player standing directly BEHIND bot (+Z while bot faces -Z toward North sites) -> ZERO shots across 120 frames (2s)
      let shotsBehind = 0;
      const aiBehind = new BotAISystem(
        {
          onBotShootPlayer: () => {
            shotsBehind++;
          },
          onBotShootBot: () => {},
        },
        'Sovereign'
      );
      const behindBot = makeBot(Math.PI); // facing -Z (North toward CS_OFFICE A/B sites)
      behindBot.mesh.position.set(0, 0, 12);
      aiBehind.startNewRound(1, [behindBot]);
      for (let f = 0; f < 120; f++) {
        aiBehind.update(
          [behindBot],
          1 / 60,
          [],
          [],
          new THREE.Vector3(0, 0, 22),
          new THREE.Vector3(0, 1.68, 22),
          [],
          false,
          null,
          100,
          100,
          'Vanguard',
          false
        );
      }
      expect(shotsBehind).toBe(0);

      // 2. Player steps in front of bot -> ZERO prefires during initial reaction window on ALL 4 difficulties
      const difficulties: Array<{ tier: 'Recruit' | 'Veteran' | 'Elite' | 'Sovereign'; prefireWindowFrames: number }> = [
        { tier: 'Recruit', prefireWindowFrames: 26 }, // ~433ms
        { tier: 'Veteran', prefireWindowFrames: 18 }, // ~300ms
        { tier: 'Elite', prefireWindowFrames: 12 },   // ~200ms
        { tier: 'Sovereign', prefireWindowFrames: 8 }, // ~133ms
      ];

      for (const { tier, prefireWindowFrames } of difficulties) {
        let shots = 0;
        const ai = new BotAISystem(
          {
            onBotShootPlayer: () => {
              shots++;
            },
            onBotShootBot: () => {},
          },
          tier
        );
        const bot = makeBot(0);
        ai.startNewRound(1, [bot]);
        for (let f = 0; f < prefireWindowFrames; f++) {
          ai.update(
            [bot],
            1 / 60,
            [],
            [],
            new THREE.Vector3(0, 0, 14),
            new THREE.Vector3(0, 1.68, 14),
            [],
            false,
            null,
            100,
            100,
            'Vanguard',
            false
          );
        }
        expect(shots, `Prefire detected on ${tier} within ${prefireWindowFrames} frames`).toBe(0);
      }

      // 3. Mid-match setDifficulty('Recruit') immediately suppresses Sovereign bots + flashbang blinds bot
      let flashedShots = 0;
      const aiFlash = new BotAISystem(
        {
          onBotShootPlayer: () => {
            flashedShots++;
          },
          onBotShootBot: () => {},
        },
        'Sovereign'
      );
      const flashBot = makeBot(0);
      aiFlash.startNewRound(1, [flashBot]);
      aiFlash.setDifficulty('Recruit');
      aiFlash.onFlashbangExploded(new THREE.Vector3(0, 1.6, 5), [flashBot]);
      for (let f = 0; f < 60; f++) {
        aiFlash.update(
          [flashBot],
          1 / 60,
          [],
          [],
          new THREE.Vector3(0, 0, 10),
          new THREE.Vector3(0, 1.68, 10),
          [],
          false,
          null,
          100,
          100,
          'Vanguard',
          false
        );
      }
      expect(flashedShots).toBe(0);
    });
  });
});



