import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AIR,
  applyChunk,
  type BlockState,
  blockEntities,
  blockStateKey,
  ChunkError,
  type ChunkModel,
  chunkSummary,
  decodeChunk,
  findBlockEntity,
  getBlock,
  parseBlockStateKey,
  setBlock,
} from '../frontend/src/lib/chunk.ts';
import {
  type CompoundTag,
  compound,
  getCompound,
  getList,
  getNumber,
  type ListTag,
  type NbtDocument,
  readNbt,
  type Tag,
  writeNbt,
} from '../frontend/src/lib/nbt.ts';

const MODERN = 3953; // 1.21
const NON_SPANNING = 2586; // 1.16.5, Level wrapper
const SPANNING = 2230; // 1.15.2, Level wrapper

const str = (value: string): Tag => ({ type: 'string', value });
const int = (value: number): Tag => ({ type: 'int', value });
const byte = (value: number): Tag => ({ type: 'byte', value });
const long = (value: bigint): Tag => ({ type: 'long', value });
const list = (itemType: ListTag['itemType'], items: Tag[]): ListTag => ({ type: 'list', itemType, items });

const STONE: BlockState = { name: 'minecraft:stone', properties: null };
const DIRT: BlockState = { name: 'minecraft:dirt', properties: null };
const CHEST_NORTH: BlockState = {
  name: 'minecraft:chest',
  properties: { facing: 'north', type: 'single', waterlogged: 'false' },
};

/** Palette of `size` distinct states; entry 0 is air, every third entry has properties. */
const makePalette = (size: number): BlockState[] =>
  Array.from({ length: size }, (_, i) =>
    i === 0 ? AIR : { name: `minecraft:block_${i}`, properties: i % 3 === 0 ? { level: String(i), axis: 'y' } : null },
  );

/** Uses every palette entry, entry 0 at index 0. */
const pattern = (size: number): number[] => Array.from({ length: 4096 }, (_, i) => (i * 7 + (i >> 9)) % size);

/** Straightforward BigInt packing as described on the wiki, independent of the code under test. */
function referencePack(indices: number[], bits: number, spanning: boolean): BigInt64Array {
  const perLong = Math.floor(64 / bits);
  const longs = new BigUint64Array(spanning ? (4096 * bits) / 64 : Math.ceil(4096 / perLong));
  indices.forEach((value, i) => {
    const bit = spanning ? i * bits : Math.floor(i / perLong) * 64 + (i % perLong) * bits;
    const index = Math.floor(bit / 64);
    const shift = BigInt(bit % 64);
    longs[index] |= BigInt(value) << shift;
    if ((bit % 64) + bits > 64) longs[index + 1] |= BigInt(value) >> (64n - shift);
  });
  return new BigInt64Array(longs.buffer);
}

const paletteTag = (palette: BlockState[]): ListTag =>
  list(
    'compound',
    palette.map((state) => {
      const entry = compound([['Name', str(state.name)]]);
      if (state.properties) {
        entry.entries.set('Properties', compound(Object.entries(state.properties).map(([k, v]) => [k, str(v)])));
      }
      return entry;
    }),
  );

interface SectionSpec {
  y: number;
  palette: BlockState[];
  indices?: number[];
  biome?: string | null;
}

const bitsFor = (size: number) => Math.max(4, Math.ceil(Math.log2(size)));

