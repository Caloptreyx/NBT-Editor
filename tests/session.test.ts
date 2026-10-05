import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { compound, type NbtDocument } from '../frontend/src/lib/nbt.ts';
import type { PruneCriteria } from '../frontend/src/lib/prune.ts';
import { chunkIndex, Region } from '../frontend/src/lib/region.ts';
import {
  applyPrune,
  deleteFromSiblings,
  type FileIo,
  formatTicks,
  rectSelection,
  regionFilesIn,
  SessionError,
  scanRegionForPrune,
} from '../frontend/src/lib/session.ts';

const DIM = '/world';
const REGION = `${DIM}/region/r.0.0.mca`;
const ENTITIES = `${DIM}/entities/r.0.0.mca`;
const POI = `${DIM}/poi/r.0.0.mca`;

function chunkDoc(x: number, z: number, inhabited: bigint, status = 'minecraft:full'): NbtDocument {
  return {
    name: '',
    root: compound([
      ['DataVersion', { type: 'int', value: 3953 }],
      ['xPos', { type: 'int', value: x }],
      ['zPos', { type: 'int', value: z }],
      ['Status', { type: 'string', value: status }],
      ['InhabitedTime', { type: 'long', value: inhabited }],
    ]),
  };
}

async function regionBytes(chunks: [number, number, NbtDocument][]): Promise<Uint8Array> {
  const region = Region.empty();
  for (const [lx, lz, doc] of chunks) await region.writeChunk(lx, lz, doc);
  return region.encode();
}

function memoryIo(initial: Record<string, Uint8Array>) {
  const files = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: string[] = [];
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

  const io: FileIo = {
    async read(path) {
      reads.push(path);
      const bytes = files.get(path);
      return bytes ? { bytes, hash: hash(bytes) } : null;
    },
    async write(path, bytes, expectedHash, force = false) {
      const current = files.get(path);
      const matches = expectedHash === null ? current === undefined : current !== undefined && hash(current) === expectedHash;
      if (!force && !matches) throw Object.assign(new Error('conflict'), { response: { status: 409 } });
      writes.push(path);
      files.set(path, bytes.slice());
      return { hash: hash(bytes) };
    },
    async exists(path) {
      return files.has(path);
    },
  };
  return { io, files, reads, writes };
}

const criteria = (overrides: Partial<PruneCriteria>): PruneCriteria => ({
  inhabitedBelowTicks: null,
  unfinishedOnly: false,
  outsideRadius: null,
  ...overrides,
});

const presentSlots = (bytes: Uint8Array) => {
  const region = Region.parse(bytes);
  const slots: number[] = [];
  for (let index = 0; index < 1024; index++) if (region.slot(index & 31, index >> 5)) slots.push(index);
  return slots;
};

test('rectSelection spans both corners in any order, row-major', () => {
  const expected = [chunkIndex(29, 1), chunkIndex(30, 1), chunkIndex(29, 2), chunkIndex(30, 2)];
  assert.deepEqual(rectSelection(chunkIndex(30, 1), chunkIndex(29, 2)), expected);
  assert.deepEqual(rectSelection(chunkIndex(29, 2), chunkIndex(30, 1)), expected);
  assert.deepEqual(rectSelection(chunkIndex(31, 31), chunkIndex(31, 31)), [1023]);
  assert.equal(rectSelection(0, 1023).length, 1024);
});

test('formatTicks renders game time with 20 ticks per second', () => {
  assert.equal(formatTicks(0n), '0s');
  assert.equal(formatTicks(39n), '1s');
  assert.equal(formatTicks(20n * 61n), '1m 1s');
  assert.equal(formatTicks(20n * 3600n), '1h 0m 0s');
  assert.equal(formatTicks(20n * (26n * 3600n + 5n * 60n + 12n)), '26h 5m 12s');
  assert.equal(formatTicks(-100n), '0s');
});

test('regionFilesIn keeps r.<x>.<z>.mca files only, sorted by z then x', () => {
  const entry = (name: string, directory = false) => ({ name, path: `/w/region/${name}`, directory, size: 0 });
  const files = regionFilesIn([
    entry('r.1.0.mca'),
    entry('r.-1.0.mca'),
    entry('r.0.-2.mca'),
    entry('r.0.0.mcc'),
    entry('c.0.0.mcc'),
    entry('r.a.b.mca'),
    entry('r.5.5.mca', true),
  ]);
  assert.deepEqual(
    files.map((file) => [file.name, file.rx, file.rz]),
    [
      ['r.0.-2.mca', 0, -2],
      ['r.-1.0.mca', -1, 0],
      ['r.1.0.mca', 1, 0],
    ],
  );
});

