import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { Keycaps } from './Keycap';

/**
 * Instant hover tooltip for action buttons: label plus the action's keycaps.
 * Rendered into a portal with fixed positioning so no overflow/scroll
 * ancestor can clip it (z-index alone cannot beat overflow clipping).
 * Wraps its child, so flex sizing classes (flex-1 etc.) belong on
 * `className`, not the child.
 */
export function Tip({
  label,
  keys = [],
  side = 'bottom',
  align = 'center',
  className,
  children,
}: {
  label: string;
  keys?: string[];
  side?: 'top' | 'bottom';
  align?: 'center' | 'end';
  className?: string;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const show = () => setBox(anchorRef.current?.getBoundingClientRect() ?? null);
  const hide = () => setBox(null);

  return (
    <span
      ref={anchorRef}
      className={cn('inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {box &&
        createPortal(
          <span
            role="tooltip"
            style={{
              top: side === 'bottom' ? box.bottom + 6 : undefined,
              bottom: side === 'top' ? window.innerHeight - box.top + 6 : undefined,
              left: align === 'center' ? box.left + box.width / 2 : undefined,
              right: align === 'end' ? window.innerWidth - box.right : undefined,
            }}
            className={cn(
              'tip-fade pointer-events-none fixed z-[200] flex items-center gap-1.5 whitespace-nowrap',
              'border-hairline bg-surface text-ink rounded-md border px-2 py-1 text-[11px] font-medium shadow-md',
              align === 'center' && '-translate-x-1/2',
            )}
          >
            {label}
            <Keycaps keys={keys} />
          </span>,
          document.body,
        )}
    </span>
  );
}
