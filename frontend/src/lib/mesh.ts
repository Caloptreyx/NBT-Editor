import type { BlockState } from './chunk.ts';
import { type BlockKind, blockLook } from './blockColors.ts';

export const KIND_AIR = 0;
export const KIND_SOLID = 1;
export const KIND_CUTOUT = 2;
export const KIND_TRANSPARENT = 3;
export const KIND_LIQUID = 4;
export const KIND_PLANT = 5;

const KIND_CODES: Record<BlockKind, number> = {
  air: KIND_AIR,
  solid: KIND_SOLID,
  cutout: KIND_CUTOUT,
  transparent: KIND_TRANSPARENT,
  liquid: KIND_LIQUID,
  plant: KIND_PLANT,
};

/** Per palette id render attributes (colors as rgb byte triples). */
export interface LookTable {
  kinds: Uint8Array;
  top: Uint8Array;
  side: Uint8Array;
  alpha: Uint8Array;
}

export function buildLookTable(palette: readonly BlockState[]): LookTable {
  const n = palette.length;
  const table: LookTable = {
    kinds: new Uint8Array(n),
    top: new Uint8Array(n * 3),
    side: new Uint8Array(n * 3),
    alpha: new Uint8Array(n),
  };
  palette.forEach((state, id) => {
    const look = blockLook(state.name);
    const side = look.side ?? look.color;
    table.kinds[id] = id === 0 ? KIND_AIR : KIND_CODES[look.kind];
    table.top.set(look.color, id * 3);
    table.side.set(side, id * 3);
    const alpha = look.alpha ?? (look.kind === 'transparent' ? 0.45 : look.kind === 'liquid' ? 0.6 : 1);
    table.alpha[id] = Math.round(alpha * 255);
  });
  return table;
}

export interface MeshGrid {
  ids: Uint16Array;
  sizeX: number;
  sizeZ: number;
  height: number;
}

/**
 * Interleaved vertex layout, 24 bytes:
 * 0 f32x3 position (grid-relative) | 12 u8 u, v (0..16 texel units), shade (0..255), flags (1 cutout, 2 plant)
 * 16 u8x4 rgba | 20 u32 texture seed. Four vertices per quad, triangles (0,1,2) (0,2,3).
 */
export const VERTEX_STRIDE = 24;
export const BYTES_PER_QUAD = VERTEX_STRIDE * 4;
export const FLAG_CUTOUT = 1;
export const FLAG_PLANT = 2;

export interface SectionMesh {
  opaque: Uint8Array; // solid, cutout and plant geometry
  translucent: Uint8Array; // transparent and liquid geometry, drawn with blending after the opaque pass
}

class QuadWriter {
  bytes = new Uint8Array(BYTES_PER_QUAD * 1024);
  f32 = new Float32Array(this.bytes.buffer);
  u32 = new Uint32Array(this.bytes.buffer);
  length = 0;

  reserve(quads: number) {
    const needed = this.length + quads * BYTES_PER_QUAD;
    if (needed <= this.bytes.length) return;
    const next = new Uint8Array(Math.max(needed, this.bytes.length * 2));
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
    this.f32 = new Float32Array(next.buffer);
    this.u32 = new Uint32Array(next.buffer);
  }

  vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    shade: number,
    flags: number,
    color: Uint8Array,
    colorOffset: number,
    alpha: number,
    seed: number,
  ) {
    const o = this.length;
    const w = o >> 2;
    this.f32[w] = x;
    this.f32[w + 1] = y;
    this.f32[w + 2] = z;
    const b = this.bytes;
    b[o + 12] = u;
    b[o + 13] = v;
    b[o + 14] = shade;
    b[o + 15] = flags;
    b[o + 16] = color[colorOffset];
    b[o + 17] = color[colorOffset + 1];
    b[o + 18] = color[colorOffset + 2];
    b[o + 19] = alpha;
    this.u32[w + 5] = seed;
    this.length = o + VERTEX_STRIDE;
  }

  take(): Uint8Array {
    const out = this.bytes.slice(0, this.length);
    this.length = 0;
    return out;
  }
}

// Faces: +X, -X, +Y, -Y, +Z, -Z. Corners are counter-clockwise seen from outside.
const FACE_CORNERS = [
  [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0],
];
export const FACE_NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const FACE_SHADE = [204, 204, 255, 128, 153, 153];
const FACE_U_AXIS = [2, 2, 0, 0, 0, 0];
const FACE_V_AXIS = [1, 1, 2, 2, 1, 1];
const LIQUID_TOP = 0.875;
const PLANT_SHADE = 230;
const PLANT_INSET = 0.15;

const opaqueWriter = new QuadWriter();
const translucentWriter = new QuadWriter();

