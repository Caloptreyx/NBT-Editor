import {
  type CompoundTag,
  cloneTag,
  compound,
  getCompound,
  getList,
  getLong,
  getNumber,
  getString,
  type ListTag,
  type LongArrayTag,
  type NbtDocument,
  type Tag,
} from './nbt.ts';

/** A block state as stored in chunk palettes. */
export interface BlockState {
  name: string;
  properties: Record<string, string> | null;
}

export const AIR: BlockState = Object.freeze({ name: 'minecraft:air', properties: null });

/** One 16x16x16 section; `data[(y * 16 + z) * 16 + x]` (local coords) indexes `palette`, null = all `palette[0]`. */
export interface ChunkSection {
  y: number;
  palette: BlockState[];
  data: Uint16Array | null;
}

export interface ChunkModel {
  doc: NbtDocument;
  dataVersion: number;
  /** Absolute chunk coordinates. */
  x: number;
  z: number;
  /** Absolute block Y range, inclusive. */
  minY: number;
  maxY: number;
  /** Keyed by section Y. */
  sections: Map<number, ChunkSection>;
  status: string | null;
  inhabitedTime: bigint;
  lastUpdate: bigint;
  editable: boolean;
  readOnlyReason: string | null;
  dirty: boolean;
}

export interface ChunkSummary {
  x: number;
  z: number;
  dataVersion: number;
  status: string | null;
  inhabitedTime: bigint;
  lastUpdate: bigint;
}

export class ChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkError';
  }
}

const SECTION_VOLUME = 4096;
/** 17w47a: block palettes replace numeric block ids. */
const FLATTENING_VERSION = 1451;
/** 20w17a: palette indices no longer span two longs. */
const NON_SPANNING_VERSION = 2529;
/** 21w43a: the `Level` wrapper is gone, sections hold `block_states`/`biomes`, `yPos` gives the bottom section. */
const FLAT_ROOT_VERSION = 2844;
/** Palette entries accumulate in setBlock until applyChunk compacts them; this keeps indices well inside 16 bits. */
const MAX_PALETTE = SECTION_VOLUME;

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Sections changed by setBlock since the last applyChunk. */
const dirtySections = new WeakMap<ChunkModel, Set<number>>();

const RESOURCE_NAMESPACE = /^[a-z0-9_.-]+$/;
const RESOURCE_PATH = /^[a-z0-9_./-]+$/;
const PROPERTY_NAME = /^[a-z0-9_]+$/;
const PROPERTY_VALUE = /^[a-z0-9_.-]+$/;

/** `minecraft:oak_stairs[facing=north,half=bottom]`, properties sorted by name. */
export function blockStateKey(state: BlockState): string {
  const properties = state.properties;
  if (!properties) return state.name;
  const names = Object.keys(properties).sort();
  if (names.length === 0) return state.name;
  return `${state.name}[${names.map((name) => `${name}=${properties[name]}`).join(',')}]`;
}

/** Inverse of blockStateKey; lowercases, adds `minecraft:` when the id has no namespace, null when malformed. */
export function parseBlockStateKey(text: string): BlockState | null {
  const input = text.trim().toLowerCase();
  let id = input;
  let properties: Record<string, string> | null = null;
  const open = input.indexOf('[');
  if (open >= 0) {
    if (!input.endsWith(']')) return null;
    id = input.slice(0, open).trim();
    const body = input.slice(open + 1, -1).trim();
    if (body) {
      const pairs: [string, string][] = [];
      const seen = new Set<string>();
      for (const part of body.split(',')) {
        const eq = part.indexOf('=');
        if (eq < 0) return null;
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (!PROPERTY_NAME.test(name) || !PROPERTY_VALUE.test(value) || seen.has(name)) return null;
        seen.add(name);
        pairs.push([name, value]);
      }
      properties = Object.fromEntries(pairs);
    }
  }
  const colon = id.indexOf(':');
  const namespace = colon >= 0 ? id.slice(0, colon) : 'minecraft';
  const path = colon >= 0 ? id.slice(colon + 1) : id;
  if (!RESOURCE_NAMESPACE.test(namespace) || !RESOURCE_PATH.test(path)) return null;
  return { name: `${namespace}:${path}`, properties };
}

