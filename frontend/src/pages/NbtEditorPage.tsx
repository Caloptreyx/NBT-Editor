import { basename, dirname } from 'pathe';
import { useState } from 'react';
import { useBeforeUnload } from 'react-router';
import { httpErrorToHuman } from '@/api/axios.ts';
import ServerContentContainer from '@/elements/containers/ServerContentContainer.tsx';
import Card from '@/elements/data-display/Card.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import ConfirmationModal from '@/elements/modals/ConfirmationModal.tsx';
import { useBlocker } from '@/plugins/useBlocker.ts';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import FileBrowser, { type OpenFileSummary } from '../components/FileBrowser.tsx';
import NbtFileView from '../components/NbtFileView.tsx';
import RegionView from '../components/RegionView.tsx';
import { fileKind } from '../lib/worlds.ts';
import { useExtTranslations } from '../translations.ts';
import useNbtFileSession from './useNbtFileSession.ts';
import useRegionSession from './useRegionSession.ts';

type PendingAction = { kind: 'open'; path: string } | { kind: 'close' };

export default function NbtEditorPage() {
  const { t } = useTranslations();
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const server = useServerStore((state) => state.server);
  const powerState = useServerStore((state) => state.state);
  const canCreate = useServerCan('files.create');

  const nbt = useNbtFileSession(server.uuid);
  const region = useRegionSession(server.uuid);
  const [directory, setDirectory] = useState('/');
  const [browsing, setBrowsing] = useState(true);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const serverOffline = powerState === 'offline';
  const canWriteRegion = serverOffline && canCreate;
  const regionReadOnlyReason = !canCreate
    ? tExt('page.region.noPermission', {})
    : tExt('page.region.serverRunning', {});

  const dirty = nbt.dirty || region.dirty;
  const opening = nbt.opening ?? region.opening;
  // reloads of the open file keep its view mounted (it shows its own loading state)
  const openingOther = opening !== null && opening !== (nbt.file?.path ?? region.file?.path ?? null);
  const openFile: OpenFileSummary | null = nbt.file
    ? { name: nbt.file.name, path: nbt.file.path, kind: 'nbt', dirty: nbt.dirty }
    : region.file
      ? { name: region.file.name, path: region.file.path, kind: region.file.kind, dirty: region.dirty }
      : null;

  const blocker = useBlocker(dirty, true);
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  const open = async (path: string) => {
    const kind = fileKind(path);
    if (!kind) return;
    try {
      if (kind === 'nbt') {
        await nbt.open(path);
        region.close();
      } else {
        await region.open(path);
        nbt.close();
      }
      setDirectory(dirname(path));
      setBrowsing(false);
    } catch (error) {
      addToast(tExt('page.toast.openFailed', { name: basename(path), error: httpErrorToHuman(error) }), 'error');
    }
  };

  const close = () => {
    nbt.close();
    region.close();
    setBrowsing(true);
  };

  const requestOpen = (path: string) => {
    if (path === openFile?.path) setBrowsing(false);
    else if (dirty) setPending({ kind: 'open', path });
    else open(path);
  };

  const requestClose = () => {
    if (dirty) setPending({ kind: 'close' });
    else close();
  };

  return (
    <ServerContentContainer title={tExt('common.nbtEditor', {})} subtitle={tExt('common.subtitle', {})}>
      <ConfirmationModal
        title={t('pages.server.files.modal.unsavedChanges.title', {})}
        opened={blocker.state === 'blocked'}
        onClose={blocker.reset}
        onConfirmed={blocker.proceed}
        confirm={t('common.button.leavePage', {})}
      >
        {t('pages.server.files.modal.unsavedChanges.content', {}).md()}
      </ConfirmationModal>

      <ConfirmationModal
        title={tExt('page.discard.title', {})}
        opened={pending !== null}
        onClose={() => setPending(null)}
        onConfirmed={() => {
          const action = pending;
          setPending(null);
          if (action?.kind === 'open') open(action.path);
          else if (action) close();
        }}
        confirm={t('common.button.discard', {})}
      >
        {tExt('page.discard.content', { name: openFile?.name ?? '' })}
      </ConfirmationModal>

      <Card p={0} className='flex h-[calc(100dvh-12rem)] min-h-[36rem] min-w-0 flex-col overflow-hidden'>
        {openingOther && opening ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-3'>
            <Spinner />
            <span className='text-sm text-(--mantine-color-dimmed)'>
              {tExt('page.opening', { name: basename(opening) })}
            </span>
          </div>
        ) : browsing || !openFile ? (
          <FileBrowser
            serverUuid={server.uuid}
            directory={directory}
            openFile={openFile}
            onNavigate={setDirectory}
            onOpen={requestOpen}
            onReturn={() => setBrowsing(false)}
          />
        ) : nbt.file ? (
          <NbtFileView
            session={nbt}
            canSave={canCreate}
            serverOffline={serverOffline}
            onBackToFiles={() => setBrowsing(true)}
            onClose={requestClose}
          />
        ) : region.file ? (
          <RegionView
            serverUuid={server.uuid}
            session={region}
            file={region.file}
            canWrite={canWriteRegion}
            readOnlyReason={regionReadOnlyReason}
            onBackToFiles={() => setBrowsing(true)}
            onClose={requestClose}
          />
        ) : null}
      </Card>
    </ServerContentContainer>
  );
}
