import DOMPurify from "dompurify";
import {
  Bold,
  Check,
  Italic,
  Link2,
  List,
  ListOrdered,
  TextQuote,
  Underline,
  Unlink,
  X,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * The composer's message body: a small rich-text field. Nothing about
 * formatting shows until you select text; then a glass bar with the
 * desktop composer's formats (bold, italic, underline, lists, quote, link)
 * rises just above the keyboard. It sits there, not on the selection, so it
 * never fights iOS's own Copy / Paste callout, which lives on the selection.
 */

export interface RichBodyHandle {
  focus(): void;
  /** Replace everything with plain text (AI rewrites). */
  setText(text: string): void;
  /** Add plain text at the end, as new paragraphs. */
  appendText(text: string): void;
}

const ALLOWED = {
  ALLOWED_TAGS: [
    "b",
    "strong",
    "i",
    "em",
    "u",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "div",
    "p",
    "br",
  ],
  ALLOWED_ATTR: ["href"],
};

export function cleanHtml(html: string): string {
  return DOMPurify.sanitize(html, ALLOWED);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text as editor paragraphs. */
export function textToHtml(text: string): string {
  return text
    .split("\n")
    .map((l) => `<div>${l ? escapeHtml(l) : "<br>"}</div>`)
    .join("");
}

/** True when the HTML carries anything plain text cannot (so it is worth sending). */
function hasFormatting(root: HTMLElement): boolean {
  return !!root.querySelector("b,strong,i,em,u,a,ul,ol,blockquote");
}

/**
 * The text/plain twin of the formatted body: lists keep "-" and "1." marks,
 * quotes keep ">", links keep their address.
 */
export function htmlToText(root: Node): string {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    out.push(line);
    line = "";
  };
  const walk = (
    n: Node,
    quote: string,
    list: { kind: "ul" | "ol"; n: number } | null,
  ) => {
    if (n.nodeType === Node.TEXT_NODE) {
      if (!line && quote) line = quote;
      line += (n.textContent ?? "").replace(/\u00a0/g, " ");
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    const tag = n.tagName.toLowerCase();
    if (tag === "br") {
      line = line || quote;
      flush();
      return;
    }
    const block = ["div", "p", "li", "blockquote", "ul", "ol"].includes(tag);
    if (block && line) flush();
    if (tag === "li") {
      const mark = list?.kind === "ol" ? `${++list.n}. ` : "- ";
      line = quote + mark;
    }
    const q = tag === "blockquote" ? `${quote}> ` : quote;
    const l = tag === "ul" || tag === "ol" ? { kind: tag, n: 0 } : list;
    n.childNodes.forEach((c) => walk(c, q, l as typeof list));
    if (tag === "a") {
      const href = n.getAttribute("href") ?? "";
      const label = n.textContent ?? "";
      if (href && href.replace(/^mailto:/, "") !== label)
        line += ` (${href.replace(/^mailto:/, "")})`;
    }
    if (block && line) flush();
  };
  root.childNodes.forEach((c) => walk(c, "", null));
  if (line) flush();
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  if (/^(https?|mailto|tel):/i.test(s)) return s;
  return `https://${s}`;
}

type Fmt = "bold" | "italic" | "underline" | "ul" | "ol" | "quote" | "link";

export const RichBody = forwardRef<
  RichBodyHandle,
  {
    initialHtml?: string;
    placeholder: string;
    onChange: (text: string, html: string | undefined) => void;
  }
>(function RichBody({ initialHtml, placeholder, onChange }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(!initialHtml);
  const [sel, setSel] = useState(false);
  const [active, setActive] = useState<Set<Fmt>>(new Set());
  const [linking, setLinking] = useState<string | null>(null);
  const linkingRef = useRef(false);
  linkingRef.current = linking !== null;
  const [kb, setKb] = useState(0);

  const emit = () => {
    const root = el.current;
    if (!root) return;
    const text = htmlToText(root);
    setEmpty(!text && !root.querySelector("li"));
    onChange(text, hasFormatting(root) ? cleanHtml(root.innerHTML) : undefined);
  };

  useImperativeHandle(ref, () => ({
    focus: () => el.current?.focus(),
    setText: (t) => {
      if (!el.current) return;
      el.current.innerHTML = textToHtml(t);
      emit();
    },
    appendText: (t) => {
      if (!el.current) return;
      const has = htmlToText(el.current).length > 0;
      el.current.insertAdjacentHTML(
        "beforeend",
        (has ? "<div><br></div>" : "") + textToHtml(t),
      );
      emit();
    },
  }));

  useEffect(() => {
    if (el.current && initialHtml)
      el.current.innerHTML = cleanHtml(initialHtml);
    try {
      document.execCommand("defaultParagraphSeparator", false, "div");
    } catch {
      // Older engines keep their own separator; the text twin handles both.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the bar only while a stretch of text in the body is selected.
  useEffect(() => {
    const onSel = () => {
      const root = el.current;
      const s = document.getSelection();
      if (!root || !s || !s.rangeCount) return setSel(false);
      const r = s.getRangeAt(0);
      if (!root.contains(r.commonAncestorContainer)) {
        // Focus moved into the link field: keep the bar and the saved range.
        if (!linkingRef.current) setSel(false);
        return;
      }
      saved.current = r.cloneRange();
      setSel(!s.isCollapsed);
      if (!s.isCollapsed) setActive(readActive(root));
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // Keep the bar just above the keyboard (visualViewport shrinks for it).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () =>
      setKb(Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)));
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
    };
  }, []);

  /** Put the selection back in the body (a tap on the bar may have moved it). */
  const restore = () => {
    const root = el.current;
    const s = document.getSelection();
    if (!root || !s) return;
    // Focusing the body puts the caret at its start, so the saved range
    // always wins when focus was elsewhere (the link field, the bar).
    const wasOut = document.activeElement !== root;
    if (wasOut) root.focus({ preventScroll: true });
    if (
      saved.current &&
      (wasOut || !(s.rangeCount && root.contains(s.getRangeAt(0).commonAncestorContainer)))
    ) {
      s.removeAllRanges();
      s.addRange(saved.current);
    }
  };

  const run = (f: Fmt) => {
    const root = el.current;
    if (!root) return;
    restore();
    if (f === "link") {
      const a = closestIn(root, "a");
      if (a) {
        const s = document.getSelection();
        const r = document.createRange();
        r.selectNodeContents(a);
        s?.removeAllRanges();
        s?.addRange(r);
        document.execCommand("unlink");
      } else {
        setLinking("");
        return;
      }
    } else if (f === "quote") {
      const q = closestIn(root, "blockquote");
      if (q) {
        while (q.firstChild) q.parentNode!.insertBefore(q.firstChild, q);
        q.remove();
      } else document.execCommand("formatBlock", false, "blockquote");
    } else {
      const cmd = {
        bold: "bold",
        italic: "italic",
        underline: "underline",
        ul: "insertUnorderedList",
        ol: "insertOrderedList",
      }[f];
      document.execCommand(cmd);
    }
    setActive(readActive(root));
    emit();
  };

  const applyLink = (raw: string) => {
    const url = normalizeUrl(raw);
    setLinking(null);
    restore();
    if (url) document.execCommand("createLink", false, url);
    if (el.current) setActive(readActive(el.current));
    emit();
  };

  const show = sel || linking !== null;
  const items: { f: Fmt; label: string; Icon: typeof Bold }[] = [
    { f: "bold", label: "Bold", Icon: Bold },
    { f: "italic", label: "Italic", Icon: Italic },
    { f: "underline", label: "Underline", Icon: Underline },
    { f: "ul", label: "Bullet list", Icon: List },
    { f: "ol", label: "Numbered list", Icon: ListOrdered },
    { f: "quote", label: "Quote", Icon: TextQuote },
    {
      f: "link",
      label: active.has("link") ? "Remove link" : "Link",
      Icon: active.has("link") ? Unlink : Link2,
    },
  ];
  // Taps on the bar must not take focus (and the selection) from the body.
  const keep = (e: { preventDefault(): void }) => e.preventDefault();

  return (
    <>
      <div
        ref={el}
        className={`rb${empty ? " empty" : ""}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="Message"
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={(e) => {
          // Keep pasted structure (bold, links, lists) but drop fonts, colours and sizes.
          const html = e.clipboardData.getData("text/html");
          const text = e.clipboardData.getData("text/plain");
          e.preventDefault();
          document.execCommand(
            "insertHTML",
            false,
            html ? cleanHtml(html) : textToHtml(text),
          );
        }}
      />
      {createPortal(
        <div
          className={`rb-bar glass${show ? " on" : ""}`}
          style={{ bottom: kb ? kb + 8 : undefined }}
          role="toolbar"
          aria-label="Format selected text"
          aria-hidden={!show}
          inert={!show}
          onPointerDown={linking === null ? keep : undefined}
          onMouseDown={linking === null ? keep : undefined}
        >
          {linking === null ? (
            items.map(({ f, label, Icon }) => (
              <button
                key={f}
                className={active.has(f) ? "on" : ""}
                aria-label={label}
                aria-pressed={f === "link" ? undefined : active.has(f)}
                onClick={() => run(f)}
              >
                <Icon size={19} strokeWidth={f === "bold" ? 2.6 : 2} />
              </button>
            ))
          ) : (
            <form
              className="rb-link"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                applyLink(linking);
              }}
            >
              <Link2 size={17} color="var(--muted)" />
              <input
                autoFocus
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="Paste or type a link"
                value={linking}
                onChange={(e) => setLinking(e.target.value)}
              />
              <button
                type="button"
                aria-label="Cancel link"
                onClick={() => {
                  setLinking(null);
                  restore();
                }}
              >
                <X size={17} />
              </button>
              <button
                type="submit"
                className="ok"
                aria-label="Add link"
                disabled={!linking.trim()}
              >
                <Check size={17} />
              </button>
            </form>
          )}
        </div>,
        document.body,
      )}
    </>
  );
});

function closestIn(root: HTMLElement, tag: string): HTMLElement | null {
  const s = document.getSelection();
  let n: Node | null = s?.anchorNode ?? null;
  while (n && n !== root) {
    if (n instanceof HTMLElement && n.tagName.toLowerCase() === tag) return n;
    n = n.parentNode;
  }
  return null;
}

function readActive(root: HTMLElement): Set<Fmt> {
  const on = new Set<Fmt>();
  const q = (c: string) => {
    try {
      return document.queryCommandState(c);
    } catch {
      return false;
    }
  };
  if (q("bold")) on.add("bold");
  if (q("italic")) on.add("italic");
  if (q("underline")) on.add("underline");
  if (q("insertUnorderedList")) on.add("ul");
  if (q("insertOrderedList")) on.add("ol");
  if (closestIn(root, "blockquote")) on.add("quote");
  if (closestIn(root, "a")) on.add("link");
  return on;
}
