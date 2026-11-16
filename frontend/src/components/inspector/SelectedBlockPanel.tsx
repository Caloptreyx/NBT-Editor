import { faArrowRightArrowLeft, faCube, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { type ReactNode, useState } from 'react';
import ActionIcon from '@/elements/buttons/ActionIcon.tsx';
import Button from '@/elements/buttons/Button.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import type { BlockState } from '../../lib/chunk.ts';
import type { CompoundTag } from '../../lib/nbt.ts';
import type { BlockPos } from '../VoxelViewport.tsx';
import { blockStateKey, parseBlockStateKey } from '../../lib/chunk.ts';
import { useExtTranslations } from '../../translations.ts';
import NbtTreeEditor from '../NbtTreeEditor.tsx';
import { blockEntityId } from './blocks.ts';
import OverlayCard from './OverlayCard.tsx';

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex flex-col gap-1 border-t border-(--mantine-color-default-border) px-3 py-2'>
      <span className='text-[11px] font-medium tracking-wide text-(--mantine-color-dimmed) uppercase'>{label}</span>
      {children}
    </div>
  );
}

// keyed by the selected position by the parent, so the replace input starts from the block it was opened for
export default function SelectedBlockPanel({
  pos,
  state,
  blockEntity,
  editable,
  lockedReason,
  onRemove,
  onReplace,
  onBlockEntityChange,
  onClose,
}: {
  pos: BlockPos;
  state: BlockState;
  blockEntity: CompoundTag | null;
  editable: boolean;
  /** Why this chunk cannot be edited even though the inspector is writable, e.g. a pre-1.13 chunk. */
  lockedReason: string | null;
  onRemove: () => void;
  onReplace: (state: BlockState) => void;
  onBlockEntityChange: () => void;
  onClose: () => void;
}) {
  const { t: tExt } = useExtTranslations();
  const [replacement, setReplacement] = useState(() => blockStateKey(state));
  const [entityRevision, setEntityRevision] = useState(0);
  const parsed = parseBlockStateKey(replacement.trim());
  const properties = Object.entries(state.properties ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const entityId = blockEntityId(blockEntity);

  return (
    <OverlayCard className='flex max-h-full w-96 max-w-full flex-col overflow-hidden'>
      <div className='flex items-center gap-2 px-3 py-2'>
        <FontAwesomeIcon icon={faCube} className='text-(--mantine-color-dimmed)' />
        <span className='min-w-0 flex-1 truncate font-mono text-xs font-medium' title={blockStateKey(state)}>
          {state.name}
        </span>
        <ActionIcon
          size='sm'
          variant='subtle'
          color='gray'
          aria-label={tExt('inspector.selected.deselect', {})}
          title={tExt('inspector.selected.deselect', {})}
          onClick={onClose}
        >
          <FontAwesomeIcon icon={faXmark} />
        </ActionIcon>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        <Section label={tExt('inspector.selected.position', {})}>
          <div className='flex justify-between text-xs tabular-nums'>
            <span>{tExt('inspector.hover.position', { x: pos.x, y: pos.y, z: pos.z })}</span>
            <span className='text-(--mantine-color-dimmed)'>
              {tExt('inspector.selected.chunk', { x: pos.x >> 4, z: pos.z >> 4 })}
            </span>
          </div>
        </Section>

        <Section label={tExt('inspector.selected.properties', {})}>
          {properties.length === 0 ? (
            <span className='text-xs text-(--mantine-color-dimmed)'>{tExt('inspector.selected.noProperties', {})}</span>
          ) : (
            <table className='w-full text-xs'>
              <tbody>
                {properties.map(([key, value]) => (
                  <tr key={key} className='border-b border-(--mantine-color-default-border) last:border-b-0'>
                    <td className='py-0.5 pr-2 font-mono text-(--mantine-color-dimmed)'>{key}</td>
                    <td className='py-0.5 font-mono break-all'>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {editable ? (
          <Section label={tExt('inspector.selected.edit', {})}>
            <Button
              size='xs'
              color='red'
              variant='light'
              leftSection={<FontAwesomeIcon icon={faTrash} />}
              onClick={onRemove}
            >
              {tExt('inspector.selected.remove', {})}
            </Button>
            <form
              className='flex items-start gap-1.5'
              onSubmit={(e) => {
                e.preventDefault();
                if (parsed) onReplace(parsed);
              }}
            >
              <TextInput
                size='xs'
                className='flex-1'
                aria-label={tExt('inspector.selected.replaceWith', {})}
                placeholder={tExt('inspector.selected.replaceWith', {})}
                spellCheck={false}
                value={replacement}
                error={replacement.trim() && !parsed ? tExt('inspector.selected.invalidState', {}) : undefined}
                onChange={(e) => setReplacement(e.currentTarget.value)}
              />
              <Button
                size='xs'
                type='submit'
                disabled={!parsed || blockStateKey(parsed) === blockStateKey(state)}
                leftSection={<FontAwesomeIcon icon={faArrowRightArrowLeft} />}
              >
                {tExt('inspector.selected.replace', {})}
              </Button>
            </form>
          </Section>
        ) : (
          lockedReason && (
            <Section label={tExt('inspector.selected.edit', {})}>
              <span className='text-xs text-(--mantine-color-dimmed)'>{lockedReason}</span>
            </Section>
          )
        )}

        {blockEntity && (
          <Section label={tExt('inspector.selected.blockEntity', { id: entityId ?? '?' })}>
            <NbtTreeEditor
              root={blockEntity}
              rootName={entityId ?? ''}
              revision={entityRevision}
              readOnly={!editable}
              onChange={() => {
                setEntityRevision((revision) => revision + 1);
                onBlockEntityChange();
              }}
              className='max-h-80 min-h-24'
            />
          </Section>
        )}
      </div>
    </OverlayCard>
  );
}
