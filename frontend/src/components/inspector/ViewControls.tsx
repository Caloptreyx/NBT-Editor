import { faCamera, faEraser, faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { RangeSlider } from '@mantine/core';
import Button from '@/elements/buttons/Button.tsx';
import Switch from '@/elements/input/Switch.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import { useExtTranslations } from '../../translations.ts';
import OverlayCard from './OverlayCard.tsx';

export default function ViewControls({
  minY,
  maxY,
  slice,
  onSliceChange,
  onResetCamera,
  paintDelete,
  onPaintDeleteChange,
  readOnly,
}: {
  /** Inclusive block Y bounds of the volume. */
  minY: number;
  maxY: number;
  slice: [number, number];
  onSliceChange: (slice: [number, number]) => void;
  onResetCamera: () => void;
  paintDelete: boolean;
  onPaintDeleteChange: (enabled: boolean) => void;
  readOnly: boolean;
}) {
  const { t: tExt } = useExtTranslations();

  const paintSwitch = (
    <Switch
      size='xs'
      checked={paintDelete && !readOnly}
      disabled={readOnly}
      onChange={(e) => onPaintDeleteChange(e.currentTarget.checked)}
      label={
        <span className='inline-flex items-center gap-1.5 text-xs'>
          <FontAwesomeIcon icon={faEraser} />
          {tExt('inspector.controls.paintDelete', {})}
        </span>
      }
    />
  );

  return (
    <OverlayCard className='flex w-72 flex-col gap-2 px-3 py-2'>
      <div className='flex items-center gap-2 text-xs font-medium'>
        <FontAwesomeIcon icon={faLayerGroup} className='text-(--mantine-color-dimmed)' />
        <span className='flex-1'>{tExt('inspector.controls.title', {})}</span>
        <Button
          size='compact-xs'
          variant='subtle'
          leftSection={<FontAwesomeIcon icon={faCamera} />}
          onClick={onResetCamera}
        >
          {tExt('inspector.controls.resetCamera', {})}
        </Button>
      </div>

      <div className='flex flex-col gap-1'>
        <div className='flex justify-between text-xs text-(--mantine-color-dimmed)'>
          <span>{tExt('inspector.controls.yMin', { y: slice[0] })}</span>
          <span>{tExt('inspector.controls.yMax', { y: slice[1] })}</span>
        </div>
        <RangeSlider
          size='xs'
          min={minY}
          max={maxY}
          minRange={0}
          value={slice}
          onChange={onSliceChange}
          label={null}
          thumbFromLabel={tExt('inspector.controls.lowestY', {})}
          thumbToLabel={tExt('inspector.controls.highestY', {})}
        />
      </div>

      {readOnly ? (
        <Tooltip label={tExt('inspector.readOnlyHint', {})} multiline w={240}>
          {paintSwitch}
        </Tooltip>
      ) : (
        paintSwitch
      )}
    </OverlayCard>
  );
}
