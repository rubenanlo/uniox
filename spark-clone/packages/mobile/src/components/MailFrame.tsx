import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef } from "react";

/**
 * A designed email (newsletter, shipping notice, receipt) shown the way the
 * sender laid it out, like Gmail does: its own HTML and style sheet in a
 * sandboxed frame, scaled down to the screen width when the layout is wider
 * (most are 600px), and as tall as its content. No scripts run in the frame;
 * links open in a new tab.
 */

const HEAD =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:\">" +
  '<base target="_blank">' +
  "<style>html,body{height:auto!important;min-height:0!important}html{overflow:hidden!important;background:#fff;-webkit-text-size-adjust:100%}</style>";

export function frameDoc(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "form",
      "input",
      "button",
      "select",
      "textarea",
      "iframe",
      "object",
      "embed",
      "base",
      "meta",
      "link",
    ],
    ADD_ATTR: ["target"],
  });
  return /<head[^>]*>/i.test(clean)
    ? clean.replace(/<head[^>]*>/i, (h) => h + HEAD)
    : `<!doctype html><html><head>${HEAD}</head><body>${clean}</body></html>`;
}

export function MailFrame({ html }: { html: string }) {
  const doc = useMemo(() => frameDoc(html), [html]);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const f = frame.current;
    const b = box.current;
    if (!f || !b) return;
    let avail = 0;
    let natural = 0;
    let raf = 0;
    const seen = new WeakSet<Document>();
    const timers: number[] = [];
    let ro: ResizeObserver | null = null;

    const measure = () => {
      const d = f.contentDocument;
      if (!d?.body || d.URL !== "about:srcdoc") return;
      const w = b.clientWidth;
      if (!w) return;
      if (w !== avail) {
        // Lay out at the screen width first: a responsive email fits there,
        // a fixed one overflows and tells us its real width.
        avail = w;
        f.style.width = `${w}px`;
        natural = 0;
      }
      const sw = Math.max(avail, d.documentElement.scrollWidth, d.body.scrollWidth);
      if (sw !== natural) {
        natural = sw;
        f.style.width = `${sw}px`;
      }
      const k = avail / natural;
      const h = Math.ceil(d.documentElement.offsetHeight);
      f.style.height = `${h}px`;
      f.style.transform = k < 1 ? `scale(${k})` : "";
      b.style.height = `${Math.ceil(h * k)}px`;
    };

    // The frame's document exists before its load event, which never fires
    // while one image hangs; attach as soon as the srcdoc body is there.
    const attach = () => {
      const d = f.contentDocument;
      if (!d?.body || d.URL !== "about:srcdoc") {
        raf = requestAnimationFrame(attach);
        return;
      }
      if (seen.has(d)) return;
      seen.add(d);
      measure();
      d.addEventListener("load", measure, true); // images, fonts
      ro?.disconnect();
      ro = new ResizeObserver(measure);
      ro.observe(d.documentElement);
      ro.observe(b);
      for (const ms of [150, 600, 1500, 3000])
        timers.push(window.setTimeout(measure, ms));
    };
    raf = requestAnimationFrame(attach);
    f.addEventListener("load", attach);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      ro?.disconnect();
      f.removeEventListener("load", attach);
    };
  }, [doc]);

  return (
    <div ref={box} className="mail-frame">
      <iframe
        ref={frame}
        title="Email"
        srcDoc={doc}
        // Same origin only so the app can measure it; without allow-scripts
        // nothing in the email can run.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        scrolling="no"
      />
    </div>
  );
}
