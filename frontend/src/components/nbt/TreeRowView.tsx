import {
  faArrowDown,
  faArrowUp,
  faChevronRight,
  faClone,
  faCopy,
  faEye,
  faICursor,
  faPen,
  faPlus,
  faTrash,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import { type KeyboardEvent, memo, useRef, useState } from 'react';
import ActionIcon from '@/elements/buttons/ActionIcon.tsx';
import Button from '@/elements/buttons/Button.tsx';
import TextArea from '@/elements/input/TextArea.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import type { Tag } from '../../lib/nbt.ts';
import { useExtTranslations } from '../../translations.ts';
import TypeBadge from './TypeBadge.tsx';
import {
  type KeyError,
  type MoreRow,
  type NodeRow,
  PAGE_SIZE,
  type ScalarTag,
  scalarText,
  type TreeRow,
} from './treeModel.ts';

export type EditField = 'value' | 'key';
export type EditError = KeyError | 'invalidValue';

/** One stable object shared by every row; rows pass themselves back instead of binding per-row closures. */
export interface TreeActions {
  toggle(row: NodeRow): void;
  startEdit(tag: Tag, field: EditField): void;
  cancelEdit(): void;
  validate(row: NodeRow, field: EditField, text: string): EditError | null;
  commit(row: NodeRow, field: EditField, text: string): void;
  add(row: NodeRow): void;
  duplicate(row: NodeRow): void;
  remove(row: NodeRow): void;
  move(row: NodeRow, delta: number): void;
  copy(row: NodeRow): void;
  openArray(row: NodeRow): void;
  showMore(row: MoreRow, all: boolean): void;
}

export const ROW_HEIGHT = 28;
const INDENT = 16;

function InlineEditor({
  row,
  field,
  initial,
  actions,
}: {
  row: NodeRow;
  field: EditField;
  initial: string;
  actions: TreeActions;
}) {
  const { t: tExt } = useExtTranslations();
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const error = actions.validate(row, field, text);
  const message =
    error === 'empty'
      ? tExt('nbt.errors.emptyKey', {})
      : error === 'duplicate'
        ? tExt('nbt.errors.duplicateKey', {})
        : error === 'invalidValue'
          ? tExt('nbt.errors.invalidValue', { type: tExt(`nbt.types.${row.tag.type}`, {}) })
          : null;
  const multiline = field === 'value' && row.tag.type === 'string' && initial.includes('\n');

  const commit = () => {
    if (done.current || error !== null) return;
    done.current = true;
    actions.commit(row, field, text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      done.current = true;
      actions.cancelEdit();
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  };

  return (
    <Tooltip
      label={message}
      opened={message !== null}
      color='red'
      position='bottom-start'
      innerClassName={field === 'key' ? 'w-56 shrink-0' : 'min-w-40 max-w-xl flex-1'}
    >
      {multiline ? (
        <TextArea
          autoFocus
          autosize
          minRows={2}
          maxRows={10}
          size='xs'
          aria-label={row.key}
          error={error !== null}
          value={text}
          classNames={{ input: 'font-mono text-xs!' }}
          onChange={(e) => setText(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <TextInput
          autoFocus
          size='xs'
          aria-label={row.key}
          error={error !== null}
          value={text}
          classNames={{ input: 'h-6! min-h-6! font-mono text-xs!' }}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setText(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      )}
    </Tooltip>
  );
}

function Action({
  icon,
  label,
  danger = false,
  disabled,
  onClick,
}: {
  icon: IconDefinition;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} openDelay={300}>
      <ActionIcon
        size='sm'
        variant='subtle'
        color='gray'
        className={
          danger ? 'hover:bg-(--mantine-color-red-light)! hover:text-(--mantine-color-red-light-color)!' : undefined
        }
        disabled={disabled}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <FontAwesomeIcon icon={icon} size='xs' />
      </ActionIcon>
    </Tooltip>
  );
}

function NodeRowView({
  row,
  editing,
  readOnly,
  actions,
}: {
  row: NodeRow;
  editing: EditField | null;
  readOnly: boolean;
  actions: TreeActions;
}) {
  const { t: tExt, tItem } = useExtTranslations();
  const { tag, parent } = row;
  const container = tag.type === 'compound' || tag.type === 'list';
  const array = tag.type === 'byteArray' || tag.type === 'intArray' || tag.type === 'longArray';
  const inList = parent?.type === 'list';

  let summary: string | null = null;
  if (tag.type === 'compound') summary = tItem('tag', row.childCount);
  else if (tag.type === 'list') {
    summary =
      row.childCount > 0 && tag.itemType !== 'end'
        ? tExt('nbt.listOf', { tags: tItem('tag', row.childCount), type: tExt(`nbt.types.${tag.itemType}`, {}) })
        : tItem('tag', 0);
  }

  const toggle = () => actions.toggle(row);

  return (
    <>
      {container && row.childCount > 0 ? (
        <button
          type='button'
          aria-label={tExt(row.expanded ? 'nbt.collapse' : 'nbt.expand', {})}
          aria-expanded={row.expanded}
          className='flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-(--mantine-color-dimmed) hover:text-(--mantine-color-text)'
          onClick={toggle}
        >
          <FontAwesomeIcon
            icon={faChevronRight}
            className={classNames('text-[10px] transition-transform', row.expanded && 'rotate-90')}
          />
        </button>
      ) : (
        <span className='size-4 shrink-0' />
      )}
      <TypeBadge type={tag.type} />

      {editing === 'key' ? (
        <InlineEditor row={row} field='key' initial={row.key} actions={actions} />
      ) : (
        <span
          className={classNames(
            'shrink-0 whitespace-pre rounded px-0.5',
            inList ? 'text-(--mantine-color-dimmed)' : 'font-semibold',
            row.keyMatch && 'bg-(--mantine-color-yellow-light)',
            container && 'cursor-pointer',
          )}
          onClick={container ? toggle : undefined}
        >
          {row.key}
        </span>
      )}
      <span className='-ml-1.5 shrink-0 text-(--mantine-color-dimmed)'>:</span>

      {container ? (
        <span className='shrink-0 cursor-pointer text-(--mantine-color-dimmed)' onClick={toggle}>
          {summary}
        </span>
      ) : array ? (
        <span className='flex min-w-0 items-center gap-2'>
          <span className='shrink-0 text-(--mantine-color-dimmed)'>
            {tExt('nbt.length', { count: row.arrayLength })}
          </span>
          <span className='max-w-[32rem] truncate'>[{row.value}]</span>
        </span>
      ) : editing === 'value' ? (
        <InlineEditor row={row} field='value' initial={scalarText(tag as ScalarTag)} actions={actions} />
      ) : readOnly ? (
        <span
          className={classNames(
            'max-w-[40rem] truncate select-text whitespace-pre',
            tag.type === 'string' && 'text-(--mantine-color-green-light-color)',
            row.valueMatch && 'bg-(--mantine-color-yellow-light)',
          )}
          title={row.value}
        >
          {tag.type === 'string' ? `"${row.value}"` : row.value}
        </span>
      ) : (
        <button
          type='button'
          title={tExt('nbt.editValue', {})}
          className={classNames(
            'max-w-[40rem] cursor-text truncate whitespace-pre rounded px-1 text-left hover:bg-(--mantine-color-default-hover)',
            tag.type === 'string' && 'text-(--mantine-color-green-light-color)',
            row.valueMatch && 'bg-(--mantine-color-yellow-light)',
          )}
          onClick={() => actions.startEdit(tag, 'value')}
        >
          {tag.type === 'string' ? `"${row.value}"` : row.value}
        </button>
      )}

      <span className='ml-auto flex shrink-0 items-center gap-0.5 pl-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100'>
        {!readOnly && container && (
          <Action icon={faPlus} label={tExt('nbt.actions.add', {})} onClick={() => actions.add(row)} />
        )}
        {array && (
          <Action
            icon={readOnly ? faEye : faPen}
            label={tExt(readOnly ? 'nbt.actions.viewArray' : 'nbt.actions.editArray', {})}
            onClick={() => actions.openArray(row)}
          />
        )}
        {!readOnly && parent?.type === 'compound' && (
          <Action
            icon={faICursor}
            label={tExt('nbt.actions.rename', {})}
            onClick={() => actions.startEdit(tag, 'key')}
          />
        )}
        {!readOnly && inList && (
          <>
            <Action
              icon={faArrowUp}
              label={tExt('nbt.actions.moveUp', {})}
              disabled={row.index === 0}
              onClick={() => actions.move(row, -1)}
            />
            <Action
              icon={faArrowDown}
              label={tExt('nbt.actions.moveDown', {})}
              disabled={row.index === row.siblings - 1}
              onClick={() => actions.move(row, 1)}
            />
          </>
        )}
        {!readOnly && parent && (
          <Action icon={faClone} label={tExt('nbt.actions.duplicate', {})} onClick={() => actions.duplicate(row)} />
        )}
        <Action icon={faCopy} label={tExt('nbt.actions.copySnbt', {})} onClick={() => actions.copy(row)} />
        {!readOnly && parent && (
          <Action icon={faTrash} label={tExt('nbt.actions.remove', {})} danger onClick={() => actions.remove(row)} />
        )}
      </span>
    </>
  );
}

function MoreRowView({ row, actions }: { row: MoreRow; actions: TreeActions }) {
  const { t: tExt } = useExtTranslations();
  const remaining = row.total - row.shown;

  return (
    <>
      <span className='text-(--mantine-color-dimmed)'>
        {tExt('nbt.more.shown', { shown: row.shown, total: row.total })}
      </span>
      <Button size='compact-xs' variant='subtle' onClick={() => actions.showMore(row, false)}>
        {tExt('nbt.more.showMore', { count: Math.min(PAGE_SIZE, remaining) })}
      </Button>
      <Button size='compact-xs' variant='subtle' onClick={() => actions.showMore(row, true)}>
        {tExt('nbt.more.showAll', {})}
      </Button>
    </>
  );
}

function TreeRowView({
  row,
  index,
  measure,
  editing,
  readOnly,
  actions,
}: {
  row: TreeRow;
  index: number;
  measure: (element: HTMLElement | null) => void;
  editing: EditField | null;
  readOnly: boolean;
  actions: TreeActions;
}) {
  return (
    <div
      ref={measure}
      data-index={index}
      className='group flex min-h-7 w-full items-center gap-1.5 pr-1 font-mono text-xs hover:bg-(--mantine-color-default-hover)'
      style={{ paddingLeft: 4 + row.depth * INDENT }}
    >
      {row.kind === 'node' ? (
        <NodeRowView row={row} editing={editing} readOnly={readOnly} actions={actions} />
      ) : (
        <MoreRowView row={row} actions={actions} />
      )}
    </div>
  );
}

export default memo(TreeRowView);
