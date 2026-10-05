import { faEarthAmericas, faFileCode, faTableCellsLarge } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useQuery } from '@tanstack/react-query';
import { getHttpStatus } from '@/api/axios.ts';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import { listDirectory, nbtEditorQueryKey } from '../api.ts';
import { type Dimension, discoverDimensions, type ListEntry } from '../lib/worlds.ts';
import { useExtTranslations } from '../translations.ts';

interface WorldInfo {
  name: string;
  path: string;
  levelDat: string;
  dimensions: Dimension[];
}

// a world is a root-level directory with a level.dat; Bukkit's world_nether/world_the_end also have one, so a world
// whose dimensions were all found through an earlier world is folded into it
async function findWorlds(serverUuid: string): Promise<WorldInfo[]> {
  const listings = new Map<string, Promise<ListEntry[]>>();
  const list = (directory: string) => {
    let entries = listings.get(directory);
    if (!entries) {
      entries = listDirectory(serverUuid, directory).then(
        (listing) => listing.entries,
        (error) => {
          if (getHttpStatus(error) === 404 || getHttpStatus(error) === 403) return [];
          throw error;
        },
      );
      listings.set(directory, entries);
    }
    return entries;
  };

  const roots = (await list('/')).filter((entry) => entry.directory);
  const contents = await Promise.all(roots.map((entry) => list(entry.path)));

  const worlds: WorldInfo[] = [];
  const seen = new Set<string>();
  for (const [index, root] of roots.entries()) {
    const levelDat = contents[index].find((entry) => !entry.directory && entry.name === 'level.dat');
    if (!levelDat) continue;

    const dimensions = await discoverDimensions(root.path, list);
    const fresh = dimensions.filter((dimension) => !seen.has(dimension.regionDir));
    if (dimensions.length > 0 && fresh.length === 0) continue;
    for (const dimension of fresh) seen.add(dimension.regionDir);

    worlds.push({ name: root.name, path: root.path, levelDat: levelDat.path, dimensions: fresh });
  }
  return worlds;
}

// shortcuts to every detected world: its level.dat and the region folder of each dimension
export default function WorldsStrip({
  serverUuid,
  onNavigate,
  onOpen,
}: {
  serverUuid: string;
  onNavigate: (directory: string) => void;
  onOpen: (path: string) => void;
}) {
  const { t: tExt } = useExtTranslations();

  const worlds = useQuery({
    queryKey: [...nbtEditorQueryKey(serverUuid), 'worlds'],
    queryFn: () => findWorlds(serverUuid),
    staleTime: 60_000,
  });

  if (!worlds.data || worlds.data.length === 0) return null;

  return (
    <div className='flex shrink-0 gap-2 overflow-x-auto border-b border-(--mantine-color-default-border) px-4 py-3'>
      {worlds.data.map((world) => (
        <div
          key={world.path}
          className='flex min-w-56 shrink-0 flex-col gap-2 rounded-md border border-(--mantine-color-default-border) bg-(--mantine-color-default) p-2.5 light:bg-(--mantine-color-gray-0)'
        >
          <div className='flex items-center gap-2'>
            <FontAwesomeIcon icon={faEarthAmericas} className='text-(--mantine-primary-color-light-color)' />
            <button
              type='button'
              className='mantine-focus-auto min-w-0 flex-1 cursor-pointer truncate rounded text-left text-sm font-semibold hover:underline'
              title={world.path}
              onClick={() => onNavigate(world.path)}
            >
              {world.name}
            </button>
            <Tooltip label={tExt('page.worlds.openLevelDat', {})}>
              <button
                type='button'
                aria-label={tExt('page.worlds.openLevelDat', {})}
                className='mantine-focus-auto cursor-pointer rounded px-1.5 py-0.5 text-xs text-(--mantine-color-dimmed) hover:bg-(--mantine-color-default-hover) hover:text-(--mantine-color-text)'
                onClick={() => onOpen(world.levelDat)}
              >
                <FontAwesomeIcon icon={faFileCode} className='mr-1' />
                level.dat
              </button>
            </Tooltip>
          </div>
          {world.dimensions.length > 0 ? (
            <div className='flex flex-wrap gap-1.5'>
              {world.dimensions.map((dimension) => (
                <button
                  key={dimension.id}
                  type='button'
                  title={dimension.regionDir}
                  className='mantine-focus-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-(--mantine-color-default-hover) px-2.5 py-0.5 text-xs hover:bg-(--mantine-primary-color-light) hover:text-(--mantine-primary-color-light-color)'
                  onClick={() => onNavigate(dimension.regionDir)}
                >
                  <FontAwesomeIcon icon={faTableCellsLarge} className='text-[10px]' />
                  {dimension.label}
                </button>
              ))}
            </div>
          ) : (
            <span className='text-xs text-(--mantine-color-dimmed)'>{tExt('page.worlds.noRegions', {})}</span>
          )}
        </div>
      ))}
    </div>
  );
}
