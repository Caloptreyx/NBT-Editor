import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compress } from '../frontend/src/lib/compression.ts';
import { compound, getNumber, type NbtDocument, writeNbt } from '../frontend/src/lib/nbt.ts';
import { chunkIndex, parseRegionFileName, Region, RegionError } from '../frontend/src/lib/region.ts';

const SECTOR = 4096;

function chunkDoc(x: number, z: number, extra = 0): NbtDocument {
  return {
    name: '',
    root: compound([
      ['xPos', { type: 'int', value: x }],
      ['zPos', { type: 'int', value: z }],
      ['blob', { type: 'longArray', value: new BigInt64Array(extra).map((_, i) => BigInt(i) * 0x0101010101n) }],
    ]),
  };
}

interface RawChunk {
  lx: number;
  lz: number;
  sector: number;
  sectors: number;
  payload: Uint8Array;
  compression: number;
  timestamp?: number;
  declaredLength?: number;
}

function buildRegion(chunks: RawChunk[], totalSectors: number): Uint8Array {
  const out = new Uint8Array(totalSectors * SECTOR);
  const view = new DataView(out.buffer);
  for (const c of chunks) {
    const index = chunkIndex(c.lx, c.lz);
    view.setUint32(index * 4, (c.sector << 8) | c.sectors);
    view.setUint32(SECTOR + index * 4, c.timestamp ?? 0);
    const start = c.sector * SECTOR;
    if (start + 5 > out.length) continue;
    view.setInt32(start, c.declaredLength ?? c.payload.length + 1);
    out[start + 4] = c.compression;
    out.set(c.payload.subarray(0, Math.max(0, out.length - start - 5)), start + 5);
  }
  return out;
}

test('parses chunks in every supported compression', async () => {
  const raw = writeNbt(chunkDoc(1, 2));
  const lz4 = Uint8Array.from([
    ...new TextEncoder().encode('LZ4Block'),
    0x16,
    ...new Uint8Array(new Int32Array([raw.length, raw.length, 0]).buffer),
    ...raw,
    ...new TextEncoder().encode('LZ4Block'),
    0x16,
    ...new Uint8Array(12),
  ]);
  const bytes = buildRegion(
    [
      { lx: 0, lz: 0, sector: 2, sectors: 1, payload: await compress(raw, 'gzip'), compression: 1, timestamp: 1700000000 },
      { lx: 1, lz: 0, sector: 3, sectors: 1, payload: await compress(raw, 'zlib'), compression: 2 },
      { lx: 0, lz: 1, sector: 4, sectors: 1, payload: raw, compression: 3 },
      { lx: 31, lz: 31, sector: 5, sectors: 1, payload: lz4, compression: 4 },
    ],
    6,
  );
  const region = Region.parse(bytes);
  assert.deepEqual(region.problems, []);
  assert.equal(region.chunkCount(), 4);
  assert.equal(region.slot(0, 0)?.timestamp, 1700000000);
  assert.equal(region.slot(-1, -1)?.compression, 4);
  for (const [lx, lz] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [31, 31],
  ]) {
    assert.deepEqual(await region.readChunk(lx, lz), chunkDoc(1, 2));
  }
  assert.equal(await region.readChunk(5, 5), null);
  assert.equal(region.dirty, false);
});

test('records problems for garbage slots instead of throwing', async () => {
  const payload = await compress(writeNbt(chunkDoc(0, 0)), 'zlib');
  const bytes = buildRegion(
    [
      { lx: 0, lz: 0, sector: 2, sectors: 1, payload, compression: 2 },
      { lx: 1, lz: 0, sector: 1, sectors: 1, payload, compression: 2 }, // points into header
      { lx: 2, lz: 0, sector: 3, sectors: 0, payload, compression: 2 }, // zero sectors
      { lx: 3, lz: 0, sector: 900, sectors: 1, payload, compression: 2 }, // beyond end
      { lx: 4, lz: 0, sector: 3, sectors: 1, payload, compression: 2, declaredLength: 0 }, // zero length
      { lx: 5, lz: 0, sector: 4, sectors: 1, payload, compression: 2, declaredLength: 9000 }, // longer than sectors
      { lx: 6, lz: 0, sector: 2, sectors: 1, payload, compression: 2 }, // overlaps 0,0
      { lx: 7, lz: 0, sector: 5, sectors: 1, payload: Uint8Array.of(1, 2, 3), compression: 2 }, // bad zlib
      { lx: 8, lz: 0, sector: 6, sectors: 1, payload, compression: 127 }, // custom compression
      { lx: 9, lz: 0, sector: 7, sectors: 1, payload: new Uint8Array(0), compression: 0x82 }, // external
    ],
    8,
  );
  const region = Region.parse(bytes);
  const problemSlots = region.problems.map((p) => `${p.lx},${p.lz}`);
  assert.deepEqual(problemSlots, ['1,0', '2,0', '3,0', '4,0', '5,0', '6,0']);
  for (const lx of [1, 2, 3, 4, 5]) assert.equal(region.slot(lx, 0), null);
  assert.deepEqual(await region.readChunk(0, 0), chunkDoc(0, 0));
  assert.deepEqual(await region.readChunk(6, 0), chunkDoc(0, 0));

  await assert.rejects(region.readChunk(7, 0), (e) => e instanceof RegionError && e.code === 'corrupt');
  await assert.rejects(
    region.readChunk(8, 0),
    (e) => e instanceof RegionError && e.code === 'unsupportedCompression',
  );
  const external = region.slot(9, 0);
  assert.equal(external?.external, true);
  assert.equal(external?.compression, 2);
  await assert.rejects(region.readChunk(9, 0), (e) => e instanceof RegionError && e.code === 'external');

  const reparsed = Region.parse(region.encode());
  assert.deepEqual(reparsed.problems, []);
  assert.equal(reparsed.chunkCount(), 5);
  assert.equal(reparsed.slot(9, 0)?.external, true);
  assert.deepEqual(reparsed.slot(8, 0)?.payload, payload);
});

