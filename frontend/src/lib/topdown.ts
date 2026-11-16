import type { ChunkModel } from './chunk.ts';
import { type BlockLook, blockLook } from './blockColors.ts';

const COLUMNS = 256;
const SEARCHING = 0;
const UNDER_LIQUID = 1;
const DONE = 2;
/** Liquids get more opaque with depth up to this opacity, so the floor stays faintly visible. */
const MAX_LIQUID_OPACITY = 0.92;
const LIQUID_OPACITY_PER_BLOCK = 0.05;
/** Brightness change per block of height difference to the northern neighbour, clamped to +-3 blocks. */
const SHADE_PER_BLOCK = 0.05;

/**
 * RGBA 16x16 image (row = z, column = x, north up) of the highest visible block per column at y <= maxY. Liquids are
 * blended over the first solid block below them; columns are shaded by their height difference to the column north.
 * Columns without blocks stay transparent.
 */
export function renderChunkTopDown(model: ChunkModel, maxY?: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(COLUMNS * 4);
  const top = Math.min(maxY ?? model.maxY, model.maxY);
  const state = new Uint8Array(COLUMNS);
  const surfaceY = new Int32Array(COLUMNS);
  const surface: (BlockLook | null)[] = Array.from({ length: COLUMNS }, () => null);
  const floorY = new Int32Array(COLUMNS);
  const floor: (BlockLook | null)[] = Array.from({ length: COLUMNS }, () => null);
  let pending = COLUMNS;

  const sections = [...model.sections.values()].sort((a, b) => b.y - a.y);
  for (const section of sections) {
    if (pending === 0) break;
    const baseY = section.y * 16;
    if (baseY > top) continue;
    const looks = section.palette.map((entry) => {
      const look = blockLook(entry.name);
      return look.kind === 'air' ? null : look;
    });
    if (looks.every((look) => look === null)) continue;
    const data = section.data;
    for (let ly = Math.min(15, top - baseY); ly >= 0 && pending > 0; ly--) {
      const row = ly * COLUMNS;
      for (let column = 0; column < COLUMNS; column++) {
        const columnState = state[column];
        if (columnState === DONE) continue;
        const look = looks[data ? data[row + column] : 0];
        if (!look) continue;
        if (columnState === SEARCHING) {
          surface[column] = look;
          surfaceY[column] = baseY + ly;
          if (look.kind === 'liquid') {
            state[column] = UNDER_LIQUID;
            continue;
          }
        } else if (look.kind === 'liquid') {
          continue;
        } else {
          floor[column] = look;
          floorY[column] = baseY + ly;
        }
        state[column] = DONE;
        pending--;
      }
    }
  }

  for (let column = 0; column < COLUMNS; column++) {
    const look = surface[column];
    if (!look) continue;
    let [r, g, b] = look.color;
    const under = floor[column];
    if (under) {
      const depth = surfaceY[column] - floorY[column];
      const opacity = Math.min(MAX_LIQUID_OPACITY, (look.alpha ?? 0.6) + (depth - 1) * LIQUID_OPACITY_PER_BLOCK);
      r = r * opacity + under.color[0] * (1 - opacity);
      g = g * opacity + under.color[1] * (1 - opacity);
      b = b * opacity + under.color[2] * (1 - opacity);
    }
    const north = column - 16;
    if (north >= 0 && surface[north]) {
      const delta = Math.max(-3, Math.min(3, surfaceY[column] - surfaceY[north]));
      const shade = 1 + delta * SHADE_PER_BLOCK;
      r *= shade;
      g *= shade;
      b *= shade;
    }
    const offset = column * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = 255;
  }
  return pixels;
}