function modernChunk(
  sections: SectionSpec[],
  options: { x?: number; z?: number; blockEntities?: CompoundTag[] } = {},
): NbtDocument {
  const sectionTags = sections.map((spec) => {
    const states = compound([['palette', paletteTag(spec.palette)]]);
    if (spec.palette.length > 1) {
      const indices = spec.indices ?? pattern(spec.palette.length);
      states.entries.set('data', {
        type: 'longArray',
        value: referencePack(indices, bitsFor(spec.palette.length), false),
      });
    }
    const tag = compound([
      ['Y', byte(spec.y)],
      ['block_states', states],
    ]);
    if (spec.biome !== null)
      tag.entries.set('biomes', compound([['palette', list('string', [str(spec.biome ?? 'minecraft:plains')])]]));
    return tag;
  });
  return {
    name: '',
    root: compound([
      ['DataVersion', int(MODERN)],
      ['xPos', int(options.x ?? 0)],
      ['yPos', int(-4)],
      ['zPos', int(options.z ?? 0)],
      ['Status', str('minecraft:full')],
      ['LastUpdate', long(123456789n)],
      ['InhabitedTime', long(4000n)],
      ['sections', list('compound', sectionTags)],
      ['block_entities', list(options.blockEntities?.length ? 'compound' : 'end', options.blockEntities ?? [])],
      ['Heightmaps', compound([['MOTION_BLOCKING', { type: 'longArray', value: new BigInt64Array(37) }]])],
      ['isLightOn', byte(1)],
    ]),
  };
}

function legacyChunk(
  dataVersion: number,
  sections: SectionSpec[] | null,
  options: { status?: string } = {},
): NbtDocument {
  const spanning = dataVersion < 2529;
  const level = compound([
    ['xPos', int(-1)],
    ['zPos', int(5)],
    ['Status', str(options.status ?? 'full')],
    ['LastUpdate', long(77n)],
    ['InhabitedTime', long(12n)],
    ['TileEntities', list('end', [])],
    ['Heightmaps', compound([['WORLD_SURFACE', { type: 'longArray', value: new BigInt64Array(36) }]])],
    ['isLightOn', byte(1)],
  ]);
  if (sections) {
    level.entries.set(
      'Sections',
      list(
        'compound',
        sections.map((spec) => {
          const indices =
            spec.palette.length > 1 ? (spec.indices ?? pattern(spec.palette.length)) : new Array(4096).fill(0);
          return compound([
            ['Y', byte(spec.y)],
            ['Palette', paletteTag(spec.palette)],
            [
              'BlockStates',
              { type: 'longArray', value: referencePack(indices, bitsFor(spec.palette.length), spanning) },
            ],
          ]);
        }),
      ),
    );
  }
  return {
    name: '',
    root: compound([
      ['DataVersion', int(dataVersion)],
      ['Level', level],
    ]),
  };
}

const fullSections = (from: number, to: number): SectionSpec[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ y: from + i, palette: [AIR] }));

/** Every block of the chunk as state keys, bottom to top. */
function snapshot(model: ChunkModel): string[] {
  const keys: string[] = [];
  for (let y = model.minY; y <= model.maxY; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) keys.push(blockStateKey(getBlock(model, x, y, z)));
    }
  }
  return keys;
}

const sectionTag = (doc: NbtDocument, key: string, y: number): CompoundTag => {
  const level = getCompound(doc.root, 'Level') ?? doc.root;
  const sections = getList(level, key);
  assert.ok(sections, `${key} list exists`);
  const tag = sections.items.find((item) => item.type === 'compound' && getNumber(item, 'Y') === y);
  assert.ok(tag && tag.type === 'compound', `section ${y} exists`);
  return tag;
};

const longArray = (tag: Tag | null | undefined): BigInt64Array => {
  assert.ok(tag && tag.type === 'longArray', 'long array');
  return tag.value;
};

describe('block state keys', () => {
  test('sorts properties and parses back', () => {
    const key = blockStateKey({ name: 'minecraft:oak_stairs', properties: { half: 'bottom', facing: 'north' } });
    assert.equal(key, 'minecraft:oak_stairs[facing=north,half=bottom]');
    assert.deepEqual(parseBlockStateKey(key), {
      name: 'minecraft:oak_stairs',
      properties: { facing: 'north', half: 'bottom' },
    });
    assert.equal(blockStateKey({ name: 'minecraft:stone', properties: {} }), 'minecraft:stone');
  });

  test('adds the minecraft namespace and tolerates spacing and case', () => {
    assert.deepEqual(parseBlockStateKey(' Stone '), { name: 'minecraft:stone', properties: null });
    assert.deepEqual(parseBlockStateKey('mymod:pipe[ north = true , up=false ]'), {
      name: 'mymod:pipe',
      properties: { north: 'true', up: 'false' },
    });
    assert.deepEqual(parseBlockStateKey('stone[]'), { name: 'minecraft:stone', properties: null });
  });

  test('rejects malformed keys', () => {
    for (const text of [
      '',
      'minecraft:',
      ':stone',
      'stone[facing]',
      'stone[a=1,a=2]',
      'stone[a=1',
      'st one',
      'a:b:c',
    ]) {
      assert.equal(parseBlockStateKey(text), null, text);
    }
  });
});

