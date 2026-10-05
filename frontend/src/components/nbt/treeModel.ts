import {
  type CompoundTag,
  cloneTag,
  defaultTag,
  type ListTag,
  parseLongInput,
  parseNumberInput,
  type Tag,
  type TagType,
} from '../../lib/nbt.ts';

export type ContainerTag = CompoundTag | ListTag;
export type ArrayTag = Extract<Tag, { type: 'byteArray' | 'intArray' | 'longArray' }>;
export type ScalarTag = Extract<Tag, { type: 'byte' | 'short' | 'int' | 'long' | 'float' | 'double' | 'string' }>;
export type CreatableTagType = Exclude<TagType, 'end'>;

export const TAG_TYPES: CreatableTagType[] = [
  'byte',
  'short',
  'int',
  'long',
  'float',
  'double',
  'string',
  'byteArray',
  'intArray',
  'longArray',
  'list',
  'compound',
];

export const PAGE_SIZE = 100;
const ARRAY_PREVIEW_ITEMS = 8;
const MAX_VALUE_TEXT = 300;

export function isContainer(tag: Tag): tag is ContainerTag {
  return tag.type === 'compound' || tag.type === 'list';
}

export function isArray(tag: Tag): tag is ArrayTag {
  return tag.type === 'byteArray' || tag.type === 'intArray' || tag.type === 'longArray';
}

// shortest decimal text that maps back to the same float32
function floatText(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  for (let precision = 1; precision <= 9; precision++) {
    const text = String(Number(value.toPrecision(precision)));
    if (Math.fround(Number(text)) === value) return text;
  }
  return String(value);
}

/** Text shown in (and pre-filled into) the inline editor of a scalar tag. */
export function scalarText(tag: ScalarTag): string {
  switch (tag.type) {
    case 'float':
      return floatText(tag.value);
    case 'long':
      return tag.value.toString();
    case 'string':
      return tag.value;
    default:
      return String(tag.value);
  }
}

export function arrayPreview(tag: ArrayTag): string {
  const shown = Math.min(tag.value.length, ARRAY_PREVIEW_ITEMS);
  const parts: string[] = new Array(shown);
  for (let i = 0; i < shown; i++) parts[i] = String(tag.value[i]);
  return tag.value.length > shown ? `${parts.join(', ')}, …` : parts.join(', ');
}

export function arrayText(tag: ArrayTag, limit = Number.POSITIVE_INFINITY): string {
  const shown = Math.min(tag.value.length, limit);
  const parts: string[] = new Array(shown);
  for (let i = 0; i < shown; i++) parts[i] = String(tag.value[i]);
  return parts.join(', ');
}

/** Parses inline editor text for a scalar tag; null when invalid for the tag's type. */
export function parseScalar(tag: ScalarTag, text: string): number | bigint | string | null {
  switch (tag.type) {
    case 'string':
      return text;
    case 'long':
      return parseLongInput(text);
    default:
      return parseNumberInput(tag.type, text);
  }
}

/** Writes a value produced by parseScalar; returns false when it equals the current value. */
export function applyScalar(tag: ScalarTag, value: number | bigint | string): boolean {
  if (Object.is(tag.value, value)) return false;
  (tag as { value: number | bigint | string }).value = value;
  return true;
}

export function applyArray(tag: ArrayTag, value: ArrayTag['value']): boolean {
  const current = tag.value;
  if (current.length === value.length) {
    let same = true;
    for (let i = 0; i < value.length && same; i++) same = current[i] === value[i];
    if (same) return false;
  }
  (tag as { value: ArrayTag['value'] }).value = value;
  return true;
}

export type KeyError = 'empty' | 'duplicate';

export function validateKey(parent: CompoundTag, key: string, current: string | null): KeyError | null {
  if (key.length === 0) return 'empty';
  if (key !== current && parent.entries.has(key)) return 'duplicate';
  return null;
}

// rewrites the same Map so the entry order of the file is kept
function rebuildEntries(parent: CompoundTag, entries: [string, Tag][]): void {
  parent.entries.clear();
  for (const [key, tag] of entries) parent.entries.set(key, tag);
}

