import type { TagType } from '../../lib/nbt.ts';
import { useExtTranslations } from '../../translations.ts';
import type { CreatableTagType } from './treeModel.ts';

export const TYPE_BADGES: Record<CreatableTagType, { label: string; color: string }> = {
  byte: { label: 'B', color: 'grape' },
  short: { label: 'S', color: 'violet' },
  int: { label: 'I', color: 'blue' },
  long: { label: 'L', color: 'indigo' },
  float: { label: 'F', color: 'teal' },
  double: { label: 'D', color: 'cyan' },
  string: { label: '""', color: 'green' },
  byteArray: { label: '[B]', color: 'orange' },
  intArray: { label: '[I]', color: 'yellow' },
  longArray: { label: '[L]', color: 'pink' },
  list: { label: '[ ]', color: 'lime' },
  compound: { label: '{ }', color: 'gray' },
};

export default function TypeBadge({ type }: { type: Exclude<TagType, 'end'> }) {
  const { t: tExt } = useExtTranslations();
  const badge = TYPE_BADGES[type];

  return (
    <span
      title={tExt(`nbt.types.${type}`, {})}
      className='w-7 shrink-0 rounded py-px text-center font-mono text-[10px] leading-4'
      style={{
        backgroundColor: `var(--mantine-color-${badge.color}-light)`,
        color: `var(--mantine-color-${badge.color}-light-color)`,
      }}
    >
      {badge.label}
    </span>
  );
}