test('handles empty and truncated files', () => {
  const empty = Region.parse(new Uint8Array(0));
  assert.equal(empty.chunkCount(), 0);
  assert.deepEqual(empty.problems, []);
  const truncated = Region.parse(new Uint8Array(100));
  assert.equal(truncated.problems.length, 1);
  assert.match(truncated.problems[0].message, /truncated/);
});

test('parse, write, delete, encode, parse keeps everything consistent', async () => {
  const before = Math.floor(Date.now() / 1000);
  const region = Region.empty();
  await region.writeChunk(0, 0, chunkDoc(0, 0));
  await region.writeChunk(3, 4, chunkDoc(3, 4, 2000)); // larger than one sector
  await region.writeChunk(31, 31, chunkDoc(31, 31));
  assert.equal(region.dirty, true);
  region.markClean();

  const parsed = Region.parse(region.encode());
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.chunkCount(), 3);
  assert.ok((parsed.slot(3, 4)?.timestamp ?? 0) >= before);
  assert.equal(parsed.slot(3, 4)?.compression, 2);

  await parsed.writeChunk(3, 4, chunkDoc(3, 4, 5000));
  parsed.deleteChunk(0, 0);
  parsed.deleteChunk(10, 10);
  await parsed.writeChunk(-1, 0, chunkDoc(-1, 0));
  assert.equal(parsed.dirty, true);

  const encoded = parsed.encode();
  assert.equal(encoded.length % SECTOR, 0);
  const view = new DataView(encoded.buffer);
  let expectedSector = 2;
  for (let index = 0; index < 1024; index++) {
    const entry = view.getUint32(index * 4);
    if (entry === 0) continue;
    assert.equal(entry >>> 8, expectedSector);
    const length = view.getInt32((entry >>> 8) * SECTOR);
    assert.equal(entry & 0xff, Math.ceil((length + 4) / SECTOR));
    expectedSector += entry & 0xff;
  }
  assert.equal(expectedSector * SECTOR, encoded.length);

  const reparsed = Region.parse(encoded);
  assert.deepEqual(reparsed.problems, []);
  assert.equal(reparsed.chunkCount(), 3);
  assert.equal(reparsed.slot(0, 0), null);
  assert.deepEqual(await reparsed.readChunk(3, 4), chunkDoc(3, 4, 5000));
  assert.deepEqual(await reparsed.readChunk(31, 0), chunkDoc(-1, 0));
  assert.equal(getNumber((await reparsed.readChunk(31, 31))?.root ?? compound(), 'xPos'), 31);
  assert.deepEqual(reparsed.encode(), encoded);
});

test('deleting or rewriting a broken slot clears its problem', async () => {
  const bytes = buildRegion(
    [
      { lx: 0, lz: 0, sector: 1, sectors: 1, payload: new Uint8Array(1), compression: 2 },
      { lx: 1, lz: 0, sector: 1, sectors: 1, payload: new Uint8Array(1), compression: 2 },
    ],
    2,
  );
  const region = Region.parse(bytes);
  assert.equal(region.problems.length, 2);
  region.deleteChunk(0, 0);
  await region.writeChunk(1, 0, chunkDoc(1, 0));
  assert.deepEqual(region.problems, []);
  assert.equal(region.dirty, true);
});

test('refuses chunks larger than 255 sectors', async () => {
  const region = Region.empty();
  const huge: NbtDocument = {
    name: '',
    root: compound([['noise', { type: 'byteArray', value: Int8Array.from(randomBytes(1_100_000)) }]]),
  };
  await assert.rejects(region.writeChunk(0, 0, huge), (e) => e instanceof RegionError && e.code === 'corrupt');
  assert.equal(region.chunkCount(), 0);
});

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = 0x12345678;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

test('parses region file names', () => {
  assert.deepEqual(parseRegionFileName('r.-1.12.mca'), { rx: -1, rz: 12 });
  assert.deepEqual(parseRegionFileName('/world/region/r.0.0.mca'), { rx: 0, rz: 0 });
  assert.equal(parseRegionFileName('r.0.0.mcr'), null);
  assert.equal(parseRegionFileName('r.a.0.mca'), null);
});
