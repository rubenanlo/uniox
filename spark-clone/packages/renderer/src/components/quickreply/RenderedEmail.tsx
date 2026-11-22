import type { AttachmentMeta } from '@app/shared';
import { buildSrcdoc, IFRAME_SANDBOX, sanitizeEmailHtml } from '@app/email-render';
import { useEffect, useMemo, useRef, useState } from 'react';
import { watchEmailFrame } from '../../lib/emailFrame';
import { useIsDark } from '../../lib/useIsDark';

/**
 * An email that won't read as a chat bubble (a designed newsletter, an
 * image-led mail, or a text part that is really HTML), shown as the email
 * itself: sanitized, scripts off, in the same sandboxed frame the reading
 * pane uses. Wider layouts are scaled down to fit the bubble.
 */
export function RenderedEmail({ html, attachments }: { html: string; attachments: AttachmentMeta[] }) {
  const dark = useIsDark();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Natural height of the email, and how much a wider-than-the-bubble layout is scaled down.
  const [height, setHeight] = useState(120);
  const [fit, setFit] = useState<{ scale: number; width: number | null }>({ scale: 1, width: null });

  const srcdoc = useMemo(() => {
    const clean = sanitizeEmailHtml(html, { allowRemoteImages: true, attachments, darkMode: dark });
    return buildSrcdoc(clean.html, { allowRemoteImages: true, dark });
  }, [html, attachments, dark]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // Follows the email's layout and hands its keys back (Esc, ⌘↩, the rail
    // keys, r / ⇧R / f in the reading pane) without waiting for every image.
    return watchEmailFrame(frame, {
      onMeasure: (doc) => {
        const room = boxRef.current?.clientWidth ?? 0;
        if (!room) return;
        // Laid out at its own width (once widened, the frame stays that wide, so this settles).
        const wide = doc.documentElement.scrollWidth;
        const scale = wide > room + 4 ? room / wide : 1;
        setFit((f) => (f.scale === scale ? f : { scale, width: scale < 1 ? wide : null }));
        setHeight(Math.min(20_000, Math.max(40, doc.body.scrollHeight + 2)));
      },
    });
  }, [srcdoc]);

  // Shown in full: the conversation scrolls instead of folding the email.
  const shown = Math.ceil(height * fit.scale);
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div
        ref={boxRef}
        className="qr-bubble-in relative overflow-hidden rounded-[6px_17px_17px_17px] select-text"
        style={{ height: shown }}
      >
        <iframe
          ref={frameRef}
          title="Email"
          sandbox={IFRAME_SANDBOX}
          srcDoc={srcdoc}
          style={{
            width: fit.width ?? '100%',
            height,
            border: 0,
            display: 'block',
            colorScheme: dark ? 'dark' : 'light',
            transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined,
            transformOrigin: 'top left',
          }}
        />
      </div>
    </div>
  );
}
