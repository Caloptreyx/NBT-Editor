export const TAG_IDS = {
  end: 0,
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12,
} as const;

export type TagType = keyof typeof TAG_IDS;
export type NumberTagType = 'byte' | 'short' | 'int' | 'float' | 'double';
export type NumberTag = { type: NumberTagType; value: number };
export type LongTag = { type: 'long'; value: bigint };
export type StringTag = { type: 'string'; value: string };
export type ByteArrayTag = { type: 'byteArray'; value: Int8Array };
export type IntArrayTag = { type: 'intArray'; value: Int32Array };
export type LongArrayTag = { type: 'longArray'; value: BigInt64Array };
export type ListTag = { type: 'list'; itemType: TagType; items: Tag[] };
export type CompoundTag = { type: 'compound'; entries: Map<string, Tag> };
export type Tag = NumberTag | LongTag | StringTag | ByteArrayTag | IntArrayTag | LongArrayTag | ListTag | CompoundTag;

export interface NbtDocument {
  name: string;
  root: CompoundTag;
}

export interface NbtCodecOptions {
  littleEndian?: boolean;
}

export class NbtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NbtError';
  }
}

const TAG_TYPES: TagType[] = [
  'end',
  'byte',
  'short',
  'int',
  'long',
  'float',
  'double',
  'byteArray',
  'string',
  'list',
  'compound',
  'intArray',
  'longArray',
];

const MAX_DEPTH = 512;
const PLATFORM_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const asciiDecoder = new TextDecoder('utf-8');

// Reverses every `width`-byte group in place (endianness swap of a packed numeric array).
function swapBytes(bytes: Uint8Array, width: 4 | 8) {
  if (width === 4) {
    for (let i = 0; i < bytes.length; i += 4) {
      const a = bytes[i];
      const b = bytes[i + 1];
      bytes[i] = bytes[i + 3];
      bytes[i + 1] = bytes[i + 2];
      bytes[i + 2] = b;
      bytes[i + 3] = a;
    }
  } else {
    for (let i = 0; i < bytes.length; i += 8) {
      for (let j = 0; j < 4; j++) {
        const t = bytes[i + j];
        bytes[i + j] = bytes[i + 7 - j];
        bytes[i + 7 - j] = t;
      }
    }
  }
}

function codesToString(codes: Uint16Array, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 8192) {
    out += String.fromCharCode.apply(null, codes.subarray(i, Math.min(length, i + 8192)) as unknown as number[]);
  }
  return out;
}