describe('decodeChunk', () => {
  for (const [label, dataVersion] of [
    ['spanning (1.15)', SPANNING],
    ['non-spanning (1.16)', NON_SPANNING],
    ['1.18+ block_states', MODERN],
  ] as const) {
    for (const size of [1, 2, 16, 17, 33]) {
      test(`${label}: palette of ${size} decodes and re-encodes bit-exact`, () => {
        const palette = makePalette(size);
        const indices = size > 1 ? pattern(size) : new Array(4096).fill(0);
        const doc =
          dataVersion === MODERN ? modernChunk([{ y: 2, palette }]) : legacyChunk(dataVersion, [{ y: 2, palette }]);
        const model = decodeChunk(doc);
        for (let i = 0; i < 4096; i++) {
          const x = i & 15;
          const z = (i >> 4) & 15;
          const y = 32 + (i >> 8);
          assert.equal(getBlock(model, x, y, z), model.sections.get(2)?.palette[indices[i]]);
          assert.equal(blockStateKey(getBlock(model, x, y, z)), blockStateKey(palette[indices[i]]));
        }

        // Every entry stays in use, so the palette keeps its order and the data must equal the reference packing.
        const replacement = size > 1 ? palette[size - 1] : STONE;
        assert.equal(setBlock(model, 0, 32, 0, replacement), true);
        const expectedPalette = size > 1 ? palette : [AIR, STONE];
        const expected = [...indices];
        expected[0] = expectedPalette.indexOf(replacement);
        const before = snapshot(model);
        applyChunk(model);

        const tag = sectionTag(doc, dataVersion === MODERN ? 'sections' : 'Sections', 2);
        const states = dataVersion === MODERN ? getCompound(tag, 'block_states') : tag;
        assert.ok(states);
        const written = longArray(states.entries.get(dataVersion === MODERN ? 'data' : 'BlockStates'));
        assert.deepEqual(written, referencePack(expected, bitsFor(expectedPalette.length), dataVersion < 2529));
        const writtenPalette = getList(states, dataVersion === MODERN ? 'palette' : 'Palette');
        assert.deepEqual(writtenPalette, paletteTag(expectedPalette));
        assert.deepEqual(snapshot(decodeChunk(doc)), before);
      });
    }
  }

  test('4-bit packing matches the documented layout', () => {
    const doc = modernChunk([{ y: 0, palette: makePalette(16) }]);
    const states = getCompound(sectionTag(doc, 'sections', 0), 'block_states');
    assert.ok(states);
    // Entry i of each long sits at bits 4i..4i+3: indices 0..15 read as the nibbles 0x0..0xf from the low end.
    const ascending = new BigInt64Array(256).fill(BigInt.asIntN(64, 0xfedcba9876543210n));
    states.entries.set('data', { type: 'longArray', value: ascending });
    const model = decodeChunk(doc);
    for (let x = 0; x < 16; x++) assert.equal(getBlock(model, x, 0, 0).name, makePalette(16)[x].name);
    assert.equal(getBlock(model, 15, 15, 15).name, makePalette(16)[15].name);

    // Mark the section changed through the public API without altering the pattern.
    setBlock(model, 0, 0, 0, STONE);
    setBlock(model, 0, 0, 0, AIR);
    applyChunk(model);
    assert.deepEqual(longArray(states.entries.get('data')), ascending);
  });

  test('a single-entry 1.18+ section has no data array and fills the section', () => {
    const model = decodeChunk(modernChunk([{ y: 0, palette: [STONE] }]));
    assert.equal(model.sections.get(0)?.data, null);
    assert.deepEqual(getBlock(model, 15, 15, 15), STONE);
    assert.deepEqual(getBlock(model, 0, 0, 0), STONE);
  });

  test('accepts wider-than-needed packing and rejects data that fits no width', () => {
    const wide = modernChunk([{ y: 0, palette: [AIR, STONE] }]);
    const states = getCompound(sectionTag(wide, 'sections', 0), 'block_states');
    assert.ok(states);
    states.entries.set('data', { type: 'longArray', value: referencePack(pattern(2), 7, false) });
    const model = decodeChunk(wide);
    assert.deepEqual(getBlock(model, 1, 0, 0), STONE);
    assert.deepEqual(getBlock(model, 2, 0, 0), AIR);

    states.entries.set('data', { type: 'longArray', value: new BigInt64Array(100) });
    assert.throws(() => decodeChunk(wide), ChunkError);
  });

  test('rejects palette indices beyond the palette', () => {
    const doc = modernChunk([{ y: 0, palette: [AIR, STONE], indices: new Array(4096).fill(2) }]);
    assert.throws(() => decodeChunk(doc), ChunkError);
  });

  test('requires chunk coordinates', () => {
    const doc = modernChunk([]);
    doc.root.entries.delete('xPos');
    assert.throws(() => decodeChunk(doc), ChunkError);
    assert.throws(() => chunkSummary(doc), ChunkError);
  });

  test('reads the Y range per format', () => {
    const modern = decodeChunk(modernChunk(fullSections(-4, 19)));
    assert.equal(modern.minY, -64);
    assert.equal(modern.maxY, 319);

    const netherDoc = modernChunk(fullSections(0, 15));
    netherDoc.root.entries.set('yPos', int(0));
    const nether = decodeChunk(netherDoc);
    assert.equal(nether.minY, 0);
    assert.equal(nether.maxY, 255);

    const old = decodeChunk(legacyChunk(NON_SPANNING, [{ y: 3, palette: [STONE] }]));
    assert.equal(old.minY, 0);
    assert.equal(old.maxY, 255);

    const tall = decodeChunk(
      legacyChunk(2724, [
        { y: -2, palette: [STONE] },
        { y: 18, palette: [STONE] },
      ]),
    );
    assert.equal(tall.minY, -32);
    assert.equal(tall.maxY, 303);
  });

  test('ignores light-only sections', () => {
    const doc = legacyChunk(NON_SPANNING, [{ y: 0, palette: [STONE] }]);
    getList(getCompound(doc.root, 'Level') ?? doc.root, 'Sections')?.items.push(
      compound([
        ['Y', byte(-1)],
        ['SkyLight', { type: 'byteArray', value: new Int8Array(2048) }],
      ]),
    );
    const model = decodeChunk(doc);
    assert.deepEqual([...model.sections.keys()], [0]);
    assert.equal(model.minY, 0);
  });

  test('pre-1.13 chunks are read-only without sections', () => {
    const level = compound([
      ['xPos', int(3)],
      ['zPos', int(4)],
      ['InhabitedTime', long(9n)],
      [
        'Sections',
        list('compound', [
          compound([
            ['Y', byte(0)],
            ['Blocks', { type: 'byteArray', value: new Int8Array(4096).fill(1) }],
            ['Data', { type: 'byteArray', value: new Int8Array(2048) }],
          ]),
        ]),
      ],
    ]);
    for (const root of [
      compound([
        ['DataVersion', int(1343)],
        ['Level', level],
      ]),
      compound([['Level', level]]),
      compound([
        ['DataVersion', int(1631)],
        ['Level', level],
      ]),
    ]) {
      const doc: NbtDocument = { name: '', root };
      const model = decodeChunk(doc);
      assert.equal(model.editable, false);
      assert.match(model.readOnlyReason ?? '', /1\.13/);
      assert.equal(model.sections.size, 0);
      assert.deepEqual(getBlock(model, 0, 10, 0), AIR);
      assert.equal(setBlock(model, 0, 10, 0, STONE), false);
      assert.equal(applyChunk(model), doc);
      assert.equal(level.entries.has('isLightOn'), false);
      assert.equal(model.inhabitedTime, 9n);
    }
  });

  test('summary and model share metadata, statuses as stored', () => {
    const modern = modernChunk([], { x: -7, z: 12 });
    assert.deepEqual(chunkSummary(modern), {
      x: -7,
      z: 12,
      dataVersion: MODERN,
      status: 'minecraft:full',
      inhabitedTime: 4000n,
      lastUpdate: 123456789n,
    });
    const model = decodeChunk(modern);
    assert.equal(model.x, -7);
    assert.equal(model.z, 12);
    assert.equal(model.status, 'minecraft:full');

    const old = legacyChunk(NON_SPANNING, null, { status: 'features' });
    assert.deepEqual(chunkSummary(old), {
      x: -1,
      z: 5,
      dataVersion: NON_SPANNING,
      status: 'features',
      inhabitedTime: 12n,
      lastUpdate: 77n,
    });
  });
});

