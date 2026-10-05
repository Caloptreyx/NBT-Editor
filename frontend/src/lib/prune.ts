import type { ChunkSummary } from './chunk.ts';

export interface PruneRadius {
  /** Block coordinates. */
  centerX: number;
  centerZ: number;
  /** Blocks; a block at exactly this distance is inside. */
  radius: number;
  shape: 'square' | 'circle';
}

export interface PruneCriteria {
  /** Matches chunks with InhabitedTime < value (ticks). */
  inhabitedBelowTicks: number | null;
  /** Matches chunks whose generation status is set and not complete. */
  unfinishedOnly: boolean;
  /** Matches chunks lying entirely outside the area. */
  outsideRadius: PruneRadius | null;
}

/**
 * Statuses of fully generated chunks: `full` (1.14+, also namespaced), and `postprocessed`/`fullchunk` of 1.13, which
 * the game's own upgrade maps to `full`.
 */
const COMPLETE_STATUSES = new Set(['full', 'postprocessed', 'fullchunk']);

export function hasCriteria(c: PruneCriteria): boolean {
  return c.inhabitedBelowTicks !== null || c.unfinishedOnly || c.outsideRadius !== null;
}

/** Whether no block of the area [minX..maxX] x [minZ..maxZ] (inclusive) lies within the radius. */
const areaOutside = (minX: number, minZ: number, maxX: number, maxZ: number, area: PruneRadius): boolean => {
  const { centerX, centerZ, radius } = area;
  // An invalid area matches nothing, so a typo can never select the whole world.
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ) || !Number.isFinite(radius) || radius < 0) return false;
  const dx = Math.min(Math.max(centerX, minX), maxX) - centerX;
  const dz = Math.min(Math.max(centerZ, minZ), maxZ) - centerZ;
  if (area.shape === 'square') return Math.max(Math.abs(dx), Math.abs(dz)) > radius;
  return dx * dx + dz * dz > radius * radius;
};

/** AND of the enabled criteria; false when none is enabled. */
export function matchesPrune(summary: ChunkSummary, c: PruneCriteria): boolean {
  if (!hasCriteria(c)) return false;
  if (c.inhabitedBelowTicks !== null && !(Number(summary.inhabitedTime) < c.inhabitedBelowTicks)) return false;
  if (c.unfinishedOnly) {
    if (summary.status === null) return false;
    const status = summary.status.startsWith('minecraft:') ? summary.status.slice('minecraft:'.length) : summary.status;
    if (COMPLETE_STATUSES.has(status)) return false;
  }
  if (c.outsideRadius) {
    const minX = summary.x * 16;
    const minZ = summary.z * 16;
    if (!areaOutside(minX, minZ, minX + 15, minZ + 15, c.outsideRadius)) return false;
  }
  return true;
}

/**
 * True when outsideRadius is the only criterion and the whole region lies outside it, so every chunk of the region
 * matches and the region can be pruned without reading its chunks.
 */
export function regionEntirelyOutside(rx: number, rz: number, c: PruneCriteria): boolean {
  if (!c.outsideRadius || c.inhabitedBelowTicks !== null || c.unfinishedOnly) return false;
  const minX = rx * 512;
  const minZ = rz * 512;
  return areaOutside(minX, minZ, minX + 511, minZ + 511, c.outsideRadius);
}