function decodeModifiedUtf8(bytes: Uint8Array, start: number, length: number): string {
  const end = start + length;
  let ascii = true;
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    if (b === 0 || b > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    if (length < 32) {
      let out = '';
      for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
      return out;
    }
    return asciiDecoder.decode(bytes.subarray(start, end));
  }

  const codes = new Uint16Array(length);
  let n = 0;
  let i = start;
  while (i < end) {
    const b = bytes[i];
    if (b < 0x80) {
      codes[n++] = b;
      i++;
    } else if ((b & 0xe0) === 0xc0 && i + 1 < end && (bytes[i + 1] & 0xc0) === 0x80) {
      codes[n++] = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if ((b & 0xf0) === 0xe0 && i + 2 < end && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80) {
      codes[n++] = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else if (
      (b & 0xf8) === 0xf0 &&
      i + 3 < end &&
      (bytes[i + 1] & 0xc0) === 0x80 &&
      (bytes[i + 2] & 0xc0) === 0x80 &&
      (bytes[i + 3] & 0xc0) === 0x80
    ) {
      // Standard 4-byte UTF-8 is not valid modified UTF-8, but some third-party tools write it.
      const cp =
        (((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)) -
        0x10000;
      codes[n++] = 0xd800 + (cp >> 10);
      codes[n++] = 0xdc00 + (cp & 0x3ff);
      i += 4;
    } else {
      codes[n++] = 0xfffd;
      i++;
    }
  }
  return codesToString(codes, n);
}

class Reader {
  bytes: Uint8Array;
  view: DataView;
  pos = 0;
  le: boolean;

  constructor(bytes: Uint8Array, littleEndian: boolean) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.le = littleEndian;
  }

  need(n: number) {
    if (this.pos + n > this.bytes.length) {
      throw new NbtError(`Unexpected end of data at offset ${this.pos} (need ${n} more bytes)`);
    }
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++];
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, this.le);
    this.pos += 2;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, this.le);
    this.pos += 4;
    return v;
  }

  i64(): bigint {
    this.need(8);
    const v = this.view.getBigInt64(this.pos, this.le);
    this.pos += 8;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, this.le);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, this.le);
    this.pos += 8;
    return v;
  }

  string(): string {
    this.need(2);
    const length = this.view.getUint16(this.pos, this.le);
    this.pos += 2;
    this.need(length);
    const s = decodeModifiedUtf8(this.bytes, this.pos, length);
    this.pos += length;
    return s;
  }

  arrayLength(width: number): number {
    const length = this.i32();
    if (length < 0) throw new NbtError(`Negative array length ${length} at offset ${this.pos - 4}`);
    this.need(length * width);
    return length;
  }

  // Copies `length` elements of `width` bytes into a fresh, platform-ordered buffer.
  numericArray(length: number, width: 4 | 8): ArrayBuffer {
    const size = length * width;
    const copy = new Uint8Array(size);
    copy.set(this.bytes.subarray(this.pos, this.pos + size));
    this.pos += size;
    if (this.le !== PLATFORM_LITTLE_ENDIAN) swapBytes(copy, width);
    return copy.buffer;
  }

  payload(typeId: number, depth: number): Tag {
    switch (typeId) {
      case 1:
        return { type: 'byte', value: this.i8() };
      case 2:
        return { type: 'short', value: this.i16() };
      case 3:
        return { type: 'int', value: this.i32() };
      case 4:
        return { type: 'long', value: this.i64() };
      case 5:
        return { type: 'float', value: this.f32() };
      case 6:
        return { type: 'double', value: this.f64() };
      case 7: {
        const length = this.arrayLength(1);
        const value = new Int8Array(length);
        value.set(new Int8Array(this.bytes.buffer, this.bytes.byteOffset + this.pos, length));
        this.pos += length;
        return { type: 'byteArray', value };
      }
      case 8:
        return { type: 'string', value: this.string() };
      case 9: {
        if (depth >= MAX_DEPTH) throw new NbtError(`NBT nesting deeper than ${MAX_DEPTH}`);
        const itemId = this.u8();
        const itemType = TAG_TYPES[itemId];
        if (itemType === undefined) throw new NbtError(`Unknown list item type ${itemId} at offset ${this.pos - 1}`);
        const length = this.i32();
        if (length < 0) throw new NbtError(`Negative list length ${length} at offset ${this.pos - 4}`);
        if (itemId === 0 && length > 0) throw new NbtError(`List of end tags with ${length} items`);
        // Every item payload takes at least one byte; rejects absurd lengths before allocating.
        this.need(length);
        const items: Tag[] = Array.from({ length }, () => this.payload(itemId, depth + 1));
        return { type: 'list', itemType, items };
      }
      case 10: {
        if (depth >= MAX_DEPTH) throw new NbtError(`NBT nesting deeper than ${MAX_DEPTH}`);
        const entries = new Map<string, Tag>();
        for (;;) {
          const id = this.u8();
          if (id === 0) break;
          if (id > 12) throw new NbtError(`Unknown tag type ${id} at offset ${this.pos - 1}`);
          const key = this.string();
          entries.set(key, this.payload(id, depth + 1));
        }
        return { type: 'compound', entries };
      }
      case 11: {
        const length = this.arrayLength(4);
        return { type: 'intArray', value: new Int32Array(this.numericArray(length, 4)) };
      }
      case 12: {
        const length = this.arrayLength(8);
        return { type: 'longArray', value: new BigInt64Array(this.numericArray(length, 8)) };
      }
      default:
        throw new NbtError(`Unknown tag type ${typeId}`);
    }
  }
}