/** Same name and same properties (null and `{}` are equal). */
export function sameBlockState(a: BlockState, b: BlockState): boolean {
  if (a === b) return true;
  if (a.name !== b.name) return false;
  const aNames = a.properties ? Object.keys(a.properties) : [];
  const bNames = b.properties ? Object.keys(b.properties) : [];
  if (aNames.length !== bNames.length) return false;
  for (const name of aNames) {
    if (!b.properties || !Object.hasOwn(b.properties, name) || b.properties[name] !== a.properties?.[name]) {
      return false;
    }
  }
  return true;
}

const copyState = (state: BlockState): BlockState => {
  const properties = state.properties && Object.keys(state.properties).length > 0 ? { ...state.properties } : null;
  return { name: state.name, properties };
};

const ceilLog2 = (n: number) => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));

const levelTag = (doc: NbtDocument): CompoundTag => getCompound(doc.root, 'Level') ?? doc.root;

const chunkCoords = (level: CompoundTag): { x: number; z: number } => {
  const x = getNumber(level, 'xPos');
  const z = getNumber(level, 'zPos');
  if (x === null || z === null) throw new ChunkError('Chunk has no xPos/zPos');
  return { x, z };
};

/** The palette/data tags of a section in either layout; null palette for light-only sections. */
const sectionBlockTags = (section: CompoundTag): { palette: ListTag | null; data: Tag | null } => {
  const states = getCompound(section, 'block_states');
  if (states) return { palette: getList(states, 'palette'), data: states.entries.get('data') ?? null };
  return { palette: getList(section, 'Palette'), data: section.entries.get('BlockStates') ?? null };
};

const readPaletteEntry = (tag: Tag, sectionY: number): BlockState => {
  if (tag.type !== 'compound') throw new ChunkError(`Section ${sectionY}: palette entry is not a compound`);
  const name = getString(tag, 'Name');
  if (name === null) throw new ChunkError(`Section ${sectionY}: palette entry has no Name`);
  const propertiesTag = getCompound(tag, 'Properties');
  if (!propertiesTag) return { name, properties: null };
  const pairs: [string, string][] = [];
  for (const [key, value] of propertiesTag.entries) {
    if (value.type === 'string') pairs.push([key, value.value]);
  }
  return { name, properties: pairs.length > 0 ? Object.fromEntries(pairs) : null };
};

const writePaletteEntry = (state: BlockState): CompoundTag => {
  const entry = compound([['Name', { type: 'string', value: state.name }]]);
  const properties = state.properties ? Object.entries(state.properties) : [];
  if (properties.length > 0) {
    entry.entries.set(
      'Properties',
      compound(properties.map(([key, value]): [string, Tag] => [key, { type: 'string', value }])),
    );
  }
  return entry;
};

const packedLength = (bits: number, spanning: boolean): number =>
  spanning ? (SECTION_VOLUME * bits) / 64 : Math.ceil(SECTION_VOLUME / Math.floor(64 / bits));

/** Bit offset of entry `i` in the long stream. */
const bitOffset = (i: number, bits: number, perLong: number, spanning: boolean): number =>
  spanning ? i * bits : Math.floor(i / perLong) * 64 + (i % perLong) * bits;

/** The longs as little-endian 32-bit words (bit n of the stream = bit n % 32 of word n / 32). */
const longWords = (longs: BigInt64Array): Uint32Array => {
  const view = new Uint32Array(longs.buffer, longs.byteOffset, longs.length * 2);
  if (LITTLE_ENDIAN) return view;
  const words = new Uint32Array(view.length);
  for (let i = 0; i < view.length; i += 2) {
    words[i] = view[i + 1];
    words[i + 1] = view[i];
  }
  return words;
};

