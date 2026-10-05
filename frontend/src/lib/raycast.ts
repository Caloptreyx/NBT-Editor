import { KIND_AIR } from './mesh.ts';
import type { Volume } from './volume.ts';

export interface GridHit {
  x: number;
  y: number;
  z: number;
  normal: [number, number, number]; // face that was entered; all zero when the ray starts inside the hit cell
  distance: number;
}

/**
 * Amanatides-Woo traversal of the grid [0,sizeX) x [0,sizeY) x [0,sizeZ) (grid-relative coordinates), returning the
 * first cell for which `solid` is true within `maxDistance` along the normalized direction.
 */
export function raycastGrid(
  size: readonly [number, number, number],
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  solid: (x: number, y: number, z: number) => boolean,
  maxDistance = Infinity,
): GridHit | null {
  let tEnter = 0;
  let tExit = maxDistance;
  let enterAxis = -1;
  for (let axis = 0; axis < 3; axis++) {
    const d = dir[axis];
    const o = origin[axis];
    if (d === 0) {
      if (o < 0 || o >= size[axis]) return null;
      continue;
    }
    let t0 = (0 - o) / d;
    let t1 = (size[axis] - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tEnter) {
      tEnter = t0;
      enterAxis = axis;
    }
    tExit = Math.min(tExit, t1);
    if (tEnter > tExit) return null;
  }

  const cell = [0, 0, 0];
  const step = [0, 0, 0];
  const tMax = [Infinity, Infinity, Infinity];
  const tDelta = [Infinity, Infinity, Infinity];
  for (let axis = 0; axis < 3; axis++) {
    const d = dir[axis];
    const p = origin[axis] + d * tEnter;
    let c = Math.floor(p);
    // Entering through a max face lands exactly on the boundary; that cell belongs to the grid's last slab.
    if (axis === enterAxis) c = d > 0 ? 0 : size[axis] - 1;
    cell[axis] = Math.max(0, Math.min(size[axis] - 1, c));
    if (d > 0) {
      step[axis] = 1;
      tMax[axis] = tEnter + (cell[axis] + 1 - p) / d;
      tDelta[axis] = 1 / d;
    } else if (d < 0) {
      step[axis] = -1;
      tMax[axis] = tEnter + (cell[axis] - p) / d;
      tDelta[axis] = -1 / d;
    }
  }

  const normal: [number, number, number] = [0, 0, 0];
  if (enterAxis >= 0) normal[enterAxis] = -step[enterAxis];
  let t = tEnter;
  for (;;) {
    if (solid(cell[0], cell[1], cell[2])) {
      return { x: cell[0], y: cell[1], z: cell[2], normal: [normal[0], normal[1], normal[2]], distance: t };
    }
    const axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[axis];
    if (t > tExit) return null;
    cell[axis] += step[axis];
    if (cell[axis] < 0 || cell[axis] >= size[axis]) return null;
    tMax[axis] += tDelta[axis];
    normal[0] = 0;
    normal[1] = 0;
    normal[2] = 0;
    normal[axis] = -step[axis];
  }
}

export interface BlockHit {
  x: number;
  y: number;
  z: number; // absolute block coordinates
  normal: [number, number, number];
  distance: number;
}

/**
 * First visible block along a ray in absolute world coordinates. `kinds` maps palette ids to mesh kind codes; blocks
 * outside [sliceMinY, sliceMaxY] (absolute, inclusive) are ignored like the renderer hides them.
 */
export function pickBlock(
  v: Volume,
  kinds: Uint8Array,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  sliceMinY: number,
  sliceMaxY: number,
  maxDistance = Infinity,
): BlockHit | null {
  const minY = sliceMinY - v.minY;
  const maxY = sliceMaxY - v.minY;
  const { ids, sizeX, sizeZ } = v;
  const hit = raycastGrid(
    [sizeX, v.height, sizeZ],
    [origin[0] - v.originX, origin[1] - v.minY, origin[2] - v.originZ],
    dir,
    (x, y, z) => y >= minY && y <= maxY && kinds[ids[(y * sizeZ + z) * sizeX + x]] !== KIND_AIR,
    maxDistance,
  );
  if (!hit) return null;
  return {
    x: hit.x + v.originX,
    y: hit.y + v.minY,
    z: hit.z + v.originZ,
    normal: hit.normal,
    distance: hit.distance,
  };
}
