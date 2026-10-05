import { chunkSummary } from './chunk.ts';
import { matchesPrune, type PruneCriteria, regionEntirelyOutside } from './prune.ts';
import { chunkIndex, parseRegionFileName, Region } from './region.ts';
import { type ListEntry, siblingRegionPaths } from './worlds.ts';

export const REGION_CHUNKS = 32;
export const SLOT_COUNT = REGION_CHUNKS * REGION_CHUNKS;
export const TICKS_PER_SECOND = 20;

/** Region slot compression byte → display name. */
export const COMPRESSION_NAMES: Record<number, string> = { 1: 'gzip', 2: 'zlib', 3: 'none', 4: 'lz4', 127: 'custom' };

/** Local chunk coordinates of a region slot index (inverse of `chunkIndex`). */
export function slotCoords(index: number): { lx: number; lz: number } {
  return { lx: index & 31, lz: index >> 5 };
}

/** Slot indices of the rectangle spanned by two slots (inclusive, either corner order), row-major. */
export function rectSelection(a: number, b: number): number[] {
  const from = slotCoords(a);
  const to = slotCoords(b);
  const indices: number[] = [];
  for (let lz = Math.min(from.lz, to.lz); lz <= Math.max(from.lz, to.lz); lz++) {
    for (let lx = Math.min(from.lx, to.lx); lx <= Math.max(from.lx, to.lx); lx++) {
      indices.push(chunkIndex(lx, lz));
    }
  }
  return indices;
}