const wordsToLongs = (words: Uint32Array): BigInt64Array => {
  if (!LITTLE_ENDIAN) {
    for (let i = 0; i < words.length; i += 2) {
      const low = words[i];
      words[i] = words[i + 1];
      words[i + 1] = low;
    }
  }
  return new BigInt64Array(words.buffer, words.byteOffset, words.length / 2);
};

/** Width used by the game: max(4, ceil(log2(size))); other widths are accepted when the array length fits one. */
const resolveBits = (length: number, paletteSize: number, spanning: boolean, sectionY: number): number => {
  for (let bits = Math.max(4, ceilLog2(paletteSize)); bits <= 16; bits++) {
    if (packedLength(bits, spanning) === length) return bits;
  }
  throw new ChunkError(
    `Section ${sectionY}: ${length} longs of block data do not fit a palette of ${paletteSize} entries`,
  );
};

const unpackIndices = (longs: BigInt64Array, bits: number, spanning: boolean): Uint16Array => {
  const words = longWords(longs);
  const out = new Uint16Array(SECTION_VOLUME);
  const mask = (1 << bits) - 1;
  const perLong = Math.floor(64 / bits);
  for (let i = 0; i < SECTION_VOLUME; i++) {
    const bit = bitOffset(i, bits, perLong, spanning);
    const word = bit >>> 5;
    const shift = bit & 31;
    let value = words[word] >>> shift;
    if (shift + bits > 32) value |= words[word + 1] << (32 - shift);
    out[i] = value & mask;
  }
  return out;
};

const packIndices = (data: Uint16Array | null, bits: number, spanning: boolean): BigInt64Array => {
  const words = new Uint32Array(packedLength(bits, spanning) * 2);
  if (data) {
    const perLong = Math.floor(64 / bits);
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const value = data[i];
      if (value === 0) continue;
      const bit = bitOffset(i, bits, perLong, spanning);
      const word = bit >>> 5;
      const shift = bit & 31;
      words[word] |= value << shift;
      if (shift + bits > 32) words[word + 1] |= value >>> (32 - shift);
    }
  }
  return wordsToLongs(words);
};

const decodeSection = (tag: CompoundTag, sectionY: number, spanning: boolean): ChunkSection | null => {
  const { palette: paletteTag, data: dataTag } = sectionBlockTags(tag);
  if (!paletteTag || paletteTag.items.length === 0) return null;
  const palette = paletteTag.items.map((entry) => readPaletteEntry(entry, sectionY));
  if (palette.length === 1 || !dataTag) return { y: sectionY, palette, data: null };
  if (dataTag.type !== 'longArray') throw new ChunkError(`Section ${sectionY}: block data is not a long array`);
  const bits = resolveBits(dataTag.value.length, palette.length, spanning, sectionY);
  const data = unpackIndices(dataTag.value, bits, spanning);
  for (let i = 0; i < SECTION_VOLUME; i++) {
    if (data[i] >= palette.length) {
      throw new ChunkError(`Section ${sectionY}: block index ${data[i]} is outside the palette of ${palette.length}`);
    }
  }
  return { y: sectionY, palette, data };
};

/**
 * Decodes the block sections of a chunk: 1.18+ (root `sections` with `block_states`, `block_entities`, `yPos`) and
 * 1.13-1.17 (`Level` with `Sections` holding `Palette`/`BlockStates`, `TileEntities`). Chunks from before 1.13 are
 * returned read-only without sections. Throws ChunkError for malformed chunks.
 */
