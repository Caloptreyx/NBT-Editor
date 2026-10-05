import { AIR, type BlockState, blockStateKey, type ChunkModel, setBlock } from './chunk.ts';

export interface Volume {
  chunks: ChunkModel[];
  originX: number;
  originZ: number;
  sizeX: number;
  sizeZ: number;
  minY: number;
  height: number;
  palette: BlockState[];
  ids: Uint16Array; // ids[((y-minY)*sizeZ + (z-originZ))*sizeX + (x-originX)], 0 = air (palette[0] = AIR)
}

export const SECTION_SIZE = 16;

interface VolumeIndex {
  stateIds: Map<string, number>;
  chunkByKey: Map<string, ChunkModel>;
  sectionVersions: Uint32Array;
}

const indexes = new WeakMap<Volume, VolumeIndex>();

/** Section grid dimensions of a volume (16x16x16 cells; the top row may be partial). */
export function volumeSectionCounts(v: Volume): { x: number; y: number; z: number } {
  return { x: v.sizeX / SECTION_SIZE, y: Math.ceil(v.height / SECTION_SIZE), z: v.sizeZ / SECTION_SIZE };
}

/**
 * Per-section change counters, indexed `(sy * countZ + sz) * countX + sx`. setVolumeBlock bumps the section of the
 * changed block and every face-adjacent section that borders it, so a renderer can remesh only what changed.
 */
export function volumeSectionVersions(v: Volume): Uint32Array {
  return indexOf(v).sectionVersions;
}

function indexOf(v: Volume): VolumeIndex {
  let index = indexes.get(v);
  if (!index) {
    const stateIds = new Map<string, number>();
    v.palette.forEach((state, i) => {
      const key = blockStateKey(state);
      if (!stateIds.has(key)) stateIds.set(key, i);
    });
    const chunkByKey = new Map<string, ChunkModel>();
    for (const model of v.chunks) chunkByKey.set(`${model.x},${model.z}`, model);
    const counts = volumeSectionCounts(v);
    index = { stateIds, chunkByKey, sectionVersions: new Uint32Array(counts.x * counts.y * counts.z) };
    indexes.set(v, index);
  }
  return index;
}

function stateId(v: Volume, index: VolumeIndex, state: BlockState): number {
  const key = blockStateKey(state);
  let id = index.stateIds.get(key);
  if (id === undefined) {
    if (v.palette.length >= 0xffff) throw new RangeError('Too many distinct block states in the volume');
    id = v.palette.length;
    v.palette.push(state);
    index.stateIds.set(key, id);
  }
  return id;
}

/** Copies the blocks of the given chunks into one dense grid covering their bounding box; gaps between chunks are air. */
export function buildVolume(models: ChunkModel[]): Volume {
  if (models.length === 0) {
    return {
      chunks: [],
      originX: 0,
      originZ: 0,
      sizeX: 0,
      sizeZ: 0,
      minY: 0,
      height: 0,
      palette: [AIR],
      ids: new Uint16Array(0),
    };
  }
  let minCx = Infinity;
  let minCz = Infinity;
  let maxCx = -Infinity;
  let maxCz = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const model of models) {
    minCx = Math.min(minCx, model.x);
    maxCx = Math.max(maxCx, model.x);
    minCz = Math.min(minCz, model.z);
    maxCz = Math.max(maxCz, model.z);
    minY = Math.min(minY, model.minY);
    maxY = Math.max(maxY, model.maxY);
  }
  const sizeX = (maxCx - minCx + 1) * 16;
  const sizeZ = (maxCz - minCz + 1) * 16;
  const height = maxY - minY + 1;
  const v: Volume = {
    chunks: models,
    originX: minCx * 16,
    originZ: minCz * 16,
    sizeX,
    sizeZ,
    minY,
    height,
    palette: [AIR],
    ids: new Uint16Array(sizeX * sizeZ * height),
  };
  const index = indexOf(v);
  const layer = sizeX * sizeZ;

  for (const model of models) {
    const baseX = model.x * 16 - v.originX;
    const baseZ = model.z * 16 - v.originZ;
    for (const section of model.sections.values()) {
      const fromY = Math.max(section.y * 16, model.minY);
      const toY = Math.min(section.y * 16 + 15, model.maxY);
      if (fromY > toY || section.palette.length === 0) continue;
      const remap = section.palette.map((state) => stateId(v, index, state));
      const data = section.data;
      for (let y = fromY; y <= toY; y++) {
        const localY = y - section.y * 16;
        const rowBase = (y - minY) * layer;
        for (let z = 0; z < 16; z++) {
          const dst = rowBase + (baseZ + z) * sizeX + baseX;
          if (!data) {
            v.ids.fill(remap[0], dst, dst + 16);
            continue;
          }
          const src = (localY * 16 + z) * 16;
          for (let x = 0; x < 16; x++) v.ids[dst + x] = remap[data[src + x]] ?? 0;
        }
      }
    }
  }
  return v;
}

