import { useDeferredValue, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import TextArea from '@/elements/input/TextArea.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { parseArrayInput } from '../../lib/nbt.ts';
import { useExtTranslations } from '../../translations.ts';
import { type ArrayTag, arrayText } from './treeModel.ts';

// beyond this the text would be megabytes and the textarea unusable; such arrays are shown truncated, read only
const MAX_TEXT_ITEMS = 200_000;
const PREVIEW_ITEMS = 1000;

export default function ArrayEditModal({
  tag,
  readOnly,
  onApply,
  onClose,
}: {
  tag: ArrayTag;
  readOnly: boolean;
  onApply: (value: ArrayTag['value']) => void;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const { t: tExt } = useExtTranslations();
  const tooLarge = tag.value.length > MAX_TEXT_ITEMS;
  const [text, setText] = useState(() => arrayText(tag, tooLarge ? PREVIEW_ITEMS : MAX_TEXT_ITEMS));
  const deferredText = useDeferredValue(text);
  const editable = !readOnly && !tooLarge;
  const parsed = editable ? parseArrayInput(tag.type, deferredText) : null;
  const invalid = editable && parsed === null;

  return (
    <Modal
      size='xl'
      title={tExt('nbt.arrayModal.title', { type: tExt(`nbt.types.${tag.type}`, {}), count: tag.value.length })}
      opened
      onClose={onClose}
    >
      <Stack gap='sm'>
        <Text size='sm' c='dimmed'>
          {tooLarge
            ? tExt('nbt.arrayModal.tooLarge', { count: tag.value.length, shown: PREVIEW_ITEMS })
            : tExt('nbt.arrayModal.help', {})}
        </Text>
        <TextArea
          data-autofocus
          autosize
          minRows={6}
          maxRows={18}
          readOnly={!editable}
          value={text}
          error={invalid ? tExt('nbt.errors.invalidArray', {}) : undefined}
          classNames={{ input: 'font-mono text-xs!' }}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      </Stack>

      <ModalFooter>
        {editable && (
          <Button
            disabled={parsed === null || deferredText !== text}
            onClick={() => {
              if (parsed !== null) onApply(parsed as ArrayTag['value']);
            }}
          >
            {tExt('nbt.arrayModal.apply', {})}
          </Button>
        )}
        <Button variant='default' onClick={onClose}>
          {t(editable ? 'common.button.cancel' : 'common.button.close', {})}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
