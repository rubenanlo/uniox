import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSrcdoc, IFRAME_SANDBOX, sanitizeEmailHtml, textToHtml } from '@app/email-render';
import { ImageOff } from 'lucide-react';
import { watchEmailFrame } from '../../lib/emailFrame';
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

  // Follow the email's height and hand its keys back to the app (Esc, ←, r /
  // ⇧R / f…): the sandboxed frame swallows them once clicked into.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !rendered) return;
    return watchEmailFrame(iframe, {
      // body carries its own padding; +2 only covers subpixel rounding
      onMeasure: (doc) => setHeight(Math.min(20_000, Math.max(40, doc.body.scrollHeight + 2))),
    });
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
