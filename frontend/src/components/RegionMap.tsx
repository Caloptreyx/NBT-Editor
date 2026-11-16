import { useEffect, useRef, useState } from 'react';
import Progress from '@/elements/feedback/Progress.tsx';
import type { ChunkPreview, RegionFile } from '../pages/useRegionSession.ts';
import { rectSelection, SLOT_COUNT, slotCoords } from '../lib/session.ts';
import { useExtTranslations } from '../translations.ts';
import { chunkFacts, chunkPosition } from './chunkFacts.ts';

const COLORS = {
  background: '#0b0c0e',
  missing: '#16171a',
  pending: '#2a2c31',
  failed: '#c92a2a',
  presence: { entities: '#d9480f', poi: '#7048e8', region: '#2f9e44' },
  grid: 'rgba(0, 0, 0, 0.45)',
  hover: '#ffffff',
};

interface Drag {
  anchor: number;
  current: number;
  additive: boolean;
  pointerId: number;
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      <span className='h-2.5 w-2.5 rounded-sm border border-white/10' style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// the 32x32 chunk grid of a region: top-down renders of decoded chunks, hover details and chunk selection
export default function RegionMap({
  file,
  previews,
  atlas,
  revision,
  progress,
  selection,
  onSelectionChange,
  onActivate,
}: {
  file: RegionFile;
  previews: (ChunkPreview | null)[];
  atlas: HTMLCanvasElement | null;
  revision: number;
  progress: { done: number; total: number };
  selection: ReadonlySet<number>;
  onSelectionChange: (selection: Set<number>) => void;
  /** double click on a chunk */
  onActivate: (index: number) => void;
}) {
  // reads the mutable region session (Region, previews, models) during render; compiler memoization would go stale
  'use no memo';

  const { t: tExt } = useExtTranslations();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize(Math.max(0, Math.floor(Math.min(entry.contentRect.width, entry.contentRect.height))));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || size === 0) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = false;
    const cell = size / 32;

    context.fillStyle = COLORS.background;
    context.fillRect(0, 0, size, size);
    if (atlas) context.drawImage(atlas, 0, 0, atlas.width, atlas.height, 0, 0, size, size);

    for (let index = 0; index < SLOT_COUNT; index++) {
      const preview = previews[index] ?? null;
      const { lx, lz } = slotCoords(index);
      let fill: string | null = null;
      if (preview === null) fill = COLORS.missing;
      else if (preview.state === 'pending') fill = COLORS.pending;
      else if (preview.state === 'failed') fill = COLORS.failed;
      else if (!preview.summary) fill = COLORS.presence[file.kind];
      if (fill) {
        context.fillStyle = fill;
        context.fillRect(lx * cell, lz * cell, cell, cell);
      }
    }

    if (cell >= 8) {
      context.strokeStyle = COLORS.grid;
      context.lineWidth = 1;
      context.beginPath();
      for (let line = 1; line < 32; line++) {
        const offset = Math.round(line * cell) + 0.5;
        context.moveTo(offset, 0);
        context.lineTo(offset, size);
        context.moveTo(0, offset);
        context.lineTo(size, offset);
      }
      context.stroke();
    }

    const highlighted = new Set(selection);
    if (drag) {
      if (!drag.additive) highlighted.clear();
      for (const index of rectSelection(drag.anchor, drag.current)) highlighted.add(index);
    }
    const primary = getComputedStyle(canvas).getPropertyValue('--mantine-primary-color-filled').trim() || '#228be6';
    for (const index of highlighted) {
      const { lx, lz } = slotCoords(index);
      context.globalAlpha = 0.5;
      context.fillStyle = primary;
      context.fillRect(lx * cell, lz * cell, cell, cell);
      context.globalAlpha = 1;
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1;
      context.strokeRect(lx * cell + 1.5, lz * cell + 1.5, cell - 3, cell - 3);
    }

