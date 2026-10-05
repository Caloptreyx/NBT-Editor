import { useEffect, useRef, useState } from 'react';
import { panCamera, walkCamera } from '../lib/camera.ts';
import type { Volume } from '../lib/volume.ts';
import { useExtTranslations } from '../translations.ts';
import { samePos, VoxelRenderer } from './voxelRenderer.ts';

export interface BlockPos {
  x: number;
  y: number;
  z: number;
}

export interface VoxelViewportProps {
  volume: Volume;
  revision: number;
  sliceMinY: number;
  sliceMaxY: number;
  highlights: BlockPos[];
  selected: BlockPos | null;
  paintDelete: boolean;
  onHover(pos: BlockPos | null): void;
  onSelect(pos: BlockPos | null): void;
  onDelete(pos: BlockPos): void;
  focusRequest: { pos: BlockPos; nonce: number } | null;
  resetRequest?: number; // any change (after mount) resets the camera like the R key
  className?: string;
}

type DragMode = 'orbit' | 'tilt' | 'pan' | 'paint';

interface Drag {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  deleted: Set<string>;
}

const ROTATE_PER_PIXEL = 0.008;
const CLICK_SLOP_PX = 4;
const PAINT_STEP_PX = 4;
const KEY_TILT_PER_SECOND = 1.4;
const MAX_PIXEL_RATIO = 2;
const MOVE_KEYS: Record<string, [number, number]> = {
  w: [1, 0],
  arrowup: [1, 0],
  s: [-1, 0],
  arrowdown: [-1, 0],
  a: [0, -1],
  arrowleft: [0, -1],
  d: [0, 1],
  arrowright: [0, 1],
};

