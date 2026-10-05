import { faArrowLeft, faFloppyDisk, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import { bytesToString } from '@/lib/format/size.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import type { NbtFileSession } from '../pages/useNbtFileSession.ts';
import useSaveShortcut from '../pages/useSaveShortcut.ts';
import { useExtTranslations } from '../translations.ts';
import ConflictModal from './ConflictModal.tsx';
import FileHeader from './FileHeader.tsx';
import NbtTreeEditor from './NbtTreeEditor.tsx';

function FormatBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className='inline-flex items-center overflow-hidden rounded border border-(--mantine-color-default-border) text-[10px] leading-4'>
      <span className='bg-(--mantine-color-default-hover) px-1.5 uppercase tracking-wide text-(--mantine-color-dimmed)'>
        {label}
      </span>
      <span className='px-1.5 font-mono'>{value}</span>
    </span>
  );
}

// an open standalone NBT file: format details, the tag tree and saving in the original format
export default function NbtFileView({
  session,
  canSave,
  serverOffline,
  onBackToFiles,
  onClose,
}: {
  session: NbtFileSession;
  canSave: boolean;
  serverOffline: boolean;
  onBackToFiles: () => void;
  onClose: () => void;
}) {
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const [conflict, setConflict] = useState(false);
  const file = session.file;

  const save = async (force = false) => {
    if (!file) return;
    try {
      if ((await session.save(force)) === 'conflict') {
        setConflict(true);
        return;
      }
      setConflict(false);
      addToast(tExt('page.toast.saved', { name: file.name }), 'success');
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    }
  };

  const reload = async () => {
    if (!file) return;
    try {
      await session.reload();
      setConflict(false);
      addToast(tExt('page.toast.reloaded', { name: file.name }), 'success');
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    }
  };

  useSaveShortcut(() => {
    if (canSave && session.dirty && !session.saving) save();
  });

  if (!file) return null;

  const { format } = file;

  return (
    <>
      <ConflictModal
        name={conflict ? file.name : null}
        loading={session.saving}
        onClose={() => setConflict(false)}
        onReload={reload}
        onOverwrite={() => save(true)}
      />

      <FileHeader
        kind='nbt'
        name={file.name}
        path={file.path}
        dirty={session.dirty}
        readOnly={!canSave}
        badges={
          <>
            <FormatBadge label={tExt('page.nbtFile.compression', {})} value={format.compression} />
            <FormatBadge
              label={tExt('page.nbtFile.endianness', {})}
              value={tExt(format.littleEndian ? 'page.nbtFile.littleEndian' : 'page.nbtFile.bigEndian', {})}
            />
            {format.bedrockHeaderVersion !== null && (
              <FormatBadge label={tExt('page.nbtFile.bedrockHeader', {})} value={String(format.bedrockHeaderVersion)} />
            )}
            <FormatBadge label={tExt('page.nbtFile.size', {})} value={bytesToString(file.size)} />
          </>
        }
      >
        <Button
          size='xs'
          variant='default'
          leftSection={<FontAwesomeIcon icon={faArrowLeft} />}
          onClick={onBackToFiles}
        >
          {tExt('page.header.backToFiles', {})}
        </Button>
        <Button size='xs' variant='default' leftSection={<FontAwesomeIcon icon={faXmark} />} onClick={onClose}>
          {tExt('page.header.closeFile', {})}
        </Button>
        {canSave && (
          <Tooltip label={tExt('page.header.saveShortcut', {})}>
            <Button
              size='xs'
              leftSection={<FontAwesomeIcon icon={faFloppyDisk} />}
              disabled={!session.dirty}
              loading={session.saving}
              onClick={() => save()}
            >
              {tExt('page.header.save', {})}
            </Button>
          </Tooltip>
        )}
      </FileHeader>

      {!serverOffline && canSave && (
        <Alert color='yellow' className='mx-4 mt-3 shrink-0' title={tExt('page.nbtFile.runningTitle', {})}>
          {tExt('page.nbtFile.running', {})}
        </Alert>
      )}

      <div className='flex min-h-0 flex-1 flex-col'>
        <NbtTreeEditor
          className='min-h-0 flex-1'
          root={file.doc.root}
          rootName={file.doc.name}
          revision={session.revision}
          onChange={session.markChanged}
          readOnly={!canSave}
        />
      </div>
    </>
  );
}
