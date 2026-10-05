import { faLock, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import ActionIcon from '@/elements/buttons/ActionIcon.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import type { BlockState, ChunkModel } from '../lib/chunk.ts';
import { AIR, blockStateKey } from '../lib/chunk.ts';
import { buildVolume, findInVolume, setVolumeBlock, volumeBlock } from '../lib/volume.ts';
import { useExtTranslations } from '../translations.ts';
import BlockSearch from './inspector/BlockSearch.tsx';
import { blockEntityAt, blockEntityId, modelAt, samePos } from './inspector/blocks.ts';
import HelpCard from './inspector/HelpCard.tsx';
import HoverTooltip from './inspector/HoverTooltip.tsx';
import SelectedBlockPanel from './inspector/SelectedBlockPanel.tsx';
import ViewControls from './inspector/ViewControls.tsx';
import VoxelViewport, { type BlockPos } from './VoxelViewport.tsx';

export interface ChunkInspectorProps {
  models: ChunkModel[];
  readOnly: boolean;
  onEdit(): void;
  onClose(): void;
}

const HIGHLIGHT_CAP = 2000;
const NO_HIGHLIGHTS: BlockPos[] = [];

interface SearchState {
  query: string;
  matches: BlockPos[];
  index: number;
}

export default function ChunkInspector({ models, readOnly, onEdit, onClose }: ChunkInspectorProps) {
  const { t: tExt } = useExtTranslations();
  const volume = useMemo(() => buildVolume(models), [models]);
  const topY = volume.minY + volume.height - 1;
  const viewportRef = useRef<HTMLDivElement>(null);

  const [revision, setRevision] = useState(0);
  const [slice, setSlice] = useState<[number, number]>([volume.minY, topY]);
  const [paintDelete, setPaintDelete] = useState(false);
  const [hovered, setHovered] = useState<BlockPos | null>(null);
  const [selected, setSelected] = useState<BlockPos | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ pos: BlockPos; nonce: number } | null>(null);
  const [cameraReset, setCameraReset] = useState(0);

  // a different chunk selection starts from a clean view
  const [shownVolume, setShownVolume] = useState(volume);
  if (shownVolume !== volume) {
    setShownVolume(volume);
    setSlice([volume.minY, topY]);
    setHovered(null);
    setSelected(null);
    setSearch(null);
    setFocusRequest(null);
  }

  const highlights = useMemo(() => (search ? search.matches.slice(0, HIGHLIGHT_CAP) : NO_HIGHLIGHTS), [search]);

  const focus = (pos: BlockPos) => {
    setFocusRequest((request) => ({ pos, nonce: (request?.nonce ?? 0) + 1 }));
    // a jump target hidden by the Y slice would leave the camera looking at nothing
    setSlice(([low, high]) =>
      pos.y < low || pos.y > high ? [Math.min(low, pos.y), Math.max(high, pos.y)] : [low, high],
    );
  };

  const applyBlock = (pos: BlockPos, state: BlockState) => {
    if (readOnly || !setVolumeBlock(volume, pos.x, pos.y, pos.z, state)) return;
    setRevision((value) => value + 1);
    if (search) {
      const matches = findInVolume(volume, search.query);
      setSearch((current) =>
        current && current.query === search.query
          ? { ...current, matches, index: Math.min(current.index, Math.max(0, matches.length - 1)) }
          : current,
      );
    }
    if (state.name === AIR.name) setSelected((current) => (samePos(current, pos) ? null : current));
    onEdit();
  };

  const findBlocks = (query: string) => {
    const matches = findInVolume(volume, query);
    setSearch({ query, matches, index: 0 });
    if (matches.length > 0) focus(matches[0]);
  };

  const stepSearch = (delta: 1 | -1) => {
    if (!search || search.matches.length === 0) return;
    const index = (search.index + delta + search.matches.length) % search.matches.length;
    setSearch({ ...search, index });
    focus(search.matches[index]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !selected) return;
    const target = e.target as HTMLElement;
    if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    setSelected(null);
  };

  const hoveredState = hovered ? volumeBlock(volume, hovered.x, hovered.y, hovered.z) : AIR;
  const hoverInfo =
    hovered && hoveredState.name !== AIR.name
      ? {
          stateKey: blockStateKey(hoveredState),
          pos: hovered,
          entityId: blockEntityId(blockEntityAt(volume, hovered)),
        }
      : null;

  const selectedState = selected ? volumeBlock(volume, selected.x, selected.y, selected.z) : AIR;
  const selectedModel = selected ? modelAt(volume, selected.x, selected.z) : null;
  const chunkList = models.map((model) => `(${model.x}, ${model.z})`).join(', ');

  return (
    <div className='flex h-full min-h-0 flex-col gap-2' onKeyDown={onKeyDown}>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-base leading-tight font-semibold'>{tExt('inspector.title', {})}</h2>
          <p className='text-xs text-(--mantine-color-dimmed)'>{tExt('inspector.subtitle', {})}</p>
        </div>
        {readOnly && (
          <Tooltip label={tExt('inspector.readOnlyHint', {})} multiline w={300}>
            <Badge color='yellow' variant='light' leftSection={<FontAwesomeIcon icon={faLock} />}>
              {tExt('inspector.readOnly', {})}
            </Badge>
          </Tooltip>
        )}
        <span className='max-w-md truncate text-xs text-(--mantine-color-dimmed) tabular-nums' title={chunkList}>
          {tExt('inspector.chunks', { chunks: chunkList })}
        </span>
        <ActionIcon
          variant='subtle'
          color='gray'
          aria-label={tExt('inspector.close', {})}
          title={tExt('inspector.close', {})}
          onClick={onClose}
        >
          <FontAwesomeIcon icon={faXmark} />
        </ActionIcon>
      </div>

      <div
        ref={viewportRef}
        className='relative min-h-[28rem] flex-1 overflow-hidden rounded-md border border-(--mantine-color-default-border)'
      >
        <VoxelViewport
          className='absolute inset-0'
          volume={volume}
          revision={revision}
          sliceMinY={slice[0]}
          sliceMaxY={slice[1]}
          highlights={highlights}
          selected={selected}
          paintDelete={paintDelete && !readOnly}
          onHover={(pos) => setHovered((current) => (samePos(current, pos) ? current : pos))}
          onSelect={setSelected}
          onDelete={(pos) => applyBlock(pos, AIR)}
          focusRequest={focusRequest}
          resetRequest={cameraReset}
        />

        <HoverTooltip containerRef={viewportRef} info={hoverInfo} />

        <div className='pointer-events-none absolute top-2 left-2 z-10'>
          <HelpCard />
        </div>

        <div className='pointer-events-none absolute bottom-2 left-2 z-10 flex flex-col gap-2'>
          <ViewControls
            minY={volume.minY}
            maxY={topY}
            slice={slice}
            onSliceChange={setSlice}
            onResetCamera={() => setCameraReset((value) => value + 1)}
            paintDelete={paintDelete}
            onPaintDeleteChange={setPaintDelete}
            readOnly={readOnly}
          />
          <BlockSearch
            result={search && { query: search.query, count: search.matches.length, index: search.index }}
            highlightCap={HIGHLIGHT_CAP}
            onFind={findBlocks}
            onClear={() => setSearch(null)}
            onStep={stepSearch}
          />
        </div>

        {selected && selectedState.name !== AIR.name && (
          <div className='pointer-events-none absolute top-2 right-2 bottom-2 z-10 flex max-w-[calc(100%-1rem)] items-start'>
            <SelectedBlockPanel
              key={`${selected.x},${selected.y},${selected.z}`}
              pos={selected}
              state={selectedState}
              blockEntity={blockEntityAt(volume, selected)}
              editable={!readOnly && (selectedModel?.editable ?? false)}
              lockedReason={!readOnly && selectedModel && !selectedModel.editable ? selectedModel.readOnlyReason : null}
              onRemove={() => applyBlock(selected, AIR)}
              onReplace={(state) => applyBlock(selected, state)}
              onBlockEntityChange={() => {
                if (selectedModel) selectedModel.dirty = true;
                onEdit();
              }}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
