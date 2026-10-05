import { faCompress, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import {
  type Dispatch,
  type SetStateAction,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import ActionIcon from '@/elements/buttons/ActionIcon.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import { handleRawCopyToClipboard } from '@/lib/clipboard/copy.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { type CompoundTag, type Tag, tagToSnbt } from '../lib/nbt.ts';
import { useExtTranslations } from '../translations.ts';
import AddTagModal from './nbt/AddTagModal.tsx';
import ArrayEditModal from './nbt/ArrayEditModal.tsx';
import TreeRowView, { type EditField, ROW_HEIGHT, type TreeActions } from './nbt/TreeRowView.tsx';
import {
  type ArrayTag,
  addChild,
  allowedChildTypes,
  applyArray,
  applyScalar,
  buildRows,
  type ContainerTag,
  type CreatableTagType,
  duplicateChild,
  type FilterResult,
  filterTree,
  isArray,
  isContainer,
  moveListItem,
  PAGE_SIZE,
  parseScalar,
  removeChild,
  renameEntry,
  type ScalarTag,
  validateKey,
} from './nbt/treeModel.ts';

export interface NbtTreeEditorProps {
  root: CompoundTag;
  rootName?: string;
  revision: number;
  onChange(): void;
  readOnly?: boolean;
  className?: string;
}

const NO_TAGS: Set<Tag> = new Set();
const subscribeNever = () => () => undefined;

interface TreeBodyProps extends NbtTreeEditorProps {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
}

// keyed by the shown root in NbtTreeEditor, so expansion, paging and edits reset when another root is shown
function TreeBody({ root, rootName, revision, onChange, readOnly = false, className, query, setQuery }: TreeBodyProps) {
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const name = rootName || tExt('nbt.root', {});
  const filterQuery = useDeferredValue(query.trim().toLowerCase());

  const [expanded, setExpanded] = useState<Set<Tag>>(() => new Set([root]));
  // containers the user collapsed although the filter auto-expands them; reset when the query changes
  const [filterCollapsed, setFilterCollapsed] = useState({ query: '', tags: NO_TAGS });
  const [limits, setLimits] = useState<Map<Tag, number>>(() => new Map());
  const [editing, setEditing] = useState<{ tag: Tag; field: EditField } | null>(null);
  const [addTarget, setAddTarget] = useState<ContainerTag | null>(null);
  const [arrayTarget, setArrayTarget] = useState<ArrayTag | null>(null);

  const filter = useMemo<FilterResult | null>(
    () => (filterQuery ? filterTree({ root, rootName: name, query: filterQuery, revision }) : null),
    [root, name, filterQuery, revision],
  );
  const collapsedInFilter = filterCollapsed.query === filterQuery ? filterCollapsed.tags : NO_TAGS;
  const rows = useMemo(
    () => buildRows({ root, rootName: name, revision, expanded, filterCollapsed: collapsedInFilter, limits, filter }),
    [root, name, revision, expanded, collapsedInFilter, limits, filter],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 16,
  });
  // the virtualizer mutates itself; reading through useSyncExternalStore keeps memoizing compilers from caching it
  const virtualItems = useSyncExternalStore(subscribeNever, () => virtualizer.getVirtualItems());
  const totalSize = useSyncExternalStore(subscribeNever, () => virtualizer.getTotalSize());

  // latest values for the stable action object
  const latest = useRef({ root, onChange, filter, filterQuery, addToast });
  useLayoutEffect(() => {
    latest.current = { root, onChange, filter, filterQuery, addToast };
  });
  const reveal = useRef<Tag | null>(null);

  const actions = useMemo<TreeActions>(() => {
    const changed = (show: Tag | null) => {
      reveal.current = show;
      latest.current.onChange();
    };
    const expand = (container: ContainerTag, visibleChildren: number) => {
      setExpanded((prev) => (prev.has(container) ? prev : new Set(prev).add(container)));
      setLimits((prev) =>
        (prev.get(container) ?? PAGE_SIZE) >= visibleChildren ? prev : new Map(prev).set(container, visibleChildren),
      );
    };

    return {
      toggle(row) {
        const { filter, filterQuery } = latest.current;
        if (filter?.ancestors.has(row.tag)) {
          setFilterCollapsed((prev) => {
            const tags = new Set(prev.query === filterQuery ? prev.tags : NO_TAGS);
            if (!tags.delete(row.tag)) tags.add(row.tag);
            return { query: filterQuery, tags };
          });
        } else {
          setExpanded((prev) => {
            const next = new Set(prev);
            if (!next.delete(row.tag)) next.add(row.tag);
            return next;
          });
        }
      },
      startEdit(tag, field) {
        setEditing({ tag, field });
      },
      cancelEdit() {
        setEditing(null);
      },
      validate(row, field, text) {
        if (field === 'value') return parseScalar(row.tag as ScalarTag, text) === null ? 'invalidValue' : null;
        return row.parent?.type === 'compound' ? validateKey(row.parent, text, row.key) : null;
      },
      commit(row, field, text) {
        setEditing(null);
        if (field === 'key') {
          if (row.parent?.type !== 'compound' || text === row.key || validateKey(row.parent, text, row.key)) return;
          renameEntry(row.parent, row.key, text);
          changed(row.tag);
          return;
        }
        const value = parseScalar(row.tag as ScalarTag, text);
        if (value !== null && applyScalar(row.tag as ScalarTag, value)) changed(null);
      },
      add(row) {
        if (!isContainer(row.tag)) return;
        const container = row.tag;
        const types = allowedChildTypes(container);
        if (container.type === 'list' && types.length === 1) {
          const tag = addChild(container, types[0], '');
          expand(container, container.items.length);
          if (!isContainer(tag) && !isArray(tag)) setEditing({ tag, field: 'value' });
          changed(tag);
        } else {
          setAddTarget(container);
        }
      },
      duplicate(row) {
        if (!row.parent) return;
        const copy = duplicateChild(row.parent, { key: row.key, index: row.index });
        if (!copy) return;
        expand(row.parent, row.index + 2);
        changed(copy);
      },
      remove(row) {
        if (!row.parent) return;
        removeChild(row.parent, { key: row.key, index: row.index });
        setEditing((prev) => (prev?.tag === row.tag ? null : prev));
        changed(null);
      },
      move(row, delta) {
        if (row.parent?.type !== 'list' || !moveListItem(row.parent, row.index, delta)) return;
        expand(row.parent, row.index + delta + 1);
        changed(row.tag);
      },
      copy(row) {
        handleRawCopyToClipboard(tagToSnbt(row.tag), latest.current.addToast);
      },
      openArray(row) {
        if (isArray(row.tag)) setArrayTarget(row.tag);
      },
      showMore(row, all) {
        setLimits((prev) => new Map(prev).set(row.container, all ? Number.POSITIVE_INFINITY : row.shown + PAGE_SIZE));
      },
    };
  }, []);

  useEffect(() => {
    const tag = reveal.current;
    if (!tag) return;
    reveal.current = null;
    const index = rows.findIndex((row) => row.kind === 'node' && row.tag === tag);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [rows, virtualizer]);

  const addTo = (type: CreatableTagType, key: string) => {
    const container = addTarget;
    setAddTarget(null);
    if (!container) return;
    const tag = addChild(container, type, key);
    const count = container.type === 'compound' ? container.entries.size : container.items.length;
    setExpanded((prev) => (prev.has(container) ? prev : new Set(prev).add(container)));
    setLimits((prev) => ((prev.get(container) ?? PAGE_SIZE) >= count ? prev : new Map(prev).set(container, count)));
    if (!isContainer(tag) && !isArray(tag)) setEditing({ tag, field: 'value' });
    reveal.current = tag;
    onChange();
  };

  const collapseAll = () => {
    setExpanded(new Set([root]));
    if (filter) {
      const tags = new Set(filter.ancestors);
      tags.delete(root);
      setFilterCollapsed({ query: filterQuery, tags });
    }
  };

  const noMatches = filter !== null && filter.matches.size === 0;

  return (
    <div className={classNames('flex min-h-0 flex-col gap-2', className)}>
      <div className='flex items-center gap-2'>
        <TextInput
          size='xs'
          className='flex-1'
          placeholder={tExt('nbt.filter', {})}
          aria-label={tExt('nbt.filter', {})}
          value={query}
          leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} size='xs' />}
          rightSection={
            query ? (
              <ActionIcon
                size='sm'
                variant='subtle'
                color='gray'
                aria-label={tExt('nbt.clearFilter', {})}
                onClick={() => setQuery('')}
              >
                <FontAwesomeIcon icon={faXmark} size='xs' />
              </ActionIcon>
            ) : null
          }
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <Tooltip label={tExt('nbt.collapseAll', {})}>
          <ActionIcon
            size='md'
            variant='subtle'
            color='gray'
            aria-label={tExt('nbt.collapseAll', {})}
            onClick={collapseAll}
          >
            <FontAwesomeIcon icon={faCompress} size='sm' />
          </ActionIcon>
        </Tooltip>
      </div>

      {noMatches ? (
        <p className='px-2 py-4 text-center text-sm text-(--mantine-color-dimmed)'>{tExt('nbt.noMatches', {})}</p>
      ) : (
        <div
          ref={scrollRef}
          className='min-h-0 flex-1 overflow-auto rounded border border-(--mantine-color-default-border)'
        >
          <div className='relative w-max min-w-full' style={{ height: totalSize }}>
            <div
              className='absolute top-0 left-0 w-full'
              style={{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }}
            >
              {virtualItems.map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                return (
                  <TreeRowView
                    key={item.key}
                    index={item.index}
                    measure={virtualizer.measureElement}
                    row={row}
                    editing={row.kind === 'node' && editing?.tag === row.tag ? editing.field : null}
                    readOnly={readOnly}
                    actions={actions}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {addTarget && <AddTagModal container={addTarget} onAdd={addTo} onClose={() => setAddTarget(null)} />}
      {arrayTarget && (
        <ArrayEditModal
          tag={arrayTarget}
          readOnly={readOnly}
          onApply={(value) => {
            setArrayTarget(null);
            if (applyArray(arrayTarget, value)) onChange();
          }}
          onClose={() => setArrayTarget(null)}
        />
      )}
    </div>
  );
}

export default function NbtTreeEditor(props: NbtTreeEditorProps) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState({ root: props.root, key: 0 });
  if (shown.root !== props.root) setShown({ root: props.root, key: shown.key + 1 });

  return <TreeBody key={shown.key} {...props} query={query} setQuery={setQuery} />;
}
