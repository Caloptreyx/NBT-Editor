import {
  faArrowRight,
  faArrowTurnUp,
  faChevronRight,
  faFolder,
  faHouse,
  faMagnifyingGlass,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useQuery } from '@tanstack/react-query';
import classNames from 'classnames';
import { dirname, join } from 'pathe';
import { Fragment, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import ActionIcon from '@/elements/buttons/ActionIcon.tsx';
import Button from '@/elements/buttons/Button.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import FormattedTimestamp from '@/elements/time/FormattedTimestamp.tsx';
import { bytesToString } from '@/lib/format/size.ts';
import { pathSegments } from '@/lib/path.ts';
import { listDirectory, nbtEditorQueryKey } from '../api.ts';
import { type FileKind, fileKind } from '../lib/worlds.ts';
import { useExtTranslations } from '../translations.ts';
import FileKindIcon from './FileKindIcon.tsx';
import WorldsStrip from './WorldsStrip.tsx';

const CRUMB_CLASS =
  'mantine-focus-auto min-w-0 cursor-pointer truncate rounded px-1 py-0.5 hover:bg-(--mantine-color-default-hover)';

const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_6.5rem_5.5rem] md:grid-cols-[minmax(0,1fr)_7rem_6rem_10rem] gap-3';

export interface OpenFileSummary {
  name: string;
  path: string;
  kind: FileKind;
  dirty: boolean;
}

