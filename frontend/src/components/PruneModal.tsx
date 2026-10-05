import { faBroom, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import { basename, dirname } from 'pathe';
import { useRef, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Progress from '@/elements/feedback/Progress.tsx';
import Checkbox from '@/elements/input/Checkbox.tsx';
import NumberInput from '@/elements/input/NumberInput.tsx';
import SegmentedControl from '@/elements/layout/SegmentedControl.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { listDirectory } from '../api.ts';
import { hasCriteria, type PruneCriteria } from '../lib/prune.ts';
import {
  applyPrune,
  type PruneOutcome,
  type PruneScan,
  type RegionFileRef,
  regionFilesIn,
  SessionError,
  scanRegionForPrune,
  TICKS_PER_SECOND,
} from '../lib/session.ts';
import { createFileIo } from '../pages/fileIo.ts';
import { useExtTranslations } from '../translations.ts';

type Scope = 'region' | 'dimension';
type Phase = 'idle' | 'scanning' | 'scanned' | 'pruning' | 'done';

interface Row {
  file: RegionFileRef;
  status: 'pending' | 'working' | 'scanned' | 'pruned' | 'unchanged' | 'failed';
  scan: PruneScan | null;
  outcome: PruneOutcome | null;
  error: string | null;
  /** problems with the entities/poi siblings */
  warnings: string[];
}

const numberValue = (value: number | string, fallback: number) => (typeof value === 'number' ? value : fallback);

// criteria based chunk pruning for the open region or its whole dimension: scan first, then delete the matches
export default function PruneModal({
  opened,
  serverUuid,
  region,
  canWrite,
  readOnlyReason,
  hasUnsavedChanges,
  onClose,
  onPruned,
}: {
  opened: boolean;
  serverUuid: string;
  /** the open region file */
  region: RegionFileRef;
  canWrite: boolean;
  readOnlyReason: string;
  hasUnsavedChanges: boolean;
  onClose: () => void;
  /** region file paths that were rewritten */
  onPruned: (paths: string[]) => void;
}) {
  const { t } = useTranslations();
  const { t: tExt, tItem } = useExtTranslations();
  const { addToast } = useToast();

  const [inhabitedEnabled, setInhabitedEnabled] = useState(true);
  const [inhabitedMinutes, setInhabitedMinutes] = useState(2);
  const [unfinishedOnly, setUnfinishedOnly] = useState(false);
  const [radiusEnabled, setRadiusEnabled] = useState(false);
  const [centerX, setCenterX] = useState(0);
  const [centerZ, setCenterZ] = useState(0);
  const [radius, setRadius] = useState(2048);
  const [shape, setShape] = useState<'square' | 'circle'>('square');
  const [scope, setScope] = useState<Scope>('region');

  const [phase, setPhase] = useState<Phase>('idle');
  const [rows, setRows] = useState<Row[]>([]);
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const criteria: PruneCriteria = {
    inhabitedBelowTicks: inhabitedEnabled ? Math.round(inhabitedMinutes * 60 * TICKS_PER_SECOND) : null,
    unfinishedOnly,
    outsideRadius: radiusEnabled ? { centerX, centerZ, radius, shape } : null,
  };
  const busy = phase === 'scanning' || phase === 'pruning';

  // any change to the criteria or scope makes earlier scan results meaningless
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      if (!busy) {
        setRows([]);
        setPhase('idle');
      }
    };

  const describeError = (error: unknown) =>
    error instanceof SessionError
      ? tExt(error.code === 'missing' ? 'page.prune.errorMissing' : 'page.prune.errorChanged', {})
      : httpErrorToHuman(error);

  const updateRow = (index: number, change: Partial<Row>) =>
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...change } : row)));

  const scan = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setPhase('scanning');

    let files: RegionFileRef[];
    try {
      files =
        scope === 'region' ? [region] : regionFilesIn((await listDirectory(serverUuid, dirname(region.path))).entries);
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
      setPhase('idle');
      return;
    }

    const io = createFileIo(serverUuid);
    const scanCriteria = criteria;
    setRows(files.map((file) => ({ file, status: 'pending', scan: null, outcome: null, error: null, warnings: [] })));

    for (const [index, file] of files.entries()) {
      if (controller.signal.aborted) break;
      updateRow(index, { status: 'working' });
      setChunkProgress(null);
      try {
        const result = await scanRegionForPrune(file, scanCriteria, io, {
          signal: controller.signal,
          onProgress: (done, total) => setChunkProgress({ done, total }),
        });
        updateRow(index, { status: 'scanned', scan: result });
      } catch (error) {
        if (controller.signal.aborted) {
          updateRow(index, { status: 'pending' });
          break;
        }
        updateRow(index, { status: 'failed', error: describeError(error) });
      }
    }

    setChunkProgress(null);
    abort.current = null;
    setPhase(controller.signal.aborted ? 'idle' : 'scanned');
    if (controller.signal.aborted) setRows([]);
  };

  const prune = async () => {
    setPhase('pruning');
    const io = createFileIo(serverUuid);
    const written: string[] = [];
    let deletedChunks = 0;
    let failures = 0;

    for (const [index, row] of rows.entries()) {
      const target = row.scan;
      if (row.status !== 'scanned' || !target) continue;
      if (target.kind === 'chunks' && target.matched.length === 0) {
        updateRow(index, { status: 'unchanged' });
        continue;
      }

      updateRow(index, { status: 'working' });
      try {
        const outcome = await applyPrune(row.file, target, io);
        written.push(row.file.path);
        if (outcome.deleted !== 'all') deletedChunks += outcome.deleted;
        const warnings = outcome.siblings
          .filter((sibling) => sibling.status === 'failed')
          .map(
            (sibling) =>
              `${basename(dirname(sibling.path))}/${basename(sibling.path)}: ${httpErrorToHuman(sibling.error)}`,
          );
        failures += warnings.length;
        updateRow(index, { status: 'pruned', outcome, warnings });
      } catch (error) {
        failures++;
        updateRow(index, { status: 'failed', error: describeError(error) });
      }
    }

    setPhase('done');
    if (written.length > 0) onPruned(written);
    addToast(
      tExt('page.prune.toastDone', { chunks: deletedChunks, files: written.length }),
      failures > 0 ? 'warning' : 'success',
    );
  };

  const close = () => {
    if (phase === 'pruning') return;
    abort.current?.abort();
    onClose();
  };

  const scannedRows = rows.filter((row) => row.scan !== null);
  const matchedChunks = scannedRows.reduce(
    (sum, row) => sum + (row.scan?.kind === 'chunks' ? row.scan.matched.length : 0),
    0,
  );
  const entireRegions = scannedRows.filter((row) => row.scan?.kind === 'entire').length;
  const finishedRows = rows.filter((row) => row.status !== 'pending' && row.status !== 'working').length;
  const pruneBlocked = !canWrite ? readOnlyReason : hasUnsavedChanges ? tExt('page.prune.unsavedChanges', {}) : null;

  return (
    <Modal
      title={tExt('page.prune.title', {})}
      opened={opened}
      onClose={close}
      size='xl'
      closeOnClickOutside={!busy}
      closeOnEscape={phase !== 'pruning'}
    >
      <div className='flex flex-col gap-4'>
        <p className='text-sm text-(--mantine-color-dimmed)'>{tExt('page.prune.description', {})}</p>

        <fieldset disabled={busy} className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-3'>
            <Checkbox
              className='min-w-56'
              label={tExt('page.prune.inhabited', {})}
              checked={inhabitedEnabled}
              onChange={(event) => edit(setInhabitedEnabled)(event.currentTarget.checked)}
            />
            <NumberInput
              size='xs'
              className='w-40'
              min={0}
              step={1}
              decimalScale={2}
              disabled={!inhabitedEnabled || busy}
              suffix={` ${tExt('page.prune.minutes', {})}`}
              value={inhabitedMinutes}
              onChange={(value) => edit(setInhabitedMinutes)(numberValue(value, 0))}
            />
          </div>

          <Checkbox
            label={tExt('page.prune.unfinished', {})}
            description={tExt('page.prune.unfinishedHint', {})}
            checked={unfinishedOnly}
            onChange={(event) => edit(setUnfinishedOnly)(event.currentTarget.checked)}
          />

          <div className='flex flex-col gap-2'>
            <Checkbox
              label={tExt('page.prune.outside', {})}
              description={tExt('page.prune.outsideHint', {})}
              checked={radiusEnabled}
              onChange={(event) => edit(setRadiusEnabled)(event.currentTarget.checked)}
            />
            {radiusEnabled && (
              <div className='ml-8 flex flex-wrap items-end gap-3'>
                <NumberInput
                  size='xs'
                  className='w-28'
                  label={tExt('page.prune.centerX', {})}
                  allowDecimal={false}
                  value={centerX}
                  onChange={(value) => edit(setCenterX)(numberValue(value, 0))}
                />
                <NumberInput
                  size='xs'
                  className='w-28'
                  label={tExt('page.prune.centerZ', {})}
                  allowDecimal={false}
                  value={centerZ}
                  onChange={(value) => edit(setCenterZ)(numberValue(value, 0))}
                />
                <NumberInput
                  size='xs'
                  className='w-32'
                  label={tExt('page.prune.radius', {})}
                  allowDecimal={false}
                  min={0}
                  value={radius}
                  onChange={(value) => edit(setRadius)(numberValue(value, 0))}
                />
                <SegmentedControl
                  size='xs'
                  value={shape}
                  onChange={(value) => edit(setShape)(value as 'square' | 'circle')}
                  data={[
                    { value: 'square', label: tExt('page.prune.square', {}) },
                    { value: 'circle', label: tExt('page.prune.circle', {}) },
                  ]}
                />
              </div>
            )}
          </div>

          <div className='flex flex-wrap items-center gap-3'>
            <span className='text-sm'>{tExt('page.prune.scope', {})}</span>
            <SegmentedControl
              size='xs'
              value={scope}
              onChange={(value) => edit(setScope)(value as Scope)}
              data={[
                { value: 'region', label: tExt('page.prune.scopeRegion', { name: region.name }) },
                { value: 'dimension', label: tExt('page.prune.scopeDimension', {}) },
              ]}
            />
          </div>
        </fieldset>

        {pruneBlocked && <Alert color='yellow'>{pruneBlocked}</Alert>}

        {rows.length > 0 && (
          <div className='flex flex-col gap-2'>
            {busy && (
              <Progress
                hourglass={false}
                size='md'
                value={
                  ((finishedRows + (chunkProgress ? chunkProgress.done / Math.max(1, chunkProgress.total) : 0)) /
                    rows.length) *
                  100
                }
              />
            )}
            <div className='max-h-72 overflow-y-auto rounded-md border border-(--mantine-color-default-border)'>
              <table className='w-full text-xs'>
                <thead className='sticky top-0 bg-(--mantine-color-body) text-left text-(--mantine-color-dimmed)'>
                  <tr>
                    <th className='px-3 py-1.5 font-semibold'>{tExt('page.prune.file', {})}</th>
                    <th className='px-3 py-1.5 font-semibold'>{tExt('page.prune.matches', {})}</th>
                    <th className='px-3 py-1.5 font-semibold'>{tExt('page.prune.state', {})}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.file.path} className='border-t border-(--mantine-color-default-border) align-top'>
                      <td className='px-3 py-1.5 font-mono'>{row.file.name}</td>
                      <td className='px-3 py-1.5'>
                        {row.scan?.kind === 'entire'
                          ? tExt('page.prune.entireRegion', {})
                          : row.scan
                            ? `${row.scan.matched.length} / ${row.scan.total}${
                                row.scan.failed > 0
                                  ? ` · ${tExt('page.prune.undecodable', { count: row.scan.failed })}`
                                  : ''
                              }`
                            : ''}
                      </td>
                      <td
                        className={classNames(
                          'px-3 py-1.5',
                          row.status === 'failed' && 'text-(--mantine-color-red-light-color)',
                          row.status === 'pruned' && 'text-(--mantine-color-green-light-color)',
                        )}
                      >
                        {row.status === 'failed' ? row.error : tExt(`page.prune.status.${row.status}`, {})}
                        {row.warnings.map((warning) => (
                          <div key={warning} className='text-(--mantine-color-orange-light-color)'>
                            {warning}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {phase !== 'scanning' && scannedRows.length > 0 && (
              <p className='text-sm'>
                {entireRegions > 0
                  ? tExt('page.prune.summaryEntire', {
                      chunks: tItem('chunk', matchedChunks),
                      regions: tItem('region', entireRegions),
                    })
                  : tExt('page.prune.summary', { chunks: tItem('chunk', matchedChunks) })}
              </p>
            )}
          </div>
        )}
      </div>

      <ModalFooter>
        {phase === 'scanning' ? (
          <Button variant='default' onClick={() => abort.current?.abort()}>
            {t('common.button.cancel', {})}
          </Button>
        ) : (
          <Button
            variant='default'
            leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
            disabled={!hasCriteria(criteria) || phase === 'pruning'}
            onClick={scan}
          >
            {tExt('page.prune.scan', {})}
          </Button>
        )}
        <Button
          color='red'
          leftSection={<FontAwesomeIcon icon={faBroom} />}
          disabled={phase !== 'scanned' || pruneBlocked !== null || (matchedChunks === 0 && entireRegions === 0)}
          loading={phase === 'pruning'}
          onClick={prune}
        >
          {tExt('page.prune.prune', {})}
        </Button>
        <Button variant='default' disabled={phase === 'pruning'} onClick={close}>
          {t('common.button.close', {})}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
