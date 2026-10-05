import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compress } from '../frontend/src/lib/compression.ts';
import { compound, type NbtDocument, NbtError, writeNbt } from '../frontend/src/lib/nbt.ts';
import { readNbtFile, writeNbtFile } from '../frontend/src/lib/nbtFile.ts';

function levelDat(): NbtDocument {
  return {
    name: '',
    root: compound([
      ['LevelName', { type: 'string', value: 'My World \u00e9' }],
      ['RandomSeed', { type: 'long', value: -8_000_000_000_000_000_000n }],
      ['GameType', { type: 'int', value: 1 }],
      ['Data', compound([['Time', { type: 'long', value: 123456n }]])],
    ]),
  };
}

test('gzip, zlib and uncompressed Java files round trip with the detected format', async () => {
  for (const compression of ['gzip', 'zlib', 'none'] as const) {
    const raw = writeNbt(levelDat());
    const file = await compress(raw, compression);
    const { doc, format } = await readNbtFile(file);
    assert.deepEqual(format, { compression, littleEndian: false, bedrockHeaderVersion: null });
    assert.deepEqual(doc, levelDat());
    const written = await writeNbtFile(doc, format);
    if (compression === 'none') assert.deepEqual(written, file);
    const reread = await readNbtFile(written);
    assert.deepEqual(reread.format, format);
    assert.deepEqual(writeNbt(reread.doc), raw);
  }
});

test('Bedrock level.dat with header round trips byte-identically', async () => {
  const payload = writeNbt(levelDat(), { littleEndian: true });
  const file = new Uint8Array(8 + payload.length);
  const view = new DataView(file.buffer);
  view.setInt32(0, 10, true);
  view.setInt32(4, payload.length, true);
  file.set(payload, 8);

  const { doc, format } = await readNbtFile(file);
  assert.deepEqual(format, { compression: 'none', littleEndian: true, bedrockHeaderVersion: 10 });
  assert.deepEqual(doc, levelDat());
  assert.deepEqual(await writeNbtFile(doc, format), file);
});

test('headerless little-endian NBT falls back to little-endian', async () => {
  const file = writeNbt(levelDat(), { littleEndian: true });
  const { doc, format } = await readNbtFile(file);
  assert.deepEqual(format, { compression: 'none', littleEndian: true, bedrockHeaderVersion: null });
  assert.deepEqual(doc, levelDat());
  assert.deepEqual(await writeNbtFile(doc, format), file);
});

test('unreadable files report the big-endian NBT error', async () => {
  await assert.rejects(readNbtFile(Uint8Array.of(10, 0, 5, 0x61)), NbtError);
  await assert.rejects(readNbtFile(new Uint8Array(0)), NbtError);
});
