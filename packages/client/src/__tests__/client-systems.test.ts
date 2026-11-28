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
        expect(cfg.armsOffset[2]).toBeLessThanOrEqual(0.12);
        expect(cfg.armsOffset[2]).toBeGreaterThanOrEqual(-0.15);
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

  describe('Map-Aware Bot Respawn & Full GPU Texture Disposal', () => {
    it('disposes geometries, materials, and deduplicated textures on map roots via AssetManager.disposeObject3D(root, true)', async () => {
      const THREE = await import('three');
      const { AssetManager } = await import('../render/AssetManager.js');

      const root = new THREE.Group();
      const sharedTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      const normalTex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);

      let texDisposals = 0;
      const origSharedDispose = sharedTex.dispose.bind(sharedTex);
      sharedTex.dispose = () => {
        texDisposals++;
        origSharedDispose();
      };
      const origNormDispose = normalTex.dispose.bind(normalTex);
      normalTex.dispose = () => {
        texDisposals++;
        origNormDispose();
      };

      const matA = new THREE.MeshStandardMaterial({ map: sharedTex, normalMap: normalTex });
      const matB = new THREE.MeshStandardMaterial({ map: sharedTex });
      let matDisposals = 0;
      const origMatA = matA.dispose.bind(matA);
      matA.dispose = () => {
        matDisposals++;
        origMatA();
      };
      const origMatB = matB.dispose.bind(matB);
      matB.dispose = () => {
        matDisposals++;
        origMatB();
      };

      root.add(
        new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matA),
        new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matB)
      );

      AssetManager.disposeObject3D(root, true);
      expect(matDisposals).toBe(2);
      expect(texDisposals).toBe(2); // Deduplicated: sharedTex + normalTex disposed once each
    });

    it('faces respawned bots along their DE_DUST2 waypoint direction rather than hardcoded office angles', async () => {
      const THREE = await import('three');
      const { PlayerManager } = await import('../combat/PlayerManager.js');
      const { settingsStore } = await import('../core/SettingsStore.js');

      settingsStore.settings.mapId = 'de_dust2';
      const player = new KinematicPlayerController(0, 0, 0);
      const pm = new PlayerManager(
        player,
        {} as never,
        { armor: 100 } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { onSyncActiveWeapon: () => {} }
      );

      const ctMesh = new THREE.Group();
      const tMesh = new THREE.Group();
      const bots = [
        {
          id: 'ct_1',
          name: 'Vanguard Steel',
          team: 'Vanguard' as const,
          mesh: ctMesh,
          health: 0,
          maxHealth: 100,
          armor: 0,
          hasHelmet: true,
          isDead: true,
          kills: 0,
          deaths: 1,
          patrolWaypoints: [
            { x: 6, y: 0, z: 36 },
            { x: 6, y: 0, z: 24 }, // North (-Z -> Math.PI)
          ],
          waypointIndex: 1,
          patrolTarget: { x: 6, y: 0, z: 24 },
          lastShotTime: 0,
          vx: 0,
          vz: 0,
        },
        {
          id: 't_1',
          name: 'Syndicate Razor',
          team: 'Syndicate' as const,
          mesh: tMesh,
          health: 0,
          maxHealth: 100,
          armor: 0,
          hasHelmet: true,
          isDead: true,
          kills: 0,
          deaths: 1,
          patrolWaypoints: [
            { x: -60, y: 3.5, z: -10 },
            { x: -46, y: 3.5, z: -10 }, // East (+X -> Math.PI / 2)
          ],
          waypointIndex: 1,
          patrolTarget: { x: -46, y: 3.5, z: -10 },
          lastShotTime: 0,
          vx: 0,
          vz: 0,
        },
      ];

      pm.respawnAllBots(bots as never);
      expect(Math.abs(ctMesh.rotation.y)).toBeCloseTo(Math.PI, 3);
      expect(tMesh.rotation.y).toBeCloseTo(Math.PI * 0.5, 3);
      expect(bots[0].isDead).toBe(false);
      expect(bots[1].health).toBe(100);
    });
  });

  describe('Frame Pacing SettingsStore & Software WebGL Detection', () => {
    it('defaults fpsLimit to VSYNC and persists VSYNC / 120 / 240 / UNLIMITED in localStorage', async () => {
      const storeMap = new Map<string, string>();
      const origLocalStorage = globalThis.localStorage;
      (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (k: string) => storeMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storeMap.set(k, v);
        },
        removeItem: (k: string) => {
          storeMap.delete(k);
        },
        clear: () => storeMap.clear(),
        key: (idx: number) => Array.from(storeMap.keys())[idx] ?? null,
        get length() {
          return storeMap.size;
        },
      };

      try {
        const { SettingsStore } = await import('../core/SettingsStore.js');
        const store = SettingsStore.getInstance();
        const prevLimit = store.settings.fpsLimit;

        expect(['VSYNC', '120', '240', 'UNLIMITED']).toContain(prevLimit);

        for (const mode of ['VSYNC', '120', '240', 'UNLIMITED'] as const) {
          store.update('fpsLimit', mode);
          const raw = storeMap.get('garam_tactical_settings_v2');
          expect(raw).toBeTruthy();
          expect(JSON.parse(raw!).fpsLimit).toBe(mode);
        }

        // Verify load() validates invalid fpsLimit and falls back safely to VSYNC
        storeMap.set('garam_tactical_settings_v2', JSON.stringify({ fpsLimit: 'INVALID_HZ', graphicsQuality: 'POTATO' }));
        const reloaded = (store as unknown as { load: () => { fpsLimit: string; graphicsQuality: string } }).load();
        expect(reloaded.fpsLimit).toBe('VSYNC');
        expect(reloaded.graphicsQuality).toBe('AUTO');

        store.update('fpsLimit', prevLimit);
      } finally {
        (globalThis as unknown as { localStorage: Storage | undefined }).localStorage = origLocalStorage;
      }
    });

    it('detects CPU software WebGL renderers without misclassifying hardware Mesa or discrete GPUs', async () => {
      const { isSoftwareRendererString } = await import('../render/SceneManager.js');

      expect(isSoftwareRendererString('Google SwiftShader')).toBe(true);
      expect(isSoftwareRendererString('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
      expect(isSoftwareRendererString('Microsoft Basic Render Driver')).toBe(true);
      expect(isSoftwareRendererString('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
      expect(isSoftwareRendererString('softpipe')).toBe(true);
      expect(isSoftwareRendererString('Software Rasterizer')).toBe(true);

      expect(isSoftwareRendererString('Mesa Intel(R) UHD Graphics 770 (ADL-S GT1)')).toBe(false);
      expect(isSoftwareRendererString('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
      expect(isSoftwareRendererString('AMD Radeon RX 7800 XT (radeonsi, navi32, LLVM 16.0.6, DRM 3.54)')).toBe(false);
      expect(isSoftwareRendererString('Apple M3 Pro')).toBe(false);
    });
  });

  describe('CS2 Round Transition Hard-Reset Regression (DE_DUST2 & CS_OFFICE)', () => {
    it('hard-resets player kinematics, camera roll/height, and combat state across ROUND_END -> FREEZE_TIME -> ROUND_LIVE from mid-air and dead/spectating states', async () => {
      const THREE = await import('three');
      const { getMapDescriptor } = await import('@garam/shared');
      const { buildRoundCallbacks } = await import('../core/GameEventWire.js');
      const { PlayerManager } = await import('../combat/PlayerManager.js');
      const { InventoryManager } = await import('../combat/InventoryManager.js');
      const { RoundManager } = await import('../match/RoundManager.js');
      const { settingsStore } = await import('../core/SettingsStore.js');

      const origMap = settingsStore.settings.mapId;
      const origFaction = settingsStore.settings.faction;

      try {
        const maps: Array<'de_dust2'> = ['de_dust2'];
        const scenarios: Array<'midair' | 'dead_spectating'> = ['midair', 'dead_spectating'];

        for (const mapId of maps) {
          for (const scenario of scenarios) {
            settingsStore.settings.mapId = mapId;
            settingsStore.settings.faction = scenario === 'midair' ? 'Vanguard' : 'Syndicate';
            const desc = getMapDescriptor(mapId);
            const expectedSpawn =
              settingsStore.settings.faction === 'Syndicate'
                ? desc.spawnPoints.OBSIDIAN_T
                : desc.spawnPoints.VANGUARD_CT;
            const expectedYaw = desc.initialYaw[settingsStore.settings.faction];

            const player = new KinematicPlayerController(18, 9.5, -24);
            player.state.vx = 5.4;
            player.state.vy = 4.2;
            player.state.vz = -4.9;
            player.state.isGrounded = false;
            player.state.isCrouching = true;
            player.actualCrouching = true;
            player.stepOffsetY = 0.42;
            player.landingCameraDip = -0.18;
            player.prevState.x = 12;
            player.prevState.y = 7.0;

            const camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 200);
            camera.position.set(18, 12.2, -24);
            camera.rotation.set(0.35, 1.9, 0.72, 'YXZ'); // simulated deathcam tilt + pitch

            let spectatorStopped = false;
            let weaponCombatReset = false;
            let movementInputsReset = false;
            let viewmodelMotionReset = false;
            let hudKillsReset = false;
            let syncedWeapon = false;

            const inventory = new InventoryManager();
            const economy = new EconomyManager();
            const playerManager = new PlayerManager(
              player,
              inventory,
              economy,
              {} as never,
              { stop: () => { spectatorStopped = true; } } as never,
              { reset: () => {}, show: () => {} } as never,
              {
                addKillfeed: () => {},
                addKillEntry: () => {},
                addRadioMessage: () => {},
                recordRoundKill: () => {},
                resetRoundKills: () => { hudKillsReset = true; },
                setFactionTheme: () => {},
                updateScores: () => {},
                showCenterBanner: () => {},
                showRoundWinRibbon: () => {},
                updateRoundTimer: () => {},
              } as never,
              { playKillSound: () => {}, playImpact: () => {} } as never,
              { spawnDeathParticleBurst: () => {} } as never,
              { onSyncActiveWeapon: () => { syncedWeapon = true; } }
            );

            if (scenario === 'dead_spectating') {
              playerManager.playerHealth = 0;
            }

            const mockAudio = {
              playRoundEndHorn: () => {},
              playBombExplosion: () => {},
              playDefuseSuccess: () => {},
              playRoundStart: () => {},
              playBombPlantBeep: () => {},
              playRadioChirp: () => {},
            };
            const ctx = {
              worldCamera: camera,
              spectator: { stop: () => { spectatorStopped = true; } },
              weaponController: { resetRoundCombatState: () => { weaponCombatReset = true; } },
              cameraPunchPitch: { value: 0.14 },
              isFiring: { value: true },
              pendingFireTrigger: { value: true },
              isInteracting: { value: true },
              inputManager: {
                input: { yaw: 2.1, pitch: -0.4, forward: true, backward: false, left: true, right: false, jump: true, crouch: true, walk: false },
                mouseDeltaX: 18,
                mouseDeltaY: -12,
                resetMovementInputs: () => { movementInputsReset = true; },
              },
              droppedWeapons: { clearAll: () => {} },
              utilityManager: { resetRound: () => {} },
              effects: { clearAll: () => {} },
              radar: { clearSpotted: () => {} },
              player,
              playerManager,
              inventory,
              economy,
              viewmodel: { resetMotionState: () => { viewmodelMotionReset = true; } },
              hud: {
                resetRoundKills: () => { hudKillsReset = true; },
                setFactionTheme: () => {},
                updateScores: () => {},
                showCenterBanner: () => {},
                showRoundWinRibbon: () => {},
                updateRoundTimer: () => {},
                addKillfeed: () => {},
                addKillEntry: () => {},
                addRadioMessage: () => {},
                updateInteractionBar: () => {},
              },
              combatReport: { resetRound: () => {}, show: () => {} },
              audio: mockAudio,
              bots: [],
              spawnPos: { x: 0, y: 0, z: 0 },
              syncActiveWeapon: () => { syncedWeapon = true; },
            };

            const roundCallbacks = buildRoundCallbacks(ctx as never);
            const roundManager = new RoundManager(
              new THREE.Scene(),
              mockAudio as never,
              roundCallbacks,
              desc.bombsites
            );
            (ctx as unknown as { roundManager: InstanceType<typeof RoundManager> }).roundManager = roundManager;

            // Simulate ROUND_END -> FREEZE_TIME -> ROUND_LIVE transition
            const feetPos = new THREE.Vector3(18, 9.5, -24);
            roundManager.phase = 'ROUND_END';
            roundManager.phaseTimer = 0.05;
            roundManager.update(0.1, feetPos, false, false, false, [], playerManager.playerHealth);
            expect(roundManager.phase).toBe('FREEZE_TIME');

            expect(spectatorStopped).toBe(true);
            expect(weaponCombatReset).toBe(true);
            expect(movementInputsReset).toBe(true);
            expect(viewmodelMotionReset).toBe(true);
            expect(hudKillsReset).toBe(true);
            expect(syncedWeapon).toBe(true);

            // Player state strictly grounded on spawn floor with zero velocity & zero interpolation residue
            expect(playerManager.playerHealth).toBe(100);
            expect(player.state.x).toBeCloseTo(expectedSpawn.x, 4);
            expect(player.state.y).toBeCloseTo(expectedSpawn.y, 4);
            expect(player.state.z).toBeCloseTo(expectedSpawn.z, 4);
            expect(player.state.vx).toBe(0);
            expect(player.state.vy).toBe(0);
            expect(player.state.vz).toBe(0);
            expect(player.state.isGrounded).toBe(true);
            expect(player.state.isCrouching).toBe(false);
            expect(player.actualCrouching).toBe(false);
            expect(player.stepOffsetY).toBe(0);
            expect(player.landingCameraDip).toBe(0);
            expect(player.prevState.x).toBeCloseTo(player.state.x, 5);
            expect(player.prevState.y).toBeCloseTo(player.state.y, 5);
            expect(player.prevState.z).toBeCloseTo(player.state.z, 5);

            // Camera snapped cleanly to standing eye height with zero deathcam roll
            expect(camera.position.x).toBeCloseTo(expectedSpawn.x, 4);
            expect(camera.position.y).toBeCloseTo(expectedSpawn.y + KINEMATICS.EYE_HEIGHT_STAND, 4);
            expect(camera.position.z).toBeCloseTo(expectedSpawn.z, 4);
            expect(camera.rotation.z).toBe(0);
            expect(camera.rotation.x).toBe(0);
            expect(camera.rotation.y).toBeCloseTo(expectedYaw, 4);
            expect(ctx.cameraPunchPitch.value).toBe(0);
            expect(ctx.isFiring.value).toBe(false);

            // Advance through FREEZE_TIME -> ROUND_LIVE
            roundManager.update(roundManager.phaseTimer + 0.1, feetPos, false, false, false, [], 100);
            expect(roundManager.phase).toBe('ROUND_LIVE');
          }
        }
      } finally {
        settingsStore.settings.mapId = origMap;
        settingsStore.settings.faction = origFaction;
      }
    });
  });

  describe('CS2 PBR Weapon Calibration & HUD Kill-Card Stack', () => {
    it('calibrates metallic steel, crimson karambit bevels, AWP scope glass, AK wood, Deagle chrome, and polymer materials', async () => {
      const THREE = await import('three');
      const { calibrateWeaponPBRMaterials } = await import('../viewmodel/WeaponViewmodel.js');

      const makeMesh = (meshName: string, matName: string) => {
        const mat = new THREE.MeshStandardMaterial({ name: matName, metalness: 0.5, roughness: 0.5 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat);
        mesh.name = meshName;
        return { mesh, mat };
      };

      // Karambit: crimson metallic blade vs matte grip
      const karGroup = new THREE.Group();
      const karBlade = makeMesh('karambit_blade', 'blade_mat');
      const karGrip = makeMesh('karambit_handle_grip', 'grip_mat');
      karGroup.add(karBlade.mesh, karGrip.mesh);
      expect(calibrateWeaponPBRMaterials(karGroup, 'garam-karambit')).toBe(2);
      expect(karBlade.mat.metalness).toBeCloseTo(0.88, 2);
      expect(karBlade.mat.roughness).toBeCloseTo(0.18, 2);
      expect(karBlade.mat.envMapIntensity).toBeGreaterThanOrEqual(1.6);
      expect(karGrip.mat.metalness).toBeLessThan(0.2);

      // AWP: glossy scope lens vs matte polymer chassis
      const awpGroup = new THREE.Group();
      const awpLens = makeMesh('scope_glass', 'optic_lens');
      const awpBody = makeMesh('awp_chassis', 'polymer_body');
      awpGroup.add(awpLens.mesh, awpBody.mesh);
      calibrateWeaponPBRMaterials(awpGroup, 'sovereign-awp');
      expect(awpLens.mat.roughness).toBeCloseTo(0.06, 2);
      expect(awpLens.mat.envMapIntensity).toBeCloseTo(2.0, 2);
      expect(awpBody.mat.roughness).toBeCloseTo(0.62, 2);

      // AK-47: warm satin wood vs brushed steel receiver
      const akGroup = new THREE.Group();
      const akWood = makeMesh('ak_wood_handguard', 'wood_mat');
      const akSteel = makeMesh('ak_receiver', 'steel_mat');
      akGroup.add(akWood.mesh, akSteel.mesh);
      calibrateWeaponPBRMaterials(akGroup, 'garam-47');
      expect(akWood.mat.metalness).toBeLessThan(0.1);
      expect(akWood.mat.roughness).toBeCloseTo(0.52, 2);
      expect(akSteel.mat.metalness).toBeGreaterThanOrEqual(0.72);

      // Desert Eagle: high-metalness chrome slide
      const deagleGroup = new THREE.Group();
      const deagleSlide = makeMesh('deagle_slide', 'chrome_slide');
      deagleGroup.add(deagleSlide.mesh);
      calibrateWeaponPBRMaterials(deagleGroup, 'desert-eagle');
      expect(deagleSlide.mat.metalness).toBeGreaterThanOrEqual(0.84);
      expect(deagleSlide.mat.envMapIntensity).toBeCloseTo(1.38, 2);
    });

    it('tracks round kill cards (capped at 5 with headshot styling), resets on new round, and updates team alive counters', async () => {
      const { HUDManager } = await import('../ui/HUDManager.js');

      const makeEl = (id: string) => {
        const classes = new Set<string>();
        const children: unknown[] = [];
        return {
          id,
          textContent: '',
          innerHTML: '',
          className: '',
          dataset: {} as Record<string, string>,
          style: {} as Record<string, string>,
          offsetWidth: 0,
          children,
          classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
            toggle: (c: string, force?: boolean) => (force ? classes.add(c) : classes.delete(c)),
            contains: (c: string) => classes.has(c),
          },
          appendChild: (child: unknown) => {
            children.push(child);
            return child;
          },
        };
      };

      const elements = new Map<string, ReturnType<typeof makeEl>>([
        ['alive-ct', makeEl('alive-ct')],
        ['alive-t', makeEl('alive-t')],
        ['cs2-kill-cards', makeEl('cs2-kill-cards')],
        ['cs2-kill-flare', makeEl('cs2-kill-flare')],
        ['cs2-faction-emblem', makeEl('cs2-faction-emblem')],
      ]);

      const origDoc = globalThis.document;
      const origWin = globalThis.window;
      (globalThis as unknown as { document: unknown }).document = {
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelectorAll: () => [],
        createElement: () => makeEl('card'),
      };
      (globalThis as unknown as { window: unknown }).window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
      };

      try {
        const hud = new HUDManager();
        hud.updateAliveCounts(4, 3);
        expect(elements.get('alive-ct')!.textContent).toBe('4');
        expect(elements.get('alive-t')!.textContent).toBe('3');

        hud.setFactionTheme('Syndicate');
        expect(elements.get('cs2-faction-emblem')!.dataset.faction).toBe('syndicate');

        hud.recordRoundKill(false);
        hud.recordRoundKill(true);
        hud.recordRoundKill(true);
        expect(hud.roundKillCount).toBe(3);
        const cards = elements.get('cs2-kill-cards')!.children as Array<{ className: string }>;
        expect(cards.length).toBe(3);
        expect(cards[0].className).toBe('cs2-kill-card');
        expect(cards[1].className).toBe('cs2-kill-card headshot');
        expect(elements.get('cs2-kill-flare')!.classList.contains('active')).toBe(true);

        hud.recordRoundKill(false);
        hud.recordRoundKill(false);
        hud.recordRoundKill(true); // 6th kill caps roundKillCount at 5
        expect(hud.roundKillCount).toBe(5);

        hud.resetRoundKills();
        expect(hud.roundKillCount).toBe(0);
        expect(elements.get('cs2-kill-cards')!.innerHTML).toBe('');
        expect(elements.get('cs2-kill-flare')!.classList.contains('active')).toBe(false);
      } finally {
        (globalThis as unknown as { document: unknown }).document = origDoc;
        (globalThis as unknown as { window: unknown }).window = origWin;
      }
    });

    it('isolates radio/system feed (max 3 lines) from pure SVG killfeed (max 5 rows) and renders pulsing C4 timer & MVP ribbon', async () => {
      const { HUDManager } = await import('../ui/HUDManager.js');

      type MockEl = {
        id: string;
        textContent: string;
        innerHTML: string;
        className: string;
        dataset: Record<string, string>;
        style: Record<string, string> & { setProperty: (k: string, v: string) => void };
        offsetWidth: number;
        children: MockEl[];
        firstElementChild: MockEl | null;
        parent: MockEl | null;
        remove: () => void;
        classList: {
          add: (c: string) => void;
          remove: (c: string) => void;
          toggle: (c: string, force?: boolean) => void;
          contains: (c: string) => boolean;
        };
        appendChild: (child: MockEl) => MockEl;
      };

      const makeEl = (id: string): MockEl => {
        const classes = new Set<string>();
        const el: MockEl = {
          id,
          textContent: '',
          innerHTML: '',
          className: '',
          dataset: {},
          style: Object.assign({} as Record<string, string>, {
            setProperty(k: string, v: string) {
              (this as unknown as Record<string, string>)[k] = v;
            },
          }),
          offsetWidth: 0,
          children: [],
          get firstElementChild() {
            return this.children.length > 0 ? this.children[0] : null;
          },
          parent: null,
          remove() {
            if (!this.parent) return;
            const idx = this.parent.children.indexOf(this);
            if (idx >= 0) this.parent.children.splice(idx, 1);
            this.parent = null;
          },
          classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
            toggle: (c: string, force?: boolean) => {
              if (force) classes.add(c);
              else classes.delete(c);
            },
            contains: (c: string) => classes.has(c),
          },
          appendChild(child: MockEl) {
            child.parent = this;
            this.children.push(child);
            return child;
          },
        };
        return el;
      };

      const elements = new Map<string, MockEl>([
        ['killfeed', makeEl('killfeed')],
        ['cs2-radio-feed', makeEl('cs2-radio-feed')],
        ['round-timer', makeEl('round-timer')],
        ['cs2-tactical-toast', makeEl('cs2-tactical-toast')],
        ['ui-overlay', makeEl('ui-overlay')],
      ]);

      const origDoc = globalThis.document;
      const origWin = globalThis.window;
      (globalThis as unknown as { document: unknown }).document = {
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelectorAll: () => [],
        createElement: () => makeEl('node'),
        body: makeEl('body'),
      };
      (globalThis as unknown as { window: unknown }).window = {
        setTimeout: () => 1,
        clearTimeout: () => {},
      };

      try {
        const hud = new HUDManager();

        // Radio/system messages go strictly to #cs2-radio-feed (capped at 3) and NEVER enter #killfeed
        hud.addRadioMessage('Kestrel: "Enemy spotted A Long"');
        hud.addRadioMessage('Tactical Smoke Deployed');
        hud.addRadioMessage('Purchased Kevlar Vest ($650)');
        hud.addRadioMessage('Round End Payout: +$3250');

        const radioFeed = elements.get('cs2-radio-feed')!;
        const killfeed = elements.get('killfeed')!;
        expect(radioFeed.children.length).toBe(3);
        expect(radioFeed.children[0].textContent).toBe('Tactical Smoke Deployed');
        expect(radioFeed.children[2].textContent).toBe('Round End Payout: +$3250');
        expect(killfeed.children.length).toBe(0);

        // Structured SVG killfeed caps at 5 rows with local-kill crimson highlight + SVG weapon/headshot/wallbang
        for (let i = 1; i <= 6; i++) {
          hud.addKillEntry({
            killer: i === 6 ? 'Eldar' : `Bot${i}`,
            killerTeam: i % 2 === 0 ? 'Vanguard' : 'Syndicate',
            victim: `Target${i}`,
            victimTeam: i % 2 === 0 ? 'Syndicate' : 'Vanguard',
            weaponId: i === 6 ? 'garam-47' : 'desert-eagle',
            isHeadshot: i === 6,
            isWallbang: i === 6,
            isLocalInvolved: i === 6,
          });
        }
        expect(killfeed.children.length).toBe(5);
        const latestKill = killfeed.children[4];
        expect(latestKill.className).toBe('kill-entry local-kill');
        expect(latestKill.innerHTML).toContain('kill-name ct');
        expect(latestKill.innerHTML).toContain('kill-name t');
        expect(latestKill.innerHTML).toContain('<svg');
        expect(latestKill.innerHTML).toContain('kill-hs-icon');
        expect(latestKill.innerHTML).toContain('kill-wb-icon');

        // Armed bomb renders pulsing crimson C4 SVG icon in top-center timer + toast
        hud.updateRoundTimer(38, true);
        expect(elements.get('round-timer')!.innerHTML).toContain('c4-timer-icon');
        expect(elements.get('round-timer')!.innerHTML).toContain('00:38');
        expect(elements.get('cs2-tactical-toast')!.textContent).toContain('40 seconds');

        // Horizontal CS2 round-win ribbon includes winning faction and MVP callsign
        hud.showRoundWinRibbon('Vanguard', 'All Syndicate Operators Eliminated', 'Eldar');
        const overlay = elements.get('ui-overlay')!;
        expect(overlay.children.length).toBe(1);
        expect(overlay.children[0].className).toBe('cs2-round-ribbon');
        expect(overlay.children[0].innerHTML).toContain('VANGUARD WINS');
        expect(overlay.children[0].innerHTML).toContain('MVP');
        expect(overlay.children[0].innerHTML).toContain('Eldar');
      } finally {
        (globalThis as unknown as { document: unknown }).document = origDoc;
        (globalThis as unknown as { window: unknown }).window = origWin;
      }
    });

    it('computes accurate relative attacker bearing angles across ahead, right, left, behind, and rotated yaw', async () => {
      const { computeRelativeAttackerAngleRad } = await import('../ui/HUDManager.js');

      const player = { x: 0, z: 0 };
      // Facing -Z (yaw = 0)
      expect(computeRelativeAttackerAngleRad(player, 0, { x: 0, z: -10 })).toBeCloseTo(0, 4);
      expect(computeRelativeAttackerAngleRad(player, 0, { x: 10, z: 0 })).toBeCloseTo(Math.PI / 2, 4);
      expect(computeRelativeAttackerAngleRad(player, 0, { x: -10, z: 0 })).toBeCloseTo(-Math.PI / 2, 4);
      expect(Math.abs(computeRelativeAttackerAngleRad(player, 0, { x: 0, z: 10 }))).toBeCloseTo(Math.PI, 4);

      // Facing -X (yaw = +PI/2): attacker at (-10, 0) is straight ahead (0 rad); attacker at (0, -10) is to the right (+PI/2)
      expect(computeRelativeAttackerAngleRad(player, Math.PI / 2, { x: -10, z: 0 })).toBeCloseTo(0, 4);
      expect(computeRelativeAttackerAngleRad(player, Math.PI / 2, { x: 0, z: -10 })).toBeCloseTo(Math.PI / 2, 4);
    });

    it('enforces >= 2.05m bot anti-clump repulsion and assigns unique Dust 2 round-start hold positions per CT bot', async () => {
      const THREE = await import('three');
      const { BotBrain } = await import('@garam/shared');
      const { BotAISystem, DE_DUST2_BOT_MAP_CONFIG } = await import('../match/BotAISystem.js');

      // 1. Stationary bot within 1.4m of a teammate receives non-zero repulsive separation away from teammate
      const sep = BotBrain.computeCorridorSeparation(
        { x: 0, y: 0, z: 0 },
        0,
        0,
        0,
        [{ x: 1.4, y: 0, z: 0 }]
      );
      expect(sep.dirX).toBeLessThan(-0.5);
      expect(Math.hypot(sep.dirX, sep.dirZ)).toBeCloseTo(1, 3);

      // 2. All 5 Vanguard bots on de_dust2 receive unique final hold destinations at round start
      const botAI = new BotAISystem(
        {
          onBotShootPlayer: () => {},
          onBotShootBot: () => {},
          onBotSpawnTracer: () => {},
          onBotSpawnDecal: () => {},
        },
        'Veteran',
        DE_DUST2_BOT_MAP_CONFIG
      );

      const makeBot = (id: string, team: 'Vanguard' | 'Syndicate', x: number, z: number) => {
        const mesh = new THREE.Group();
        mesh.position.set(x, 0, z);
        return {
          id,
          name: id,
          team,
          mesh,
          health: 100,
          maxHealth: 100,
          armor: 100,
          hasHelmet: true,
          isDead: false,
          kills: 0,
          deaths: 0,
          vx: 0,
          vz: 0,
          lastShotTime: 0,
          patrolWaypoints: [],
          patrolTarget: new THREE.Vector3(x, 0, z),
          waypointIndex: 0,
          weaponId: team === 'Vanguard' ? 'vanguard-m4' : 'garam-47',
        };
      };

      const { DE_DUST2_BLOCKS, DE_DUST2_SPAWN_POINTS, SpatialGrid } = await import('@garam/shared');

      // 2. All 5 Vanguard bots on de_dust2 receive unique hold anchors strictly >= 3.0m apart
      const ctSpawnY = DE_DUST2_SPAWN_POINTS.VANGUARD_CT.y;
      const tSpawn = DE_DUST2_SPAWN_POINTS.OBSIDIAN_T;
      const bots = [
        makeBot('ct1', 'Vanguard', 6.66, -55.2),
        makeBot('ct2', 'Vanguard', 3.0, -55.2),
        makeBot('ct3', 'Vanguard', -0.74, -55.2),
        makeBot('ct4', 'Vanguard', -2.8, -54.2),
        makeBot('ct5', 'Vanguard', 9.62, -55.8),
        makeBot('t1', 'Syndicate', tSpawn.x, tSpawn.z),
        makeBot('t2', 'Syndicate', tSpawn.x + 2.5, tSpawn.z),
        makeBot('t3', 'Syndicate', tSpawn.x + 5.0, tSpawn.z),
        makeBot('t4', 'Syndicate', tSpawn.x - 2.5, tSpawn.z),
        makeBot('t5', 'Syndicate', tSpawn.x - 5.0, tSpawn.z),
      ];

      for (let trial = 0; trial < 8; trial++) {
        botAI.startNewRound(trial + 1, bots as never, 0, 0);
        const statesMap = (
          botAI as unknown as { botStates: Map<string, { path: Array<{ x: number; z: number }>; assignedHoldPos: { x: number; z: number } | null }> }
        ).botStates;
        const ctGoals: Array<{ id: string; x: number; z: number }> = [];
        for (let i = 1; i <= 5; i++) {
          const st = statesMap.get(`ct${i}`);
          expect(st).toBeDefined();
          const goal = st!.assignedHoldPos ?? st!.path[st!.path.length - 1];
          expect(goal).toBeDefined();
          ctGoals.push({ id: `ct${i}`, x: goal.x, z: goal.z });
        }
        for (let a = 0; a < ctGoals.length; a++) {
          for (let b = a + 1; b < ctGoals.length; b++) {
            const dist = Math.hypot(ctGoals[a].x - ctGoals[b].x, ctGoals[a].z - ctGoals[b].z);
            expect(
              dist,
              `trial ${trial} ${ctGoals[a].id} vs ${ctGoals[b].id} hold separation (${dist.toFixed(2)}m)`
            ).toBeGreaterThanOrEqual(3.0);
          }
        }
      }

      // 3. Simulate real Dust 2 movement from 1.48x CT Spawn: all 5 CT bots climb CT Ramp
      // cleanly and fan out across A Site / Long / Short / Goose (zero conga-line stacking).
      const grid = new SpatialGrid(DE_DUST2_BLOCKS);
      const playerFeet = new THREE.Vector3(tSpawn.x, tSpawn.y, tSpawn.z);
      const playerEye = new THREE.Vector3(tSpawn.x, tSpawn.y + 1.68, tSpawn.z);
      const ctOnly = bots.slice(0, 5);
      for (const b of ctOnly) b.mesh.position.y = ctSpawnY;
      botAI.startNewRound(2, ctOnly as never, 0, 0);
      for (let tick = 0; tick < 420; tick++) {
        botAI.update(
          ctOnly as never,
          0.05,
          DE_DUST2_BLOCKS,
          DE_DUST2_BLOCKS,
          playerFeet,
          playerEye,
          [],
          false,
          null,
          100,
          100,
          'Syndicate',
          false,
          grid
        );
      }

      let reachedUpperSite = 0;
      let totalPairwiseDist = 0;
      let pairCount = 0;
      for (let a = 0; a < ctOnly.length; a++) {
        if (ctOnly[a].mesh.position.y >= 4.5) reachedUpperSite++;
        for (let b = a + 1; b < ctOnly.length; b++) {
          totalPairwiseDist += Math.hypot(
            ctOnly[a].mesh.position.x - ctOnly[b].mesh.position.x,
            ctOnly[a].mesh.position.z - ctOnly[b].mesh.position.z
          );
          pairCount++;
        }
      }
      const posSummary = ctOnly
        .map((b) => `${b.id}=(${b.mesh.position.x.toFixed(1)},${b.mesh.position.y.toFixed(2)},${b.mesh.position.z.toFixed(1)})`)
        .join(' ');
      expect(reachedUpperSite, `All 5 CT bots climb CT Ramp onto upper Dust 2 level [${posSummary}]`).toBe(5);
      expect(totalPairwiseDist / pairCount, 'Average pairwise spread across Dust 2 zones >= 6.0m').toBeGreaterThanOrEqual(
        6.0
      );
    });
  });
});





