import { faChevronDown, faChevronUp, faCircleQuestion } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useLocalStorage } from '@mantine/hooks';
import { useExtTranslations } from '../../translations.ts';
import OverlayCard from './OverlayCard.tsx';

export default function HelpCard() {
  const { t: tExt } = useExtTranslations();
  const [expanded, setExpanded] = useLocalStorage({
    key: 'dev.caloptreyx.nbteditor.inspector-help',
    defaultValue: true,
  });

  return (
    <OverlayCard className='max-w-sm'>
      <button
        type='button'
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className='mantine-focus-auto flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-medium'
      >
        <FontAwesomeIcon icon={faCircleQuestion} className='text-(--mantine-color-dimmed)' />
        <span className='flex-1 text-left'>{tExt('inspector.help.title', {})}</span>
        <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} className='text-(--mantine-color-dimmed)' />
      </button>
      {expanded && (
        <p className='px-3 pb-2 text-xs leading-relaxed text-(--mantine-color-dimmed)'>
          {tExt('inspector.help.text', {})}
        </p>
      )}
    </OverlayCard>
  );
}
