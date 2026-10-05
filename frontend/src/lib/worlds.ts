export type FileKind = 'region' | 'entities' | 'poi' | 'nbt' | null;

export interface Dimension {
  /** Dimension id, e.g. `minecraft:the_nether`. */
  id: string;
  label: string;
  regionDir: string;
  entitiesDir: string;
  poiDir: string;
}

export interface ListEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
}

const REGION_EXTENSIONS = ['.mca', '.mcr'];
const NBT_EXTENSIONS = ['.dat', '.dat_old', '.nbt', '.schem', '.schematic', '.litematic'];

const VANILLA_LABELS: Record<string, string> = {
  'minecraft:overworld': 'Overworld',
  'minecraft:the_nether': 'The Nether',
  'minecraft:the_end': 'The End',
};
const VANILLA_ORDER = Object.keys(VANILLA_LABELS);

/** Folders inside a dimension folder that never hold nested dimensions. */
const DIMENSION_DATA_DIRS = new Set(['region', 'entities', 'poi', 'data']);
/** How many folders deep below `dimensions/<namespace>` custom dimensions are searched. */
const MAX_DIMENSION_DEPTH = 4;

/** The path without trailing slashes (`/` stays `/`). */
export function trimPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' && path.startsWith('/') ? '/' : trimmed;
}

export function joinPath(dir: string, name: string): string {
  const base = trimPath(dir);
  if (base === '') return name;
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

/** Last path segment. */
export function baseName(path: string): string {
  const trimmed = trimPath(path);
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** Containing directory; `/` for top-level absolute paths, `` for top-level relative ones. */
export function parentPath(path: string): string {
  const trimmed = trimPath(path);
  const slash = trimmed.lastIndexOf('/');
  if (slash < 0) return '';
  return slash === 0 ? '/' : trimmed.slice(0, slash);
}

/** Region-format files by their folder (`entities`, `poi`, anything else is terrain), NBT files by extension. */
export function fileKind(path: string): FileKind {
  const name = baseName(path).toLowerCase();
  if (REGION_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    const folder = baseName(parentPath(path));
    if (folder === 'entities') return 'entities';
    if (folder === 'poi') return 'poi';
    return 'region';
  }
  if (NBT_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'nbt';
  return null;
}

/** The same region file name in the `region`, `entities` and `poi` folders next to the file's own folder. */
export function siblingRegionPaths(regionPath: string): { region: string; entities: string; poi: string } {
  const name = baseName(regionPath);
  const dimensionDir = parentPath(parentPath(regionPath));
  return {
    region: joinPath(joinPath(dimensionDir, 'region'), name),
    entities: joinPath(joinPath(dimensionDir, 'entities'), name),
    poi: joinPath(joinPath(dimensionDir, 'poi'), name),
  };
}

const dimension = (id: string, dir: string): Dimension => ({
  id,
  label: VANILLA_LABELS[id] ?? id,
  regionDir: joinPath(dir, 'region'),
  entitiesDir: joinPath(dir, 'entities'),
  poiDir: joinPath(dir, 'poi'),
});

const subdirectories = async (dir: string, list: (dir: string) => Promise<ListEntry[]>): Promise<string[]> => {
  try {
    return (await list(dir)).filter((entry) => entry.directory).map((entry) => entry.name);
  } catch {
    return [];
  }
};

/** Dimensions below `<world>/dimensions/<namespace>/<path...>`, identified by a `region` folder. */
const customDimensions = async (
  dir: string,
  namespace: string,
  segments: string[],
  list: (dir: string) => Promise<ListEntry[]>,
): Promise<Dimension[]> => {
  const children = await subdirectories(dir, list);
  const found: Dimension[] = [];
  if (segments.length > 0 && children.includes('region'))
    found.push(dimension(`${namespace}:${segments.join('/')}`, dir));
  if (segments.length < MAX_DIMENSION_DEPTH) {
    const nested = await Promise.all(
      children
        .filter((child) => !DIMENSION_DATA_DIRS.has(child))
        .map((child) => customDimensions(joinPath(dir, child), namespace, [...segments, child], list)),
    );
    found.push(...nested.flat());
  }
  return found;
};

/** `dir` as dimension `id` when it has a `region` folder. */
const probeDimension = async (
  id: string,
  dir: string,
  list: (dir: string) => Promise<ListEntry[]>,
): Promise<Dimension[]> => ((await subdirectories(dir, list)).includes('region') ? [dimension(id, dir)] : []);

/**
 * The dimensions of a world folder that have region files: `<world>/region`, `<world>/DIM-1`, `<world>/DIM1`,
 * `<world>/dimensions/<namespace>/<path...>` (custom dimensions and the newer vanilla layout), and the Bukkit siblings
 * `<world>_nether/DIM-1` and `<world>_the_end/DIM1`. When a dimension appears in several layouts, the
 * `dimensions/` folder wins over the old folders, which win over Bukkit siblings. Vanilla dimensions come first.
 */
export async function discoverDimensions(
  worldDir: string,
  list: (dir: string) => Promise<ListEntry[]>,
): Promise<Dimension[]> {
  const world = trimPath(worldDir);
  const children = (await list(world)).filter((entry) => entry.directory).map((entry) => entry.name);

  const fromDimensionsDir = children.includes('dimensions')
    ? Promise.all(
        (await subdirectories(joinPath(world, 'dimensions'), list)).map((namespace) =>
          customDimensions(joinPath(joinPath(world, 'dimensions'), namespace), namespace, [], list),
        ),
      ).then((groups) => groups.flat())
    : Promise.resolve([]);

  const oldLayout: Promise<Dimension[]>[] = [];
  if (children.includes('region')) oldLayout.push(Promise.resolve([dimension('minecraft:overworld', world)]));
  if (children.includes('DIM-1'))
    oldLayout.push(probeDimension('minecraft:the_nether', joinPath(world, 'DIM-1'), list));
  if (children.includes('DIM1')) oldLayout.push(probeDimension('minecraft:the_end', joinPath(world, 'DIM1'), list));

  const worldName = baseName(world);
  const bukkit = (async (): Promise<Dimension[]> => {
    if (worldName === '') return [];
    const parent = parentPath(world);
    const siblings = await subdirectories(parent, list);
    const found = await Promise.all([
      siblings.includes(`${worldName}_nether`)
        ? probeDimension('minecraft:the_nether', joinPath(joinPath(parent, `${worldName}_nether`), 'DIM-1'), list)
        : [],
      siblings.includes(`${worldName}_the_end`)
        ? probeDimension('minecraft:the_end', joinPath(joinPath(parent, `${worldName}_the_end`), 'DIM1'), list)
        : [],
    ]);
    return found.flat();
  })();

  const candidates = [...(await fromDimensionsDir), ...(await Promise.all(oldLayout)).flat(), ...(await bukkit)];
  const byId = new Map<string, Dimension>();
  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  const rank = (id: string) => {
    const index = VANILLA_ORDER.indexOf(id);
    return index < 0 ? VANILLA_ORDER.length : index;
  };
  return [...byId.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
