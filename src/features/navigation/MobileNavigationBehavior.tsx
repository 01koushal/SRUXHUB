import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export function MobileNavigationBehavior({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const panel = document.querySelector('.leftbar');
      const trigger = document.querySelector('.mobile-menu');
      if (panel?.contains(target) || trigger?.contains(target) || (target instanceof Element && target.closest('.nav-scrim'))) return;
      closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeRef.current();
      document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => document.querySelector<HTMLAnchorElement>('#primary-navigation a')?.focus());
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeRef.current();
    document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus();
  }, [location.pathname]);

  if (!open) return null;
  return <button className="nav-scrim" type="button" onClick={() => { onClose(); document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus(); }} aria-label="Close navigation" />;
}
