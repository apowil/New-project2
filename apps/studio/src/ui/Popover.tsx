import { useEffect, useRef, type ReactNode } from 'react';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Which way it opens from its anchor. */
  align?: 'left' | 'center' | 'right';
  label: string;
}

/**
 * A panel anchored above its trigger.
 *
 * Popovers keep the tablet UI from silting up: the colour picker and brush
 * list are large but only wanted momentarily, so they live behind a button
 * rather than permanently occupying the screen.
 *
 * The trigger must be positioned (`relative`) — this renders inside it.
 */
export function Popover({ open, onClose, children, align = 'center', label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      const target = event.target as Node;
      // The trigger handles its own toggle, so ignore clicks inside the
      // anchor as well as inside the panel.
      if (!node.contains(target) && !node.parentElement?.contains(target)) onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    // Capture phase, so the canvas cannot swallow the press first.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const position =
    align === 'left'
      ? 'left-0'
      : align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`panel absolute bottom-full z-30 mb-2 p-3 ${position}`}
    >
      {children}
    </div>
  );
}