/** Deterministic per-block texture seed from absolute block coordinates. */
export function blockSeed(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Whether a face of block `id` (kind `kind`) is visible against neighbour `nid` (kind `nkind`, 0 when cut away). */
function faceVisible(kind: number, id: number, nkind: number, nid: number): boolean {
  switch (nkind) {
    case KIND_SOLID:
      return false;
    case KIND_CUTOUT:
    case KIND_TRANSPARENT:
    case KIND_LIQUID:
      return !(kind === nkind && id === nid);
    default:
      return true;
  }
}

/**
 * Builds the faces of one 16x16x16 section of the grid. Blocks with y outside [sliceMin, sliceMax] (grid-relative,
 * inclusive) are skipped and treated as air by their neighbours, so the cut plane shows closed faces.
 * `origin` is the absolute coordinate of grid cell 0,0,0 and only feeds the texture seed.
 */
export function meshSection(
  grid: MeshGrid,
  looks: LookTable,
  sliceMin: number,
  sliceMax: number,
  sx: number,
  sy: number,
  sz: number,
  origin: readonly [number, number, number],
): SectionMesh {
  const { ids, sizeX, sizeZ, height } = grid;
  const { kinds, top, side, alpha } = looks;
  const layer = sizeX * sizeZ;
  const x0 = sx * 16;
  const z0 = sz * 16;
  const y0 = Math.max(sy * 16, sliceMin, 0);
  const y1 = Math.min(sy * 16 + 15, sliceMax, height - 1);
  const x1 = Math.min(x0 + 16, sizeX);
  const z1 = Math.min(z0 + 16, sizeZ);

  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z < z1; z++) {
      let i = (y * sizeZ + z) * sizeX + x0;
      for (let x = x0; x < x1; x++, i++) {
        const id = ids[i];
        const kind = kinds[id];
        if (kind === KIND_AIR) continue;
        const seed = blockSeed(x + origin[0], y + origin[1], z + origin[2]);

        if (kind === KIND_PLANT) {
          opaqueWriter.reserve(4);
          const lo = PLANT_INSET;
          const hi = 1 - PLANT_INSET;
          const c = id * 3;
          for (let diagonal = 0; diagonal < 2; diagonal++) {
            const faceSeed = (seed + diagonal * 0x9e3779b9) >>> 0;
            const ax = x + (diagonal ? hi : lo);
            const bx = x + (diagonal ? lo : hi);
            for (let back = 0; back < 2; back++) {
              const fx = back ? bx : ax;
              const fz = z + (back ? hi : lo);
              const tx = back ? ax : bx;
              const tz = z + (back ? lo : hi);
              opaqueWriter.vertex(fx, y, fz, 0, 0, PLANT_SHADE, FLAG_PLANT, side, c, 255, faceSeed);
              opaqueWriter.vertex(tx, y, tz, 16, 0, PLANT_SHADE, FLAG_PLANT, side, c, 255, faceSeed);
              opaqueWriter.vertex(tx, y + 1, tz, 16, 16, PLANT_SHADE, FLAG_PLANT, side, c, 255, faceSeed);
              opaqueWriter.vertex(fx, y + 1, fz, 0, 16, PLANT_SHADE, FLAG_PLANT, side, c, 255, faceSeed);
            }
          }
          continue;
        }

        const translucent = kind === KIND_TRANSPARENT || kind === KIND_LIQUID;
        const writer = translucent ? translucentWriter : opaqueWriter;
        const a = translucent ? alpha[id] : 255;
        const flags = kind === KIND_CUTOUT ? FLAG_CUTOUT : 0;
        const aboveSame = y < sliceMax && y + 1 < height && ids[i + layer] === id;
        const lowered = kind === KIND_LIQUID && !aboveSame;
        writer.reserve(6);

        for (let face = 0; face < 6; face++) {
          let nkind = KIND_AIR;
          let nid = 0;
          switch (face) {
            case 0:
              if (x + 1 < sizeX) nid = ids[i + 1];
              break;
            case 1:
              if (x > 0) nid = ids[i - 1];
              break;
            case 2:
              if (y < sliceMax && y + 1 < height) nid = ids[i + layer];
              break;
            case 3:
              if (y > sliceMin && y > 0) nid = ids[i - layer];
              break;
            case 4:
              if (z + 1 < sizeZ) nid = ids[i + sizeX];
              break;
            default:
              if (z > 0) nid = ids[i - sizeX];
          }
          nkind = kinds[nid];
          if (!(face === 2 && lowered) && !faceVisible(kind, id, nkind, nid)) continue;

          const corners = FACE_CORNERS[face];
          const shade = FACE_SHADE[face];
          const color = face === 2 ? top : side;
          const uAxis = FACE_U_AXIS[face];
          const vAxis = FACE_V_AXIS[face];
          const faceSeed = (seed + face * 0x9e3779b9) >>> 0;
          for (let c = 0; c < 12; c += 3) {
            const cy = lowered && corners[c + 1] === 1 ? LIQUID_TOP : corners[c + 1];
            const u = (uAxis === 1 ? cy : corners[c + uAxis]) * 16;
            const v = (vAxis === 1 ? cy : corners[c + vAxis]) * 16;
            writer.vertex(x + corners[c], y + cy, z + corners[c + 2], u, v, shade, flags, color, id * 3, a, faceSeed);
          }
        }
      }
    }
  }
  return { opaque: opaqueWriter.take(), translucent: translucentWriter.take() };
}

/** Grid-relative bounds [min, max) of every non-air cell, or null when the grid holds no visible blocks. */
export function contentBounds(
  grid: MeshGrid,
  looks: LookTable,
): { min: [number, number, number]; max: [number, number, number] } | null {
  const { ids, sizeX, sizeZ, height } = grid;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++, i++) {
        if (looks.kinds[ids[i]] === KIND_AIR) continue;
        if (x < min[0]) min[0] = x;
        if (x + 1 > max[0]) max[0] = x + 1;
        if (y < min[1]) min[1] = y;
        if (y + 1 > max[1]) max[1] = y + 1;
        if (z < min[2]) min[2] = z;
        if (z + 1 > max[2]) max[2] = z + 1;
      }
    }
  }
  return min[0] === Infinity ? null : { min, max };
}