function Breadcrumbs({ directory, onNavigate }: { directory: string; onNavigate: (directory: string) => void }) {
  const { t: tExt } = useExtTranslations();
  const segments = pathSegments(directory);

  return (
    <div className='flex min-w-0 flex-1 flex-wrap items-center gap-0.5 rounded-md bg-(--mantine-color-default) px-1.5 py-1 font-mono text-xs light:bg-(--mantine-color-gray-0)'>
      <button
        type='button'
        title={tExt('page.browser.root', {})}
        aria-label={tExt('page.browser.root', {})}
        className={classNames(
          CRUMB_CLASS,
          segments.length === 0 ? 'text-(--mantine-color-text)' : 'text-(--mantine-color-dimmed)',
        )}
        onClick={() => onNavigate('/')}
      >
        <FontAwesomeIcon icon={faHouse} />
      </button>
      {segments.map((segment, index) => (
        <Fragment key={segment.path}>
          <FontAwesomeIcon icon={faChevronRight} className='text-[8px] text-(--mantine-color-dimmed)' />
          <button
            type='button'
            title={segment.name}
            className={classNames(
              CRUMB_CLASS,
              index === segments.length - 1 ? 'text-(--mantine-color-text)' : 'text-(--mantine-color-dimmed)',
            )}
            onClick={() => onNavigate(join('/', segment.path))}
          >
            {segment.name}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

// directory listing of region/NBT files with breadcrumbs, a name filter and world shortcuts
export default function FileBrowser({
  serverUuid,
  directory,
  openFile,
  onNavigate,
  onOpen,
  onReturn,
}: {
  serverUuid: string;
  directory: string;
  /** the file kept open in the background, if any */
  openFile: OpenFileSummary | null;
  onNavigate: (directory: string) => void;
  onOpen: (path: string) => void;
  onReturn: () => void;
}) {
  const { t: tExt } = useExtTranslations();
  const [filter, setFilter] = useState('');

  const listing = useQuery({
    queryKey: [...nbtEditorQueryKey(serverUuid), 'files', directory],
    queryFn: () => listDirectory(serverUuid, directory),
  });

  const query = filter.trim().toLowerCase();
  const entries = (listing.data?.entries ?? []).filter((entry) => entry.name.toLowerCase().includes(query));

  const navigate = (next: string) => {
    setFilter('');
    onNavigate(next);
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 flex-wrap items-center gap-2 border-b border-(--mantine-color-default-border) px-4 py-3'>
        <Breadcrumbs directory={directory} onNavigate={navigate} />
        <TextInput
          size='xs'
          className='w-full sm:w-56'
          placeholder={tExt('page.browser.filter', {})}
          leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
        />
        <Tooltip label={tExt('page.browser.refresh', {})}>
          <ActionIcon
            variant='default'
            size='md'
            aria-label={tExt('page.browser.refresh', {})}
            loading={listing.isFetching}
            onClick={() => listing.refetch()}
          >
            <FontAwesomeIcon icon={faRotateRight} />
          </ActionIcon>
        </Tooltip>
      </div>

      {openFile && (
        <div className='flex shrink-0 flex-wrap items-center gap-3 border-b border-(--mantine-color-default-border) bg-(--mantine-primary-color-light) px-4 py-2'>
          <FileKindIcon kind={openFile.kind} />
          <span className='min-w-0 flex-1 truncate text-sm'>
            {tExt(openFile.dirty ? 'page.browser.openUnsaved' : 'page.browser.open', { name: openFile.name })}
          </span>
          <Button size='xs' variant='light' rightSection={<FontAwesomeIcon icon={faArrowRight} />} onClick={onReturn}>
            {tExt('page.browser.return', {})}
          </Button>
        </div>
      )}

      {directory === '/' && <WorldsStrip serverUuid={serverUuid} onNavigate={navigate} onOpen={onOpen} />}

      <div
        className={classNames(
          ROW_GRID,
          'shrink-0 border-b border-(--mantine-color-default-border) px-6 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--mantine-color-dimmed)',
        )}
      >
        <span>{tExt('page.browser.name', {})}</span>
        <span>{tExt('page.browser.type', {})}</span>
        <span className='text-right'>{tExt('page.browser.size', {})}</span>
        <span className='hidden md:block'>{tExt('page.browser.modified', {})}</span>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-1.5'>
        {directory !== '/' && (
          <button
            type='button'
            className='mantine-focus-auto flex cursor-pointer items-center gap-2.5 rounded-md px-4 py-1.5 text-sm text-(--mantine-color-dimmed) hover:bg-(--mantine-color-default-hover)'
            onClick={() => navigate(dirname(directory))}
          >
            <FontAwesomeIcon icon={faArrowTurnUp} className='w-4 shrink-0 -scale-x-100' />
            {tExt('page.browser.up', {})}
          </button>
        )}

        {listing.isLoading ? (
          <Spinner.Centered />
        ) : listing.error ? (
          <Alert color='red' className='m-2'>
            {httpErrorToHuman(listing.error)}
          </Alert>
        ) : entries.length === 0 ? (
          <p className='px-4 py-3 text-sm text-(--mantine-color-dimmed)'>
            {query ? tExt('page.browser.noMatches', {}) : tExt('page.browser.empty', {})}
          </p>
        ) : (
          entries.map((entry) => {
            const kind = entry.directory ? null : fileKind(entry.path);
            const supported = entry.directory || kind !== null;

            return (
              <button
                key={entry.path}
                type='button'
                disabled={!supported}
                title={supported ? entry.path : tExt('page.browser.unsupported', {})}
                className={classNames(
                  ROW_GRID,
                  'mantine-focus-auto items-center rounded-md px-4 py-1.5 text-left text-sm',
                  supported
                    ? 'cursor-pointer hover:bg-(--mantine-color-default-hover)'
                    : 'cursor-not-allowed opacity-50',
                  entry.path === openFile?.path &&
                    'bg-(--mantine-primary-color-light) text-(--mantine-primary-color-light-color)',
                )}
                onClick={() => (entry.directory ? navigate(entry.path) : onOpen(entry.path))}
              >
                <span className='flex min-w-0 items-center gap-2.5'>
                  {entry.directory ? (
                    <FontAwesomeIcon
                      icon={faFolder}
                      className='w-4 shrink-0'
                      style={{ color: 'var(--mantine-primary-color-filled)' }}
                    />
                  ) : (
                    <FileKindIcon kind={kind} className='w-4 shrink-0' />
                  )}
                  <span className='min-w-0 truncate'>{entry.name}</span>
                </span>
                <span className='truncate text-xs text-(--mantine-color-dimmed)'>
                  {tExt(`page.kinds.${entry.directory ? 'directory' : (kind ?? 'unsupported')}`, {})}
                </span>
                <span className='text-right text-xs tabular-nums text-(--mantine-color-dimmed)'>
                  {entry.directory ? '' : bytesToString(entry.size)}
                </span>
                <span className='hidden truncate text-xs text-(--mantine-color-dimmed) md:block'>
                  <FormattedTimestamp timestamp={entry.modified} />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
