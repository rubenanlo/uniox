import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Link2, List as ListIcon, ListOrdered, TextQuote, Underline as UnderlineIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cn } from '../../lib/utils';

/**
 * The editor setup every mail body shares (the composer and the chat reply
 * box), so formatting and its shortcuts behave the same everywhere: ⌘B, ⌘I,
 * ⌘U, ⇧⌘8 bullets, ⇧⌘7 numbers, "- " / "1. " / "> " at a line start.
 */
export function mailEditorExtensions(placeholder: string | ((props: { editor: Editor }) => string)) {
  return [
    // StarterKit ships its own Link; ours replaces it so the inline style below applies.
    StarterKit.configure({ link: false }),
    // The style must live inline on each <a>: recipients' clients (Gmail
    // especially) strip <style> blocks, so this is the only way the link
    // reads as a link everywhere. It also styles links inside the editor.
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { style: 'color:#2563eb;text-decoration:underline' },
    }),
    Placeholder.configure({ placeholder }),
  ];
}

/** A typed address as a link target: bare "example.com" becomes https://example.com. */
export function linkHref(url: string): string {
  const trimmed = url.trim();
  if (/^[a-z][\w+.-]*:/i.test(trimmed)) return trimmed;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(trimmed)) return `mailto:${trimmed}`;
  return `https://${trimmed}`;
}

/**
 * The ⇧⌘K link editor: the selected text becomes the link text. With nothing
 * selected the address itself is inserted as a link.
 */
export function useLinkEditor(editor: Editor | null) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [existing, setExisting] = useState(false);

  const openEditor = useCallback(() => {
    if (!editor) return;
    const href = editor.getAttributes('link')['href'] as string | undefined;
    setUrl(href ?? '');
    setExisting(!!href);
    setOpen(true);
  }, [editor]);

  const apply = useCallback(
    (value: string) => {
      setOpen(false);
      if (!editor) return;
      const trimmed = value.trim();
      const chain = editor.chain().focus().extendMarkRange('link');
      if (!trimmed) return void chain.unsetLink().run();
      const href = linkHref(trimmed);
      if (editor.state.selection.empty && !editor.isActive('link')) {
        chain
          .insertContent({ type: 'text', text: trimmed, marks: [{ type: 'link', attrs: { href } }] })
          .unsetMark('link')
          .run();
      } else chain.setLink({ href }).run();
    },
    [editor],
  );

  const close = useCallback(() => {
    setOpen(false);
    editor?.commands.focus();
  }, [editor]);

  return { open, url, setUrl, existing, openEditor, apply, close };
}

/** The little "paste the address" bar the link editor shows. */
export function LinkPrompt({
  link,
  className,
}: {
  link: ReturnType<typeof useLinkEditor>;
  className?: string;
}) {
  if (!link.open) return null;
  return (
    <div
      data-owns-escape
      className={cn(
        'border-hairline bg-surface z-50 flex w-80 items-center gap-1.5 rounded-xl border p-2 shadow-2xl',
        className,
      )}
    >
      <Link2 size={13} className="text-ink-muted shrink-0" />
      <input
        autoFocus
        value={link.url}
        onChange={(e) => link.setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            link.apply(link.url);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            link.close();
          }
        }}
        placeholder="https://example.com"
        aria-label="Link URL"
        className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12px] focus:outline-none"
      />
      {link.existing && (
        <button onClick={() => link.apply('')} className="text-ink-muted hover:text-danger shrink-0 text-[11.5px]">
          Remove
        </button>
      )}
      <button
        onClick={() => link.apply(link.url)}
        className="bg-accent shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold text-white hover:opacity-90"
      >
        Apply
      </button>
    </div>
  );
}

/** The format buttons over a selection (composer bubble, chat reply right-click menu). */
export function FormatButtons({
  editor,
  onLink,
  lists,
  onDone,
}: {
  editor: Editor;
  onLink: () => void;
  /** Also offer bullet and numbered lists. */
  lists?: boolean;
  /** Called after a button runs (closes a menu). */
  onDone?: () => void;
}) {
  const items = [
    { Icon: Bold, label: 'Bold — ⌘B', active: 'bold', run: () => editor.chain().focus().toggleBold().run() },
    { Icon: Italic, label: 'Italic — ⌘I', active: 'italic', run: () => editor.chain().focus().toggleItalic().run() },
    { Icon: UnderlineIcon, label: 'Underline — ⌘U', active: 'underline', run: () => editor.chain().focus().toggleUnderline().run() },
    ...(lists
      ? [
          { Icon: ListIcon, label: 'Bullet list — ⇧⌘8', active: 'bulletList', run: () => editor.chain().focus().toggleBulletList().run() },
          { Icon: ListOrdered, label: 'Numbered list — ⇧⌘7', active: 'orderedList', run: () => editor.chain().focus().toggleOrderedList().run() },
        ]
      : []),
    { Icon: TextQuote, label: 'Quote', active: 'blockquote', run: () => editor.chain().focus().toggleBlockquote().run() },
    { Icon: Link2, label: 'Link — ⇧⌘K', active: 'link', run: onLink },
  ];
  return (
    <div className="border-hairline bg-surface flex items-center gap-0.5 rounded-xl border p-1 shadow-2xl">
      {items.map(({ Icon, label, active, run }) => (
        <button
          key={label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            run();
            onDone?.();
          }}
          title={label}
          aria-label={label}
          className={cn('rounded-lg p-1.5', editor.isActive(active) ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink')}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}
