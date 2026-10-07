import { Bold, Italic, Link2, Underline } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/**
 * Small rich-text field for event descriptions: bold, italic, underline,
 * links (toolbar or the native ⌘B/⌘I/⌘U). Seeded once from `initialHtml`
 * (already sanitized by the caller); emits the live HTML via onChange.
 */
export function RichTextArea({
  initialHtml,
  onChange,
  placeholder,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
    // Seed once on mount; afterwards the DOM is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(ref.current?.innerHTML ?? '');
  const exec = (cmd: string, val?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    emit();
  };

  const openLink = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange();
    setLinkOpen(true);
  };
  const applyLink = () => {
    const url = linkUrl.trim();
    setLinkOpen(false);
    setLinkUrl('');
    if (!url) return;
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    exec('createLink', /^https?:/i.test(url) ? url : `https://${url}`);
  };

  const toolBtn =
    'text-ink-muted hover:text-ink hover:bg-sunken flex h-6 w-6 items-center justify-center rounded';
  return (
    <div className="border-hairline bg-sunken w-full rounded-lg border">
      <div className="border-hairline flex items-center gap-0.5 border-b px-1.5 py-1">
        {(
          [
            ['bold', Bold, 'Bold'],
            ['italic', Italic, 'Italic'],
            ['underline', Underline, 'Underline'],
          ] as const
        ).map(([cmd, Icon, label]) => (
          <button
            key={cmd}
            type="button"
            aria-label={label}
            onMouseDown={(e) => e.preventDefault()} // keep the text selection
            onClick={() => exec(cmd)}
            className={toolBtn}
          >
            <Icon size={12} />
          </button>
        ))}
        <button
          type="button"
          aria-label="Link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLink}
          className={toolBtn}
        >
          <Link2 size={12} />
        </button>
        {linkOpen && (
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setLinkOpen(false);
              }
            }}
            onBlur={applyLink}
            placeholder="https://…"
            className="text-ink ml-1 min-w-0 flex-1 bg-transparent text-[11.5px] outline-none"
          />
        )}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={emit}
        className={cn(
          'text-ink max-h-48 min-h-16 overflow-y-auto px-2.5 py-1.5 text-[12.5px] break-words outline-none',
          '[&_a]:text-accent [&_a]:underline',
          'empty:before:text-ink-faint empty:before:content-[attr(data-placeholder)]',
        )}
      />
    </div>
  );
}
