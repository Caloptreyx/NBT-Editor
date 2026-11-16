import { faCube, faEraser, faPenToSquare, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Button from '@/elements/buttons/Button.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import type { ChunkPreview, RegionFile } from '../pages/useRegionSession.ts';
import { slotCoords } from '../lib/session.ts';
import { useExtTranslations } from '../translations.ts';
import { chunkFacts, chunkPosition } from './chunkFacts.ts';

export const MAX_INSPECTED_CHUNKS = 9;

function ActionButton({
  icon,
  label,
  disabledReason,
  color,
  onClick,
}: {
  icon: typeof faCube;
  label: string;
  /** null when the action is available */
  disabledReason: string | null;
  color?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip
      label={disabledReason}
      disabled={disabledReason === null}
      multiline
      w={260}
      className='w-full'
      innerClassName='w-full'
    >
      <Button
        fullWidth
        size='xs'
        variant={color ? 'light' : 'default'}
        color={color}
        justify='flex-start'
        leftSection={<FontAwesomeIcon icon={icon} className='w-3.5' />}
        disabled={disabledReason !== null}
        onClick={onClick}
      >
        {label}
      </Button>
    </Tooltip>
  );
}

// details and actions for the chunks selected on the region map
export default function SelectionPanel({
  file,
  previews,
  selection,
  canWrite,
  readOnlyReason,
  onInspect,
  onEditNbt,
  onDelete,
  onClear,
}: {
  file: RegionFile;
  previews: (ChunkPreview | null)[];
  selection: ReadonlySet<number>;
  canWrite: boolean;
  readOnlyReason: string;
  onInspect: (indices: number[]) => void;
  onEditNbt: (index: number) => void;
  onDelete: (indices: number[]) => void;
  onClear: () => void;
}) {
  // reads the mutable region session (Region, previews, models) during render; compiler memoization would go stale
  'use no memo';

  const { t: tExt, tItem } = useExtTranslations();

  const selected = [...selection].sort((a, b) => a - b);
  const present = selected.filter((index) => previews[index] !== null);
  const decodable = present.filter((index) => previews[index]?.state !== 'failed');
  const single = selected.length === 1 ? selected[0] : null;
  const singlePreview = single === null ? null : (previews[single] ?? null);

  let chunkCount = 0;
  let failedCount = 0;
  for (const preview of previews) {
    if (preview) chunkCount++;
    if (preview?.state === 'failed') failedCount++;
  }

  const inspectReason =
    file.kind !== 'region'
      ? tExt('page.selection.noBlocks', {})
      : decodable.length === 0
        ? tExt('page.selection.selectPresent', {})
        : decodable.length > MAX_INSPECTED_CHUNKS
          ? tExt('page.selection.tooMany', { max: MAX_INSPECTED_CHUNKS })
          : null;
  const editReason = present.length === 1 ? null : tExt('page.selection.selectOne', {});
  const deleteReason = !canWrite
    ? readOnlyReason
    : present.length === 0
      ? tExt('page.selection.selectPresent', {})
      : null;

  const bounds = (() => {
    if (selected.length < 2) return null;
    const positions = selected.map((index) => chunkPosition(file, index));
    const xs = positions.map((position) => position.x);
    const zs = positions.map((position) => position.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  })();

  return (
    <div className='flex min-h-0 w-full shrink-0 flex-col border-t border-(--mantine-color-default-border) lg:w-72 lg:border-t-0 lg:border-l'>
      <div className='flex h-10 shrink-0 items-center gap-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-(--mantine-color-dimmed)'>
        <span>{tExt('page.selection.title', {})}</span>
        {selected.length > 0 && (
          <span className='rounded-full bg-(--mantine-color-default-hover) px-1.5 py-px text-[10px] leading-4'>
            {selected.length}
          </span>
        )}
        <span className='flex-1' />
        {selected.length > 0 && (
          <button
            type='button'
            className='mantine-focus-auto cursor-pointer rounded px-1 normal-case tracking-normal hover:text-(--mantine-color-text)'
            onClick={onClear}
          >
            <FontAwesomeIcon icon={faEraser} className='mr-1' />
            {tExt('page.selection.clear', {})}
          </button>
        )}
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4'>
        {selected.length === 0 ? (
          <p className='text-xs leading-relaxed text-(--mantine-color-dimmed)'>{tExt('page.selection.empty', {})}</p>
        ) : single !== null ? (
          <div className='flex flex-col gap-1.5 rounded-md border border-(--mantine-color-default-border) p-3 text-xs'>
            <span className='text-sm font-semibold'>{tExt('page.map.chunkAt', chunkPosition(file, single))}</span>
            <span className='text-(--mantine-color-dimmed)'>
              {tExt('page.map.local', { x: slotCoords(single).lx, z: slotCoords(single).lz })}
            </span>
            {singlePreview === null && (
              <span className='text-(--mantine-color-dimmed)'>{tExt('page.map.empty', {})}</span>
            )}
            {singlePreview?.state === 'failed' && (
              <span className='break-words text-(--mantine-color-red-light-color)'>{singlePreview.error}</span>
            )}
            {chunkFacts(file, single, singlePreview, tExt).map((fact) => (
              <div key={fact.label} className='flex justify-between gap-3'>
                <span className='text-(--mantine-color-dimmed)'>{fact.label}</span>
                <span className='truncate text-right font-mono' title={fact.value}>
                  {fact.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className='flex flex-col gap-1.5 rounded-md border border-(--mantine-color-default-border) p-3 text-xs'>
            <span className='text-sm font-semibold'>{tItem('chunk', present.length)}</span>
            {present.length < selected.length && (
              <span className='text-(--mantine-color-dimmed)'>
                {tExt('page.selection.emptySlots', { count: selected.length - present.length })}
              </span>
            )}
            {bounds && (
              <span className='font-mono text-(--mantine-color-dimmed)'>{tExt('page.selection.bounds', bounds)}</span>
            )}
          </div>
        )}

        <div className='flex flex-col gap-1.5'>
          <ActionButton
            icon={faCube}
            label={tExt('page.selection.inspect', {})}
            disabledReason={inspectReason}
            onClick={() => onInspect(decodable)}
          />
          <ActionButton
            icon={faPenToSquare}
            label={tExt('page.selection.editNbt', {})}
            disabledReason={editReason}
            onClick={() => onEditNbt(present[0])}
          />
          <ActionButton
            icon={faTrash}
            label={
              present.length > 1
                ? tExt('page.selection.deleteMany', { count: present.length })
                : tExt('page.selection.delete', {})
            }
            color='red'
            disabledReason={deleteReason}
            onClick={() => onDelete(present)}
          />
        </div>

        <div className='mt-auto flex flex-col gap-1 border-t border-(--mantine-color-default-border) pt-3 text-xs text-(--mantine-color-dimmed)'>
          <div className='flex justify-between'>
            <span>{tExt('page.selection.regionChunks', {})}</span>
            <span className='font-mono'>{chunkCount} / 1024</span>
          </div>
          {failedCount > 0 && (
            <div className='flex justify-between text-(--mantine-color-red-light-color)'>
              <span>{tExt('page.selection.regionFailed', {})}</span>
              <span className='font-mono'>{failedCount}</span>
            </div>
          )}
          {file.rx !== null && file.rz !== null && (
            <div className='flex flex-wrap justify-between gap-x-3'>
              <span>{tExt('page.selection.regionBlocks', {})}</span>
              <span className='font-mono'>
                {tExt('page.selection.bounds', {
                  minX: file.rx * 512,
                  maxX: file.rx * 512 + 511,
                  minZ: file.rz * 512,
                  maxZ: file.rz * 512 + 511,
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
