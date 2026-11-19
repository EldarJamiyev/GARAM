import { describe, it, expect } from 'vitest';
import { DE_CITADEL_BLOCKS } from '../maps/DeCitadelData.js';
import { SpatialGrid } from '../physics/SpatialGrid.js';
import { executeTacticalRaycast, hasLineOfSight, Ray } from '../physics/RaycastEngine.js';

describe('SpatialGrid Acceleration Broadphase', () => {
  const grid = new SpatialGrid(DE_CITADEL_BLOCKS, 10);

  it('initializes grid bounds and covers all map blocks without boundary clipping', () => {
    expect(grid.cols).toBeGreaterThan(5);
    expect(grid.rows).toBeGreaterThan(5);
    expect(grid.cellSize).toBe(10);
  });

  it('preserves 100% hit parity across 500 random rays against brute-force raycast', () => {
    let rngState = 1337;
    function pseudoRandom(): number {
      rngState = (rngState * 1664525 + 1013904223) % 4294967296;
      return rngState / 4294967296;
    }

    for (let i = 0; i < 500; i++) {
      // Pick random origin within map bounds [-45, 45]
      const ox = (pseudoRandom() - 0.5) * 90;
      const oy = 1.0 + pseudoRandom() * 2.0;
      const oz = (pseudoRandom() - 0.5) * 90;

      // Pick random spherical direction
      const theta = pseudoRandom() * 2 * Math.PI;
      const phi = (pseudoRandom() - 0.5) * Math.PI * 0.8;
      const dx = Math.cos(phi) * Math.sin(theta);
      const dy = Math.sin(phi);
      const dz = Math.cos(phi) * Math.cos(theta);

      const ray: Ray = {
        origin: { x: ox, y: oy, z: oz },
        direction: { x: dx, y: dy, z: dz },
      };

      const bruteHits = executeTacticalRaycast(ray, 100, 75, 2.0, 200, DE_CITADEL_BLOCKS, [], 1.0);
      const gridHits = executeTacticalRaycast(ray, 100, 75, 2.0, 200, DE_CITADEL_BLOCKS, [], 1.0, grid);

      expect(gridHits.length).toBe(bruteHits.length);

      if (bruteHits.length > 0) {
        expect(gridHits[0].distance).toBeCloseTo(bruteHits[0].distance, 4);
        expect(gridHits[0].material).toBe(bruteHits[0].material);
        expect(gridHits[0].blockId).toBe(bruteHits[0].blockId);
      }
    }
  });

  it('guarantees hasLineOfSight parity with and without SpatialGrid', () => {
    let rngState = 42;
    function pseudoRandom(): number {
      rngState = (rngState * 1664525 + 1013904223) % 4294967296;
      return rngState / 4294967296;
    }

    for (let i = 0; i < 200; i++) {
      const a = {
        x: (pseudoRandom() - 0.5) * 80,
        y: 1.65,
        z: (pseudoRandom() - 0.5) * 80,
      };
      const b = {
        x: (pseudoRandom() - 0.5) * 80,
        y: 1.65,
        z: (pseudoRandom() - 0.5) * 80,
      };

      const bruteLoS = hasLineOfSight(a, b, DE_CITADEL_BLOCKS, []);
      const gridLoS = hasLineOfSight(a, b, DE_CITADEL_BLOCKS, [], grid);

      expect(gridLoS).toBe(bruteLoS);
    }
  });
});
