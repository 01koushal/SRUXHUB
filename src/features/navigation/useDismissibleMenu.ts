import { useEffect, useId, useRef } from 'react';

export function useDismissibleMenu(open: boolean, onClose: () => void, menu: React.RefObject<HTMLElement>, trigger: React.RefObject<HTMLElement>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onOtherMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) closeRef.current();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeRef.current();
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('sruxhub:overlay-menu-open', onOtherMenu);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('sruxhub:overlay-menu-open', onOtherMenu);
    };
  }, [open, menu, trigger]);
  useEffect(() => {
    if (open) document.dispatchEvent(new CustomEvent('sruxhub:overlay-menu-open', { detail: id }));
  }, [open, id]);
}
