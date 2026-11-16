import type { ChunkModel } from '../../lib/chunk.ts';
import type { CompoundTag } from '../../lib/nbt.ts';
import type { Volume } from '../../lib/volume.ts';
import type { BlockPos } from '../VoxelViewport.tsx';
import { findBlockEntity } from '../../lib/chunk.ts';
import { getString } from '../../lib/nbt.ts';

export function samePos(a: BlockPos | null, b: BlockPos | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.z === b.z);
}

export function modelAt(volume: Volume, x: number, z: number): ChunkModel | null {
  const cx = x >> 4;
  const cz = z >> 4;
  return volume.chunks.find((model) => model.x === cx && model.z === cz) ?? null;
}

export function blockEntityAt(volume: Volume, pos: BlockPos): CompoundTag | null {
  const model = modelAt(volume, pos.x, pos.z);
  return model ? findBlockEntity(model, pos.x & 15, pos.y, pos.z & 15) : null;
}

export function blockEntityId(tag: CompoundTag | null): string | null {
  return tag ? (getString(tag, 'id') ?? getString(tag, 'Id')) : null;
}
