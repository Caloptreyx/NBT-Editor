import { basename } from 'pathe';
import { useEffect, useRef, useState } from 'react';
import { getHttpStatus } from '@/api/axios.ts';
import type { NbtDocument } from '../lib/nbt.ts';
import { readFile, writeFile } from '../api.ts';
import { applyChunk, type ChunkModel, type ChunkSummary, decodeChunk } from '../lib/chunk.ts';
import { parseRegionFileName, Region } from '../lib/region.ts';
import { deleteFromSiblings, type SiblingOutcome, SLOT_COUNT, slotCoords } from '../lib/session.ts';
import { renderChunkTopDown } from '../lib/topdown.ts';
import { fileKind } from '../lib/worlds.ts';
import { createFileIo } from './fileIo.ts';

export type RegionKind = 'region' | 'entities' | 'poi';

export interface RegionFile {
  path: string;
  name: string;
  kind: RegionKind;
  hash: string;
  /** region coordinates from the file name, null when the name does not follow r.<x>.<z>.mca */
  rx: number | null;
  rz: number | null;
  region: Region;
}

export type ChunkPreview =
  | { state: 'pending' }
  | { state: 'ready'; summary: ChunkSummary | null }
  | { state: 'failed'; error: string };

interface LiveChunk {
  doc: NbtDocument;
  model: ChunkModel | null;
  error: string | null;
}

export type SaveResult = { status: 'saved'; siblings: SiblingOutcome[] } | { status: 'conflict' };

export interface RegionSession {
  file: RegionFile | null;
  /** path being opened, null when idle */
  opening: string | null;
  /** bumped on every change of the mutable session state */
  revision: number;
  dirty: boolean;
  /** map preview decoding progress */
  progress: { done: number; total: number };
  /** per slot: null = no chunk */
  previews: (ChunkPreview | null)[];
  /** 512x512 canvas with the 16x16 px top-down render of every decoded chunk at (lx * 16, lz * 16) */
  atlas: HTMLCanvasElement | null;
  open(path: string): Promise<void>;
  close(): void;
  reload(): Promise<void>;
  loadModels(indices: number[]): Promise<{ models: ChunkModel[]; failures: { index: number; message: string }[] }>;
  chunkDocument(index: number): Promise<NbtDocument>;
  markDocumentChanged(index: number): void;
  redecode(index: number): void;
  settleLiveChunks(): void;
  deleteChunks(indices: number[]): void;
  /** the inspector mutated models in place */
  markEdited(): void;
  save(force?: boolean): Promise<SaveResult>;
}

const ATLAS_SIZE = 32 * 16;

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function idle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 120 });
  else setTimeout(resolve, 16);
  return promise;
}

function decodeLive(doc: NbtDocument): LiveChunk {
  try {
    return { doc, model: decodeChunk(doc), error: null };
  } catch (error) {
    return { doc, model: null, error: errorMessage(error) };
  }
}

/**
 * An open region file: the parsed region, a lazily filled preview atlas (16x16 px per chunk), the chunks decoded for
 * editing and the pending changes. All of it is mutable and lives in a ref; `revision` re-renders consumers.
 */