describe('setBlock', () => {
  test('sets and gets across section boundaries and negative Y', () => {
    const doc = modernChunk(fullSections(-4, 19));
    const model = decodeChunk(doc);
    const placed: [number, number, number, BlockState][] = [
      [0, -64, 0, STONE],
      [15, -17, 15, DIRT],
      [3, -16, 4, STONE],
      [3, -1, 4, DIRT],
      [3, 0, 4, CHEST_NORTH],
      [3, 15, 4, STONE],
      [3, 16, 4, DIRT],
      [15, 319, 15, STONE],
    ];
    for (const [x, y, z, state] of placed) assert.equal(setBlock(model, x, y, z, state), true);
    for (const [x, y, z, state] of placed) assert.deepEqual(getBlock(model, x, y, z), state);
    assert.deepEqual(getBlock(model, 3, -2, 4), AIR);
    assert.deepEqual(getBlock(model, 3, 1, 4), AIR);
    assert.deepEqual(getBlock(model, 4, 0, 4), AIR);
    assert.equal(model.dirty, true);

    for (const [x, y, z] of [
      [0, 320, 0],
      [0, -65, 0],
      [16, 0, 0],
      [0, 0, -1],
      [0.5, 0, 0],
    ]) {
      assert.equal(setBlock(model, x, y, z, STONE), false, `${x},${y},${z}`);
      assert.deepEqual(getBlock(model, x, y, z), AIR);
    }

    const before = snapshot(model);
    applyChunk(model);
    assert.equal(model.dirty, false);
    assert.deepEqual(snapshot(decodeChunk(doc)), before);
    assert.deepEqual(snapshot(model), before);
  });

  test('copies the state so later caller mutations do not leak into the chunk', () => {
    const model = decodeChunk(modernChunk(fullSections(-4, 19)));
    const state: BlockState = { name: 'minecraft:oak_log', properties: { axis: 'y' } };
    setBlock(model, 1, 1, 1, state);
    if (state.properties) state.properties.axis = 'x';
    assert.equal(blockStateKey(getBlock(model, 1, 1, 1)), 'minecraft:oak_log[axis=y]');
  });

  test('creates a missing 1.18+ section with biomes from the nearest section', () => {
    const doc = modernChunk([
      { y: -4, palette: [STONE], biome: 'minecraft:deep_dark' },
      { y: 0, palette: [AIR, DIRT], biome: 'minecraft:forest' },
      { y: 19, palette: [AIR], biome: 'minecraft:the_void' },
    ]);
    const model = decodeChunk(doc);
    assert.equal(model.maxY, 319);
    assert.equal(model.sections.has(2), false);
    assert.equal(setBlock(model, 5, 40, 6, STONE), true);
    assert.deepEqual(model.sections.get(2)?.palette, [AIR, STONE]);
    applyChunk(model);

    const sections = getList(doc.root, 'sections');
    assert.deepEqual(
      sections?.items.map((item) => (item.type === 'compound' ? getNumber(item, 'Y') : null)),
      [-4, 0, 2, 19],
    );
    const created = sectionTag(doc, 'sections', 2);
    const biomes = getCompound(created, 'biomes');
    const forest = getCompound(sectionTag(doc, 'sections', 0), 'biomes');
    assert.deepEqual(biomes, forest);
    assert.notEqual(biomes, forest);
    const reread = decodeChunk(doc);
    assert.deepEqual(getBlock(reread, 5, 40, 6), STONE);
    assert.deepEqual(getBlock(reread, 5, 41, 6), AIR);
    assert.equal(doc.root.entries.has('Sections'), false);
  });

  test('a created 1.18+ section falls back to plains', () => {
    const doc = modernChunk([
      { y: -4, palette: [STONE], biome: null },
      { y: 19, palette: [AIR], biome: null },
    ]);
    const model = decodeChunk(doc);
    setBlock(model, 0, 0, 0, STONE);
    applyChunk(model);
    assert.deepEqual(
      getCompound(sectionTag(doc, 'sections', 0), 'biomes'),
      compound([['palette', list('string', [str('minecraft:plains')])]]),
    );
  });

  test('creates 1.13-1.17 sections and the sections list under Level', () => {
    const doc = legacyChunk(NON_SPANNING, null);
    const model = decodeChunk(doc);
    assert.equal(model.sections.size, 0);
    assert.equal(setBlock(model, 1, 100, 2, STONE), true);
    assert.equal(setBlock(model, 1, 10, 2, DIRT), true);
    applyChunk(model);

    const level = getCompound(doc.root, 'Level');
    assert.ok(level);
    assert.equal(doc.root.entries.has('sections'), false);
    assert.equal(level.entries.has('sections'), false);
    const sections = getList(level, 'Sections');
    assert.deepEqual(
      sections?.items.map((item) => (item.type === 'compound' ? getNumber(item, 'Y') : null)),
      [0, 6],
    );
    const created = sectionTag(doc, 'Sections', 6);
    assert.equal(created.entries.has('block_states'), false);
    assert.equal(created.entries.has('biomes'), false);
    assert.equal(longArray(created.entries.get('BlockStates')).length, 256);
    const reread = decodeChunk(doc);
    assert.deepEqual(getBlock(reread, 1, 100, 2), STONE);
    assert.deepEqual(getBlock(reread, 1, 10, 2), DIRT);
    assert.equal(getNumber(level, 'isLightOn'), 0);
  });

  test('removes the block entity when the block id changes, keeps it on property changes', () => {
    const chest = compound([
      ['id', str('minecraft:chest')],
      ['x', int(2 * 16 + 3)],
      ['y', int(64)],
      ['z', int(-3 * 16 + 4)],
      ['Items', list('end', [])],
    ]);
    const sign = compound([
      ['id', str('minecraft:sign')],
      ['x', int(2 * 16 + 5)],
      ['y', int(70)],
      ['z', int(-3 * 16 + 5)],
    ]);
    const indices = new Array(4096).fill(0);
    indices[(0 * 16 + 4) * 16 + 3] = 1;
    indices[(6 * 16 + 5) * 16 + 5] = 2;
    const doc = modernChunk(
      [
        ...fullSections(-4, 3),
        { y: 4, palette: [AIR, CHEST_NORTH, { name: 'minecraft:oak_sign', properties: { rotation: '0' } }], indices },
        ...fullSections(5, 19),
      ],
      { x: 2, z: -3, blockEntities: [chest, sign] },
    );
    const model = decodeChunk(doc);
    assert.equal(findBlockEntity(model, 3, 64, 4), chest);
    assert.equal(findBlockEntity(model, 5, 70, 5), sign);
    assert.equal(findBlockEntity(model, 3, 65, 4), null);

    const south = { ...CHEST_NORTH, properties: { ...CHEST_NORTH.properties, facing: 'south' } };
    assert.equal(setBlock(model, 3, 64, 4, south), true);
    assert.equal(findBlockEntity(model, 3, 64, 4), chest);

    assert.equal(setBlock(model, 3, 64, 4, STONE), true);
    assert.equal(findBlockEntity(model, 3, 64, 4), null);
    assert.deepEqual(blockEntities(model), [sign]);
    applyChunk(model);
    assert.deepEqual(getList(doc.root, 'block_entities')?.items, [sign]);
  });
});

