import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cloneTag,
  compound,
  getLong,
  getNumber,
  getString,
  NbtError,
  type NbtDocument,
  parseArrayInput,
  parseLongInput,
  parseNumberInput,
  readNbt,
  type Tag,
  tagToSnbt,
  writeNbt,
} from '../frontend/src/lib/nbt.ts';

const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

function sampleDocument(): NbtDocument {
  const nested: Tag = {
    type: 'list',
    itemType: 'list',
    items: [
      { type: 'list', itemType: 'int', items: [{ type: 'int', value: 1 }] },
      { type: 'list', itemType: 'end', items: [] },
      { type: 'list', itemType: 'compound', items: [compound([['k', { type: 'string', value: 'v' }]])] },
    ],
  };
  return {
    name: 'root \u00e9',
    root: compound([
      ['byte', { type: 'byte', value: -128 }],
      ['short', { type: 'short', value: 32767 }],
      ['int', { type: 'int', value: -2147483648 }],
      ['longMin', { type: 'long', value: LONG_MIN }],
      ['longMax', { type: 'long', value: LONG_MAX }],
      ['float', { type: 'float', value: Math.fround(3.14159) }],
      ['double', { type: 'double', value: -1.5e300 }],
      ['bytes', { type: 'byteArray', value: Int8Array.of(-1, 0, 127, -128) }],
      ['ints', { type: 'intArray', value: Int32Array.of(1, -1, 0x7fffffff, -0x80000000) }],
      ['longs', { type: 'longArray', value: BigInt64Array.of(LONG_MIN, -1n, 0n, LONG_MAX) }],
      ['unicode', { type: 'string', value: 'a\u0000b \u00fc \u4e16 \ud83d\ude00 end' }],
      ['empty', { type: 'string', value: '' }],
      ['emptyList', { type: 'list', itemType: 'end', items: [] }],
      ['emptyTypedList', { type: 'list', itemType: 'compound', items: [] }],
      ['nested', nested],
      ['inner', compound([['deep', compound()]])],
    ]),
  };
}

test('round trips every tag type byte-identically in both endiannesses', () => {
  for (const littleEndian of [false, true]) {
    const bytes = writeNbt(sampleDocument(), { littleEndian });
    const doc = readNbt(bytes, { littleEndian });
    assert.deepEqual(doc, sampleDocument());
    assert.deepEqual(writeNbt(doc, { littleEndian }), bytes);
  }
});

test('reads a hand-encoded big-endian document', () => {
  // { "": { "a": int 258, "l": long[2] {1, -2} } }
  const bytes = Uint8Array.of(
    10, 0, 0,
    3, 0, 1, 0x61, 0, 0, 1, 2,
    12, 0, 1, 0x6c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0,
  );
  const doc = readNbt(bytes);
  assert.equal(getNumber(doc.root, 'a'), 258);
  assert.deepEqual(doc.root.entries.get('l'), { type: 'longArray', value: BigInt64Array.of(1n, -2n) });
  assert.deepEqual(writeNbt(doc), bytes);
});

test('encodes strings as Java modified UTF-8', () => {
  const bytes = writeNbt({ name: '\u0000\ud83d\ude00', root: compound() });
  assert.deepEqual(
    [...bytes.subarray(1, 11)],
    [0, 8, 0xc0, 0x80, 0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80],
  );
});

test('decodes long ASCII strings and standard 4-byte UTF-8', () => {
  const long = 'x'.repeat(5000);
  assert.equal(readNbt(writeNbt({ name: long, root: compound() })).name, long);
  const fourByte = Uint8Array.of(10, 0, 4, 0xf0, 0x9f, 0x98, 0x80, 0);
  assert.equal(readNbt(fourByte).name, '\ud83d\ude00');
});

test('rejects truncated, mistyped and too deep input', () => {
  const bytes = writeNbt(sampleDocument());
  for (const cut of [0, 1, 5, bytes.length - 1]) {
    assert.throws(() => readNbt(bytes.subarray(0, cut)), NbtError);
  }
  assert.throws(() => readNbt(Uint8Array.of(8, 0, 0, 0, 0)), NbtError);
  assert.throws(() => readNbt(Uint8Array.of(10, 0, 0, 13, 0, 0, 0)), NbtError);
  assert.throws(() => readNbt(Uint8Array.of(10, 0, 0, 11, 0, 0, 0x7f, 0xff, 0xff, 0xff, 0)), NbtError);

  let root = compound();
  const doc = { name: '', root };
  for (let i = 0; i < 600; i++) {
    const child = compound();
    root.entries.set('c', child);
    root = child;
  }
  assert.throws(() => writeNbt(doc), NbtError);
  const deep: number[] = [10, 0, 0];
  for (let i = 0; i < 600; i++) deep.push(10, 0, 0);
  for (let i = 0; i < 601; i++) deep.push(0);
  assert.throws(() => readNbt(Uint8Array.from(deep)), /deeper than 512/);
});