export default function useRegionSession(serverUuid: string): RegionSession {
  // reads the mutable region session (refs, Region, previews) during render; compiler memoization would go stale
  'use no memo';

  const [file, setFile] = useState<RegionFile | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const generation = useRef(0);
  const previews = useRef<(ChunkPreview | null)[]>([]);
  const live = useRef(new Map<number, LiveChunk>());
  const changed = useRef(new Set<number>());
  const deleted = useRef(new Set<number>());
  const atlas = useRef<HTMLCanvasElement | null>(null);

  const bump = () => setRevision((current) => current + 1);

  const atlasContext = () => {
    if (!atlas.current) {
      atlas.current = document.createElement('canvas');
      atlas.current.width = ATLAS_SIZE;
      atlas.current.height = ATLAS_SIZE;
    }
    return atlas.current.getContext('2d');
  };

  const paint = (index: number, model: ChunkModel | null) => {
    const context = atlasContext();
    if (!context) return;
    const { lx, lz } = slotCoords(index);
    if (model) {
      context.putImageData(new ImageData(new Uint8ClampedArray(renderChunkTopDown(model)), 16, 16), lx * 16, lz * 16);
    } else {
      context.clearRect(lx * 16, lz * 16, 16, 16);
    }
  };

  const decodePreview = async (current: RegionFile, index: number) => {
    const { lx, lz } = slotCoords(index);
    const entry = live.current.get(index);
    try {
      let model = entry?.model ?? null;
      if (!entry) {
        const doc = await current.region.readChunk(lx, lz);
        if (!doc) throw new Error('empty chunk slot');
        model = decodeChunk(doc);
      }
      if (!model) throw new Error(entry?.error ?? 'undecodable chunk');
      paint(index, model);
      previews.current[index] = { state: 'ready', summary: summaryOf(model) };
    } catch (error) {
      paint(index, null);
      previews.current[index] = { state: 'failed', error: errorMessage(error) };
    }
  };

  // decode every present chunk for the map in idle-time batches; a newer open/reload abandons the loop
  useEffect(() => {
    if (!file) return;
    const run = generation.current;
    const queue = previews.current.flatMap((preview, index) => (preview?.state === 'pending' ? [index] : []));
    setProgress({ done: 0, total: queue.length });
    if (queue.length === 0) return;

    let done = 0;
    (async () => {
      while (queue.length > 0) {
        await idle();
        if (generation.current !== run) return;
        const deadline = performance.now() + 14;
        while (queue.length > 0 && performance.now() < deadline) {
          const batch = queue.splice(0, 8);
          await Promise.all(batch.map((index) => decodePreview(file, index)));
          if (generation.current !== run) return;
          done += batch.length;
        }
        setProgress({ done, total: done + queue.length });
        bump();
      }
    })();
  }, [file]);

  const reset = () => {
    generation.current++;
    live.current = new Map();
    changed.current = new Set();
    deleted.current = new Set();
    atlasContext()?.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  };

  const open = async (path: string) => {
    setOpening(path);
    try {
      const { bytes, hash } = await readFile(serverUuid, path);
      const region = Region.parse(bytes);
      const name = basename(path);
      const coords = parseRegionFileName(name.replace(/\.mcr$/, '.mca'));
      const kind = fileKind(path);
      const regionKind: RegionKind = kind === 'entities' || kind === 'poi' ? kind : 'region';

      reset();
      const slots: (ChunkPreview | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
      for (let index = 0; index < SLOT_COUNT; index++) {
        const { lx, lz } = slotCoords(index);
        // entity and poi chunks have no blocks to render; their cells only show presence
        if (region.slot(lx, lz))
          slots[index] = regionKind === 'region' ? { state: 'pending' } : { state: 'ready', summary: null };
      }
      for (const problem of region.problems) {
        slots[problem.lx + problem.lz * 32] = { state: 'failed', error: problem.message };
      }
      previews.current = slots;

      setFile({ path, name, kind: regionKind, hash, rx: coords?.rx ?? null, rz: coords?.rz ?? null, region });
      bump();
    } finally {
      setOpening(null);
    }
  };

  const close = () => {
    reset();
    previews.current = [];
    setFile(null);
    setProgress({ done: 0, total: 0 });
  };

  const liveChunk = async (index: number): Promise<LiveChunk> => {
    const existing = live.current.get(index);
    if (existing) return existing;
    if (!file) throw new Error('no region open');

    const { lx, lz } = slotCoords(index);
    const doc = await file.region.readChunk(lx, lz);
    if (!doc) throw new Error(`chunk ${lx}, ${lz} is empty`);
    const entry = decodeLive(doc);
    live.current.set(index, entry);
    return entry;
  };

  /** Decoded models for the inspector; chunks that cannot be decoded are reported, not thrown. */
  const loadModels = async (indices: number[]) => {
    const models: ChunkModel[] = [];
    const failures: { index: number; message: string }[] = [];
    for (const index of indices) {
      try {
        const entry = await liveChunk(index);
        if (entry.model) models.push(entry.model);
        else failures.push({ index, message: entry.error ?? 'undecodable chunk' });
      } catch (error) {
        failures.push({ index, message: errorMessage(error) });
      }
    }
    return { models, failures };
  };

  /** The chunk document for the NBT editor, with pending block edits written into it first. */
  const chunkDocument = async (index: number) => {
    const entry = await liveChunk(index);
    if (entry.model?.dirty) {
      applyChunk(entry.model);
      changed.current.add(index);
    }
    return entry.doc;
  };

  const markDocumentChanged = (index: number) => {
    changed.current.add(index);
    bump();
  };

  /** Re-decodes a chunk after its NBT was edited so the map and inspector see the new data. */
  const redecode = (index: number) => {
    const entry = live.current.get(index);
    if (!entry) return;
    const next = decodeLive(entry.doc);
    live.current.set(index, next);
    paint(index, next.model);
    previews.current[index] = next.model
      ? { state: 'ready', summary: summaryOf(next.model) }
      : { state: 'failed', error: next.error ?? 'undecodable chunk' };
    bump();
  };

  /** Repaints map cells of chunks edited in the inspector and drops decoded chunks without pending changes. */
  const settleLiveChunks = () => {
    for (const [index, entry] of live.current) {
      if (entry.model?.dirty) {
        paint(index, entry.model);
        changed.current.add(index);
      } else if (!changed.current.has(index)) {
        live.current.delete(index);
      }
    }
    bump();
  };

  const deleteChunks = (indices: number[]) => {
    if (!file) return;
    for (const index of indices) {
      const { lx, lz } = slotCoords(index);
      if (previews.current[index] === null) continue;
      file.region.deleteChunk(lx, lz);
      live.current.delete(index);
      changed.current.delete(index);
      deleted.current.add(index);
      previews.current[index] = null;
      paint(index, null);
    }
    bump();
  };

  const save = async (force = false): Promise<SaveResult> => {
    if (!file) throw new Error('no region open');
    for (const [index, entry] of live.current) {
      if (entry.model?.dirty) {
        applyChunk(entry.model);
        changed.current.add(index);
      }
    }
    for (const index of changed.current) {
      const entry = live.current.get(index);
      if (!entry) continue;
      const { lx, lz } = slotCoords(index);
      await file.region.writeChunk(lx, lz, entry.doc);
    }

    let hash: string;
    try {
      ({ hash } = await writeFile(serverUuid, file.path, file.region.encode(), file.hash, force));
    } catch (error) {
      if (!force && getHttpStatus(error) === 409) return { status: 'conflict' };
      throw error;
    }

    file.hash = hash;
    file.region.markClean();
    changed.current.clear();
    const removed = [...deleted.current];
    deleted.current.clear();
    bump();

    const siblings =
      file.kind === 'region' && removed.length > 0
        ? await deleteFromSiblings(file.path, removed, createFileIo(serverUuid))
        : [];
    return { status: 'saved', siblings };
  };

  const dirty =
    file !== null &&
    (file.region.dirty ||
      changed.current.size > 0 ||
      deleted.current.size > 0 ||
      [...live.current.values()].some((entry) => entry.model?.dirty));

  return {
    file,
    opening,
    revision,
    dirty,
    progress,
    previews: previews.current,
    atlas: atlas.current,
    open,
    close,
    reload: () => (file ? open(file.path) : Promise.resolve()),
    loadModels,
    chunkDocument,
    markDocumentChanged,
    redecode,
    settleLiveChunks,
    deleteChunks,
    markEdited: bump,
    save,
  };
}

function summaryOf(model: ChunkModel): ChunkSummary {
  return {
    x: model.x,
    z: model.z,
    dataVersion: model.dataVersion,
    status: model.status,
    inhabitedTime: model.inhabitedTime,
    lastUpdate: model.lastUpdate,
  };
}