function cellIndex(v: Volume, x: number, y: number, z: number): number {
  const rx = x - v.originX;
  const ry = y - v.minY;
  const rz = z - v.originZ;
  if (rx < 0 || rz < 0 || ry < 0 || rx >= v.sizeX || rz >= v.sizeZ || ry >= v.height) return -1;
  return (ry * v.sizeZ + rz) * v.sizeX + rx;
}

/** Block at absolute coordinates; air outside the volume. */
export function volumeBlock(v: Volume, x: number, y: number, z: number): BlockState {
  const i = cellIndex(v, x, y, z);
  return i < 0 ? AIR : (v.palette[v.ids[i]] ?? AIR);
}

/** Sets a block in the owning ChunkModel (via setBlock) and mirrors it into the grid. False when not editable. */
export function setVolumeBlock(v: Volume, x: number, y: number, z: number, state: BlockState): boolean {
  const i = cellIndex(v, x, y, z);
  if (i < 0) return false;
  const index = indexOf(v);
  const model = index.chunkByKey.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
  if (!model || !setBlock(model, x & 15, y, z & 15, state)) return false;
  v.ids[i] = stateId(v, index, state);

  const counts = volumeSectionCounts(v);
  const rx = x - v.originX;
  const ry = y - v.minY;
  const rz = z - v.originZ;
  const sx = rx >> 4;
  const sy = ry >> 4;
  const sz = rz >> 4;
  const bump = (bx: number, by: number, bz: number) => {
    if (bx < 0 || by < 0 || bz < 0 || bx >= counts.x || by >= counts.y || bz >= counts.z) return;
    index.sectionVersions[(by * counts.z + bz) * counts.x + bx]++;
  };
  bump(sx, sy, sz);
  if ((rx & 15) === 0) bump(sx - 1, sy, sz);
  if ((rx & 15) === 15) bump(sx + 1, sy, sz);
  if ((ry & 15) === 0) bump(sx, sy - 1, sz);
  if ((ry & 15) === 15) bump(sx, sy + 1, sz);
  if ((rz & 15) === 0) bump(sx, sy, sz - 1);
  if ((rz & 15) === 15) bump(sx, sy, sz + 1);
  return true;
}

/**
 * Positions (absolute, ordered by y, z, x) of blocks whose id or state key contains the query, case-insensitive.
 * "minecraft:" is optional; palette slot 0 (air) is never matched.
 */
export function findInVolume(v: Volume, query: string): { x: number; y: number; z: number }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches = new Uint8Array(v.palette.length);
  let any = false;
  for (let id = 1; id < v.palette.length; id++) {
    const state = v.palette[id];
    if (state.name.toLowerCase().includes(needle) || blockStateKey(state).toLowerCase().includes(needle)) {
      matches[id] = 1;
      any = true;
    }
  }
  const result: { x: number; y: number; z: number }[] = [];
  if (!any) return result;
  const { ids, sizeX, sizeZ } = v;
  for (let i = 0; i < ids.length; i++) {
    if (!matches[ids[i]]) continue;
    const x = i % sizeX;
    const rest = (i - x) / sizeX;
    const z = rest % sizeZ;
    const y = (rest - z) / sizeZ;
    result.push({ x: x + v.originX, y: y + v.minY, z: z + v.originZ });
  }
  return result;
}
