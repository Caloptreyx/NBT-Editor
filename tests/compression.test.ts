import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compress, decompress, sniffCompression } from '../frontend/src/lib/compression.ts';

const encoder = new TextEncoder();

function lz4Block(method: 0x10 | 0x20, data: number[], originalLength: number): number[] {
  const header = new Uint8Array(21);
  header.set(encoder.encode('LZ4Block'));
  header[8] = method | 6; // 64 KiB block size
  const view = new DataView(header.buffer);
  view.setInt32(9, data.length, true);
  view.setInt32(13, originalLength, true);
  view.setInt32(17, 0x1234567, true); // checksum, not verified
  return [...header, ...data];
}

const endMarker = () => lz4Block(0x10, [], 0);

test('gzip and zlib round trip and are sniffed', async () => {
  const input = encoder.encode('hello hello hello hello region'.repeat(50));
  for (const kind of ['gzip', 'zlib'] as const) {
    const packed = await compress(input, kind);
    assert.equal(sniffCompression(packed), kind);
    assert.ok(packed.length < input.length);
    assert.deepEqual(await decompress(packed, kind), input);
  }
  assert.deepEqual(await compress(input, 'none'), input);
});

test('raw NBT is not mistaken for compressed data', () => {
  assert.equal(sniffCompression(Uint8Array.of(10, 0, 0, 0)), 'none');
  assert.equal(sniffCompression(Uint8Array.of(0x1f)), 'none');
  assert.equal(sniffCompression(new Uint8Array(0)), 'none');
});

test('decompress rejects corrupt deflate data', async () => {
  await assert.rejects(decompress(Uint8Array.of(0x78, 0x9c, 1, 2, 3), 'zlib'));
});

test('decodes LZ4Block frames with raw, literal, overlapping and extended-length sequences', async () => {
  // literals "abc", match offset 3 length 9, final literals "XYZ"
  const short = [0x35, 0x61, 0x62, 0x63, 3, 0, 0x30, 0x58, 0x59, 0x5a];
  // 20 literals (15 + 5), match offset 1 length 300 (4 + 15 + 255 + 26), then 1 trailing literal
  const literals = [...encoder.encode('0123456789abcdefghij')];
  const long = [0xff, 5, ...literals, 1, 0, 255, 26, 0x10, 0x21];
  const raw = [...encoder.encode('raw!')];

  const frame = Uint8Array.from([
    ...lz4Block(0x20, short, 15),
    ...lz4Block(0x10, raw, raw.length),
    ...lz4Block(0x20, long, 321),
    ...endMarker(),
  ]);
  const expected = `abcabcabcabcXYZraw!0123456789abcdefghij${'j'.repeat(300)}!`;
  assert.equal(new TextDecoder().decode(await decompress(frame, 'lz4')), expected);
});

test('decodes concatenated LZ4Block streams', async () => {
  const frame = Uint8Array.from([
    ...lz4Block(0x10, [1, 2], 2),
    ...endMarker(),
    ...lz4Block(0x10, [3], 1),
    ...endMarker(),
  ]);
  assert.deepEqual(await decompress(frame, 'lz4'), Uint8Array.of(1, 2, 3));
});

test('rejects malformed LZ4Block data', async () => {
  const good = lz4Block(0x20, [0x35, 0x61, 0x62, 0x63, 3, 0, 0x30, 0x58, 0x59, 0x5a], 15);
  const badMagic = [...good];
  badMagic[0] = 0;
  await assert.rejects(decompress(Uint8Array.from(badMagic), 'lz4'), /magic/);
  await assert.rejects(decompress(Uint8Array.from(good.slice(0, -1)), 'lz4'), /Truncated/);
  await assert.rejects(decompress(Uint8Array.from(lz4Block(0x20, [0x10, 0x61, 9, 0, 0], 6)), 'lz4'), /offset/);
  await assert.rejects(
    decompress(Uint8Array.from(lz4Block(0x20, [0x35, 0x61, 0x62, 0x63, 3, 0, 0x30, 0x58, 0x59, 0x5a], 16)), 'lz4'),
    /wrong length/,
  );
  await assert.rejects(decompress(Uint8Array.from(lz4Block(0x10, [1, 2], 3)), 'lz4'), /Invalid/);
});
