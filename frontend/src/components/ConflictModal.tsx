import Button from '@/elements/buttons/Button.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { useExtTranslations } from '../translations.ts';

// shown when a save hits a file that changed on disk since it was loaded
export default function ConflictModal({
  name,
  loading,
  onReload,
  onOverwrite,
  onClose,
}: {
  /** file name; null hides the modal */
  name: string | null;
  loading: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const { t: tExt } = useExtTranslations();

  return (
    <Modal title={tExt('page.conflict.title', {})} opened={name !== null} onClose={onClose}>
      <Text>{tExt('page.conflict.content', { name: name ?? '' })}</Text>

      <ModalFooter>
        <Button color='red' loading={loading} onClick={onOverwrite}>
          {tExt('page.conflict.overwrite', {})}
        </Button>
        <Button variant='default' disabled={loading} onClick={onReload}>
          {tExt('page.conflict.reload', {})}
        </Button>
        <Button variant='default' disabled={loading} onClick={onClose}>
          {t('common.button.cancel', {})}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
