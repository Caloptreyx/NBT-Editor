import {
  faFile,
  faFileCode,
  faLocationDot,
  faPaw,
  faTableCellsLarge,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { FileKind } from '../lib/worlds.ts';

const KIND_LOOKS: Record<Exclude<FileKind, null>, { icon: IconDefinition; color: string }> = {
  region: { icon: faTableCellsLarge, color: 'var(--mantine-color-green-5)' },
  entities: { icon: faPaw, color: 'var(--mantine-color-orange-5)' },
  poi: { icon: faLocationDot, color: 'var(--mantine-color-violet-4)' },
  nbt: { icon: faFileCode, color: 'var(--mantine-color-blue-4)' },
};

export function fileKindColor(kind: FileKind): string {
  return kind ? KIND_LOOKS[kind].color : 'var(--mantine-color-dimmed)';
}

export default function FileKindIcon({ kind, className }: { kind: FileKind; className?: string }) {
  return (
    <FontAwesomeIcon
      icon={kind ? KIND_LOOKS[kind].icon : faFile}
      className={className}
      style={{ color: fileKindColor(kind) }}
    />
  );
}