    if (hover !== null) {
      const { lx, lz } = slotCoords(hover);
      context.strokeStyle = COLORS.hover;
      context.lineWidth = 2;
      context.strokeRect(lx * cell + 1, lz * cell + 1, cell - 2, cell - 2);
    }
  }, [size, revision, previews, atlas, selection, drag, hover, file]);

  const slotAt = (event: React.PointerEvent | React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const lx = Math.floor(((event.clientX - rect.left) / rect.width) * 32);
    const lz = Math.floor(((event.clientY - rect.top) / rect.height) * 32);
    return Math.min(31, Math.max(0, lx)) + Math.min(31, Math.max(0, lz)) * 32;
  };

  const finishDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const indices = rectSelection(drag.anchor, drag.current);
    let next: Set<number>;
    if (drag.anchor === drag.current) {
      next = new Set(drag.additive ? selection : []);
      if (drag.additive && selection.has(drag.anchor)) next.delete(drag.anchor);
      else next.add(drag.anchor);
    } else {
      next = new Set(drag.additive ? [...selection, ...indices] : indices);
    }
    setDrag(null);
    onSelectionChange(next);
  };

  const hoverPreview = hover === null ? null : (previews[hover] ?? null);
  const hoverPosition = hover === null ? null : chunkPosition(file, hover);
  const hoverLocal = hover === null ? null : slotCoords(hover);

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <div ref={containerRef} className='relative flex min-h-[16rem] flex-1 items-center justify-center p-3'>
        <canvas
          ref={canvasRef}
          className='touch-none cursor-crosshair rounded-sm shadow-[0_0_0_1px_var(--mantine-color-default-border)]'
          style={{ width: size, height: size }}
          tabIndex={0}
          aria-label={tExt('page.map.label', { name: file.name })}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const index = slotAt(event);
            setDrag({
              anchor: index,
              current: index,
              additive: event.shiftKey || event.ctrlKey || event.metaKey,
              pointerId: event.pointerId,
            });
          }}
          onPointerMove={(event) => {
            const index = slotAt(event);
            setHover(index);
            if (drag && drag.pointerId === event.pointerId && drag.current !== index) {
              setDrag({ ...drag, current: index });
            }
          }}
          onPointerUp={finishDrag}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={() => {
            if (!drag) setHover(null);
          }}
          onDoubleClick={(event) => onActivate(slotAt(event))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onSelectionChange(new Set());
            if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onSelectionChange(new Set(previews.flatMap((preview, index) => (preview ? [index] : []))));
            }
          }}
        />
      </div>

      <div className='flex min-h-[4.25rem] shrink-0 flex-col justify-center gap-1 border-t border-(--mantine-color-default-border) px-4 py-2 text-xs'>
        {hover !== null && hoverPosition && hoverLocal ? (
          <>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-0.5'>
              <span className='font-semibold'>
                {tExt('page.map.chunkAt', { x: hoverPosition.x, z: hoverPosition.z })}
              </span>
              <span className='text-(--mantine-color-dimmed)'>
                {tExt('page.map.local', { x: hoverLocal.lx, z: hoverLocal.lz })}
              </span>
              {hoverPreview === null && (
                <span className='text-(--mantine-color-dimmed)'>{tExt('page.map.empty', {})}</span>
              )}
              {hoverPreview?.state === 'pending' && (
                <span className='text-(--mantine-color-dimmed)'>{tExt('page.map.decoding', {})}</span>
              )}
            </div>
            {hoverPreview?.state === 'failed' && (
              <span className='truncate text-(--mantine-color-red-light-color)' title={hoverPreview.error}>
                {hoverPreview.error}
              </span>
            )}
            <div className='flex flex-wrap gap-x-4 gap-y-0.5'>
              {chunkFacts(file, hover, hoverPreview, tExt).map((fact) => (
                <span key={fact.label}>
                  <span className='text-(--mantine-color-dimmed)'>{fact.label}</span>{' '}
                  <span className='font-mono'>{fact.value}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-(--mantine-color-dimmed)'>
            <span>{tExt('page.map.hint', {})}</span>
            <span className='flex-1' />
            <LegendSwatch color={COLORS.missing} label={tExt('page.map.legendMissing', {})} />
            <LegendSwatch color={COLORS.pending} label={tExt('page.map.legendPending', {})} />
            <LegendSwatch color={COLORS.failed} label={tExt('page.map.legendFailed', {})} />
          </div>
        )}
        {progress.done < progress.total && (
          <div className='flex items-center gap-3'>
            <span className='shrink-0 text-(--mantine-color-dimmed)'>
              {tExt('page.map.rendering', { done: progress.done, total: progress.total })}
            </span>
            <Progress
              className='flex-1'
              hourglass={false}
              withLabel={false}
              size='sm'
              value={(progress.done / progress.total) * 100}
            />
          </div>
        )}
      </div>
    </div>
  );
}