export function decodeChunk(doc: NbtDocument): ChunkModel {
  const level = levelTag(doc);
  const { x, z } = chunkCoords(level);
  const dataVersion = getNumber(doc.root, 'DataVersion') ?? 0;
  const list = getList(level, 'sections') ?? getList(level, 'Sections');
  const sectionTags = (list?.items ?? []).filter((item): item is CompoundTag => item.type === 'compound');
  const model: ChunkModel = {
    doc,
    dataVersion,
    x,
    z,
    minY: 0,
    maxY: 255,
    sections: new Map(),
    status: getString(level, 'Status'),
    inhabitedTime: getLong(level, 'InhabitedTime') ?? 0n,
    lastUpdate: getLong(level, 'LastUpdate') ?? 0n,
    editable: true,
    readOnlyReason: null,
    dirty: false,
  };

  const legacySection = sectionTags.some(
    (tag) => tag.entries.get('Blocks')?.type === 'byteArray' && sectionBlockTags(tag).palette === null,
  );
  if (dataVersion < FLATTENING_VERSION || legacySection) {
    model.editable = false;
    model.readOnlyReason =
      'This chunk was saved before Minecraft 1.13 and uses numeric block ids, which the block editor does not support.';
    return model;
  }

  const spanning = dataVersion < NON_SPANNING_VERSION;
  for (const tag of sectionTags) {
    const sectionY = getNumber(tag, 'Y');
    if (sectionY === null || model.sections.has(sectionY)) continue;
    const section = decodeSection(tag, sectionY, spanning);
    if (section) model.sections.set(sectionY, section);
  }

  const sectionYs = [...model.sections.keys()];
  const lowest = sectionYs.length > 0 ? Math.min(...sectionYs) : null;
  const highest = sectionYs.length > 0 ? Math.max(...sectionYs) : null;
  const yPos = getNumber(level, 'yPos');
  if (dataVersion >= FLAT_ROOT_VERSION) {
    model.minY = (yPos ?? lowest ?? -4) * 16;
    model.maxY = highest !== null ? highest * 16 + 15 : model.minY === -64 ? 319 : model.minY + 255;
  } else {
    model.minY = Math.min(0, (yPos ?? lowest ?? 0) * 16);
    model.maxY = Math.max(255, highest !== null ? highest * 16 + 15 : 255);
  }
  return model;
}

const localIndex = (lx: number, y: number, lz: number) => ((y & 15) * 16 + lz) * 16 + lx;

/** The block at local lx/lz and absolute y; AIR outside the chunk or its sections. */
export function getBlock(model: ChunkModel, lx: number, y: number, lz: number): BlockState {
  if (
    !Number.isInteger(lx) ||
    !Number.isInteger(lz) ||
    !Number.isInteger(y) ||
    lx < 0 ||
    lx > 15 ||
    lz < 0 ||
    lz > 15
  ) {
    return AIR;
  }
  const section = model.sections.get(y >> 4);
  if (!section) return AIR;
  return section.palette[section.data ? section.data[localIndex(lx, y, lz)] : 0] ?? AIR;
}

/** Live block entity tags of the chunk (absolute x/y/z). */
export function blockEntities(model: ChunkModel): CompoundTag[] {
  const level = levelTag(model.doc);
  const list = getList(level, 'block_entities') ?? getList(level, 'TileEntities');
  if (!list) return [];
  return list.items.filter((item): item is CompoundTag => item.type === 'compound');
}

/** The block entity at local lx/lz (masked to 0..15) and absolute y. */
export function findBlockEntity(model: ChunkModel, lx: number, y: number, lz: number): CompoundTag | null {
  const x = model.x * 16 + (lx & 15);
  const z = model.z * 16 + (lz & 15);
  return (
    blockEntities(model).find(
      (tag) => getNumber(tag, 'x') === x && getNumber(tag, 'y') === y && getNumber(tag, 'z') === z,
    ) ?? null
  );
}

