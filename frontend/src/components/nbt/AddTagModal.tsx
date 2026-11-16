import { type FormEvent, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import Select from '@/elements/input/Select.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { useExtTranslations } from '../../translations.ts';
import { type ContainerTag, type CreatableTagType, TAG_TYPES, validateKey } from './treeModel.ts';
import { TYPE_BADGES } from './TypeBadge.tsx';

// Opened for compounds and empty lists; non-empty lists add their item type directly.
export default function AddTagModal({
  container,
  onAdd,
  onClose,
}: {
  container: ContainerTag;
  onAdd: (type: CreatableTagType, key: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const { t: tExt } = useExtTranslations();
  const [key, setKey] = useState('');
  const [touched, setTouched] = useState(false);
  const [type, setType] = useState<CreatableTagType>(
    container.type === 'list' && container.itemType !== 'end' ? container.itemType : 'string',
  );

  const keyError = container.type === 'compound' ? validateKey(container, key, null) : null;
  const shownKeyError =
    keyError === 'duplicate'
      ? tExt('nbt.errors.duplicateKey', {})
      : keyError === 'empty' && touched
        ? tExt('nbt.errors.emptyKey', {})
        : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (keyError === null) onAdd(type, key);
  };

  return (
    <Modal title={tExt('nbt.addModal.title', {})} opened onClose={onClose}>
      <form onSubmit={submit}>
        <Stack gap='sm'>
          {container.type === 'compound' ? (
            <TextInput
              data-autofocus
              label={tExt('nbt.addModal.name', {})}
              value={key}
              error={shownKeyError}
              classNames={{ input: 'font-mono' }}
              onChange={(e) => setKey(e.currentTarget.value)}
            />
          ) : (
            <Text size='sm' c='dimmed'>
              {tExt('nbt.addModal.emptyListType', {})}
            </Text>
          )}
          <Select
            label={tExt('nbt.addModal.type', {})}
            value={type}
            data={TAG_TYPES.map((value) => ({
              value,
              label: `${tExt(`nbt.types.${value}`, {})} (${TYPE_BADGES[value].label})`,
            }))}
            onChange={(value) => value && setType(value as CreatableTagType)}
          />
        </Stack>

        <ModalFooter>
          <Button type='submit' disabled={keyError === 'duplicate'}>
            {t('common.button.add', {})}
          </Button>
          <Button variant='default' onClick={onClose}>
            {t('common.button.cancel', {})}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
