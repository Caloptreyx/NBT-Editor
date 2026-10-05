import { faCircle, faCircleCheck, faLock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { ReactNode } from 'react';
import type { FileKind } from '../lib/worlds.ts';
import { useExtTranslations } from '../translations.ts';
import FileKindIcon, { fileKindColor } from './FileKindIcon.tsx';

// path bar of the open file: kind icon, name, full path and save state on the left, view actions on the right
export default function FileHeader({
  kind,
  name,
  path,
  dirty,
  readOnly,
  badges,
  children,
}: {
  kind: FileKind;
  name: string;
  path: string;
  dirty: boolean;
  readOnly: boolean;
  badges?: ReactNode;
  children: ReactNode;
}) {
  const { t: tExt } = useExtTranslations();

  const status = dirty ? (
    <span className='inline-flex shrink-0 items-center gap-1.5 text-xs text-(--mantine-color-orange-light-color)'>
      <FontAwesomeIcon icon={faCircle} className='text-[7px]' />
      {tExt('page.header.unsaved', {})}
    </span>
  ) : readOnly ? (
    <span className='inline-flex shrink-0 items-center gap-1.5 text-xs text-(--mantine-color-dimmed)'>
      <FontAwesomeIcon icon={faLock} />
      {tExt('page.header.readOnly', {})}
    </span>
  ) : (
    <span className='inline-flex shrink-0 items-center gap-1.5 text-xs text-(--mantine-color-green-light-color)'>
      <FontAwesomeIcon icon={faCircleCheck} />
      {tExt('page.header.saved', {})}
    </span>
  );

  return (
    <div className='flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-(--mantine-color-default-border) px-4 py-3'>
      <div className='flex min-w-0 flex-1 items-center gap-3'>
        <div
          className='grid h-10 w-10 shrink-0 place-items-center rounded-md text-lg'
          style={{ backgroundColor: 'var(--mantine-color-default-hover)', color: fileKindColor(kind) }}
        >
          <FileKindIcon kind={kind} />
        </div>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <span className='truncate font-semibold'>{name}</span>
            {badges}
            {status}
          </div>
          <span
            className='w-fit max-w-full truncate rounded bg-(--mantine-color-default) px-1.5 py-0.5 font-mono text-xs text-(--mantine-color-dimmed) light:bg-(--mantine-color-gray-0)'
            title={path}
          >
            {path}
          </span>
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-2'>{children}</div>
    </div>
  );
}
