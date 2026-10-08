import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSrcdoc, IFRAME_SANDBOX, sanitizeEmailHtml } from '@app/email-render';
import { useIsDark } from '../../lib/useIsDark';

/**
 * The account's signature under the message, rendered like a received email
 * (sandboxed iframe) so its tables, fonts and images show exactly. It is not
 * part of the TipTap document, which would flatten all of that.
 */
export function SignaturePreview({ html, onRemove }: { html: string; onRemove: () => void }) {
  const dark = useIsDark();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);
  const srcdoc = useMemo(() => {
    const clean = sanitizeEmailHtml(html, { allowRemoteImages: true, darkMode: dark }).html;
    return buildSrcdoc(`<div>--<br>${clean}</div>`, {
      allowRemoteImages: true,
      dark,
    });
  }, [html, dark]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const body = iframe.contentDocument?.body;
      if (body) setHeight(Math.min(2_000, Math.max(24, body.scrollHeight + 2)));
    };
    const onLoad = () => {
      measure();
      ro?.disconnect();
      const body = iframe.contentDocument?.body;
      if (body) {
        ro = new ResizeObserver(measure);
        ro.observe(body);
      }
    };
    iframe.addEventListener('load', onLoad);
    onLoad();
    return () => {
      iframe.removeEventListener('load', onLoad);
      ro?.disconnect();
    };
  }, [srcdoc]);

  return (
    <div className="group/sig relative mt-2 -mx-4">
      <iframe
        ref={iframeRef}
        title="Signature"
        sandbox={IFRAME_SANDBOX}
        srcDoc={srcdoc}
        tabIndex={-1}
        style={{
          width: '100%',
          height,
          border: 0,
          display: 'block',
          colorScheme: dark ? 'dark' : 'light',
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-ink-faint hover:text-ink bg-surface absolute top-1 right-4 rounded-md px-1.5 text-[11px] opacity-0 group-hover/sig:opacity-100 focus:opacity-100"
      >
        Remove signature
      </button>
    </div>
  );
}
