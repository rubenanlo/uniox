/**
 * Wire up a sandboxed email iframe (srcdoc): hand its key presses back to the
 * app and report its content height as it lays out.
 *
 * This deliberately does not wait for the frame's `load` event. `load` waits
 * for every image in the email, and one image that never finishes (a slow
 * tracking pixel, an inline attachment that is still downloading) held it back
 * forever: the frame stayed at its placeholder height, cutting the email off
 * after a line or two, and its keys never reached the app, so r / ⇧R / f and
 * Esc did nothing once you had clicked into the email. Instead we attach as
 * soon as the srcdoc document has a body, and a ResizeObserver follows the
 * layout from there (images settling, quotes unfolding).
 */
export function watchEmailFrame(
  iframe: HTMLIFrameElement,
  opts: {
    /** Content height of the email, in CSS px. */
    onMeasure: (doc: Document) => void;
    /** Where the frame's key presses are re-dispatched (default: the iframe element, which bubbles to window). */
    keyTarget?: EventTarget;
  },
): () => void {
  let doc: Document | null = null;
  let ro: ResizeObserver | null = null;
  let timer = 0;
  let stopped = false;
  let tries = 0;

  const forward = (e: KeyboardEvent) => {
    const clone = new KeyboardEvent('keydown', {
      key: e.key,
      code: e.code,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      repeat: e.repeat,
      bubbles: true,
      cancelable: true,
    });
    if (!(opts.keyTarget ?? iframe).dispatchEvent(clone)) e.preventDefault();
  };

  const detach = () => {
    doc?.removeEventListener('keydown', forward);
    ro?.disconnect();
    ro = null;
    doc = null;
  };

  /** Attach to the frame's current srcdoc document, once it has a body. */
  const check = () => {
    if (stopped) return;
    const current = iframe.contentDocument;
    // The initial about:blank document is replaced by the srcdoc one; skip it.
    const ready = !!current?.body && current.URL !== 'about:blank';
    if (ready && current !== doc) {
      detach();
      doc = current;
      doc.addEventListener('keydown', forward);
      ro = new ResizeObserver(() => doc && opts.onMeasure(doc));
      ro.observe(doc.body);
      opts.onMeasure(doc);
    } else if (ready && doc) {
      opts.onMeasure(doc);
    }
    // Keep looking until the document is fully parsed (cheap: a few frames).
    if ((!ready || current?.readyState === 'loading') && tries++ < 400) timer = window.setTimeout(check, 30);
  };

  iframe.addEventListener('load', check);
  check();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    iframe.removeEventListener('load', check);
    detach();
  };
}
