import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

/** Where the card should sit, in viewport coordinates. */
export interface HoverAnchor {
  x: number;
  y: number;
}

/**
 * A floating card in the search panel's visual language (same surface, border,
 * radius, shadow and 150ms fade/slide).
 *
 * Rendered through a portal and positioned fixed: list rows live inside a
 * scroll container that clips overflow, and inside virtualizer wrappers that
 * carry a transform — which would otherwise become the containing block for a
 * fixed element and break the coordinates.
 */
export function HoverCard({
  open,
  anchor,
  label,
  children,
}: {
  open: boolean;
  anchor: HoverAnchor | null;
  /** Describes the card for assistive tech. */
  label: string;
  children: React.ReactNode;
}) {
  if (!anchor) return null;
  return createPortal(
    <div
      role="tooltip"
      aria-label={label}
      style={{ position: 'fixed', top: anchor.y, left: anchor.x, maxWidth: 260 }}
      className={cn(
        'border-hairline bg-surface pointer-events-none z-[60] rounded-xl border p-2 shadow-lg',
        'origin-top transition duration-150 ease-out',
        open ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-1 scale-[0.98] opacity-0',
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
