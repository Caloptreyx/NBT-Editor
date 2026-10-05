import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ChunkSummary } from '../frontend/src/lib/chunk.ts';
import {
  hasCriteria,
  matchesPrune,
  type PruneCriteria,
  type PruneRadius,
  regionEntirelyOutside,
} from '../frontend/src/lib/prune.ts';

const NONE: PruneCriteria = { inhabitedBelowTicks: null, unfinishedOnly: false, outsideRadius: null };

const chunk = (overrides: Partial<ChunkSummary> = {}): ChunkSummary => ({
  x: 0,
  z: 0,
  dataVersion: 3953,
  status: 'minecraft:full',
  inhabitedTime: 0n,
  lastUpdate: 0n,
  ...overrides,
});

const radius = (r: number, shape: PruneRadius['shape'], centerX = 0, centerZ = 0): PruneCriteria => ({
  ...NONE,
  outsideRadius: { centerX, centerZ, radius: r, shape },
});

describe('matchesPrune', () => {
  test('nothing matches without criteria', () => {
    assert.equal(hasCriteria(NONE), false);
    assert.equal(matchesPrune(chunk({ status: 'minecraft:empty' }), NONE), false);
  });

  test('InhabitedTime must be strictly below the threshold', () => {
    const below100: PruneCriteria = { ...NONE, inhabitedBelowTicks: 100 };
    assert.equal(hasCriteria(below100), true);
    assert.equal(matchesPrune(chunk({ inhabitedTime: 99n }), below100), true);
    assert.equal(matchesPrune(chunk({ inhabitedTime: 100n }), below100), false);
    assert.equal(matchesPrune(chunk({ inhabitedTime: 101n }), below100), false);
    assert.equal(matchesPrune(chunk({ inhabitedTime: 0n }), { ...NONE, inhabitedBelowTicks: 0 }), false);
  });

  test('unfinished means a status other than full, namespaced or not', () => {
    const unfinished: PruneCriteria = { ...NONE, unfinishedOnly: true };
    for (const status of ['minecraft:full', 'full', 'postprocessed', 'fullchunk']) {
      assert.equal(matchesPrune(chunk({ status }), unfinished), false, status);
    }
    for (const status of ['minecraft:features', 'features', 'minecraft:empty', 'carvers', 'decorated']) {
      assert.equal(matchesPrune(chunk({ status }), unfinished), true, status);
    }
    assert.equal(matchesPrune(chunk({ status: null }), unfinished), false);
  });

  test('criteria are combined with AND', () => {
    const both: PruneCriteria = { ...NONE, inhabitedBelowTicks: 50, unfinishedOnly: true };
    assert.equal(matchesPrune(chunk({ status: 'minecraft:noise', inhabitedTime: 10n }), both), true);
    assert.equal(matchesPrune(chunk({ status: 'minecraft:noise', inhabitedTime: 60n }), both), false);
    assert.equal(matchesPrune(chunk({ status: 'minecraft:full', inhabitedTime: 10n }), both), false);

    const far = { ...radius(100, 'square'), inhabitedBelowTicks: 50 };
    assert.equal(matchesPrune(chunk({ x: 10, inhabitedTime: 10n }), far), true);
    assert.equal(matchesPrune(chunk({ x: 10, inhabitedTime: 60n }), far), false);
    assert.equal(matchesPrune(chunk({ x: 1, inhabitedTime: 10n }), far), false);
  });

  test('a chunk partly inside the radius is kept', () => {
    const square = radius(100, 'square');
    // Chunk 6 covers x 96..111 and contains x = 100, chunk 7 starts at 112.
    assert.equal(matchesPrune(chunk({ x: 6 }), square), false);
    assert.equal(matchesPrune(chunk({ x: 7 }), square), true);
    // Chunk -7 covers -112..-97, chunk -8 ends at -113.
    assert.equal(matchesPrune(chunk({ x: -7 }), square), false);
    assert.equal(matchesPrune(chunk({ x: -8 }), square), true);
    assert.equal(matchesPrune(chunk({ z: -7 }), square), false);
    assert.equal(matchesPrune(chunk({ z: 7 }), square), true);
    assert.equal(matchesPrune(chunk(), square), false);
  });

  test('a block exactly at the radius is inside', () => {
    // Chunk 6 starts at x = 96.
    assert.equal(matchesPrune(chunk({ x: 6 }), radius(96, 'square')), false);
    assert.equal(matchesPrune(chunk({ x: 6 }), radius(95, 'square')), true);
    assert.equal(matchesPrune(chunk({ x: 6 }), radius(96, 'circle')), false);
    assert.equal(matchesPrune(chunk({ x: 6 }), radius(95, 'circle')), true);
  });

  test('square and circle differ at the corners', () => {
    // Chunk (5,5) starts at (80,80): Chebyshev distance 80, Euclidean distance ~113.
    assert.equal(matchesPrune(chunk({ x: 5, z: 5 }), radius(100, 'square')), false);
    assert.equal(matchesPrune(chunk({ x: 5, z: 5 }), radius(100, 'circle')), true);
    assert.equal(matchesPrune(chunk({ x: -6, z: -6 }), radius(100, 'circle')), true);
    assert.equal(matchesPrune(chunk({ x: -6, z: 0 }), radius(100, 'circle')), false);
  });

  test('uses the given center', () => {
    const offCenter = radius(50, 'circle', 1000, -1000);
    assert.equal(matchesPrune(chunk({ x: 62, z: -63 }), offCenter), false);
    assert.equal(matchesPrune(chunk(), offCenter), true);
  });

  test('an invalid area matches nothing', () => {
    for (const criteria of [radius(-1, 'square'), radius(Number.NaN, 'circle'), radius(10, 'square', Number.NaN)]) {
      assert.equal(matchesPrune(chunk({ x: 100 }), criteria), false);
      assert.equal(regionEntirelyOutside(5, 5, criteria), false);
    }
  });
});

describe('regionEntirelyOutside', () => {
  test('only when the whole region lies outside', () => {
    const r = radius(1000, 'square');
    assert.equal(regionEntirelyOutside(0, 0, r), false);
    assert.equal(regionEntirelyOutside(1, 0, r), false); // 512..1023
    assert.equal(regionEntirelyOutside(2, 0, r), true); // 1024..1535
    assert.equal(regionEntirelyOutside(-2, 0, r), false); // -1024..-513
    assert.equal(regionEntirelyOutside(-3, 0, r), true); // -1536..-1025
  });

  test('never when other criteria need the chunk data', () => {
    assert.equal(regionEntirelyOutside(10, 10, { ...radius(10, 'square'), inhabitedBelowTicks: 5 }), false);
    assert.equal(regionEntirelyOutside(10, 10, { ...radius(10, 'square'), unfinishedOnly: true }), false);
    assert.equal(regionEntirelyOutside(10, 10, NONE), false);
  });

  test('agrees with matching every chunk of the region', () => {
    for (const criteria of [radius(700, 'circle', 37, -12), radius(1100, 'square', -300, 450)]) {
      for (let rx = -3; rx <= 3; rx++) {
        for (let rz = -3; rz <= 3; rz++) {
          let all = true;
          for (let i = 0; i < 1024 && all; i++) {
            all = matchesPrune(chunk({ x: rx * 32 + (i & 31), z: rz * 32 + (i >> 5) }), criteria);
          }
          assert.equal(regionEntirelyOutside(rx, rz, criteria), all, `${rx},${rz}`);
        }
      }
    }
  });
});
