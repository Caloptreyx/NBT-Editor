import { useEffect, useRef } from 'react';

// Ctrl/Cmd+S anywhere on the page while the hook is mounted
export default function useSaveShortcut(onSave: () => void) {
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's')
        return;

      event.preventDefault();
      onSaveRef.current();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}
