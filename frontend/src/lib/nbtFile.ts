import { compress, decompress, sniffCompression } from './compression.ts';
import { type NbtDocument, readNbt, TAG_IDS, writeNbt } from './nbt.ts';

export interface NbtFileFormat {
  compression: 'gzip' | 'zlib' | 'none';
  littleEndian: boolean;
  bedrockHeaderVersion: number | null;
}

const BEDROCK_HEADER_LENGTH = 8;

function bedrockHeaderVersion(bytes: Uint8Array): number | null {
  if (bytes.length < BEDROCK_HEADER_LENGTH + 3) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getInt32(0, true);
  const length = view.getInt32(4, true);
  if (version < 0 || length !== bytes.length - BEDROCK_HEADER_LENGTH) return null;
  return bytes[BEDROCK_HEADER_LENGTH] === TAG_IDS.compound ? version : null;
}

export async function readNbtFile(bytes: Uint8Array): Promise<{ doc: NbtDocument; format: NbtFileFormat }> {
  const bedrockVersion = bedrockHeaderVersion(bytes);
  if (bedrockVersion !== null) {
    return {
      doc: readNbt(bytes.subarray(BEDROCK_HEADER_LENGTH), { littleEndian: true }),
      format: { compression: 'none', littleEndian: true, bedrockHeaderVersion: bedrockVersion },
    };
  }

  const compression = sniffCompression(bytes);
  const raw = await decompress(bytes, compression);
  try {
    return { doc: readNbt(raw), format: { compression, littleEndian: false, bedrockHeaderVersion: null } };
  } catch (bigEndianError) {
    try {
      return {
        doc: readNbt(raw, { littleEndian: true }),
        format: { compression, littleEndian: true, bedrockHeaderVersion: null },
      };
    } catch {
      throw bigEndianError;
    }
  }
}

export async function writeNbtFile(doc: NbtDocument, format: NbtFileFormat): Promise<Uint8Array> {
  const raw = writeNbt(doc, { littleEndian: format.littleEndian });
  if (format.bedrockHeaderVersion !== null) {
    const out = new Uint8Array(BEDROCK_HEADER_LENGTH + raw.length);
    const view = new DataView(out.buffer);
    view.setInt32(0, format.bedrockHeaderVersion, true);
    view.setInt32(4, raw.length, true);
    out.set(raw, BEDROCK_HEADER_LENGTH);
    return out;
  }
  return compress(raw, format.compression);
}
