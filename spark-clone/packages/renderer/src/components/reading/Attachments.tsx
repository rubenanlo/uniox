import type { AttachmentMeta } from '@app/shared';
import { Download, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { fileVisual } from '../../lib/fileVisual';
import { formatSize } from '../../lib/utils';

function AttachmentCard({ att }: { att: AttachmentMeta }) {
  const { Icon, tile, label } = fileVisual(att.contentType, att.filename);
  const isImage = att.contentType.startsWith('image/');
  const ready = !!att.localPath;

  const preview = () => {
    if (!ready) return;
    void api.command('attachment:preview', { localPath: att.localPath! });
  };
  const save = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ready) return;
    void api
      .command('attachment:save', { localPath: att.localPath!, filename: att.filename })
      .then((res) => {
        if (res.ok && res.path) toast(`Saved to ${res.path}`);
      });
  };

  return (
    <button
      onClick={preview}
      disabled={!ready}
      title={ready ? `${att.filename} — click to preview` : `${att.filename} — downloading…`}
      className="group border-hairline bg-surface hover:border-accent flex w-52 items-center gap-2.5 rounded-xl border p-2 text-left disabled:opacity-50"
    >
      {isImage && ready ? (
        <img
          src={`app://attachments/${encodeURI(att.localPath!)}`}
          alt=""
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tile}`}>
          <Icon size={19} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="text-ink block truncate text-[12px] font-medium">{att.filename}</span>
        <span className="text-ink-faint block text-[10.5px]">
          {label} · {formatSize(att.size)}
        </span>
      </span>
      <span
        role="button"
        aria-label={`Save ${att.filename}`}
        onClick={save}
        className="text-ink-muted hover:text-accent shrink-0 rounded-md p-1 opacity-0 group-hover:opacity-100"
      >
        <Download size={14} />
      </span>
    </button>
  );
}

/** Spark-style attachment strip: header count + card per file. */
export function Attachments({ attachments }: { attachments: AttachmentMeta[] }) {
  if (!attachments.length) return null;
  const ready = attachments.filter((a) => a.localPath);
  const saveAll = () => {
    void api
      .command('attachment:save-all', {
        files: ready.map((a) => ({ localPath: a.localPath!, filename: a.filename })),
      })
      .then((res) => {
        if (res.ok && res.path) {
          toast(`${res.saved} ${res.saved === 1 ? 'file' : 'files'} saved to ${res.path}`);
        }
      });
  };
  return (
    <div className="px-4 pb-3">
      <div className="text-ink-muted mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold">
        <Paperclip size={11} />
        {attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'}
        {ready.length > 1 && (
          <button
            onClick={saveAll}
            className="text-ink-muted hover:text-accent ml-1 flex items-center gap-1 rounded px-1 py-0.5 font-semibold"
          >
            <Download size={11} /> Download all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <AttachmentCard key={a.id} att={a} />
        ))}
      </div>
    </div>
  );
}