export function readNbt(bytes: Uint8Array, options?: NbtCodecOptions): NbtDocument {
  const reader = new Reader(bytes, options?.littleEndian ?? false);
  const id = reader.u8();
  if (id !== TAG_IDS.compound) throw new NbtError(`Root tag must be a compound, found type ${id}`);
  const name = reader.string();
  const root = reader.payload(id, 0) as CompoundTag;
  return { name, root };
}

function modifiedUtf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 1 && c <= 0x7f) n += 1;
    else if (c <= 0x7ff) n += 2;
    else n += 3;
  }
  return n;
}

class Writer {
  bytes: Uint8Array;
  view: DataView;
  pos = 0;
  le: boolean;

  constructor(littleEndian: boolean) {
    this.bytes = new Uint8Array(4096);
    this.view = new DataView(this.bytes.buffer);
    this.le = littleEndian;
  }

  ensure(n: number) {
    const required = this.pos + n;
    if (required <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < required) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.pos));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number) {
    this.ensure(1);
    this.bytes[this.pos++] = v;
  }

  i8(v: number) {
    this.ensure(1);
    this.view.setInt8(this.pos++, v);
  }

  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.pos, v, this.le);
    this.pos += 2;
  }

  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.pos, v, this.le);
    this.pos += 4;
  }

  i64(v: bigint) {
    this.ensure(8);
    this.view.setBigInt64(this.pos, BigInt.asIntN(64, v), this.le);
    this.pos += 8;
  }

  f32(v: number) {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, this.le);
    this.pos += 4;
  }

  f64(v: number) {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, this.le);
    this.pos += 8;
  }

  string(s: string) {
    const length = modifiedUtf8Length(s);
    if (length > 0xffff) throw new NbtError(`String too long for NBT (${length} bytes, max 65535)`);
    this.ensure(2 + length);
    this.view.setUint16(this.pos, length, this.le);
    this.pos += 2;
    const out = this.bytes;
    let p = this.pos;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 1 && c <= 0x7f) {
        out[p++] = c;
      } else if (c <= 0x7ff) {
        out[p++] = 0xc0 | (c >> 6);
        out[p++] = 0x80 | (c & 0x3f);
      } else {
        out[p++] = 0xe0 | (c >> 12);
        out[p++] = 0x80 | ((c >> 6) & 0x3f);
        out[p++] = 0x80 | (c & 0x3f);
      }
    }
    this.pos = p;
  }

  numericArray(value: Int32Array | BigInt64Array, width: 4 | 8) {
    this.i32(value.length);
    const size = value.length * width;
    this.ensure(size);
    const target = this.bytes.subarray(this.pos, this.pos + size);
    target.set(new Uint8Array(value.buffer, value.byteOffset, size));
    if (this.le !== PLATFORM_LITTLE_ENDIAN) swapBytes(target, width);
    this.pos += size;
  }

  payload(tag: Tag, depth: number) {
    switch (tag.type) {
      case 'byte':
        this.i8(tag.value);
        break;
      case 'short':
        this.i16(tag.value);
        break;
      case 'int':
        this.i32(tag.value);
        break;
      case 'long':
        this.i64(tag.value);
        break;
      case 'float':
        this.f32(tag.value);
        break;
      case 'double':
        this.f64(tag.value);
        break;
      case 'byteArray':
        this.i32(tag.value.length);
        this.ensure(tag.value.length);
        this.bytes.set(new Uint8Array(tag.value.buffer, tag.value.byteOffset, tag.value.length), this.pos);
        this.pos += tag.value.length;
        break;
      case 'string':
        this.string(tag.value);
        break;
      case 'list': {
        if (depth >= MAX_DEPTH) throw new NbtError(`NBT nesting deeper than ${MAX_DEPTH}`);
        const itemType = tag.items.length === 0 ? tag.itemType : tag.items[0].type;
        for (const item of tag.items) {
          if (item.type !== itemType) throw new NbtError(`List mixes ${itemType} and ${item.type} items`);
        }
        this.u8(TAG_IDS[itemType]);
        this.i32(tag.items.length);
        for (const item of tag.items) this.payload(item, depth + 1);
        break;
      }
      case 'compound':
        if (depth >= MAX_DEPTH) throw new NbtError(`NBT nesting deeper than ${MAX_DEPTH}`);
        for (const [key, value] of tag.entries) {
          this.u8(TAG_IDS[value.type]);
          this.string(key);
          this.payload(value, depth + 1);
        }
        this.u8(0);
        break;
      case 'intArray':
        this.numericArray(tag.value, 4);
        break;
      case 'longArray':
        this.numericArray(tag.value, 8);
        break;
    }
  }
}

