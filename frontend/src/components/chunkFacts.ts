import { bytesToString } from '@/lib/format/size.ts';
import { formatDateTime } from '@/lib/format/time.ts';
import { COMPRESSION_NAMES, formatTicks, slotCoords } from '../lib/session.ts';
import type { ChunkPreview, RegionFile } from '../pages/useRegionSession.ts';
import type { getExtTranslations } from '../translations.ts';

export interface ChunkFact {
  label: string;
  value: string;
}

type Translate = ReturnType<typeof getExtTranslations>['t'];

/** Absolute chunk coordinates of a slot, or the local ones when the region coordinates are unknown. */
export function chunkPosition(file: RegionFile, index: number): { x: number; z: number } {
  const { lx, lz } = slotCoords(index);
  return file.rx === null || file.rz === null ? { x: lx, z: lz } : { x: file.rx * 32 + lx, z: file.rz * 32 + lz };
}

/** Label/value pairs describing one region slot for the hover bar and the selection panel. */
export function chunkFacts(file: RegionFile, index: number, preview: ChunkPreview | null, t: Translate): ChunkFact[] {
  const { lx, lz } = slotCoords(index);
  const slot = file.region.slot(lx, lz);
  const facts: ChunkFact[] = [];

  if (preview?.state === 'ready' && preview.summary) {
    const { summary } = preview;
    facts.push(
      { label: t('page.chunk.status', {}), value: summary.status ?? t('page.chunk.noStatus', {}) },
      { label: t('page.chunk.inhabited', {}), value: formatTicks(summary.inhabitedTime) },
      { label: t('page.chunk.lastUpdate', {}), value: t('page.chunk.tick', { tick: summary.lastUpdate.toString() }) },
      { label: t('page.chunk.dataVersion', {}), value: String(summary.dataVersion) },
    );
  }
  if (slot) {
    facts.push(
      { label: t('page.chunk.size', {}), value: bytesToString(slot.size) },
      {
        label: t('page.chunk.compression', {}),
        value: slot.external
          ? t('page.chunk.external', {})
          : (COMPRESSION_NAMES[slot.compression] ?? String(slot.compression)),
      },
    );
    if (slot.timestamp > 0) {
      facts.push({ label: t('page.chunk.saved', {}), value: formatDateTime(slot.timestamp * 1000) });
    }
  }
  return facts;
}
