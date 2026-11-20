import { describe, it, expect } from 'vitest';
import {
  KinematicPlayerController,
  SPAWN_ZONES,
  ECONOMY,
  KINEMATICS,
} from '@garam/shared';
import { computeRadarRotationRad } from '../ui/RadarRenderer.js';
import { stepMolotovBurnAccumulator } from '../utility/UtilityManager.js';
import { EconomyManager } from '../match/EconomyManager.js';
import { reconcilePredictedState, UnackInput } from '../net/NetworkClient.js';

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
  });
});
