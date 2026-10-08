import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { importSignatureContent, type PastedSignature } from '../lib/signature';

function reportSkipped({ missingImages, tooLarge }: PastedSignature) {
  if (missingImages) {
    toast(
      `${missingImages === 1 ? 'An image' : `${missingImages} images`} couldn't be copied. ` +
        'Copy the image on its own and paste it where it belongs.',
    );
  }
  if (tooLarge)
    toast(
      `${tooLarge === 1 ? 'An image is' : `${tooLarge} images are`} over 2 MB and was left out.`,
    );
}

/**
 * Insert pasted HTML at the caret (or replace the selection). Not
 * execCommand('insertHTML'): Chromium rewrites inline styles it considers
 * redundant with the editor's own (font sizes, border-collapse), which is
 * exactly the formatting a pasted signature needs to keep.
 */
function insertAtCaret(box: HTMLElement, html: string) {
  const sel = window.getSelection();
  let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!range || !box.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
  }
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  box.focus();
}

/**
 * WYSIWYG signature box: paste a signature copied from another mail client,
 * a document or a web page and it keeps its layout, fonts, colors, links and
 * images. It sits on a white card because that is how recipients see it.
 * Uncontrolled: `initialHtml` seeds it once; edits report through onChange.
 */
export function SignatureEditor({
  initialHtml,
  placeholder,
  onChange,
}: {
  initialHtml: string;
  placeholder: string;
  onChange: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
    // Seeded once per mount; the parent remounts (key) to load another value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insert = async (data: DataTransfer) => {
    // Reads the clipboard synchronously before its first await.
    const pending = importSignatureContent(data);
    setBusy(true);
    try {
      const result = await pending;
      if (result.html && ref.current) insertAtCaret(ref.current, result.html);
      reportSkipped(result);
    } finally {
      setBusy(false);
      if (ref.current) onChange(ref.current.innerHTML);
    }
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label="Signature"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        spellCheck={false}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onPaste={(e) => {
          e.preventDefault();
          void insert(e.clipboardData);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
          if (at) {
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(at);
          }
          void insert(e.dataTransfer);
        }}
        className="signature-editor border-hairline focus:ring-accent min-h-[96px] overflow-x-auto rounded-lg border bg-white px-3 py-2.5 text-[14px] leading-[1.45] text-[#1c1c1f] focus:ring-2 focus:outline-none"
      />
      {busy && (
        <div className="text-ink-muted absolute right-2 bottom-2 rounded-md bg-white/90 px-2 py-0.5 text-[11px]">
          Copying images…
        </div>
      )}
    </div>
  );
}