export default function VoxelViewport(props: VoxelViewportProps) {
  const { volume, revision, sliceMinY, sliceMaxY, highlights, selected, focusRequest, resetRequest, className } = props;
  const { t: tExt } = useExtTranslations();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<VoxelRenderer | null>(null);
  const propsRef = useRef(props);
  const hoverRef = useRef<BlockPos | null>(null);
  const [status, setStatus] = useState<'ready' | 'unsupported' | 'lost'>('ready');

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const held = new Set<string>();
    let drag: Drag | null = null;
    let pointer: { x: number; y: number } | null = null;

    const beforeFrame = (dt: number): boolean => {
      if (held.size === 0) return false;
      const camera = renderer.camera;
      let forward = 0;
      let right = 0;
      for (const key of held) {
        const move = MOVE_KEYS[key];
        if (move) {
          forward += move[0];
          right += move[1];
        }
      }
      const speed = Math.max(8, camera.distance * 0.8) * dt;
      walkCamera(camera, forward * speed, right * speed);
      if (held.has('q')) camera.pitch -= KEY_TILT_PER_SECOND * dt;
      if (held.has('e')) camera.pitch += KEY_TILT_PER_SECOND * dt;
      return true;
    };

    let renderer: VoxelRenderer;
    try {
      renderer = new VoxelRenderer(canvas, {
        beforeFrame,
        onContextLost: (lost) => setStatus(lost ? 'lost' : 'ready'),
      });
    } catch {
      setStatus('unsupported');
      return;
    }
    rendererRef.current = renderer;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width, height: rect.height };
    };
    const pickAt = (x: number, y: number): BlockPos | null => {
      const rect = canvas.getBoundingClientRect();
      const hit = renderer.pick(x, y, rect.width, rect.height);
      return hit ? { x: hit.x, y: hit.y, z: hit.z } : null;
    };
    const setHover = (pos: BlockPos | null) => {
      renderer.setHover(pos);
      if (samePos(pos, hoverRef.current)) return;
      hoverRef.current = pos;
      propsRef.current.onHover(pos);
    };
    const refreshHover = () => {
      if (pointer && (!drag || drag.mode === 'paint')) setHover(pickAt(pointer.x, pointer.y));
    };
    const paintAt = (x: number, y: number) => {
      if (!drag) return;
      const pos = pickAt(x, y);
      if (!pos) return;
      const key = `${pos.x},${pos.y},${pos.z}`;
      if (drag.deleted.has(key)) return;
      drag.deleted.add(key);
      propsRef.current.onDelete(pos);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (drag) return;
      const mode: DragMode | null =
        e.button === 0
          ? propsRef.current.paintDelete
            ? 'paint'
            : 'orbit'
          : e.button === 1
            ? 'tilt'
            : e.button === 2
              ? 'pan'
              : null;
      if (!mode) return;
      if (e.button === 1) e.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointer = { x: p.x, y: p.y };
      drag = {
        mode,
        pointerId: e.pointerId,
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
        deleted: new Set(),
      };
      if (mode === 'paint') {
        paintAt(p.x, p.y);
        refreshHover();
      } else {
        renderer.cancelFocusAnimation();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e);
      pointer = { x: p.x, y: p.y };
      if (!drag || drag.pointerId !== e.pointerId) {
        if (!drag) setHover(pickAt(p.x, p.y));
        return;
      }
      const dx = p.x - drag.lastX;
      const dy = p.y - drag.lastY;
      if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > CLICK_SLOP_PX) drag.moved = true;
      const camera = renderer.camera;
      switch (drag.mode) {
        case 'orbit':
          camera.yaw -= dx * ROTATE_PER_PIXEL;
          camera.pitch += dy * ROTATE_PER_PIXEL;
          setHover(null);
          break;
        case 'tilt':
          camera.pitch += dy * ROTATE_PER_PIXEL;
          setHover(null);
          break;
        case 'pan':
          panCamera(camera, dx, dy, p.height);
          setHover(null);
          break;
        case 'paint': {
          // sample along the segment so fast strokes do not skip blocks
          const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / PAINT_STEP_PX));
          for (let i = 1; i <= steps; i++) paintAt(drag.lastX + (dx * i) / steps, drag.lastY + (dy * i) / steps);
          refreshHover();
          break;
        }
      }
      drag.lastX = p.x;
      drag.lastY = p.y;
      renderer.requestRender();
    };

    const endDrag = (e: PointerEvent, cancelled: boolean) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const finished = drag;
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!cancelled && finished.mode === 'orbit' && !finished.moved) {
        const p = local(e);
        const pos = pickAt(p.x, p.y);
        if (e.shiftKey) {
          if (pos) propsRef.current.onDelete(pos);
        } else {
          propsRef.current.onSelect(pos);
        }
      }
      refreshHover();
    };
    const onPointerUp = (e: PointerEvent) => endDrag(e, false);
    const onPointerCancel = (e: PointerEvent) => endDrag(e, true);

    const onPointerLeave = () => {
      pointer = null;
      if (!drag) setHover(null);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      renderer.camera.distance *= Math.exp(Math.max(-200, Math.min(200, pixels)) * 0.0015);
      renderer.requestRender();
      refreshHover();
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (MOVE_KEYS[key] || key === 'q' || key === 'e') {
        e.preventDefault();
        if (!held.has(key)) {
          held.add(key);
          renderer.cancelFocusAnimation();
          renderer.requestRender();
        }
        return;
      }
      if (key === 'r' && !e.repeat) {
        e.preventDefault();
        renderer.resetCamera();
        return;
      }
      if ((key === 'delete' || key === 'backspace') && !e.repeat) {
        const current = propsRef.current.selected;
        if (!current) return;
        e.preventDefault();
        propsRef.current.onDelete(current);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      held.delete(e.key.toLowerCase());
    };
    const onBlur = () => held.clear();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('blur', onBlur);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('blur', onBlur);
      rendererRef.current = null;
      renderer.dispose();
    };
  }, []);

  // Effects below run in declaration order, so a new volume is in place before slice/overlay updates.
  const shownVolume = useRef<Volume | null>(null);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (shownVolume.current !== volume) {
      shownVolume.current = volume;
      hoverRef.current = null;
      renderer.setHover(null);
    }
    renderer.setVolume(volume);
  }, [volume, revision]);

  useEffect(() => {
    rendererRef.current?.setSlice(sliceMinY, sliceMaxY);
  }, [volume, sliceMinY, sliceMaxY]);

  useEffect(() => {
    rendererRef.current?.setHighlights(highlights);
  }, [highlights]);

  useEffect(() => {
    rendererRef.current?.setSelected(selected);
  }, [selected]);

  const lastFocusNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastFocusNonce.current) return;
    lastFocusNonce.current = focusRequest.nonce;
    rendererRef.current?.focus(focusRequest.pos);
  }, [focusRequest]);

  const lastReset = useRef(resetRequest);
  useEffect(() => {
    if (resetRequest === lastReset.current) return;
    lastReset.current = resetRequest;
    rendererRef.current?.resetCamera();
  }, [resetRequest]);

  const message =
    status === 'unsupported'
      ? tExt('viewport.webglUnavailable', {})
      : status === 'lost'
        ? tExt('viewport.contextLost', {})
        : null;

  return (
    <div ref={containerRef} className={className}>
      <div className='relative h-full w-full overflow-hidden bg-[#11131a]'>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={tExt('viewport.label', {})}
          className='block h-full w-full touch-none outline-none select-none'
        />
        {message && (
          <div className='absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-(--mantine-color-dimmed)'>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