/** Drops unused and duplicate palette entries; a section left with one state loses its data array. */
const compactSection = (section: ChunkSection): void => {
  const { palette, data } = section;
  if (!data) {
    if (palette.length > 1) section.palette = [palette[0]];
    return;
  }
  const used = new Uint8Array(palette.length);
  for (let i = 0; i < SECTION_VOLUME; i++) used[data[i]] = 1;
  const remap = new Uint16Array(palette.length);
  const compacted: BlockState[] = [];
  const byKey = new Map<string, number>();
  let identity = true;
  for (let index = 0; index < palette.length; index++) {
    if (!used[index]) {
      identity = false;
      continue;
    }
    const key = blockStateKey(palette[index]);
    let target = byKey.get(key);
    if (target === undefined) {
      target = compacted.length;
      byKey.set(key, target);
      compacted.push(palette[index]);
    }
    remap[index] = target;
    if (target !== index) identity = false;
  }
  section.palette = compacted;
  if (compacted.length === 1) {
    section.data = null;
    return;
  }
  if (identity) return;
  for (let i = 0; i < SECTION_VOLUME; i++) data[i] = remap[data[i]];
};

/**
 * Sets the block at local lx/lz and absolute y, creating the section (filled with air) when missing. Removes the block
 * entity there when the block id changes (a property-only change keeps it). False when the chunk is read-only or the
 * position is outside the chunk.
 */
export function setBlock(model: ChunkModel, lx: number, y: number, lz: number, state: BlockState): boolean {
  if (!model.editable || !Number.isInteger(lx) || !Number.isInteger(lz) || !Number.isInteger(y)) return false;
  if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < model.minY || y > model.maxY) return false;
  const sectionY = y >> 4;
  const index = localIndex(lx, y, lz);
  let section = model.sections.get(sectionY);
  const current = section ? (section.palette[section.data ? section.data[index] : 0] ?? AIR) : AIR;
  if (sameBlockState(current, state)) return true;

  if (!section) {
    section = { y: sectionY, palette: [AIR], data: null };
    model.sections.set(sectionY, section);
  }
  let paletteIndex = section.palette.findIndex((entry) => sameBlockState(entry, state));
  if (paletteIndex < 0) {
    if (section.palette.length >= MAX_PALETTE) compactSection(section);
    paletteIndex = section.palette.length;
    section.palette.push(copyState(state));
  }
  section.data ??= new Uint16Array(SECTION_VOLUME);
  section.data[index] = paletteIndex;

  if (current.name !== state.name) {
    const level = levelTag(model.doc);
    const list = getList(level, 'block_entities') ?? getList(level, 'TileEntities');
    if (list) {
      const x = model.x * 16 + lx;
      const z = model.z * 16 + lz;
      list.items = list.items.filter(
        (tag) =>
          tag.type !== 'compound' ||
          getNumber(tag, 'x') !== x ||
          getNumber(tag, 'y') !== y ||
          getNumber(tag, 'z') !== z,
      );
    }
  }

  let dirty = dirtySections.get(model);
  if (!dirty) {
    dirty = new Set();
    dirtySections.set(model, dirty);
  }
  dirty.add(sectionY);
  model.dirty = true;
  return true;
}

/** Whether new sections get a `block_states` compound (1.18+) or `Palette`/`BlockStates` (1.13-1.17). */
const usesBlockStatesCompound = (list: ListTag, dataVersion: number): boolean => {
  for (const item of list.items) {
    if (item.type !== 'compound') continue;
    if (getCompound(item, 'block_states')) return true;
    if (getList(item, 'Palette')) return false;
  }
  return dataVersion >= FLAT_ROOT_VERSION;
};

const ensureSectionsList = (level: CompoundTag, dataVersion: number): ListTag => {
  const existing = getList(level, 'sections') ?? getList(level, 'Sections');
  if (existing) return existing;
  const list: ListTag = { type: 'list', itemType: 'compound', items: [] };
  level.entries.set(dataVersion >= FLAT_ROOT_VERSION ? 'sections' : 'Sections', list);
  return list;
};