export function writeNbt(doc: NbtDocument, options?: NbtCodecOptions): Uint8Array {
  const writer = new Writer(options?.littleEndian ?? false);
  writer.u8(TAG_IDS.compound);
  writer.string(doc.name);
  writer.payload(doc.root, 0);
  return writer.bytes.slice(0, writer.pos);
}

export function compound(entries?: Iterable<[string, Tag]>): CompoundTag {
  return { type: 'compound', entries: new Map(entries) };
}

export function getTag(c: CompoundTag, key: string): Tag | null {
  return c.entries.get(key) ?? null;
}

export function getNumber(c: CompoundTag, key: string): number | null {
  const tag = c.entries.get(key);
  if (!tag) return null;
  switch (tag.type) {
    case 'byte':
    case 'short':
    case 'int':
    case 'float':
    case 'double':
      return tag.value;
    case 'long':
      return Number(tag.value);
    default:
      return null;
  }
}

export function getLong(c: CompoundTag, key: string): bigint | null {
  const tag = c.entries.get(key);
  if (!tag) return null;
  switch (tag.type) {
    case 'byte':
    case 'short':
    case 'int':
      return BigInt(tag.value);
    case 'long':
      return tag.value;
    default:
      return null;
  }
}

export function getString(c: CompoundTag, key: string): string | null {
  const tag = c.entries.get(key);
  return tag?.type === 'string' ? tag.value : null;
}

export function getCompound(c: CompoundTag, key: string): CompoundTag | null {
  const tag = c.entries.get(key);
  return tag?.type === 'compound' ? tag : null;
}

export function getList(c: CompoundTag, key: string): ListTag | null {
  const tag = c.entries.get(key);
  return tag?.type === 'list' ? tag : null;
}

export function cloneTag<T extends Tag>(tag: T): T {
  const t: Tag = tag;
  switch (t.type) {
    case 'byteArray':
      return { type: 'byteArray', value: t.value.slice() } as T;
    case 'intArray':
      return { type: 'intArray', value: t.value.slice() } as T;
    case 'longArray':
      return { type: 'longArray', value: t.value.slice() } as T;
    case 'list':
      return { type: 'list', itemType: t.itemType, items: t.items.map((item) => cloneTag(item)) } as T;
    case 'compound': {
      const entries = new Map<string, Tag>();
      for (const [key, value] of t.entries) entries.set(key, cloneTag(value));
      return { type: 'compound', entries } as T;
    }
    default:
      return { ...t } as T;
  }
}

export function defaultTag(type: Exclude<TagType, 'end'>): Tag {
  switch (type) {
    case 'byte':
    case 'short':
    case 'int':
    case 'float':
    case 'double':
      return { type, value: 0 };
    case 'long':
      return { type: 'long', value: 0n };
    case 'string':
      return { type: 'string', value: '' };
    case 'byteArray':
      return { type: 'byteArray', value: new Int8Array(0) };
    case 'intArray':
      return { type: 'intArray', value: new Int32Array(0) };
    case 'longArray':
      return { type: 'longArray', value: new BigInt64Array(0) };
    case 'list':
      return { type: 'list', itemType: 'end', items: [] };
    case 'compound':
      return compound();
  }
}

const BARE_KEY = /^[A-Za-z0-9._+-]+$/;

function quoteSnbt(s: string): string {
  const quote = s.includes('"') && !s.includes("'") ? "'" : '"';
  let out = quote;
  for (const ch of s) {
    if (ch === quote || ch === '\\') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\0') out += '\\x00';
    else out += ch;
  }
  return out + quote;
}

