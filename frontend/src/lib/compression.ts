export type Compression = 'gzip' | 'zlib' | 'none' | 'lz4';

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decompress(bytes: Uint8Array, compression: Compression): Promise<Uint8Array> {
  switch (compression) {
    case 'gzip':
      return pipe(bytes, new DecompressionStream('gzip'));
    case 'zlib':
      return pipe(bytes, new DecompressionStream('deflate'));
    case 'lz4':
      return decompressLz4Block(bytes);
    case 'none':
      return bytes;
  }
}

export async function compress(bytes: Uint8Array, compression: 'gzip' | 'zlib' | 'none'): Promise<Uint8Array> {
  switch (compression) {
    case 'gzip':
      return pipe(bytes, new CompressionStream('gzip'));
    case 'zlib':
      return pipe(bytes, new CompressionStream('deflate'));
    case 'none':
      return bytes;
  }
}

export function sniffCompression(bytes: Uint8Array): 'gzip' | 'zlib' | 'none' {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
  if (bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && bytes[0] >> 4 <= 7 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) {
    return 'zlib';
  }
  return 'none';
}

// "LZ4Block" as written by lz4-java's LZ4BlockOutputStream.
const LZ4_MAGIC = [0x4c, 0x5a, 0x34, 0x42, 0x6c, 0x6f, 0x63, 0x6b];
const LZ4_HEADER_LENGTH = 21;
const LZ4_METHOD_RAW = 0x10;
const LZ4_METHOD_LZ4 = 0x20;

interface Lz4Block {
  method: number;
  dataStart: number;
  compressedLength: number;
  originalLength: number;
}

function readLz4Blocks(bytes: Uint8Array): Lz4Block[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks: Lz4Block[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    if (pos + LZ4_HEADER_LENGTH > bytes.length) throw new Error(`Truncated LZ4 block header at offset ${pos}`);
    for (let i = 0; i < LZ4_MAGIC.length; i++) {
      if (bytes[pos + i] !== LZ4_MAGIC[i]) throw new Error(`Missing LZ4Block magic at offset ${pos}`);
    }
    const token = bytes[pos + 8];
    const method = token & 0xf0;
    const maxBlockSize = 1 << (10 + (token & 0x0f));
    const compressedLength = view.getInt32(pos + 9, true);
    const originalLength = view.getInt32(pos + 13, true);
    const dataStart = pos + LZ4_HEADER_LENGTH;
    if (
      (method !== LZ4_METHOD_RAW && method !== LZ4_METHOD_LZ4) ||
      originalLength < 0 ||
      originalLength > maxBlockSize ||
      compressedLength < 0 ||
      (originalLength === 0 && compressedLength !== 0) ||
      (method === LZ4_METHOD_RAW && compressedLength !== originalLength)
    ) {
      throw new Error(`Invalid LZ4 block header at offset ${pos}`);
    }
    if (dataStart + compressedLength > bytes.length) throw new Error(`Truncated LZ4 block at offset ${pos}`);
    pos = dataStart + compressedLength;
    // An empty block terminates a stream; another concatenated stream may follow.
    if (originalLength > 0) blocks.push({ method, dataStart, compressedLength, originalLength });
  }
  return blocks;
}

function decodeLz4Block(src: Uint8Array, dst: Uint8Array, dstStart: number, dstEnd: number) {
  let s = 0;
  let d = dstStart;
  const srcEnd = src.length;
  for (;;) {
    if (s >= srcEnd) throw new Error('Truncated LZ4 sequence');
    const token = src[s++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let b: number;
      do {
        if (s >= srcEnd) throw new Error('Truncated LZ4 literal length');
        b = src[s++];
        literalLength += b;
      } while (b === 255);
    }
    if (s + literalLength > srcEnd || d + literalLength > dstEnd) throw new Error('LZ4 literal run out of bounds');
    dst.set(src.subarray(s, s + literalLength), d);
    s += literalLength;
    d += literalLength;
    if (s === srcEnd) break;

    if (s + 2 > srcEnd) throw new Error('Truncated LZ4 match offset');
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    if (offset === 0 || d - offset < dstStart) throw new Error('Invalid LZ4 match offset');
    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      let b: number;
      do {
        if (s >= srcEnd) throw new Error('Truncated LZ4 match length');
        b = src[s++];
        matchLength += b;
      } while (b === 255);
    }
    matchLength += 4;
    if (d + matchLength > dstEnd) throw new Error('LZ4 match out of bounds');
    let m = d - offset;
    if (offset >= matchLength) {
      dst.copyWithin(d, m, m + matchLength);
      d += matchLength;
    } else {
      // Overlapping match repeats the last `offset` bytes; copy byte by byte.
      const end = d + matchLength;
      while (d < end) dst[d++] = dst[m++];
    }
  }
  if (d !== dstEnd) throw new Error('LZ4 block decoded to the wrong length');
}

function decompressLz4Block(bytes: Uint8Array): Uint8Array {
  const blocks = readLz4Blocks(bytes);
  let total = 0;
  for (const block of blocks) total += block.originalLength;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const block of blocks) {
    const data = bytes.subarray(block.dataStart, block.dataStart + block.compressedLength);
    if (block.method === LZ4_METHOD_RAW) out.set(data, pos);
    else decodeLz4Block(data, out, pos, pos + block.originalLength);
    pos += block.originalLength;
  }
  return out;
}
