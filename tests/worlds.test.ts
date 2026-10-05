import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { discoverDimensions, fileKind, type ListEntry, siblingRegionPaths } from '../frontend/src/lib/worlds.ts';

/** A listing function over the given directory paths (parents are implied); unknown directories throw like a 404. */
function fakeFs(directories: string[]) {
  const children = new Map<string, Set<string>>();
  for (const directory of directories) {
    const parts = directory.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const parent = `/${parts.slice(0, i).join('/')}`;
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent)?.add(parts[i]);
      const self = `/${parts.slice(0, i + 1).join('/')}`;
      if (!children.has(self)) children.set(self, new Set());
    }
  }
  const listed: string[] = [];
  const list = async (dir: string): Promise<ListEntry[]> => {
    listed.push(dir);
    const names = children.get(dir);
    if (!names) throw new Error(`404 ${dir}`);
    return [...names].map((name) => ({
      name,
      path: dir === '/' ? `/${name}` : `${dir}/${name}`,
      directory: true,
      size: 0,
    }));
  };
  return { list, listed };
}

const summary = (dimensions: { id: string; label: string; regionDir: string; entitiesDir: string; poiDir: string }[]) =>
  dimensions.map(({ id, label, regionDir }) => `${id}|${label}|${regionDir}`);

describe('fileKind', () => {
  test('classifies region-format files by their folder', () => {
    assert.equal(fileKind('/world/region/r.0.0.mca'), 'region');
    assert.equal(fileKind('/world/DIM-1/region/r.-1.2.mca'), 'region');
    assert.equal(fileKind('/world/entities/r.0.0.mca'), 'entities');
    assert.equal(fileKind('/world/dimensions/minecraft/overworld/poi/r.0.-1.mca'), 'poi');
    assert.equal(fileKind('/world/region/r.0.0.mcr'), 'region');
    assert.equal(fileKind('/backups/r.0.0.MCA'), 'region');
  });

  test('classifies NBT files by extension', () => {
    for (const path of [
      '/world/level.dat',
      '/world/level.dat_old',
      '/world/playerdata/069a79f4-44e9-4726-a5be-fca90e38aaf5.dat',
      '/structures/house.nbt',
      '/schematics/castle.schem',
      '/schematics/old.schematic',
      '/schematics/Farm.LITEMATIC',
    ]) {
      assert.equal(fileKind(path), 'nbt', path);
    }
  });

  test('ignores everything else', () => {
    for (const path of ['/world/region/c.0.0.mcc', '/server.properties', '/world/session.lock', '/world/region', '/']) {
      assert.equal(fileKind(path), null, path);
    }
  });
});

describe('siblingRegionPaths', () => {
  test('swaps the parent folder', () => {
    const expected = {
      region: '/world/region/r.0.-1.mca',
      entities: '/world/entities/r.0.-1.mca',
      poi: '/world/poi/r.0.-1.mca',
    };
    assert.deepEqual(siblingRegionPaths('/world/region/r.0.-1.mca'), expected);
    assert.deepEqual(siblingRegionPaths('/world/entities/r.0.-1.mca'), expected);
    assert.deepEqual(siblingRegionPaths('/world/poi/r.0.-1.mca'), expected);
  });

  test('works in dimension folders', () => {
    assert.deepEqual(siblingRegionPaths('/world/dimensions/minecraft/the_end/region/r.3.4.mca'), {
      region: '/world/dimensions/minecraft/the_end/region/r.3.4.mca',
      entities: '/world/dimensions/minecraft/the_end/entities/r.3.4.mca',
      poi: '/world/dimensions/minecraft/the_end/poi/r.3.4.mca',
    });
    assert.deepEqual(
      siblingRegionPaths('/world_nether/DIM-1/region/r.0.0.mca').poi,
      '/world_nether/DIM-1/poi/r.0.0.mca',
    );
  });
});

