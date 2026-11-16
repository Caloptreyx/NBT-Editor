import { type RefObject, useEffect, useRef } from 'react';
import type { BlockPos } from '../VoxelViewport.tsx';
import { useExtTranslations } from '../../translations.ts';

const CURSOR_OFFSET = 14;

// follows the cursor by writing its own style from a pointermove listener, so hovering never re-renders the
// inspector (and with it the viewport) per mouse move
export default function HoverTooltip({
  containerRef,
  info,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  info: { stateKey: string; pos: BlockPos; entityId: string | null } | null;
}) {
  const { t: tExt } = useExtTranslations();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const place = () => {
    const container = containerRef.current;
    const tooltip = tooltipRef.current;
    if (!container || !tooltip) return;
    const { x, y } = pointer.current;
    const flipX = x + CURSOR_OFFSET + tooltip.offsetWidth > container.clientWidth;
    const flipY = y + CURSOR_OFFSET + tooltip.offsetHeight > container.clientHeight;
    const left = flipX ? x - CURSOR_OFFSET - tooltip.offsetWidth : x + CURSOR_OFFSET;
    const top = flipY ? y - CURSOR_OFFSET - tooltip.offsetHeight : y + CURSOR_OFFSET;
    tooltip.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px)`;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      place();
    };
    container.addEventListener('pointermove', onMove);
    return () => container.removeEventListener('pointermove', onMove);
  });

  useEffect(() => {
    if (info) place();
  });

  return (
    <div
      ref={tooltipRef}
      className='pointer-events-none absolute top-0 left-0 z-20 max-w-xs rounded-md border border-(--mantine-color-default-border) bg-(--mantine-color-body)/90 px-2 py-1 text-xs shadow-lg backdrop-blur-md'
      style={{ visibility: info ? 'visible' : 'hidden' }}
    >
      {info && (
        <>
          <div className='font-mono break-all'>{info.stateKey}</div>
          <div className='text-(--mantine-color-dimmed) tabular-nums'>
            {tExt('inspector.hover.position', { x: info.pos.x, y: info.pos.y, z: info.pos.z })}
          </div>
          {info.entityId && (
            <div className='text-(--mantine-color-dimmed)'>
              {tExt('inspector.hover.blockEntity', { id: info.entityId })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