export function renameEntry(parent: CompoundTag, from: string, to: string): void {
  if (from === to) return;
  rebuildEntries(
    parent,
    Array.from(parent.entries, ([key, tag]): [string, Tag] => [key === from ? to : key, tag]),
  );
}

export function uniqueKey(parent: CompoundTag, base: string): string {
  if (!parent.entries.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}${n}`;
    if (!parent.entries.has(key)) return key;
  }
}

/** Child position: the key inside a compound, the index inside a list. */
export type ChildRef = { key: string; index: number };

export function removeChild(parent: ContainerTag, ref: ChildRef): void {
  if (parent.type === 'compound') parent.entries.delete(ref.key);
  else parent.items.splice(ref.index, 1);
}

export function duplicateChild(parent: ContainerTag, ref: ChildRef): Tag | null {
  if (parent.type === 'list') {
    const source = parent.items[ref.index];
    if (!source) return null;
    const copy = cloneTag(source);
    parent.items.splice(ref.index + 1, 0, copy);
    return copy;
  }
  const source = parent.entries.get(ref.key);
  if (!source) return null;
  const copy = cloneTag(source);
  const copyKey = uniqueKey(parent, `${ref.key}_copy`);
  const entries: [string, Tag][] = [];
  for (const entry of parent.entries) {
    entries.push(entry);
    if (entry[0] === ref.key) entries.push([copyKey, copy]);
  }
  rebuildEntries(parent, entries);
  return copy;
}

export function moveListItem(list: ListTag, index: number, delta: number): boolean {
  const target = index + delta;
  if (index < 0 || index >= list.items.length || target < 0 || target >= list.items.length) return false;
  const [item] = list.items.splice(index, 1);
  list.items.splice(target, 0, item);
  return true;
}

/** Types a new child of the container may have: a non-empty list only takes its item type. */
export function allowedChildTypes(container: ContainerTag): CreatableTagType[] {
  if (container.type === 'list' && container.items.length > 0 && container.itemType !== 'end') {
    return [container.itemType];
  }
  return TAG_TYPES;
}

/** Appends a default tag; an empty list adopts the new child's type. Returns the new tag. */
export function addChild(container: ContainerTag, type: CreatableTagType, key: string): Tag {
  const tag = defaultTag(type);
  if (container.type === 'compound') {
    container.entries.set(key, tag);
  } else {
    if (container.items.length === 0) container.itemType = type;
    container.items.push(tag);
  }
  return tag;
}

export interface FilterResult {
  query: string;
  matches: Set<Tag>;
  /** Containers with at least one matching descendant. */
  ancestors: Set<Tag>;
}

function valueMatches(tag: Tag, query: string): boolean {
  switch (tag.type) {
    case 'byteArray':
    case 'intArray':
    case 'longArray':
    case 'list':
    case 'compound':
      return false;
    default:
      return scalarText(tag).toLowerCase().includes(query);
  }
}

/** `query` is lower-cased and non-empty; `revision` ties the result to the current tree state. */
export function filterTree(params: {
  root: CompoundTag;
  rootName: string;
  query: string;
  revision: number;
}): FilterResult {
  const { root, rootName, query } = params;
  const result: FilterResult = { query, matches: new Set(), ancestors: new Set() };

  const visit = (tag: Tag, key: string | null): boolean => {
    let found = false;
    if ((key !== null && key.toLowerCase().includes(query)) || valueMatches(tag, query)) {
      result.matches.add(tag);
      found = true;
    }
    let below = false;
    if (tag.type === 'compound') {
      for (const [childKey, child] of tag.entries) below = visit(child, childKey) || below;
    } else if (tag.type === 'list') {
      for (const child of tag.items) below = visit(child, null) || below;
    }
    if (below) result.ancestors.add(tag);
    return found || below;
  };

  visit(root, rootName);
  return result;
}

export interface NodeRow {
  kind: 'node';
  id: string;
  tag: Tag;
  parent: ContainerTag | null;
  /** Compound key, list index as text, or the root name. */
  key: string;
  index: number;
  /** Number of siblings, for list move bounds. */
  siblings: number;
  depth: number;
  expanded: boolean;
  childCount: number;
  keyMatch: boolean;
  valueMatch: boolean;
  /** Display text of scalars and array previews; empty for containers. */
  value: string;
  arrayLength: number;
}

export interface MoreRow {
  kind: 'more';
  id: string;
  container: ContainerTag;
  depth: number;
  shown: number;
  total: number;
}

export type TreeRow = NodeRow | MoreRow;

export interface BuildRowsParams {
  root: CompoundTag;
  rootName: string;
  revision: number;
  expanded: Set<Tag>;
  filterCollapsed: Set<Tag>;
  limits: Map<Tag, number>;
  filter: FilterResult | null;
}

export function isExpanded(
  tag: Tag,
  params: Pick<BuildRowsParams, 'expanded' | 'filterCollapsed' | 'filter'>,
): boolean {
  if (params.filter?.ancestors.has(tag)) return !params.filterCollapsed.has(tag);
  return params.expanded.has(tag);
}

function displayValue(tag: Tag): string {
  switch (tag.type) {
    case 'compound':
    case 'list':
      return '';
    case 'byteArray':
    case 'intArray':
    case 'longArray':
      return arrayPreview(tag);
    default: {
      const text = scalarText(tag);
      return text.length > MAX_VALUE_TEXT ? `${text.slice(0, MAX_VALUE_TEXT)}…` : text;
    }
  }
}

/** Flattens the visible part of the tree: only expanded containers contribute children, paged by `limits`. */
export function buildRows(params: BuildRowsParams): TreeRow[] {
  const { root, rootName, limits, filter } = params;
  const rows: TreeRow[] = [];

  const visit = (
    tag: Tag,
    parent: ContainerTag | null,
    key: string,
    index: number,
    siblings: number,
    depth: number,
    id: string,
    insideMatch: boolean,
  ) => {
    const container = isContainer(tag);
    const expanded = container && isExpanded(tag, params);
    const keyMatch =
      filter !== null && (parent === null || parent.type === 'compound') && key.toLowerCase().includes(filter.query);
    const value = displayValue(tag);
    const count = tag.type === 'compound' ? tag.entries.size : tag.type === 'list' ? tag.items.length : 0;
    rows.push({
      kind: 'node',
      id,
      tag,
      parent,
      key,
      index,
      siblings,
      depth,
      expanded,
      childCount: count,
      keyMatch,
      valueMatch: filter !== null && !container && !isArray(tag) && value.toLowerCase().includes(filter.query),
      value,
      arrayLength: isArray(tag) ? tag.value.length : 0,
    });
    if (!container || !expanded) return;

    const showAll = !filter || insideMatch || filter.matches.has(tag);
    const relevant = (child: Tag) => showAll || filter?.matches.has(child) || filter?.ancestors.has(child);
    const childInsideMatch = insideMatch || (filter?.matches.has(tag) ?? false);
    const limit = limits.get(tag) ?? PAGE_SIZE;
    let shown = 0;
    let eligible = 0;

    if (tag.type === 'compound') {
      let i = 0;
      for (const [childKey, child] of tag.entries) {
        if (relevant(child)) {
          eligible++;
          if (shown < limit) {
            shown++;
            visit(child, tag, childKey, i, count, depth + 1, `${id}/${encodeURIComponent(childKey)}`, childInsideMatch);
          }
        }
        i++;
      }
    } else {
      tag.items.forEach((child, i) => {
        if (!relevant(child)) return;
        eligible++;
        if (shown < limit) {
          shown++;
          visit(child, tag, String(i), i, count, depth + 1, `${id}/${i}`, childInsideMatch);
        }
      });
    }

    if (eligible > shown) {
      rows.push({ kind: 'more', id: `${id}/…more`, container: tag, depth: depth + 1, shown, total: eligible });
    }
  };

  visit(root, null, rootName, 0, 1, 0, '', false);
  return rows;
}