describe('discoverDimensions', () => {
  test('vanilla folders with custom datapack dimensions', async () => {
    const { list } = fakeFs([
      '/world/region',
      '/world/entities',
      '/world/poi',
      '/world/data',
      '/world/playerdata',
      '/world/DIM-1/region',
      '/world/DIM1/region',
      '/world/DIM1/data',
      '/world/dimensions/mymod/mining/region',
      '/world/dimensions/mymod/mining/data',
      '/world/dimensions/other/deep/nested/region',
      '/world/dimensions/other/unused/data',
    ]);
    const dimensions = await discoverDimensions('/world/', list);
    assert.deepEqual(summary(dimensions), [
      'minecraft:overworld|Overworld|/world/region',
      'minecraft:the_nether|The Nether|/world/DIM-1/region',
      'minecraft:the_end|The End|/world/DIM1/region',
      'mymod:mining|mymod:mining|/world/dimensions/mymod/mining/region',
      'other:deep/nested|other:deep/nested|/world/dimensions/other/deep/nested/region',
    ]);
    assert.equal(dimensions[1].entitiesDir, '/world/DIM-1/entities');
    assert.equal(dimensions[1].poiDir, '/world/DIM-1/poi');
  });

  test('skips dimension folders without region files', async () => {
    const { list } = fakeFs(['/world/region', '/world/DIM-1/data', '/world/DIM1/region']);
    assert.deepEqual(
      (await discoverDimensions('/world', list)).map((dimension) => dimension.id),
      ['minecraft:overworld', 'minecraft:the_end'],
    );
  });

  test('Bukkit sibling worlds', async () => {
    const { list } = fakeFs([
      '/world/region',
      '/world_nether/DIM-1/region',
      '/world_the_end/DIM1/region',
      '/world_the_end/DIM1/entities',
      '/other_nether/DIM-1/region',
    ]);
    assert.deepEqual(summary(await discoverDimensions('/world', list)), [
      'minecraft:overworld|Overworld|/world/region',
      'minecraft:the_nether|The Nether|/world_nether/DIM-1/region',
      'minecraft:the_end|The End|/world_the_end/DIM1/region',
    ]);
  });

  test('Bukkit worlds in a subfolder', async () => {
    const { list } = fakeFs(['/worlds/survival/region', '/worlds/survival_nether/DIM-1/region']);
    assert.deepEqual(summary(await discoverDimensions('/worlds/survival', list)), [
      'minecraft:overworld|Overworld|/worlds/survival/region',
      'minecraft:the_nether|The Nether|/worlds/survival_nether/DIM-1/region',
    ]);
  });

  test('dimensions/minecraft layout wins over leftover old folders', async () => {
    const { list } = fakeFs([
      '/world/region',
      '/world/dimensions/minecraft/overworld/region',
      '/world/dimensions/minecraft/overworld/entities',
      '/world/dimensions/minecraft/overworld/poi',
      '/world/dimensions/minecraft/the_nether/region',
      '/world/dimensions/minecraft/the_end/region',
    ]);
    const dimensions = await discoverDimensions('/world', list);
    assert.deepEqual(summary(dimensions), [
      'minecraft:overworld|Overworld|/world/dimensions/minecraft/overworld/region',
      'minecraft:the_nether|The Nether|/world/dimensions/minecraft/the_nether/region',
      'minecraft:the_end|The End|/world/dimensions/minecraft/the_end/region',
    ]);
    assert.equal(dimensions[0].poiDir, '/world/dimensions/minecraft/overworld/poi');
  });

  test('does not walk into region folders', async () => {
    const { list, listed } = fakeFs(['/world/dimensions/minecraft/overworld/region/sub', '/world/region']);
    await discoverDimensions('/world', list);
    assert.equal(
      listed.some((dir) => dir.endsWith('/region')),
      false,
    );
  });

  test('a missing world folder is an error', async () => {
    const { list } = fakeFs(['/world/region']);
    await assert.rejects(discoverDimensions('/nope', list));
  });
});