function snbtNumber(value: number, suffix: string): string {
  if (Number.isNaN(value)) return `NaN${suffix}`;
  if (!Number.isFinite(value)) return `${value < 0 ? '-' : ''}Infinity${suffix}`;
  const text = String(value);
  return /[.e]/.test(text) ? `${text}${suffix}` : `${text}.0${suffix}`;
}

function snbtArray<T>(prefix: string, values: ArrayLike<T>, format: (v: T) => string, maxItems: number): string {
  const shown = Math.min(values.length, maxItems);
  const parts = Array.from({ length: shown }, (_, i) => format(values[i]));
  if (values.length > shown) parts.push(`... ${values.length - shown} more`);
  return `[${prefix};${parts.join(',')}]`;
}

export function tagToSnbt(tag: Tag, options?: { maxArrayItems?: number }): string {
  const maxItems = options?.maxArrayItems ?? Number.POSITIVE_INFINITY;
  switch (tag.type) {
    case 'byte':
      return `${tag.value}b`;
    case 'short':
      return `${tag.value}s`;
    case 'int':
      return String(tag.value);
    case 'long':
      return `${tag.value}L`;
    case 'float':
      return snbtNumber(tag.value, 'f');
    case 'double':
      return snbtNumber(tag.value, 'd');
    case 'string':
      return quoteSnbt(tag.value);
    case 'byteArray':
      return snbtArray('B', tag.value, (v) => `${v}b`, maxItems);
    case 'intArray':
      return snbtArray('I', tag.value, (v) => String(v), maxItems);
    case 'longArray':
      return snbtArray('L', tag.value, (v) => `${v}L`, maxItems);
    case 'list':
      return `[${tag.items.map((item) => tagToSnbt(item, options)).join(',')}]`;
    case 'compound': {
      const parts: string[] = [];
      for (const [key, value] of tag.entries) {
        parts.push(`${BARE_KEY.test(key) ? key : quoteSnbt(key)}:${tagToSnbt(value, options)}`);
      }
      return `{${parts.join(',')}}`;
    }
  }
}

const INTEGER_TEXT = /^[+-]?\d+$/;
const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const INT_RANGES = {
  byte: [-128, 127],
  short: [-32768, 32767],
  int: [-2147483648, 2147483647],
} as const;
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

export function parseNumberInput(type: NumberTagType, text: string): number | null {
  const t = text.trim();
  if (type === 'float' || type === 'double') {
    if (!DECIMAL_TEXT.test(t)) return null;
    const value = Number(t);
    if (!Number.isFinite(value)) return null;
    if (type === 'double') return value;
    const rounded = Math.fround(value);
    return Number.isFinite(rounded) ? rounded : null;
  }
  if (!INTEGER_TEXT.test(t)) return null;
  const value = Number(t);
  const [min, max] = INT_RANGES[type];
  return value >= min && value <= max ? value : null;
}

export function parseLongInput(text: string): bigint | null {
  const t = text.trim();
  if (!INTEGER_TEXT.test(t)) return null;
  const value = BigInt(t);
  return value >= LONG_MIN && value <= LONG_MAX ? value : null;
}

export function parseArrayInput(
  type: 'byteArray' | 'intArray' | 'longArray',
  text: string,
): Int8Array | Int32Array | BigInt64Array | null {
  let t = text.trim();
  const wrapped = /^\[\s*([BIL]\s*;)?([\s\S]*)\]$/i.exec(t);
  if (wrapped) t = wrapped[2];
  const parts = t.split(/[\s,]+/).filter((part) => part.length > 0);

  if (type === 'longArray') {
    const out = new BigInt64Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const value = parseLongInput(parts[i].replace(/l$/i, ''));
      if (value === null) return null;
      out[i] = value;
    }
    return out;
  }

  const out = type === 'byteArray' ? new Int8Array(parts.length) : new Int32Array(parts.length);
  const itemType = type === 'byteArray' ? 'byte' : 'int';
  for (let i = 0; i < parts.length; i++) {
    const value = parseNumberInput(itemType, type === 'byteArray' ? parts[i].replace(/b$/i, '') : parts[i]);
    if (value === null) return null;
    out[i] = value;
  }
  return out;
}
