import { MapBlockCollider, Vec3 } from '../maps/DeCitadelData.js';
import { Ray } from './RaycastEngine.js';

export class SpatialGrid {
  public readonly cellSize: number;
  public readonly minX: number;
  public readonly minZ: number;
  public readonly cols: number;
  public readonly rows: number;
  private cells: number[][];
  private visitedStamp: Int32Array;
  private currentRayId = 0;

  constructor(blocks: MapBlockCollider[], cellSize = 10, boundsMargin = 10) {
    this.cellSize = cellSize;

    let bMinX = -60;
    let bMaxX = 60;
    let bMinZ = -60;
    let bMaxZ = 60;

    for (const b of blocks) {
      if (b.minX < bMinX) bMinX = b.minX;
      if (b.maxX > bMaxX) bMaxX = b.maxX;
      if (b.minZ < bMinZ) bMinZ = b.minZ;
      if (b.maxZ > bMaxZ) bMaxZ = b.maxZ;
    }

    this.minX = Math.floor(bMinX - boundsMargin);
    this.minZ = Math.floor(bMinZ - boundsMargin);
    const maxX = Math.ceil(bMaxX + boundsMargin);
    const maxZ = Math.ceil(bMaxZ + boundsMargin);

    this.cols = Math.ceil((maxX - this.minX) / cellSize);
    this.rows = Math.ceil((maxZ - this.minZ) / cellSize);

    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.visitedStamp = new Int32Array(blocks.length);

    // Populate cells with block indices
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const startCol = Math.max(0, Math.floor((b.minX - this.minX) / cellSize));
      const endCol = Math.min(this.cols - 1, Math.floor((b.maxX - this.minX) / cellSize));
      const startRow = Math.max(0, Math.floor((b.minZ - this.minZ) / cellSize));
      const endRow = Math.min(this.rows - 1, Math.floor((b.maxZ - this.minZ) / cellSize));

      for (let c = startCol; c <= endCol; c++) {
        for (let r = startRow; r <= endRow; r++) {
          this.cells[r * this.cols + c].push(i);
        }
      }
    }
  }

  /**
   * Traverses the grid along the 2D projected ray using Amanatides & Woo DDA.
   * Calls onBlock(blockIndex) for each unique candidate block along the ray.
   */
  public queryRay(ray: Ray, maxDist: number, onBlock: (blockIndex: number) => boolean | void): void {
    this.currentRayId++;
    if (this.currentRayId >= 2147483640) {
      this.visitedStamp.fill(0);
      this.currentRayId = 1;
    }
    const rayId = this.currentRayId;

    const ox = ray.origin.x;
    const oz = ray.origin.z;
    const dx = ray.direction.x;
    const dz = ray.direction.z;

    let col = Math.floor((ox - this.minX) / this.cellSize);
    let row = Math.floor((oz - this.minZ) / this.cellSize);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const invDx = Math.abs(dx) > 1e-8 ? 1.0 / Math.abs(dx) : 1e8;
    const invDz = Math.abs(dz) > 1e-8 ? 1.0 / Math.abs(dz) : 1e8;

    const tDeltaX = this.cellSize * invDx;
    const tDeltaZ = this.cellSize * invDz;

    let tMaxX: number;
    let tMaxZ: number;

    if (stepX > 0) {
      tMaxX = (this.minX + (col + 1) * this.cellSize - ox) * invDx;
    } else if (stepX < 0) {
      tMaxX = (ox - (this.minX + col * this.cellSize)) * invDx;
    } else {
      tMaxX = Infinity;
    }

    if (stepZ > 0) {
      tMaxZ = (this.minZ + (row + 1) * this.cellSize - oz) * invDz;
    } else if (stepZ < 0) {
      tMaxZ = (oz - (this.minZ + row * this.cellSize)) * invDz;
    } else {
      tMaxZ = Infinity;
    }

    let t = 0;

    while (t <= maxDist) {
      if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
        const cellBlocks = this.cells[row * this.cols + col];
        for (let i = 0; i < cellBlocks.length; i++) {
          const bIdx = cellBlocks[i];
          if (this.visitedStamp[bIdx] !== rayId) {
            this.visitedStamp[bIdx] = rayId;
            const stop = onBlock(bIdx);
            if (stop === true) return;
          }
        }
      }

      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        col += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        row += stepZ;
      }

      // If out of bounds and moving further away, break
      if ((col < 0 && stepX <= 0) || (col >= this.cols && stepX >= 0) ||
          (row < 0 && stepZ <= 0) || (row >= this.rows && stepZ >= 0)) {
        break;
      }
    }
  }

  /**
   * Retrieves candidate blocks along a ray, maintaining zero Set allocations.
   */
  public getCandidateBlocks(ray: Ray, maxDist: number, blocks: MapBlockCollider[]): MapBlockCollider[] {
    const candidates: MapBlockCollider[] = [];
    this.queryRay(ray, maxDist, (idx) => {
      candidates.push(blocks[idx]);
    });
    return candidates;
  }
}
