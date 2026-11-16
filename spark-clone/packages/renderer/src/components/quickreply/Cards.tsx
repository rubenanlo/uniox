import type { AttachmentMeta } from '@app/shared';
import { Check, Download, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { fileVisual } from '../../lib/fileVisual';
import { offHoursNote, type GroupSlot, type Participant } from '../../lib/availability';
import { cn, formatSize } from '../../lib/utils';

/** Drag payload type for a time card dropped on the reply field. */
export const SLOT_DRAG_TYPE = 'application/x-uniox-slot';

/**
 * An attachment as a soft card in the chat: type tile, file name, and a
 * detail line. Click previews it (Quick Look); the arrow saves it.
 */
export function FileCard({
  att,
  selected,
  onToggle,
}: {
  att: AttachmentMeta;
  /** Forward card: the file rides along when checked. */
  selected?: boolean;
  onToggle?: () => void;
}) {
  const { Icon, tile, label } = fileVisual(att.contentType, att.filename);
  const ready = !!att.localPath;
  const isImage = att.contentType.startsWith('image/');
  const preview = () => {
    if (onToggle) return onToggle();
    if (ready) void api.command('attachment:preview', { localPath: att.localPath! });
  };
  const save = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ready) return;
    void api.command('attachment:save', { localPath: att.localPath!, filename: att.filename }).then((res) => {
      if (res.ok && res.path) toast(`Saved to ${res.path}`);
    });
  };
  return (
    <button
      type="button"
      onClick={preview}
      disabled={!ready && !onToggle}
      title={ready ? att.filename : `${att.filename} — still downloading`}
      className={cn(
        'qr-card group flex max-w-full items-center gap-3 py-2.5 pl-2.5 pr-3.5 text-left disabled:opacity-60',
        selected && 'picked',
      )}
    >
      {isImage && ready ? (
        <img
          src={`app://attachments/${encodeURI(att.localPath!)}`}
          alt=""
          className="h-11 w-10 shrink-0 rounded-[9px] object-cover"
        />
      ) : (
        <span className={cn('flex h-11 w-10 shrink-0 flex-col items-center justify-center rounded-[9px]', tile)}>
          <Icon size={16} />
          <span className="mt-0.5 text-[7.5px] font-bold tracking-wide">{label.slice(0, 5)}</span>
        </span>
      )}
      <span className="min-w-0">
        <span className="text-ink block truncate text-[13.5px] font-semibold">{att.filename}</span>
        <span className="text-ink-muted block text-[12px]">
          {label} · {formatSize(att.size)}
          {!ready && ' · downloading'}
        </span>
      </span>
      {onToggle ? (
        <span
          className={cn(
            'ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
            selected ? 'bg-accent border-accent text-white' : 'border-ink-faint',
          )}
        >
          {selected && <Check size={10} strokeWidth={3} />}
        </span>
      ) : (
        ready && (
          <span className="text-ink-faint ml-3 flex shrink-0 gap-2.5">
            <Eye size={15} className="group-hover:text-ink-muted" />
            <span role="button" aria-label={`Save ${att.filename}`} onClick={save} className="hover:text-accent">
              <Download size={15} />
            </span>
          </span>
        )
      )}
    </button>
  );
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function slotDay(slot: GroupSlot): string {
  return dayFmt.format(slot.startMs);
}

export function slotRange(slot: GroupSlot): string {
  return `${timeFmt.format(slot.startMs)} – ${timeFmt.format(slot.endMs)}`;
}

/** "Everyone free", or whose calendar couldn't be seen; "Early for you" when it stretches your day. */
export function slotStatus(slot: GroupSlot, people: Participant[]): string {
  const stretch = offHoursNote(slot);
  if (stretch) return stretch[0]!.toUpperCase() + stretch.slice(1);
  if (!people.length) return 'Free for you';
  const unknown = people.filter((p) => !p.busy).length;
  return unknown === 0 ? 'Everyone free' : unknown === people.length ? 'Free for you' : 'Free for those visible';
}

/** The first person whose clock reads differently, with their local start ("Antonio 8:00 AM"). */
export function slotElsewhere(slot: GroupSlot, people: Participant[]): string {
  const mine = timeFmt.format(slot.startMs);
  for (const p of people) {
    if (!p.timeZone) continue;
    const theirs = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: p.timeZone }).format(slot.startMs);
    if (theirs !== mine) return `${(p.name || p.email).split(/[\s@]/)[0]} ${theirs}`;
  }
  return '';
}

/** A suggested time as a card: click to add it to the reply, or drag it onto the field. */
export function SlotCard({
  slot,
  people,
  picked,
  onToggle,
}: {
  slot: GroupSlot;
  people: Participant[];
  picked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SLOT_DRAG_TYPE, String(slot.startMs));
        e.dataTransfer.effectAllowed = 'copy';
        // Tilted while carried, like a card lifted off the table.
        e.currentTarget.classList.add('dragging');
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove('dragging')}
      onClick={onToggle}
      aria-pressed={picked}
      className={cn('qr-card flex w-[172px] shrink-0 flex-col items-start px-3.5 py-2.5 text-left', picked && 'picked')}
    >
      {picked && (
        <span className="bg-accent absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full text-white">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
      <span className="text-ink-muted text-[10.5px] font-bold uppercase tracking-[0.08em]">{slotDay(slot)}</span>
      <span className="text-ink mt-1 whitespace-nowrap text-[14.5px] font-semibold">{slotRange(slot)}</span>
      <span className="text-ink-muted mt-0.5 max-w-full truncate text-[12px]">{slotStatus(slot, people)}</span>
      {slotElsewhere(slot, people) && (
        <span className="text-ink-faint max-w-full truncate text-[11.5px]">{slotElsewhere(slot, people)}</span>
      )}
    </button>
  );
}
