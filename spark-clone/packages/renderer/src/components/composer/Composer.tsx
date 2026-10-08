import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Bold,
  CalendarClock,
  FileText,
  Italic,
  Link2,
  List as ListIcon,
  Maximize2,
  Minimize2,
  Paperclip,
  Send,
  TextQuote,
  Trash2,
  Underline as UnderlineIcon,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Address, OutgoingAttachment, OutgoingDraft, Template } from '@app/shared';
import { api } from '../../lib/api';
import {
  registerComposerAccount,
  registerComposerEditor,
  registerComposerRecipients,
  textToHtml,
} from '../../lib/composerBridge';
import { fileVisual } from '../../lib/fileVisual';
import { inlineEmailStyles } from '../../lib/emailHtml';
import { fmtWake } from '../../lib/schedule';
import { cn, formatSize } from '../../lib/utils';
import { cancelAvailabilityCheck, useComposerTimes } from '../../state/availability';
import { useZonePrompt } from '../../state/contactZones';
import { useAccounts, useTemplates } from '../../state/queries';
import { useUi, type ComposerState } from '../../state/store';
import { SchedulePicker } from '../SchedulePicker';
import { Keycaps } from '../ui/Keycap';
import { useTimesCalendarOpen } from '../reading/TimesCalendar';
import { AvailabilityChecking } from './AvailabilityChecking';
import { TimesHoverBar } from './TimesHoverBar';

const UNDO_SEND_MS = 5000;

function parseAddresses(raw: string): Address[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)\s*<([^>]+)>$/);
      if (m) return { name: m[1]?.replace(/^"|"$/g, '') || undefined, email: m[2]! };
      return { email: part };
    })
    .filter((a) => a.email.includes('@'));
}

function formatAddresses(list: Address[] | undefined): string {
  return (list ?? []).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ');
}

/**
 * A recipients input with address autocomplete: the term being typed (after
 * the last comma) queries mail history; ↑/↓ move, Enter inserts, click works,
 * and picking appends `Name <email>, ` ready for the next recipient.
 */
