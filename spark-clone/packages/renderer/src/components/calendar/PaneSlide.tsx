import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slides a calendar side pane in and out with the main mail rail's motion
 * (220ms, same curve). Only the wrapper's width animates; the pane inside keeps
 * its full width, pinned to the edge that faces the grid, so it glides out
 * rigidly behind the clip instead of squashing and re-wrapping its contents.
 * The content stays mounted until the close finishes, then unmounts as before.
 */
export function PaneSlide({
  open,
  side,
  width,
  children,
}: {
  open: boolean;
  side: 'left' | 'right';
  width: number;
  children: ReactNode;
}) {
  // Keep the closing pane rendered until its slide ends (render-time
  // "adjusting state" pattern, like MiniMonth's cursor tracking).
  const [lingering, setLingering] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setLingering(!open && !reducedMotion());
  }

  return (
    <div
      inert={!open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'width') setLingering(false);
      }}
      style={{ width: open ? width : 0 }}
      className={cn(
        'flex h-full shrink-0 overflow-hidden',
        'transition-[width] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
        side === 'left' ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        style={{ width }}
        className={cn(
          'h-full shrink-0 transition-opacity motion-reduce:transition-none',
          open ? 'opacity-100 duration-200' : 'opacity-0 duration-150',
        )}
      >
        {(open || lingering) && children}
      </div>
    </div>
  );
}