const ensureSectionTag = (list: ListTag, sectionY: number): CompoundTag => {
  for (const item of list.items) {
    if (item.type === 'compound' && getNumber(item, 'Y') === sectionY) return item;
  }
  const tag = compound([['Y', { type: 'byte', value: sectionY }]]);
  const after = list.items.findIndex((item) => item.type === 'compound' && (getNumber(item, 'Y') ?? 0) > sectionY);
  list.items.splice(after < 0 ? list.items.length : after, 0, tag);
  list.itemType = 'compound';
  return tag;
};

/** A copy of the closest section's biomes, or plains. */
const neighbourBiomes = (list: ListTag, sectionY: number): CompoundTag => {
  let best: CompoundTag | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of list.items) {
    if (item.type !== 'compound') continue;
    const y = getNumber(item, 'Y');
    const biomes = getCompound(item, 'biomes');
    if (y === null || !biomes || y === sectionY) continue;
    const distance = Math.abs(y - sectionY);
    if (distance < bestDistance) {
      best = biomes;
      bestDistance = distance;
    }
  }
  if (best) return cloneTag(best);
  return compound([
    ['palette', { type: 'list', itemType: 'string', items: [{ type: 'string', value: 'minecraft:plains' }] }],
  ]);
};

const writeSectionTag = (
  tag: CompoundTag,
  section: ChunkSection,
  blockStatesCompound: boolean,
  spanning: boolean,
  list: ListTag,
): void => {
  const palette: ListTag = { type: 'list', itemType: 'compound', items: section.palette.map(writePaletteEntry) };
  const bits = Math.max(4, ceilLog2(section.palette.length));
  if (blockStatesCompound) {
    const states = getCompound(tag, 'block_states') ?? compound();
    states.entries.set('palette', palette);
    if (section.palette.length > 1) {
      states.entries.set('data', { type: 'longArray', value: packIndices(section.data, bits, spanning) });
    } else {
      states.entries.delete('data');
    }
    tag.entries.set('block_states', states);
    if (!getCompound(tag, 'biomes')) tag.entries.set('biomes', neighbourBiomes(list, section.y));
  } else {
    const blockStates: LongArrayTag = { type: 'longArray', value: packIndices(section.data, bits, spanning) };
    tag.entries.set('Palette', palette);
    tag.entries.set('BlockStates', blockStates);
  }
};

/**
 * Writes the sections changed by setBlock back into `model.doc` (palette compacted, packed for the chunk's data
 * version, under the chunk's own keys). When blocks changed, empties `Heightmaps` and sets `isLightOn` to 0 so the
 * game recomputes both on load. Returns `model.doc` and clears `dirty`.
 */
export function applyChunk(model: ChunkModel): NbtDocument {
  const changed = dirtySections.get(model);
  if (model.editable && changed && changed.size > 0) {
    const level = levelTag(model.doc);
    const list = ensureSectionsList(level, model.dataVersion);
    const blockStatesCompound = usesBlockStatesCompound(list, model.dataVersion);
    const spanning = model.dataVersion < NON_SPANNING_VERSION;
    for (const sectionY of [...changed].sort((a, b) => a - b)) {
      const section = model.sections.get(sectionY);
      if (!section) continue;
      compactSection(section);
      writeSectionTag(ensureSectionTag(list, sectionY), section, blockStatesCompound, spanning, list);
    }
    if (getCompound(level, 'Heightmaps')) level.entries.set('Heightmaps', compound());
    level.entries.set('isLightOn', { type: 'byte', value: 0 });
  }
  dirtySections.delete(model);
  model.dirty = false;
  return model.doc;
}

/** Position, version and pruning-relevant fields without decoding sections. */
export function chunkSummary(doc: NbtDocument): ChunkSummary {
  const level = levelTag(doc);
  const { x, z } = chunkCoords(level);
  return {
    x,
    z,
    dataVersion: getNumber(doc.root, 'DataVersion') ?? 0,
    status: getString(level, 'Status'),
    inhabitedTime: getLong(level, 'InhabitedTime') ?? 0n,
    lastUpdate: getLong(level, 'LastUpdate') ?? 0n,
  };
}
