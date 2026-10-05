import { faChevronLeft, faChevronRight, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import ActionIcon from '@/elements/buttons/ActionIcon.tsx';
import Button from '@/elements/buttons/Button.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import { useExtTranslations } from '../../translations.ts';
import OverlayCard from './OverlayCard.tsx';

export default function BlockSearch({
  result,
  highlightCap,
  onFind,
  onClear,
  onStep,
}: {
  /** Current search, or null when none ran. `index` is the match the camera was last moved to. */
  result: { query: string; count: number; index: number } | null;
  highlightCap: number;
  onFind: (query: string) => void;
  onClear: () => void;
  onStep: (delta: 1 | -1) => void;
}) {
  const { t: tExt } = useExtTranslations();
  const [query, setQuery] = useState('minecraft:');
  const trimmed = query.trim();

  return (
    <OverlayCard className='flex w-72 flex-col gap-2 px-3 py-2'>
      <div className='flex items-center gap-2 text-xs font-medium'>
        <FontAwesomeIcon icon={faMagnifyingGlass} className='text-(--mantine-color-dimmed)' />
        <span className='flex-1'>{tExt('inspector.search.title', {})}</span>
      </div>

      <form
        className='flex gap-1.5'
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onFind(trimmed);
        }}
      >
        <TextInput
          size='xs'
          className='flex-1'
          value={query}
          placeholder={tExt('inspector.search.placeholder', {})}
          aria-label={tExt('inspector.search.title', {})}
          spellCheck={false}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <Button size='xs' type='submit' disabled={!trimmed}>
          {tExt('inspector.search.find', {})}
        </Button>
      </form>

      {result && (
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-1'>
            <span className='flex-1 truncate text-xs' title={result.query}>
              {result.count === 0
                ? tExt('inspector.search.noMatches', {})
                : result.count === 1
                  ? tExt('inspector.search.oneMatch', {})
                  : tExt('inspector.search.matches', { count: result.count })}
            </span>
            {result.count > 0 && (
              <>
                <span className='text-xs tabular-nums text-(--mantine-color-dimmed)'>
                  {tExt('inspector.search.position', { index: result.index + 1, count: result.count })}
                </span>
                <ActionIcon
                  size='sm'
                  variant='subtle'
                  aria-label={tExt('inspector.search.previous', {})}
                  onClick={() => onStep(-1)}
                >
                  <FontAwesomeIcon icon={faChevronLeft} />
                </ActionIcon>
                <ActionIcon
                  size='sm'
                  variant='subtle'
                  aria-label={tExt('inspector.search.next', {})}
                  onClick={() => onStep(1)}
                >
                  <FontAwesomeIcon icon={faChevronRight} />
                </ActionIcon>
              </>
            )}
            <ActionIcon
              size='sm'
              variant='subtle'
              color='gray'
              aria-label={tExt('inspector.search.clear', {})}
              onClick={onClear}
            >
              <FontAwesomeIcon icon={faXmark} />
            </ActionIcon>
          </div>
          {result.count > highlightCap && (
            <span className='text-xs text-(--mantine-color-dimmed)'>
              {tExt('inspector.search.capped', { count: highlightCap })}
            </span>
          )}
        </div>
      )}
    </OverlayCard>
  );
}
