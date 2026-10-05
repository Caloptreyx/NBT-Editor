import { type Compression, compress, decompress } from './compression.ts';
import { type NbtDocument, NbtError, readNbt, writeNbt } from './nbt.ts';

export const chunkIndex = (lx: number, lz: number) => (lx & 31) + (lz & 31) * 32;

export interface RegionSlot {
  lx: number;
  lz: number;
  timestamp: number;
  compression: number;
  external: boolean;
  payload: Uint8Array | null;
  size: number;
}

export type RegionErrorCode = 'external' | 'unsupportedCompression' | 'corrupt';

export class RegionError extends Error {
  readonly code: RegionErrorCode;

  constructor(code: RegionErrorCode, message: string) {
    super(message);
    this.name = 'RegionError';
    this.code = code;
  }
}

const SECTOR = 4096;
const HEADER_SECTORS = 2;
const CHUNK_HEADER = 5;
const MAX_SECTORS = 255;
const EXTERNAL_FLAG = 0x80;
const COMPRESSION_BY_ID: Record<number, Compression> = { 1: 'gzip', 2: 'zlib', 3: 'none', 4: 'lz4' };

export class Region {
  readonly problems: { lx: number; lz: number; message: string }[] = [];
  private readonly slots: (RegionSlot | null)[];
  private changed = false;

  private constructor(slots: (RegionSlot | null)[]) {
    this.slots = slots;
  }

  static empty(): Region {
    return new Region(new Array(1024).fill(null));
  }

  static parse(bytes: Uint8Array): Region {
    const region = Region.empty();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const owners = new Int16Array(Math.ceil(bytes.length / SECTOR)).fill(-1);

    for (let index = 0; index < 1024; index++) {
      const lx = index & 31;
      const lz = index >> 5;
      const problem = (message: string) => region.problems.push({ lx, lz, message });

      if (index * 4 + 4 > bytes.length) {
        if (bytes.length > 0) problem(`Region header truncated (file is ${bytes.length} bytes)`);
        break;
      }
      const entry = view.getUint32(index * 4);
      if (entry === 0) continue;
      const sectorOffset = entry >>> 8;
      const sectorCount = entry & 0xff;
      if (sectorOffset < HEADER_SECTORS) {
        problem(`Chunk location points into the region header (sector ${sectorOffset})`);
        continue;
      }
      if (sectorCount === 0) {
        problem('Chunk location has zero sectors');
        continue;
      }
      const start = sectorOffset * SECTOR;
      if (start + CHUNK_HEADER > bytes.length) {
        problem(`Chunk starts beyond the end of the file (sector ${sectorOffset})`);
        continue;
      }
      const length = view.getInt32(start);
      const compressionByte = bytes[start + 4];
      const external = (compressionByte & EXTERNAL_FLAG) !== 0;
      const timestampOffset = SECTOR + index * 4;
      const timestamp = timestampOffset + 4 <= bytes.length ? view.getUint32(timestampOffset) : 0;

      let payload: Uint8Array | null = null;
      if (!external) {
        const payloadLength = length - 1;
        if (payloadLength <= 0) {
          problem('Chunk has no data');
          continue;
        }
        if (
          payloadLength > sectorCount * SECTOR - CHUNK_HEADER ||
          start + CHUNK_HEADER + payloadLength > bytes.length
        ) {
          problem(`Chunk data truncated (declares ${payloadLength} bytes in ${sectorCount} sectors)`);
          continue;
        }
        payload = bytes.slice(start + CHUNK_HEADER, start + CHUNK_HEADER + payloadLength);
      }

      const firstSector = sectorOffset;
      const lastSector = Math.min(sectorOffset + sectorCount, owners.length);
      for (let s = firstSector; s < lastSector; s++) {
        const owner = owners[s];
        if (owner >= 0 && owner !== index) {
          problem(`Chunk sectors overlap chunk ${owner & 31}, ${owner >> 5}`);
          break;
        }
      }
      for (let s = firstSector; s < lastSector; s++) if (owners[s] < 0) owners[s] = index;

      region.slots[index] = {
        lx,
        lz,
        timestamp,
        compression: compressionByte & ~EXTERNAL_FLAG,
        external,
        payload,
        size: payload?.length ?? 0,
      };
    }
    return region;
  }

  slot(lx: number, lz: number): RegionSlot | null {
    return this.slots[chunkIndex(lx, lz)];
  }

  chunkCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot) count++;
    return count;
  }

  async readChunk(lx: number, lz: number): Promise<NbtDocument | null> {
    const slot = this.slot(lx, lz);
    if (!slot) return null;
    if (slot.external || !slot.payload) {
      throw new RegionError('external', `Chunk ${slot.lx}, ${slot.lz} is stored in an external .mcc file`);
    }
    const compression = COMPRESSION_BY_ID[slot.compression];
    if (!compression) {
      throw new RegionError(
        'unsupportedCompression',
        `Chunk ${slot.lx}, ${slot.lz} uses unsupported compression type ${slot.compression}`,
      );
    }
    let raw: Uint8Array;
    try {
      raw = await decompress(slot.payload, compression);
    } catch (error) {
      throw new RegionError(
        'corrupt',
        `Chunk ${slot.lx}, ${slot.lz} failed to decompress (${compression}): ${(error as Error).message}`,
      );
    }
    try {
      return readNbt(raw);
    } catch (error) {
      if (!(error instanceof NbtError)) throw error;
      throw new RegionError('corrupt', `Chunk ${slot.lx}, ${slot.lz} has invalid NBT: ${error.message}`);
    }
  }

  async writeChunk(lx: number, lz: number, doc: NbtDocument): Promise<void> {
    const payload = await compress(writeNbt(doc), 'zlib');
    assertFits(lx & 31, lz & 31, payload.length);
    const index = chunkIndex(lx, lz);
    this.slots[index] = {
      lx: lx & 31,
      lz: lz & 31,
      timestamp: Math.floor(Date.now() / 1000),
      compression: 2,
      external: false,
      payload,
      size: payload.length,
    };
    this.clearProblems(index);
    this.changed = true;
  }

  deleteChunk(lx: number, lz: number): void {
    const index = chunkIndex(lx, lz);
    const hadProblems = this.clearProblems(index);
    if (this.slots[index] === null && !hadProblems) return;
    this.slots[index] = null;
    this.changed = true;
  }

  get dirty(): boolean {
    return this.changed;
  }

  markClean(): void {
    this.changed = false;
  }

  encode(): Uint8Array {
    let sectors = HEADER_SECTORS;
    for (const slot of this.slots) {
      if (!slot) continue;
      if (slot.external || !slot.payload) {
        sectors += 1;
        continue;
      }
      assertFits(slot.lx, slot.lz, slot.payload.length);
      sectors += Math.ceil((CHUNK_HEADER + slot.payload.length) / SECTOR);
    }

    const out = new Uint8Array(sectors * SECTOR);
    const view = new DataView(out.buffer);
    let next = HEADER_SECTORS;
    for (let index = 0; index < 1024; index++) {
      const slot = this.slots[index];
      if (!slot) continue;
      const start = next * SECTOR;
      let count: number;
      if (slot.external || !slot.payload) {
        count = 1;
        view.setInt32(start, 1);
        out[start + 4] = slot.compression | EXTERNAL_FLAG;
      } else {
        count = Math.ceil((CHUNK_HEADER + slot.payload.length) / SECTOR);
        view.setInt32(start, slot.payload.length + 1);
        out[start + 4] = slot.compression;
        out.set(slot.payload, start + CHUNK_HEADER);
      }
      view.setUint32(index * 4, ((next << 8) | count) >>> 0);
      view.setUint32(SECTOR + index * 4, slot.timestamp >>> 0);
      next += count;
    }
    return out;
  }

  private clearProblems(index: number): boolean {
    const before = this.problems.length;
    let kept = 0;
    for (const problem of this.problems) {
      if (chunkIndex(problem.lx, problem.lz) !== index) this.problems[kept++] = problem;
    }
    this.problems.length = kept;
    return kept !== before;
  }
}

function assertFits(lx: number, lz: number, payloadLength: number) {
  const sectors = Math.ceil((CHUNK_HEADER + payloadLength) / SECTOR);
  if (sectors > MAX_SECTORS) {
    throw new RegionError(
      'corrupt',
      `Chunk ${lx}, ${lz} needs ${sectors} sectors (${payloadLength} bytes); the region format allows at most ${MAX_SECTORS}`,
    );
  }
}

export function parseRegionFileName(name: string): { rx: number; rz: number } | null {
  const match = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(name.slice(name.lastIndexOf('/') + 1));
  return match ? { rx: Number(match[1]), rz: Number(match[2]) } : null;
}