describe('applyChunk', () => {
  test('drops the data of a section that became all air and resets heightmaps and light', () => {
    const indices = new Array(4096).fill(0);
    indices[100] = 1;
    const doc = modernChunk([
      ...fullSections(-4, -1),
      { y: 0, palette: [AIR, STONE], indices },
      ...fullSections(1, 19),
    ]);
    const model = decodeChunk(doc);
    assert.equal(setBlock(model, 100 & 15, 0, 100 >> 4, AIR), true);
    assert.equal(applyChunk(model), doc);
    const states = getCompound(sectionTag(doc, 'sections', 0), 'block_states');
    assert.ok(states);
    assert.deepEqual(getList(states, 'palette'), paletteTag([AIR]));
    assert.equal(states.entries.has('data'), false);
    assert.deepEqual(getCompound(doc.root, 'Heightmaps'), compound());
    assert.deepEqual(doc.root.entries.get('isLightOn'), byte(0));
    assert.equal(model.sections.get(0)?.data, null);
  });

  test('compacts palettes left with unused entries', () => {
    const doc = legacyChunk(SPANNING, [{ y: 1, palette: makePalette(17) }]);
    const model = decodeChunk(doc);
    // Replace everything that is not air or block_1 with block_1: 15 of 17 entries become unused.
    for (let y = 16; y < 32; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          if (getBlock(model, x, y, z).name !== AIR.name) setBlock(model, x, y, z, makePalette(2)[1]);
        }
      }
    }
    const before = snapshot(model);
    applyChunk(model);
    const tag = sectionTag(doc, 'Sections', 1);
    assert.deepEqual(getList(tag, 'Palette'), paletteTag(makePalette(2)));
    assert.equal(longArray(tag.entries.get('BlockStates')).length, 256);
    assert.deepEqual(snapshot(decodeChunk(doc)), before);
  });

  test('leaves the document alone when no block changed', () => {
    const doc = modernChunk(fullSections(-4, 19));
    const model = decodeChunk(doc);
    setBlock(model, 0, 0, 0, AIR);
    model.dirty = true;
    applyChunk(model);
    assert.equal(model.dirty, false);
    assert.equal(getCompound(doc.root, 'Heightmaps')?.entries.size, 1);
    assert.deepEqual(doc.root.entries.get('isLightOn'), byte(1));
  });

  test('output survives NBT serialization and re-decodes identically', () => {
    for (const doc of [
      modernChunk([
        ...fullSections(-4, -2),
        { y: -1, palette: makePalette(33) },
        { y: 0, palette: makePalette(5) },
        ...fullSections(2, 19),
      ]),
      legacyChunk(SPANNING, [
        { y: 0, palette: makePalette(17) },
        { y: 3, palette: makePalette(2) },
      ]),
    ]) {
      const model = decodeChunk(doc);
      for (let i = 0; i < 200; i++) {
        const y = model.minY + ((i * 37) % (model.maxY - model.minY + 1));
        setBlock(
          model,
          i % 16,
          y,
          (i * 5) % 16,
          i % 2 ? STONE : { name: 'minecraft:glass_pane', properties: { east: String(i % 3 === 0) } },
        );
      }
      const before = snapshot(model);
      const reread = decodeChunk(readNbt(writeNbt(applyChunk(model))));
      assert.deepEqual(snapshot(reread), before);
      assert.equal(reread.minY, model.minY);
      assert.equal(reread.maxY, model.maxY);
      assert.equal(reread.dataVersion, model.dataVersion);
    }
  });
});
