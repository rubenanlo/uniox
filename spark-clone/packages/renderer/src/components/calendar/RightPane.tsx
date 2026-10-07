import { ExternalLink, Pencil, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CalendarEvent } from '@app/shared';
import { timeLabel } from '../../lib/calendarMonth';
import { canEditEvent } from '../../lib/eventEdit';
import { descriptionToHtml } from '../../lib/richText';
import { ruleLabel, seriesId } from '../../lib/rrule';
import { cn } from '../../lib/utils';
import { useAccounts } from '../../state/queries';
import { draftFromEvent, useCalendar } from '../../state/calendar';
import { EventForm } from './EventForm';

const SHORTCUTS: [string, string][] = [
  ['Go to today', 'T'],
  ['New event', 'C'],
  ['Month / Week / Day', 'M W D'],
  ['Move around', '← → ↑ ↓'],
  ['Create on focused day', '↩'],
  ['Toggle sidebar', '⌘ \\'],
  ['Toggle this panel', '⌘ /'],
  ['Back to mail', 'Esc'],
];

function ShortcutsPanel() {
  return (
    <div className="px-4 py-4">
      <h2 className="text-ink mb-3 text-[13.5px] font-bold">Useful shortcuts</h2>
      <ul className="flex flex-col gap-2.5">
        {SHORTCUTS.map(([label, keys]) => (
          <li key={label} className="flex items-center justify-between gap-2">
            <span className="text-ink-muted text-[12.5px]">{label}</span>
            <span className="flex gap-1">
              {keys.split(' ').map((k, i) => (
                <kbd
                  key={i}
                  className="border-hairline bg-sunken text-ink-muted rounded border px-1.5 py-0.5 text-[10.5px]"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function whenLabel(e: CalendarEvent): string {
  const day = new Date(e.startMs).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  if (e.allDay) return `${day} · All day`;
  return `${day} · ${timeLabel(e.startMs)} – ${timeLabel(e.endMs)}`;
}

/** Labeled value row used for the fields that aren't self-evident. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-ink-faint text-[10px] font-semibold uppercase tracking-wide">
        {label}
      </span>
      <div className="text-ink-muted text-[12.5px]">{children}</div>
    </div>
  );
}

function DetailsPanel({ event }: { event: CalendarEvent }) {
  const openForm = useCalendar((s) => s.openForm);
  const remove = useCalendar((s) => s.remove);
  const closePane = useCalendar((s) => s.closePane);
  const calendars = useCalendar((s) => s.calendars);
  const { accounts } = useAccounts();
  const cal = calendars.find((c) => c.id === event.calendarId);
  const account = accounts.find((a) => a.id === (event.accountId ?? cal?.accountId));
  const editable = canEditEvent(event, calendars);
  const deletable = event.source === 'local';

  const openEdit = () => {
    // Local: edit the stored series row, not this (possibly future) occurrence —
    // saving from an occurrence's start would rewrite the series start and
    // silently drop earlier occurrences. Google ids contain ':' and never
    // expand, so they must not go through seriesId.
    const base =
      event.source === 'local'
        ? (useCalendar.getState().events.find((e) => e.id === seriesId(event.id)) ?? event)
        : event;
    openForm(draftFromEvent(base), { kind: 'details', event: base });
  };
  // Any property of an editable event jumps straight into the form.
  const prop = editable
    ? { onClick: openEdit, className: 'cursor-pointer', title: 'Click to edit' }
    : {};

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded"
          style={{ backgroundColor: event.color ?? cal?.color ?? 'var(--color-accent)' }}
        />
        <h2
          {...prop}
          className={cn('text-ink flex-1 text-[14.5px] leading-snug font-bold', prop.className)}
        >
          {event.eventType === 'outOfOffice' && '⊗ '}
          {event.title || '(untitled)'}
        </h2>
        <button
          onClick={closePane}
          aria-label="Close details"
          className="text-ink-muted hover:text-ink -mr-1 flex h-7 w-7 items-center justify-center rounded-lg"
        >
          <X size={14} />
        </button>
      </div>
      <p {...prop} className={cn('text-ink-muted text-[12.5px]', prop.className)}>
        {whenLabel(event)}
      </p>
      <p className="text-ink-faint text-[12px]">{ruleLabel(event.rrule)}</p>
      <Field label="Account">
        {cal ? cal.name : event.source === 'notion' ? 'Notion' : 'Calendar'}
        {account && ` · ${account.email}`}
      </Field>
      {editable && (
        <div {...prop}>
          <Field label="Show as">{event.transparency === 'transparent' ? 'Free' : 'Busy'}</Field>
        </div>
      )}
      {event.location && (
        <div {...prop}>
          <Field label="Location">{event.location}</Field>
        </div>
      )}
      {event.meetingUrl && (
        <Field label="Meeting">
          <a href={event.meetingUrl} target="_blank" rel="noreferrer"
             className="text-accent block truncate font-medium">
            {event.meetingUrl}
          </a>
        </Field>
      )}
      {event.description && (
        <div {...prop}>
          <Field label="Description">
            <div
              // Sanitized by descriptionToHtml (same DOMPurify layer as mail).
              dangerouslySetInnerHTML={{ __html: descriptionToHtml(event.description) }}
              onClick={(e) => {
                // Links open externally; don't fall through to the edit-on-click wrapper.
                const a = (e.target as HTMLElement).closest('a');
                if (a) {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(a.href, '_blank');
                }
              }}
              className="[&_a]:text-accent break-words whitespace-pre-wrap [&_a]:underline"
            />
          </Field>
        </div>
      )}
      {event.url && (
        <a href={event.url} target="_blank" rel="noreferrer"
           className="text-accent inline-flex items-center gap-1.5 text-[12.5px] font-medium">
          <ExternalLink size={13} /> Open in Notion
        </a>
      )}
      {editable && (
        <div className="border-hairline mt-1 flex gap-2 border-t pt-3">
          <button
            onClick={openEdit}
            className="border-hairline text-ink hover:bg-sunken flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[12px] font-semibold"
          >
            <Pencil size={12} /> Edit
          </button>
          {deletable && (
            <button
              onClick={() => void remove(seriesId(event.id))}
              className="border-hairline text-danger hover:bg-sunken flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[12px] font-semibold"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      )}
      {event.rrule && editable && (
        <p className="text-ink-faint text-[11px]">Edits apply to the whole series.</p>
      )}
    </div>
  );
}

export function RightPane() {
  const rightPane = useCalendar((s) => s.rightPane);
  const open = useCalendar((s) => s.rightPaneOpen);
  if (!open) return null;
  return (
    <aside
      aria-label="Calendar side panel"
      className="border-hairline h-full w-[300px] shrink-0 overflow-y-auto border-l"
    >
      {rightPane.kind === 'shortcuts' && <ShortcutsPanel />}
      {rightPane.kind === 'details' && <DetailsPanel event={rightPane.event} />}
      {rightPane.kind === 'form' && (
        <EventForm
          key={`${rightPane.draft.id ?? 'new'}:${rightPane.draft.startMs}`}
          draft={rightPane.draft}
        />
      )}
    </aside>
  );
}
