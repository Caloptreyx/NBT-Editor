import { faBroom, faCircleInfo, faFloppyDisk, faFolderOpen, faMap, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import ConfirmationModal from '@/elements/modals/ConfirmationModal.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import { useToast } from '@/providers/ToastProvider.tsx';
import type { ChunkModel } from '../lib/chunk.ts';
import type { NbtDocument } from '../lib/nbt.ts';
import { errorMessage, type RegionFile, type RegionSession } from '../pages/useRegionSession.ts';
import useSaveShortcut from '../pages/useSaveShortcut.ts';
import { useExtTranslations } from '../translations.ts';
import { chunkPosition } from './chunkFacts.ts';
import ChunkInspector from './ChunkInspector.tsx';
import ConflictModal from './ConflictModal.tsx';
import FileHeader from './FileHeader.tsx';
import NbtTreeEditor from './NbtTreeEditor.tsx';
import PruneModal from './PruneModal.tsx';
import RegionMap from './RegionMap.tsx';
import SelectionPanel from './SelectionPanel.tsx';

type Mode =
  | { kind: 'map' }
  | { kind: 'inspector'; models: ChunkModel[] }
  | { kind: 'chunkNbt'; index: number; doc: NbtDocument; changed: boolean };

// an open region file: chunk map with selection tools, the 3D chunk inspector, per-chunk NBT editing and pruning
export default function RegionView({
  serverUuid,
  session,
  file,
  canWrite,
  readOnlyReason,
  onBackToFiles,
  onClose,
}: {
  serverUuid: string;
  session: RegionSession;
  /** `session.file`, guaranteed open */
  file: RegionFile;
  /** server offline and files.create granted */
  canWrite: boolean;
  /** why saving is disabled, shown while `canWrite` is false */
  readOnlyReason: string;
  onBackToFiles: () => void;
  onClose: () => void;
}) {
  // reads the mutable region session (Region, previews, models) during render; compiler memoization would go stale
  'use no memo';

  const { t: tExt, tItem } = useExtTranslations();
  const { addToast } = useToast();
  const [mode, setMode] = useState<Mode>({ kind: 'map' });
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [nbtRevision, setNbtRevision] = useState(0);

  // a freshly opened or reloaded region invalidates decoded models and the selection
  useEffect(() => {
    setMode({ kind: 'map' });
    setSelection(new Set());
  }, [file]);

  const backToMap = () => {
    if (mode.kind === 'chunkNbt' && mode.changed) session.redecode(mode.index);
    session.settleLiveChunks();
    setMode({ kind: 'map' });
  };

  const inspect = async (indices: number[]) => {
    setPreparing(true);
    try {
      const { models, failures } = await session.loadModels(indices);
      for (const failure of failures) {
        const position = chunkPosition(file, failure.index);
        addToast(tExt('page.toast.chunkFailed', { ...position, error: failure.message }), 'error');
      }
      if (models.length > 0) setMode({ kind: 'inspector', models });
    } finally {
      setPreparing(false);
    }
  };

  const editNbt = async (index: number) => {
    setPreparing(true);
    try {
      setMode({ kind: 'chunkNbt', index, doc: await session.chunkDocument(index), changed: false });
    } catch (error) {
      addToast(tExt('page.toast.chunkFailed', { ...chunkPosition(file, index), error: errorMessage(error) }), 'error');
    } finally {
      setPreparing(false);
    }
  };

  const save = async (force = false) => {
    if (mode.kind === 'chunkNbt' && mode.changed) {
      session.redecode(mode.index);
      setMode({ ...mode, changed: false });
    }
    setSaving(true);
    try {
      const result = await session.save(force);
      if (result.status === 'conflict') {
        setConflict(true);
        return;
      }
      setConflict(false);
      addToast(tExt('page.toast.saved', { name: file.name }), 'success');
      for (const sibling of result.siblings) {
        if (sibling.status === 'failed') {
          addToast(
            tExt('page.toast.siblingFailed', { path: sibling.path, error: httpErrorToHuman(sibling.error) }),
            'error',
          );
        }
      }
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    setSaving(true);
    try {
      await session.reload();
      setConflict(false);
      addToast(tExt('page.toast.reloaded', { name: file.name }), 'success');
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(() => {
    if (canWrite && session.dirty && !saving) save();
  });

  const pruneDisabledReason =
    file.kind !== 'region'
      ? tExt('page.header.pruneRegionOnly', {})
      : file.rx === null || file.rz === null
        ? tExt('page.header.pruneUnknownCoords', {})
        : null;

  const modeLabel =
    mode.kind === 'inspector'
      ? tExt('page.header.modeInspector', { chunks: tItem('chunk', mode.models.length) })
      : mode.kind === 'chunkNbt'
        ? tExt('page.header.modeChunkNbt', chunkPosition(file, mode.index))
        : null;

  return (
    <>
      <ConflictModal
        name={conflict ? file.name : null}
        loading={saving}
        onClose={() => setConflict(false)}
        onReload={reload}
        onOverwrite={() => save(true)}
      />

      <ConfirmationModal
        title={tExt('page.delete.title', {})}
        opened={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        confirm={tExt('page.delete.confirm', {})}
        onConfirmed={() => {
          if (pendingDelete) session.deleteChunks(pendingDelete);
          setPendingDelete(null);
          setSelection(new Set());
        }}
      >
        {tExt(file.kind === 'region' ? 'page.delete.content' : 'page.delete.contentSingleFile', {
          chunks: tItem('chunk', pendingDelete?.length ?? 0),
        })}
      </ConfirmationModal>

      {pruneDisabledReason === null && file.rx !== null && file.rz !== null && (
        <PruneModal
          opened={pruneOpen}
          serverUuid={serverUuid}
          region={{ name: file.name, path: file.path, rx: file.rx, rz: file.rz }}
          canWrite={canWrite}
          readOnlyReason={readOnlyReason}
          hasUnsavedChanges={session.dirty}
          onClose={() => setPruneOpen(false)}
          onPruned={(paths) => {
            if (paths.includes(file.path)) {
              session.reload().catch((error) => addToast(httpErrorToHuman(error), 'error'));
            }
          }}
        />
      )}

      <FileHeader
        kind={file.kind}
        name={file.name}
        path={file.path}
        dirty={session.dirty}
        readOnly={!canWrite}
        badges={
          <>
            <span className='rounded bg-(--mantine-color-default-hover) px-1.5 text-[10px] leading-4 uppercase tracking-wide text-(--mantine-color-dimmed)'>
              {tExt(`page.kinds.${file.kind}`, {})}
            </span>
            {modeLabel && (
              <span className='rounded bg-(--mantine-primary-color-light) px-1.5 text-[10px] leading-4 text-(--mantine-primary-color-light-color)'>
                {modeLabel}
              </span>
            )}
          </>
        }
      >
        <Button
          size='xs'
          variant='default'
          leftSection={<FontAwesomeIcon icon={faMap} />}
          disabled={mode.kind === 'map'}
          onClick={backToMap}
        >
          {tExt('page.header.backToMap', {})}
        </Button>
        <Button
          size='xs'
          variant='default'
          leftSection={<FontAwesomeIcon icon={faFolderOpen} />}
          onClick={() => {
            if (mode.kind !== 'map') backToMap();
            onBackToFiles();
          }}
        >
          {tExt('page.header.backToFiles', {})}
        </Button>
        <Button size='xs' variant='default' leftSection={<FontAwesomeIcon icon={faXmark} />} onClick={onClose}>
          {tExt('page.header.closeFile', {})}
        </Button>
        <Tooltip label={pruneDisabledReason} disabled={pruneDisabledReason === null} multiline maw={320}>
          <Button
            size='xs'
            variant='default'
            leftSection={<FontAwesomeIcon icon={faBroom} />}
            disabled={pruneDisabledReason !== null}
            onClick={() => setPruneOpen(true)}
          >
            {tExt('page.header.prune', {})}
          </Button>
        </Tooltip>
        <Tooltip label={canWrite ? tExt('page.header.saveShortcut', {}) : readOnlyReason} multiline maw={320}>
          <Button
            size='xs'
            leftSection={<FontAwesomeIcon icon={faFloppyDisk} />}
            disabled={!canWrite || !session.dirty}
            loading={saving}
            onClick={() => save()}
          >
            {tExt('page.header.saveRegion', {})}
          </Button>
        </Tooltip>
      </FileHeader>

      {!canWrite && (
        <Alert color='yellow' className='mx-4 mt-3 shrink-0' title={tExt('page.region.readOnlyTitle', {})}>
          {readOnlyReason}
        </Alert>
      )}

      {session.opening === file.path || preparing ? (
        <div className='flex flex-1 items-center justify-center'>
          <Spinner.Centered />
        </div>
      ) : mode.kind === 'inspector' ? (
        <div className='flex min-h-0 flex-1 flex-col'>
          <ChunkInspector models={mode.models} readOnly={!canWrite} onEdit={session.markEdited} onClose={backToMap} />
        </div>
      ) : mode.kind === 'chunkNbt' ? (
        <div className='flex min-h-0 flex-1 flex-col'>
          <div className='flex shrink-0 items-center gap-2 px-4 pt-3 text-xs text-(--mantine-color-dimmed)'>
            <FontAwesomeIcon icon={faCircleInfo} />
            {tExt('page.region.chunkNbtHint', {})}
          </div>
          <NbtTreeEditor
            className='min-h-0 flex-1'
            root={mode.doc.root}
            rootName={mode.doc.name}
            revision={nbtRevision}
            readOnly={!canWrite}
            onChange={() => {
              session.markDocumentChanged(mode.index);
              setNbtRevision((current) => current + 1);
              if (!mode.changed) setMode({ ...mode, changed: true });
            }}
          />
        </div>
      ) : (
        <div className='flex min-h-0 flex-1 flex-col lg:flex-row'>
          <RegionMap
            file={file}
            previews={session.previews}
            atlas={session.atlas}
            revision={session.revision}
            progress={session.progress}
            selection={selection}
            onSelectionChange={setSelection}
            onActivate={(index) => {
              if (file.kind === 'region' && session.previews[index]?.state === 'ready') inspect([index]);
            }}
          />
          <SelectionPanel
            file={file}
            previews={session.previews}
            selection={selection}
            canWrite={canWrite}
            readOnlyReason={readOnlyReason}
            onInspect={inspect}
            onEditNbt={editNbt}
            onDelete={setPendingDelete}
            onClear={() => setSelection(new Set())}
          />
        </div>
      )}
    </>
  );
}