test('rejects lists with mixed item types', () => {
  const doc = {
    name: '',
    root: compound([
      [
        'l',
        {
          type: 'list',
          itemType: 'int',
          items: [
            { type: 'int', value: 1 },
            { type: 'byte', value: 1 },
          ],
        },
      ],
    ]),
  } satisfies NbtDocument;
  assert.throws(() => writeNbt(doc), NbtError);
});

test('cloneTag produces an independent deep copy', () => {
  const original = sampleDocument().root;
  const copy = cloneTag(original);
  assert.deepEqual(copy, original);
  const longs = copy.entries.get('longs');
  assert.ok(longs?.type === 'longArray');
  longs.value[0] = 5n;
  const inner = copy.entries.get('inner');
  assert.ok(inner?.type === 'compound');
  inner.entries.clear();
  assert.deepEqual(original, sampleDocument().root);
});

test('typed getters convert between numeric kinds', () => {
  const c = compound([
    ['b', { type: 'byte', value: 7 }],
    ['l', { type: 'long', value: 1234567890123n }],
    ['s', { type: 'string', value: 'x' }],
  ]);
  assert.equal(getLong(c, 'b'), 7n);
  assert.equal(getNumber(c, 'l'), 1234567890123);
  assert.equal(getLong(c, 's'), null);
  assert.equal(getString(c, 'b'), null);
  assert.equal(getNumber(c, 'missing'), null);
});

test('formats SNBT with suffixes, quoting and array truncation', () => {
  const c = compound([
    ['plain', { type: 'byte', value: 1 }],
    ['needs quote', { type: 'string', value: 'say "hi"' }],
    ['f', { type: 'float', value: 2 }],
    ['L', { type: 'longArray', value: BigInt64Array.of(1n, 2n, 3n) }],
    ['list', { type: 'list', itemType: 'short', items: [{ type: 'short', value: 3 }] }],
  ]);
  assert.equal(tagToSnbt(c, { maxArrayItems: 2 }), `{plain:1b,"needs quote":'say "hi"',f:2.0f,L:[L;1L,2L,... 1 more],list:[3s]}`);
});

test('validates number input per type', () => {
  assert.equal(parseNumberInput('byte', ' -128 '), -128);
  assert.equal(parseNumberInput('byte', '128'), null);
  assert.equal(parseNumberInput('short', '-32769'), null);
  assert.equal(parseNumberInput('int', '2147483647'), 2147483647);
  assert.equal(parseNumberInput('int', '2147483648'), null);
  assert.equal(parseNumberInput('int', '1.5'), null);
  assert.equal(parseNumberInput('int', ''), null);
  assert.equal(parseNumberInput('float', '0.1'), Math.fround(0.1));
  assert.equal(parseNumberInput('float', '1e39'), null);
  assert.equal(parseNumberInput('double', '1e39'), 1e39);
  assert.equal(parseNumberInput('double', '0x10'), null);
  assert.equal(parseLongInput('-9223372036854775808'), LONG_MIN);
  assert.equal(parseLongInput('9223372036854775808'), null);
  assert.equal(parseLongInput('1.0'), null);
});

test('parses array input with separators, wrappers and range checks', () => {
  assert.deepEqual(parseArrayInput('byteArray', '1, -2 3b'), Int8Array.of(1, -2, 3));
  assert.equal(parseArrayInput('byteArray', '200'), null);
  assert.deepEqual(parseArrayInput('intArray', '[I; 1, 2]'), Int32Array.of(1, 2));
  assert.deepEqual(parseArrayInput('intArray', ''), new Int32Array(0));
  assert.deepEqual(parseArrayInput('longArray', '9223372036854775807L,-1'), BigInt64Array.of(LONG_MAX, -1n));
  assert.equal(parseArrayInput('longArray', 'abc'), null);
});