function AddressField({
  inputRef,
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const [sugs, setSugs] = useState<Address[]>([]);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const term = (value.split(/[,;]/).pop() ?? '').trim();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!focused || term.length < 2 || term.includes('<')) {
        setSugs([]);
        return;
      }
      void api.query('contacts:suggest', { query: term, limit: 8 }).then((r) => {
        setSugs(r);
        setActive(0);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [term, focused]);

  const pick = (a: Address) => {
    const items = value.split(/[,;]/);
    items[items.length - 1] = a.name ? `${a.name} <${a.email}>` : a.email;
    onChange(`${items.map((s) => s.trim()).filter(Boolean).join(', ')}, `);
    setSugs([]);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!sugs.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % sugs.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + sugs.length) % sugs.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(sugs[active]!);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setSugs([]);
        }}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={className}
      />
      {sugs.length > 0 && (
        <div className="border-hairline bg-surface absolute top-full left-0 z-50 mt-1 max-h-64 w-full min-w-64 overflow-y-auto rounded-xl border py-1 shadow-lg">
          {sugs.map((a, i) => (
            <button
              key={a.email}
              // onMouseDown beats the input's blur, so the click still lands
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex w-full items-baseline gap-2 px-3 py-1.5 text-left',
                i === active && 'bg-sunken',
              )}
            >
              <span className="shrink-0 text-[12.5px] font-semibold">{a.name || a.email}</span>
              {a.name && <span className="text-ink-faint truncate text-[11.5px]">{a.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function replySubject(mode: ComposerState['mode'], subject: string): string {
  const bare = subject.replace(/^(re|fwd?):\s*/i, '');
  if (mode === 'forward') return `Fwd: ${bare}`;
  if (mode === 'reply' || mode === 'reply-all') return `Re: ${bare}`;
  return subject;
}

export function Composer({ state }: { state: ComposerState }) {
  const closeComposer = useUi((s) => s.closeComposer);
  const { accounts, loaded: accountsLoaded } = useAccounts();
  const [accountId, setAccountId] = useState(state.accountId);
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  // Reply All must never include the sender themselves — filter every one of
  // the user's OWN account addresses (case-insensitive), not just the current
  // account. selfEmails is empty until accounts load; the effect below
  // re-derives the fields once they arrive. Original roles are preserved:
  // sender + To recipients land in To, the original Cc stays in Cc.
  const replyAllFields = useCallback(
    (selfEmails: Set<string>) => {
      if (!state.replyTo) return { to: '', cc: '' };
      const seen = new Set<string>();
      const pick = (list: Address[]) =>
        list.filter((a) => {
          const key = a.email.toLowerCase();
          if (selfEmails.has(key) || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const toList = pick([
        ...(state.replyTo.from ? [state.replyTo.from] : []),
        ...state.replyTo.to,
      ]);
      const ccList = pick(state.replyTo.cc);
      return { to: formatAddresses(toList), cc: formatAddresses(ccList) };
    },
    [state.replyTo],
  );

  const initialRecipients = useMemo(() => {
    if (state.mode === 'edit-draft' && state.draftMessage) {
      return {
        to: formatAddresses(state.draftMessage.to),
        cc: formatAddresses(state.draftMessage.cc),
      };
    }
    if (state.mode === 'reply' && state.replyTo?.from) {
      return { to: formatAddresses([state.replyTo.from]), cc: '' };
    }
    if (state.mode === 'reply-all') {
      return replyAllFields(new Set(accounts.map((a) => a.email.toLowerCase())));
    }
    return { to: formatAddresses(state.to), cc: formatAddresses(state.cc) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [to, setTo] = useState(initialRecipients.to);
  const [cc, setCc] = useState(initialRecipients.cc);
  const [showCcBcc, setShowCcBcc] = useState(!!initialRecipients.cc || !!state.bcc?.length);

  // Accounts load async, so the memo above can run before they arrive and
  // leave the user's own address in To. Re-derive once they load — but only
  // while the fields still hold the auto-computed values, never over edits.
  const autoRecipientsRef = useRef(initialRecipients);
  useEffect(() => {
    if (!accountsLoaded || state.mode !== 'reply-all') return;
    const prev = autoRecipientsRef.current;
    const corrected = replyAllFields(new Set(accounts.map((a) => a.email.toLowerCase())));
    autoRecipientsRef.current = corrected;
    setTo((current) => (current === prev.to ? corrected.to : current));
    setCc((current) => (current === prev.cc ? corrected.cc : current));
    if (corrected.cc) setShowCcBcc(true);
  }, [accountsLoaded, accounts, state.mode, replyAllFields]);
  const [bcc, setBcc] = useState(state.mode === 'new' ? formatAddresses(state.bcc) : '');
  const [subject, setSubject] = useState(
    state.subject ? replySubject(state.mode, state.subject) : '',
  );
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([]);
  const [quotedHtml, setQuotedHtml] = useState('');
  const [sending, setSending] = useState(false);
  const [showSendLater, setShowSendLater] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // In the ui store (not local) so the assistant orb can reposition on it.
  const expanded = useUi((s) => s.composerExpanded);
  const setExpanded = useUi((s) => s.setComposerExpanded);
  const { templates } = useTemplates();

  const toRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const ccRef = useRef<HTMLInputElement>(null);
  const bccRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLSelectElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      // The style must live inline on each <a>: recipients' clients (Gmail
      // especially) strip <style> blocks, so this is the only way the link
      // reads as a link everywhere. It also styles links inside the editor.
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { style: 'color:#2563eb;text-decoration:underline' },
      }),
      Placeholder.configure({ placeholder: 'Write your message…' }),
    ],
    content: '',
    autofocus: state.mode === 'new' ? false : true,
  });

  // Expose the editor to the assistant orb (rewrite / translate / AI reply).
  useEffect(() => {
    registerComposerEditor(editor ?? null);
    return () => registerComposerEditor(null);
  }, [editor]);
  useEffect(() => {
    registerComposerAccount(account?.id ?? null);
    return () => registerComposerAccount(null);
  }, [account?.id]);
  // The times block belongs to this draft only.
  useEffect(() => () => useComposerTimes.setState(null, true), []);
  // ⌘⇧A offers times that suit everyone in To.
  useEffect(() => {
    registerComposerRecipients(parseAddresses(to));
    return () => registerComposerRecipients([]);
  }, [to]);

  // An AI-drafted body (from an orb "Create a reply" / "Write" action) seeds
  // the editor once on open, before the signature is appended.
  const initialBodyApplied = useRef(false);
  useEffect(() => {
    if (!editor || initialBodyApplied.current || !state.initialBody) return;
    initialBodyApplied.current = true;
    editor.commands.setContent(textToHtml(state.initialBody));
    editor.commands.focus('end');
  }, [editor, state.initialBody]);

  // Editing a stored draft: load its saved body into the editor.
  useEffect(() => {
    if (state.mode !== 'edit-draft' || !state.draftMessage || !editor) return;
    void api.query('message:body', { messageId: state.draftMessage.id }).then((body) => {
      if (!body) return;
      const html = body.html ?? `<pre>${(body.text ?? '').replace(/</g, '&lt;')}</pre>`;
      editor.commands.setContent(html);
      editor.commands.focus('end');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Pull the original body for the quote block on reply/forward.
  useEffect(() => {
    if (!state.replyTo) return;
    void api.query('message:body', { messageId: state.replyTo.id }).then((body) => {
      if (!body) return;
      const meta = `On ${new Date(state.replyTo!.date).toLocaleString()}, ${
        state.replyTo!.from?.name || state.replyTo!.from?.email || 'someone'
      } wrote:`;
      const inner = body.html ?? `<pre>${(body.text ?? '').replace(/</g, '&lt;')}</pre>`;
      setQuotedHtml(`<p></p><p style="color:#777">${meta}</p><blockquote>${inner}</blockquote>`);
    });
  }, [state.replyTo]);

  useEffect(() => {
    if (state.mode === 'new') toRef.current?.focus();
  }, [state.mode]);

  // Per-account signature (Settings → Signatures), appended once on open.
  // Skipped when editing a draft: its body already carries any signature.
  const signatureApplied = useRef(false);
  useEffect(() => {
    if (!editor || signatureApplied.current || state.mode === 'edit-draft') return;
    void api.query('signatures:list', undefined).then((sigs) => {
      const sig = sigs.find((s) => s.id === state.accountId);
      if (sig?.bodyHtml.trim() && !signatureApplied.current) {
        signatureApplied.current = true;
        editor.commands.insertContentAt(editor.state.doc.content.size, `<p>—</p>${sig.bodyHtml}`);
        editor.commands.focus('start');
      }
    });
  }, [editor, state.accountId]);

  /**
   * Template semantics (report §2.5): {name} resolves from the To field at
   * apply time and is not re-resolved later; other {placeholders} stay for
   * the sender to fill, and sending warns while any remain.
   */
  const applyTemplate = (t: Template) => {
    if (!editor) return;
    const firstTo = parseAddresses(to)[0];
    const name = firstTo?.name || firstTo?.email.split('@')[0] || '';
    const filled = t.bodyHtml.replace(/\{name\}/gi, name || '{name}');
    editor.commands.insertContentAt(0, filled);
    if (!subject && t.subject) setSubject(t.subject);
    if (!to && t.to.length) setTo(formatAddresses(t.to));
    if (t.cc.length || t.bcc.length) setShowCcBcc(true);
    if (t.cc.length && !cc) setCc(formatAddresses(t.cc));
    if (t.bcc.length && !bcc) setBcc(formatAddresses(t.bcc));
    editor.commands.focus();
  };

  // Finder drops land anywhere on the dialog; capture them before the TipTap
  // editor (ProseMirror would otherwise swallow the drop or inline the image).
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const buildDraft = useCallback((): OutgoingDraft | null => {
    if (!account || !editor) return null;
    const toList = parseAddresses(to);
    if (!toList.length) {
      toast('Add at least one recipient');
      toRef.current?.focus();
      return null;
    }
    // unfilled template placeholders block sending (report §2.5)
    const remaining = editor.getText().match(/\{[a-z_][\w-]*\}/gi);
    if (remaining?.length) {
      toast(`Fill ${[...new Set(remaining)].join(', ')} before sending`);
      editor.commands.focus();
      return null;
    }
    return {
      accountId: account.id,
      to: toList,
      cc: parseAddresses(cc),
      bcc: parseAddresses(bcc),
      subject: subject || '(no subject)',
      html: `<div>${inlineEmailStyles(editor.getHTML())}</div>${quotedHtml}`,
      text: editor.getText(),
      inReplyToMessageId: state.mode !== 'new' && state.mode !== 'forward' ? state.replyTo?.id : undefined,
      deleteDraftMessageId: state.mode === 'edit-draft' ? state.draftMessage?.id : undefined,
      attachments,
    };
  }, [account, editor, to, cc, bcc, subject, quotedHtml, attachments, state]);

  /** Like buildDraft, but without send validation — drafts may be incomplete. */
  const buildLooseDraft = useCallback((): OutgoingDraft | null => {
    if (!account || !editor) return null;
    return {
      accountId: account.id,
      to: parseAddresses(to),
      cc: parseAddresses(cc),
      bcc: parseAddresses(bcc),
      subject: subject || '(no subject)',
      html: `<div>${inlineEmailStyles(editor.getHTML())}</div>${quotedHtml}`,
      text: editor.getText(),
      inReplyToMessageId: state.mode !== 'new' && state.mode !== 'forward' ? state.replyTo?.id : undefined,
      deleteDraftMessageId: state.mode === 'edit-draft' ? state.draftMessage?.id : undefined,
      attachments,
    };
  }, [account, editor, to, cc, bcc, subject, quotedHtml, attachments, state]);

  const saveAsDraft = useCallback(() => {
    const draft = buildLooseDraft();
    if (!draft) return;
    closeComposer();
    void api.command('task:enqueue', { type: 'save-draft', draft });
    toast('Draft saved');
  }, [buildLooseDraft, closeComposer]);

  /** Delete = the email is gone: editing a stored draft removes it from Drafts too. */
  const discardDraft = useCallback(() => {
    closeComposer();
    if (state.mode === 'edit-draft' && state.draftMessage) {
      void api.command('task:enqueue', {
        type: 'delete-draft',
        accountId: state.draftMessage.accountId,
        messageId: state.draftMessage.id,
      });
      toast('Draft deleted');
    }
  }, [closeComposer, state]);

  /**
   * Closing with content asks Delete / Save draft (Spark behavior); an empty
   * composer just closes.
   */
  const requestClose = useCallback(() => {
    const hasContent =
      to.trim() !== '' ||
      cc.trim() !== '' ||
      bcc.trim() !== '' ||
      subject.trim() !== '' ||
      attachments.length > 0 ||
      (editor?.getText().trim() ?? '') !== '';
    if (hasContent) setConfirmClose(true);
    else closeComposer();
  }, [to, cc, bcc, subject, attachments, editor, closeComposer]);

  const send = useCallback(() => {
    if (sending) return;
    const draft = buildDraft();
    if (!draft) return;
    setSending(true);
    closeComposer();

    // Undo Send: the task is enqueued only after the window elapses.
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void api.command('task:enqueue', { type: 'send-draft', draft });
    }, UNDO_SEND_MS);
    toast('Sending…', {
      duration: UNDO_SEND_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          cancelled = true;
          clearTimeout(timer);
          toast('Send cancelled');
        },
      },
    });
  }, [sending, buildDraft, closeComposer]);

  const sendLater = useCallback(
    (sendAt: number) => {
      const draft = buildDraft();
      if (!draft) return;
      setShowSendLater(false);
      closeComposer();
      void api.command('task:enqueue', { type: 'schedule-send', draft, sendAt });
      toast(`Scheduled — sends ${fmtWake(sendAt)}. Find it in the Outbox.`);
    },
    [buildDraft, closeComposer],
  );

  // Link editor (Spark-style): link the selected text, ⇧⌘K or toolbar button.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkExisting, setLinkExisting] = useState(false);

  const openLinkEditor = useCallback(() => {
    if (!editor) return;
    const existing = editor.getAttributes('link')['href'] as string | undefined;
    if (editor.state.selection.empty && !existing) {
      toast('Select the text to link first');
      editor.commands.focus();
      return;
    }
    setLinkUrl(existing ?? '');
    setLinkExisting(!!existing);
    setLinkOpen(true);
  }, [editor]);

  const applyLink = useCallback(
    (url: string) => {
      setLinkOpen(false);
      if (!editor) return;
      const trimmed = url.trim();
      const chain = editor.chain().focus().extendMarkRange('link');
      if (!trimmed) chain.unsetLink().run();
      else chain.setLink({ href: /^[a-z][\w+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}` }).run();
    },
    [editor],
  );

  // Composer-scoped keys: ⌘↩ send, Esc close, ⇧⌘K link, ⌘1–6 field focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The time zone dialog and the times calendar close themselves;
        // Esc while checking only cancels the check.
        if (useZonePrompt.getState().questions || useTimesCalendarOpen.getState()) return;
        e.preventDefault();
        if (cancelAvailabilityCheck()) {
          e.stopImmediatePropagation();
          return;
        }
        if (linkOpen) setLinkOpen(false);
        else if (confirmClose) setConfirmClose(false);
        else requestClose();
        return;
      }
      if (confirmClose) return; // the close dialog owns the keyboard
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openLinkEditor();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        send();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        const fields: Record<string, () => void> = {
          '1': () => toRef.current?.focus(),
          '2': () => (setShowCcBcc(true), setTimeout(() => ccRef.current?.focus())),
          '3': () => (setShowCcBcc(true), setTimeout(() => bccRef.current?.focus())),
          '4': () => subjectRef.current?.focus(),
          '5': () => editor?.commands.focus(),
          '6': () => fromRef.current?.focus(),
        };
        const fn = fields[e.key];
        if (fn) {
          e.preventDefault();
          fn();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [send, requestClose, confirmClose, editor, linkOpen, openLinkEditor]);

  const fieldCls =
    'w-full bg-transparent text-[12.5px] py-1.5 focus:outline-none placeholder:text-ink-faint';

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-end justify-end p-4">
      <div
        ref={cardRef}
        data-composer
        role="dialog"
        aria-label="Compose email"
        className={cn(
          'border-hairline bg-surface pointer-events-auto relative flex max-w-full flex-col rounded-2xl border shadow-2xl',
          expanded ? 'h-full w-[1100px]' : 'max-h-[85%] w-[620px]',
        )}
        onDragEnterCapture={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOverCapture={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeaveCapture={(e) => {
          if (!hasFiles(e)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDropCapture={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepth.current = 0;
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        {dragOver && (
          <div className="border-accent bg-surface/90 pointer-events-none absolute inset-1.5 z-50 flex items-center justify-center rounded-xl border-2 border-dashed">
            <span className="text-accent flex items-center gap-2 text-[13px] font-semibold">
              <Paperclip size={15} />
              Drop files to attach
            </span>
          </div>
        )}
        <header className="border-hairline flex items-center gap-2 border-b px-4 py-2.5">
          <span className="flex-1 text-[12.5px] font-bold">
            {state.mode === 'new'
              ? 'New email'
              : state.mode === 'forward'
                ? 'Forward'
                : state.mode === 'edit-draft'
                  ? 'Edit draft'
                  : 'Reply'}
          </span>
          <span className="text-ink-faint flex items-center gap-1 text-[11px]">
            send <Keycaps keys={['⌘', '↩']} />
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Shrink' : 'Expand'}
            aria-label={expanded ? 'Shrink composer' : 'Expand composer'}
            className="text-ink-muted hover:text-ink ml-1"
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={requestClose} aria-label="Close composer" className="text-ink-muted hover:text-ink ml-1">
            <X size={15} />
          </button>
        </header>

        <div className="border-hairline flex items-center gap-2 border-b px-4">
          <label className="text-ink-faint w-10 shrink-0 text-[11.5px]">To</label>
          <AddressField inputRef={toRef} value={to} onChange={setTo} className={fieldCls}
            placeholder="name@example.com" ariaLabel="To" />
          {!showCcBcc && (
            <button onClick={() => setShowCcBcc(true)} className="text-ink-faint hover:text-ink shrink-0 text-[11.5px]">
              Cc/Bcc
            </button>
          )}
        </div>
        {showCcBcc && (
          <>
            <div className="border-hairline flex items-center gap-2 border-b px-4">
              <label className="text-ink-faint w-10 shrink-0 text-[11.5px]">Cc</label>
              <AddressField inputRef={ccRef} value={cc} onChange={setCc} className={fieldCls} ariaLabel="Cc" />
            </div>
            <div className="border-hairline flex items-center gap-2 border-b px-4">
              <label className="text-ink-faint w-10 shrink-0 text-[11.5px]">Bcc</label>
              <AddressField inputRef={bccRef} value={bcc} onChange={setBcc} className={fieldCls} ariaLabel="Bcc" />
            </div>
          </>
        )}
        <div className="border-hairline flex items-center gap-2 border-b px-4">
          <label className="text-ink-faint w-10 shrink-0 text-[11.5px]">Subject</label>
          <input
            ref={subjectRef}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={cn(fieldCls, 'font-semibold')}
            aria-label="Subject"
          />
        </div>
        {accounts.length > 1 && (
          <div className="border-hairline flex items-center gap-2 border-b px-4">
            <label className="text-ink-faint w-10 shrink-0 text-[11.5px]">From</label>
            <select
              ref={fromRef}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="text-ink bg-transparent py-1.5 text-[12.5px] focus:outline-none"
              aria-label="From account"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          </div>
        )}

        <AvailabilityChecking />
        <TimesHoverBar card={cardRef} />
        <div className="composer-editor min-h-0 flex-1 overflow-y-auto px-4 py-2" onClick={() => editor?.commands.focus()}>
          {/* Spark-style selection toolbar: appears over selected text with
              the common formats; the editor's ⌘B/⌘I/⌘U shortcuts still work. */}
          {editor && (
            <BubbleMenu editor={editor} options={{ placement: 'top' }}>
              <div className="border-hairline bg-surface flex items-center gap-0.5 rounded-xl border p-1 shadow-2xl">
                {(
                  [
                    { Icon: Bold, label: 'Bold — ⌘B', active: 'bold', run: () => editor.chain().focus().toggleBold().run() },
                    { Icon: Italic, label: 'Italic — ⌘I', active: 'italic', run: () => editor.chain().focus().toggleItalic().run() },
                    { Icon: UnderlineIcon, label: 'Underline — ⌘U', active: 'underline', run: () => editor.chain().focus().toggleUnderline().run() },
                    { Icon: TextQuote, label: 'Quote', active: 'blockquote', run: () => editor.chain().focus().toggleBlockquote().run() },
                    { Icon: Link2, label: 'Link — ⇧⌘K', active: 'link', run: openLinkEditor },
                  ] as const
                ).map(({ Icon, label, active, run }) => (
                  <button
                    key={label}
                    onClick={run}
                    title={label}
                    aria-label={label}
                    className={cn(
                      'rounded-lg p-1.5',
                      editor.isActive(active) ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    <Icon size={13} />
                  </button>
                ))}
              </div>
            </BubbleMenu>
          )}
          <EditorContent editor={editor} />
          {quotedHtml && (
            <div className="text-ink-faint border-hairline mt-2 border-t pt-2 text-[11.5px]">
              Quoted message included ·{' '}
              <button className="hover:text-ink underline" onClick={() => setQuotedHtml('')}>
                remove
              </button>
            </div>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {attachments.map((a, i) => {
              const { Icon, tile, label } = fileVisual(a.contentType, a.filename);
              return (
                <span key={i} className="border-hairline bg-sunken flex items-center gap-2 rounded-lg border py-1 pl-1 pr-2 text-[11.5px]">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tile}`}>
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block max-w-44 truncate font-medium leading-tight">{a.filename}</span>
                    <span className="text-ink-faint block text-[10px] leading-tight">
                      {label} · {formatSize(Math.round(a.dataBase64.length * 0.75))}
                    </span>
                  </span>
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove ${a.filename}`}
                    className="text-ink-muted hover:text-danger"
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {linkOpen && (
          <div className="border-hairline bg-surface absolute right-3 bottom-12 z-50 flex w-80 items-center gap-1.5 rounded-xl border p-2 shadow-2xl">
            <Link2 size={13} className="text-ink-muted shrink-0" />
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  applyLink(linkUrl);
                }
              }}
              placeholder="https://example.com"
              aria-label="Link URL"
              className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12px] focus:outline-none"
            />
            {linkExisting && (
              <button
                onClick={() => applyLink('')}
                className="text-ink-muted hover:text-danger shrink-0 text-[11.5px]"
              >
                Remove
              </button>
            )}
            <button
              onClick={() => applyLink(linkUrl)}
              className="bg-accent shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold text-white hover:opacity-90"
            >
              Apply
            </button>
          </div>
        )}

        <footer className="border-hairline flex items-center gap-1 border-t px-3 py-2">
          <button
            onClick={send}
            className="bg-accent flex h-7 items-center gap-1.5 rounded-l-lg px-3 text-[12px] font-semibold text-white hover:opacity-90"
          >
            <Send size={12.5} />
            Send
          </button>
          <button
            onClick={() => setShowSendLater(true)}
            title="Send later…"
            aria-label="Send later"
            className="bg-accent -ml-1 flex h-7 items-center rounded-r-lg border-l border-white/25 px-1.5 text-white hover:opacity-90"
          >
            <CalendarClock size={12.5} />
          </button>
          <span className="w-2" />
          {templates.length > 0 && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="text-ink-muted hover:text-ink rounded-md p-1.5" title="Apply template" aria-label="Apply template">
                  <FileText size={13.5} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="border-hairline bg-surface z-50 min-w-44 rounded-xl border p-1 text-[12px] shadow-xl"
                  sideOffset={4}
                >
                  <DropdownMenu.Label className="text-ink-faint px-2 py-1 text-[10.5px]">Templates</DropdownMenu.Label>
                  {templates.map((t) => (
                    <DropdownMenu.Item
                      key={t.id}
                      onSelect={() => applyTemplate(t)}
                      className="data-highlighted:bg-accent-soft data-highlighted:text-accent cursor-default rounded-lg px-2 py-1.5 outline-none"
                    >
                      {t.name}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <button
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={cn('rounded-md p-1.5', editor?.isActive('bold') ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink')}
            title="Bold — ⌘B" aria-label="Bold"
          >
            <Bold size={13.5} />
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={cn('rounded-md p-1.5', editor?.isActive('italic') ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink')}
            title="Italic — ⌘I" aria-label="Italic"
          >
            <Italic size={13.5} />
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className={cn('rounded-md p-1.5', editor?.isActive('bulletList') ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink')}
            title="Bullet list" aria-label="Bullet list"
          >
            <ListIcon size={13.5} />
          </button>
          <button
            onClick={openLinkEditor}
            className={cn('rounded-md p-1.5', editor?.isActive('link') ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink')}
            title="Link — ⇧⌘K" aria-label="Insert link"
          >
            <Link2 size={13.5} />
          </button>
          <button onClick={() => fileRef.current?.click()} className="text-ink-muted hover:text-ink rounded-md p-1.5" title="Attach files" aria-label="Attach files">
            <Paperclip size={13.5} />
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <span className="flex-1" />
          <button onClick={discardDraft} className="text-ink-muted hover:text-danger rounded-md p-1.5" title="Discard" aria-label="Discard draft">
            <Trash2 size={13.5} />
          </button>
        </footer>
      </div>
      {confirmClose && (
        <CloseConfirmDialog
          onDelete={() => {
            setConfirmClose(false);
            discardDraft();
          }}
          onKeepEditing={() => setConfirmClose(false)}
          onSave={() => {
            setConfirmClose(false);
            saveAsDraft();
          }}
        />
      )}
      {showSendLater && (
        <SchedulePicker
          title="Send later"
          icon="send"
          onClose={() => setShowSendLater(false)}
          onPick={(when) => {
            if (when !== null) sendLater(when);
          }}
        />
      )}
    </div>
  );
}

/** "Save this email?" — ←/→ move between the buttons, D/K/S pick one, ↩ runs the selected one
 *  (Save draft by default). Esc is handled by the composer and keeps editing. */
function CloseConfirmDialog({
  onDelete,
  onKeepEditing,
  onSave,
}: {
  onDelete: () => void;
  onKeepEditing: () => void;
  onSave: () => void;
}) {
  const [selected, setSelected] = useState(2);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const latest = useRef({ actions: [onDelete, onKeepEditing, onSave], selected });
  useEffect(() => {
    latest.current = { actions: [onDelete, onKeepEditing, onSave], selected };
  });

  useEffect(() => {
    buttons.current[selected]?.focus();
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Escape') return;
      const { actions, selected } = latest.current;
      const key = e.key.toLowerCase();
      const letter = ['d', 'k', 's'].indexOf(key);
      let handled = true;
      if (key === 'arrowleft' || key === 'arrowup' || (key === 'tab' && e.shiftKey))
        setSelected((selected + 2) % 3);
      else if (key === 'arrowright' || key === 'arrowdown' || key === 'tab')
        setSelected((selected + 1) % 3);
      else if (key === 'home') setSelected(0);
      else if (key === 'end') setSelected(2);
      else if (key === 'enter' || key === ' ') actions[selected]!();
      else if (letter >= 0) actions[letter]!();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const button = 'rounded-lg px-3 py-1.5 text-[12px] font-semibold';
  return (
    <div
      className="no-drag pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onKeepEditing();
      }}
    >
      <div
        role="alertdialog"
        aria-label="Close email"
        className="border-hairline bg-surface w-80 rounded-2xl border p-4 shadow-2xl"
      >
        <p className="text-[13px] font-bold">Save this email?</p>
        <p className="text-ink-muted mt-1 text-[12px]">
          You can keep it as a draft and finish it later.
        </p>
        <div className="mt-3.5 flex items-center gap-2">
          <button
            ref={(el) => {
              buttons.current[0] = el;
            }}
            onClick={onDelete}
            onMouseEnter={() => setSelected(0)}
            className={cn(
              button,
              'border-hairline text-danger border',
              selected === 0 && 'bg-danger/10 border-danger/40',
            )}
          >
            Delete
          </button>
          <span className="flex-1" />
          <button
            ref={(el) => {
              buttons.current[1] = el;
            }}
            onClick={onKeepEditing}
            onMouseEnter={() => setSelected(1)}
            className={cn(button, selected === 1 ? 'bg-sunken text-ink' : 'text-ink-muted')}
          >
            Keep editing
          </button>
          <button
            ref={(el) => {
              buttons.current[2] = el;
            }}
            onClick={onSave}
            onMouseEnter={() => setSelected(2)}
            className={cn(
              button,
              selected === 2 ? 'bg-accent text-white' : 'bg-accent-soft text-accent',
            )}
          >
            Save draft
          </button>
        </div>
      </div>
    </div>
  );
}
