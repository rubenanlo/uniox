import type { Address, AttachmentMeta, MessageBodyPayload, MessageMeta, OutgoingAttachment, OutgoingDraft } from '@app/shared';
import { Forward, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { forwardBlock, parseAddressList, prefixedSubject, textToHtml } from '../../lib/quickReply';
import { cn } from '../../lib/utils';
import { FileCard } from './Cards';

function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/**
 * The forward, as a card inside the chat: who it goes to, a short note, and
 * which of the email's files ride along. Forwarding hands the draft back to
 * the widget, which shows the Undo countdown.
 */
export function ForwardCard({
  message,
  body,
  files,
  accountId,
  suggestedTo,
  onForward,
  onCancel,
}: {
  message: MessageMeta;
  body: MessageBodyPayload | undefined;
  files: AttachmentMeta[];
  accountId: string;
  suggestedTo: Address | null;
  onForward: (draft: OutgoingDraft, label: string) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(suggestedTo ? formatAddress(suggestedTo) : '');
  const [note, setNote] = useState('');
  const [include, setInclude] = useState<Set<string>>(() => new Set(files.filter((f) => f.localPath).map((f) => f.id)));
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const recipients = parseAddressList(to);
    if (!recipients.length) return void toast('Add who to forward it to');
    setBusy(true);
    const attachments: OutgoingAttachment[] = [];
    for (const f of files) {
      if (!include.has(f.id) || !f.localPath) continue;
      const data = await api.query('attachment:data', { localPath: f.localPath });
      if (data.ok && data.dataBase64) {
        attachments.push({ filename: f.filename, contentType: f.contentType, dataBase64: data.dataBase64 });
      } else toast(`${f.filename} couldn’t be attached (${data.error ?? 'unavailable'})`);
    }
    const bodyPart = body ?? { html: null, text: message.snippet };
    onForward(
      {
        accountId,
        to: recipients,
        cc: [],
        bcc: [],
        subject: prefixedSubject('Fwd', message.subject),
        html: `${note.trim() ? textToHtml(note) : ''}${forwardBlock(message, bodyPart)}`,
        text: `${note.trim()}\n\n---------- Forwarded message ---------\n${bodyPart.text ?? message.snippet}`,
        attachments,
      },
      recipients.map((r) => r.name?.split(/\s+/)[0] || r.email).join(', '),
    );
  };

  return (
    <div className="qr-field rounded-[14px] p-3" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancel())}>
      <label className="mb-2 flex items-center gap-2">
        <span className="text-ink-muted w-6 text-[12px]">To</span>
        <input
          autoFocus
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
          }}
          placeholder="name@company.com"
          className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        rows={2}
        placeholder="Add a note (optional)"
        className="placeholder:text-ink-faint mb-2 w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none"
      />
      {files.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {files.map((f) => (
            <FileCard
              key={f.id}
              att={f}
              selected={include.has(f.id)}
              onToggle={() =>
                setInclude((s) => {
                  const n = new Set(s);
                  if (n.has(f.id)) n.delete(f.id);
                  else if (f.localPath) n.add(f.id);
                  return n;
                })
              }
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => void send()}
          disabled={busy}
          className={cn(
            'border-accent/35 bg-accent/10 text-accent flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium',
          )}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Forward size={13} />} Forward
          <span className="opacity-60">⌘↩</span>
        </button>
        <button onClick={onCancel} className="qr-field h-7 rounded-full px-3 text-[12.5px]">
          Cancel
        </button>
      </div>
    </div>
  );
}
