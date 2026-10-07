import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSrcdoc, IFRAME_SANDBOX, sanitizeEmailHtml, textToHtml } from '@app/email-render';
import { ImageOff } from 'lucide-react';
import { useIsDark } from '../../lib/useIsDark';
import { useMessageBody } from '../../state/queries';
import { Attachments } from './Attachments';

export function MessageBody({ messageId }: { messageId: string }) {
  const body = useMessageBody(messageId);
  // Remote images load automatically (like Gmail/Apple Mail). The block/"Load
  // images" path below stays wired up so it can be re-defaulted to false or
  // driven by a setting later; with this default it simply never triggers.
  const [allowRemote, setAllowRemote] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(64);
  const dark = useIsDark();

  const rendered = useMemo(() => {
    if (!body) return null;
    const source = body.html ?? (body.text ? textToHtml(body.text) : '<p style="color:#888">(empty message)</p>');
    const { html, blockedImages, inlineCids } = sanitizeEmailHtml(source, {
      allowRemoteImages: allowRemote,
      attachments: body.attachments,
      darkMode: dark,
    });
    return {
      srcdoc: buildSrcdoc(html, { allowRemoteImages: allowRemote, dark }),
      blockedImages,
      inlineCids,
    };
  }, [body, allowRemote, dark]);

  // A cid alone doesn't make an attachment inline (Gmail stamps one on every
  // file); only attachments the body actually renders inline are hidden here.
  const realAttachments = useMemo(() => {
    if (!body) return [];
    const inline = new Set(rendered?.inlineCids ?? []);
    return body.attachments.filter((a) => !a.cid || !inline.has(a.cid.replace(/^<|>$/g, '')));
  }, [body, rendered]);

  // The sandboxed iframe swallows keyboard events once clicked into. Re-dispatch
  // them on the iframe element so app shortcuts (sidebar toggle, list nav, Esc)
  // keep working while reading an email, and mirror preventDefault back.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !rendered) return;
    const forward = (e: KeyboardEvent) => {
      const clone = new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        bubbles: true,
        cancelable: true,
      });
      if (!iframe.dispatchEvent(clone)) e.preventDefault();
    };
    const attach = () => iframe.contentDocument?.addEventListener('keydown', forward);
    iframe.addEventListener('load', attach);
    attach();
    return () => {
      iframe.removeEventListener('load', attach);
      iframe.contentDocument?.removeEventListener('keydown', forward);
    };
  }, [rendered]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !rendered) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const doc = iframe.contentDocument;
      // body carries its own padding; +2 only covers subpixel rounding
      if (doc?.body) setHeight(Math.min(20_000, Math.max(40, doc.body.scrollHeight + 2)));
    };
    const onLoad = () => {
      measure();
      // srcdoc has no scripts; images/layout settling fire resize, not timers
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
  }, [rendered]);

  if (!body) {
    return <div className="text-ink-faint px-4 py-6 text-[12.5px]">Loading message…</div>;
  }

  return (
    <div>
      {rendered && rendered.blockedImages > 0 && !allowRemote && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-[12px]">
          <ImageOff size={13} className="text-ink-muted" />
          <span className="text-ink-muted flex-1">
            {rendered.blockedImages} remote {rendered.blockedImages === 1 ? 'image' : 'images'} blocked
          </span>
          <button onClick={() => setAllowRemote(true)} className="text-accent font-semibold hover:underline">
            Load images
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="Email content"
        sandbox={IFRAME_SANDBOX}
        srcDoc={rendered?.srcdoc}
        style={{ width: '100%', height, border: 0, display: 'block', colorScheme: dark ? 'dark' : 'light' }}
      />
      <Attachments attachments={realAttachments} />
    </div>
  );
}