/** Game ticks as a compact duration ("2h 5m 12s", "45s"); negative values count as zero. */
export function formatTicks(ticks: bigint): string {
  const seconds = ticks > 0n ? ticks / BigInt(TICKS_PER_SECOND) : 0n;
  const hours = seconds / 3600n;
  const minutes = (seconds % 3600n) / 60n;
  const rest = seconds % 60n;

  if (hours > 0n) return `${hours}h ${minutes}m ${rest}s`;
  if (minutes > 0n) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

export interface RegionFileRef {
  name: string;
  path: string;
  rx: number;
  rz: number;
}

/** The `r.<x>.<z>.mca` files of a directory listing, ordered by region z then x. */
export function regionFilesIn(entries: ListEntry[]): RegionFileRef[] {
  const files: RegionFileRef[] = [];
  for (const entry of entries) {
    if (entry.directory || !entry.name.endsWith('.mca')) continue;
    const coords = parseRegionFileName(entry.name);
    if (coords) files.push({ name: entry.name, path: entry.path, ...coords });
  }
  return files.sort((a, b) => a.rz - b.rz || a.rx - b.rx);
}

/** I/O seam for the save and prune flows; the page backs it with the extension API. */
export interface FileIo {
  /** null when the file does not exist */
  read(path: string): Promise<{ bytes: Uint8Array; hash: string } | null>;
  write(path: string, bytes: Uint8Array, expectedHash: string | null, force?: boolean): Promise<{ hash: string }>;
  exists(path: string): Promise<boolean>;
}

export class SessionError extends Error {
  readonly code: 'missing' | 'changed';

  constructor(code: 'missing' | 'changed', path: string) {
    super(code === 'missing' ? `${path} no longer exists` : `${path} changed since the scan`);
    this.code = code;
  }
}

export interface SiblingOutcome {
  path: string;
  status: 'missing' | 'unchanged' | 'written' | 'failed';
  error?: unknown;
}

/**
 * Removes the given slots from the `entities/` and `poi/` region files next to `regionPath`. Missing files are skipped,
 * files are only written when a slot was actually removed, and a failure on one file does not stop the other.
 */
export async function deleteFromSiblings(
  regionPath: string,
  indices: Iterable<number>,
  io: FileIo,
): Promise<SiblingOutcome[]> {
  const slots = [...indices];
  const { entities, poi } = siblingRegionPaths(regionPath);
  const outcomes: SiblingOutcome[] = [];

  for (const path of [entities, poi]) {
    if (path === regionPath) continue;
    try {
      const file = await io.read(path);
      if (!file) {
        outcomes.push({ path, status: 'missing' });
        continue;
      }

      const region = Region.parse(file.bytes);
      for (const index of slots) {
        const { lx, lz } = slotCoords(index);
        region.deleteChunk(lx, lz);
      }

      if (region.dirty) {
        await io.write(path, region.encode(), file.hash);
        outcomes.push({ path, status: 'written' });
      } else {
        outcomes.push({ path, status: 'unchanged' });
      }
    } catch (error) {
      outcomes.push({ path, status: 'failed', error });
    }
  }

  return outcomes;
}

export type PruneScan =
  /** every chunk of the region lies outside the radius: the files are replaced without reading them */
  { kind: 'entire' } | { kind: 'chunks'; hash: string; total: number; matched: number[]; failed: number };

/** Dry run: which chunks of a region file match the criteria. Chunks that fail to decode are counted, never matched. */
export async function scanRegionForPrune(
  file: RegionFileRef,
  criteria: PruneCriteria,
  io: FileIo,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<PruneScan> {
  if (regionEntirelyOutside(file.rx, file.rz, criteria)) return { kind: 'entire' };

  const read = await io.read(file.path);
  if (!read) throw new SessionError('missing', file.path);

  const region = Region.parse(read.bytes);
  const present: number[] = [];
  for (let index = 0; index < SLOT_COUNT; index++) {
    const { lx, lz } = slotCoords(index);
    if (region.slot(lx, lz)) present.push(index);
  }

  // problems of unreadable slots (no slot data) count as failures; problems of readable slots get scanned
  const unreadable = new Set<number>();
  for (const problem of region.problems) {
    if (!region.slot(problem.lx, problem.lz)) unreadable.add(chunkIndex(problem.lx, problem.lz));
  }

  const matched: number[] = [];
  let failed = unreadable.size;
  const batchSize = 16;
  for (let start = 0; start < present.length; start += batchSize) {
    options.signal?.throwIfAborted();
    const batch = present.slice(start, start + batchSize);
    const results = await Promise.all(
      batch.map(async (index) => {
        const { lx, lz } = slotCoords(index);
        try {
          const doc = await region.readChunk(lx, lz);
          return doc ? matchesPrune(chunkSummary(doc), criteria) : false;
        } catch {
          return null;
        }
      }),
    );
    results.forEach((result, offset) => {
      if (result === null) failed++;
      else if (result) matched.push(batch[offset]);
    });
    options.onProgress?.(Math.min(start + batchSize, present.length), present.length);
  }

  return { kind: 'chunks', hash: read.hash, total: present.length + unreadable.size, matched, failed };
}

export interface PruneOutcome {
  /** removed chunk count, 'all' when the region was replaced by an empty one */
  deleted: number | 'all';
  siblings: SiblingOutcome[];
}

/**
 * Applies a scan: deletes the matched chunks from the region (refusing when the file changed since the scan), then
 * from its entities/poi siblings. Regions entirely outside the radius are replaced by an empty region, siblings too
 * when they exist.
 */
export async function applyPrune(file: RegionFileRef, scan: PruneScan, io: FileIo): Promise<PruneOutcome> {
  if (scan.kind === 'entire') {
    const empty = Region.empty().encode();
    if (!(await io.exists(file.path))) throw new SessionError('missing', file.path);
    await io.write(file.path, empty, null, true);

    const { entities, poi } = siblingRegionPaths(file.path);
    const siblings: SiblingOutcome[] = [];
    for (const path of [entities, poi]) {
      try {
        if (await io.exists(path)) {
          await io.write(path, empty, null, true);
          siblings.push({ path, status: 'written' });
        } else {
          siblings.push({ path, status: 'missing' });
        }
      } catch (error) {
        siblings.push({ path, status: 'failed', error });
      }
    }
    return { deleted: 'all', siblings };
  }

  if (scan.matched.length === 0) return { deleted: 0, siblings: [] };

  const read = await io.read(file.path);
  if (!read) throw new SessionError('missing', file.path);
  if (read.hash !== scan.hash) throw new SessionError('changed', file.path);

  const region = Region.parse(read.bytes);
  for (const index of scan.matched) {
    const { lx, lz } = slotCoords(index);
    region.deleteChunk(lx, lz);
  }
  await io.write(file.path, region.encode(), read.hash);

  return { deleted: scan.matched.length, siblings: await deleteFromSiblings(file.path, scan.matched, io) };
}