test('prune scan matches by criteria, apply removes the chunks from region and siblings only', async () => {
  const region = await regionBytes([
    [0, 0, chunkDoc(0, 0, 0n)],
    [1, 0, chunkDoc(1, 0, 20n * 600n)],
    [2, 0, chunkDoc(2, 0, 5n, 'minecraft:features')],
    [3, 0, { name: '', root: compound() }],
  ]);
  const entities = await regionBytes([
    [0, 0, { name: '', root: compound([['Entities', { type: 'list', itemType: 'end', items: [] }]]) }],
    [5, 5, { name: '', root: compound() }],
  ]);
  const { io, files, writes } = memoryIo({ [REGION]: region, [ENTITIES]: entities });
  const file = { name: 'r.0.0.mca', path: REGION, rx: 0, rz: 0 };

  const scan = await scanRegionForPrune(file, criteria({ inhabitedBelowTicks: 20 * 60 }), io);
  assert.equal(scan.kind, 'chunks');
  assert.ok(scan.kind === 'chunks');
  assert.deepEqual(scan.matched, [chunkIndex(0, 0), chunkIndex(2, 0)]);
  assert.equal(scan.failed, 1, 'chunk without coordinates is reported, not matched');
  assert.equal(scan.total, 4);

  const unfinished = await scanRegionForPrune(file, criteria({ inhabitedBelowTicks: 20 * 60, unfinishedOnly: true }), io);
  assert.ok(unfinished.kind === 'chunks');
  assert.deepEqual(unfinished.matched, [chunkIndex(2, 0)]);

  const outcome = await applyPrune(file, scan, io);
  assert.equal(outcome.deleted, 2);
  assert.deepEqual(
    outcome.siblings.map((sibling) => [sibling.path, sibling.status]),
    [
      [ENTITIES, 'written'],
      [POI, 'missing'],
    ],
  );
  assert.deepEqual(writes, [REGION, ENTITIES]);
  assert.deepEqual(presentSlots(files.get(REGION) as Uint8Array), [chunkIndex(1, 0), chunkIndex(3, 0)]);
  assert.deepEqual(presentSlots(files.get(ENTITIES) as Uint8Array), [chunkIndex(5, 5)]);
  assert.equal(files.has(POI), false);
});

test('applyPrune refuses a region that changed after the scan', async () => {
  const { io, files, writes } = memoryIo({ [REGION]: await regionBytes([[0, 0, chunkDoc(0, 0, 0n)]]) });
  const file = { name: 'r.0.0.mca', path: REGION, rx: 0, rz: 0 };
  const scan = await scanRegionForPrune(file, criteria({ inhabitedBelowTicks: 100 }), io);

  files.set(REGION, await regionBytes([[0, 0, chunkDoc(0, 0, 0n)], [1, 1, chunkDoc(1, 1, 0n)]]));
  await assert.rejects(applyPrune(file, scan, io), (error) => error instanceof SessionError && error.code === 'changed');
  assert.deepEqual(writes, []);
});

test('regions entirely outside the radius are emptied without reading them', async () => {
  const chunk = await regionBytes([[0, 0, chunkDoc(64, 64, 0n)]]);
  const { io, files, reads, writes } = memoryIo({
    '/world/region/r.2.2.mca': chunk,
    '/world/entities/r.2.2.mca': chunk,
  });
  const file = { name: 'r.2.2.mca', path: '/world/region/r.2.2.mca', rx: 2, rz: 2 };
  const outside = criteria({ outsideRadius: { centerX: 0, centerZ: 0, radius: 1000, shape: 'square' } });

  const scan = await scanRegionForPrune(file, outside, io);
  assert.deepEqual(scan, { kind: 'entire' });

  const outcome = await applyPrune(file, scan, io);
  assert.equal(outcome.deleted, 'all');
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, ['/world/region/r.2.2.mca', '/world/entities/r.2.2.mca']);
  assert.equal(Region.parse(files.get('/world/region/r.2.2.mca') as Uint8Array).chunkCount(), 0);
  assert.equal(files.has('/world/poi/r.2.2.mca'), false);

  const inside = criteria({ outsideRadius: { centerX: 0, centerZ: 0, radius: 1100, shape: 'square' } });
  assert.equal((await scanRegionForPrune(file, inside, io)).kind, 'chunks');
});

test('deleteFromSiblings only writes files that held one of the chunks', async () => {
  const { io, writes } = memoryIo({
    [ENTITIES]: await regionBytes([[4, 4, { name: '', root: compound() }]]),
    [POI]: await regionBytes([[7, 7, { name: '', root: compound() }]]),
  });
  const outcomes = await deleteFromSiblings(REGION, [chunkIndex(7, 7)], io);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ['unchanged', 'written'],
  );
  assert.deepEqual(writes, [POI]);
});
