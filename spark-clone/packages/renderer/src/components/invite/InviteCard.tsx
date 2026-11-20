import type { CalendarEvent, InviteInfo, InviteResponse } from '@app/shared';
import {
  CalendarClock,
  CalendarDays,
  Check,
  HelpCircle,
  Loader2,
  MapPin,
  Repeat,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { expandEvent } from '../../lib/rrule';
import { cn } from '../../lib/utils';
import { suggestGroupSlots } from '../../state/availability';
import { useDelta } from '../../state/queries';
import { AiBadge } from '../ai/AiCards';

/**
 * The RSVP card for a meeting invite: Accept / Maybe / Decline / Propose a new
 * time, acting on the invite itself (the Google event, or an iTIP calendar
 * reply), never by writing an email. Self-contained so any email layout (the
 * reader, the ⌥⌘N island, a chat layout) can drop it in with a message id.
 */

/** The invite a message carries, kept fresh as its body and the calendar change. */
export function useInvite(messageId: string | undefined) {
  // Keyed by message so switching emails never shows the previous invite.
  const [state, setState] = useState<{ id: string; info: InviteInfo | null } | null>(null);
  const load = useCallback(() => {
    if (!messageId) return;
    void api
      .query('invite:get', { messageId })
      .then((info) => setState({ id: messageId, info }))
      .catch(() => setState({ id: messageId, info: null }));
  }, [messageId]);
  useEffect(() => load(), [load]);
  const info = state && state.id === messageId ? state.info : null;
  const setInfo = (next: InviteInfo | null) => messageId && setState({ id: messageId, info: next });
  useDelta((e) => {
    if (!messageId) return;
    if (e.kind === 'message-body' && e.messageIds.includes(messageId)) load();
  });
  return { info, setInfo, reload: load };
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Tue, Nov 24 · 10:00 – 11:00" (all-day: "Tue, Nov 24 · All day"). */
export function inviteWhen(i: Pick<InviteInfo, 'startMs' | 'endMs' | 'allDay'>): string {
  if (i.allDay) {
    const last = i.endMs - 86_400_000;
    return last > i.startMs
      ? `${dayFmt.format(i.startMs)} – ${dayFmt.format(last)} · All day`
      : `${dayFmt.format(i.startMs)} · All day`;
  }
  const sameDay = new Date(i.startMs).toDateString() === new Date(i.endMs - 1).toDateString();
  return sameDay
    ? `${dayFmt.format(i.startMs)} · ${timeFmt.format(i.startMs)} – ${timeFmt.format(i.endMs)}`
    : `${dayFmt.format(i.startMs)} ${timeFmt.format(i.startMs)} – ${dayFmt.format(i.endMs)} ${timeFmt.format(i.endMs)}`;
}

const first = (p: { name?: string; email: string } | null | undefined) =>
  (p?.name || p?.email || '').split(/[\s@,]/)[0] || 'the organizer';

const STATUS_LABEL: Record<InviteInfo['myStatus'], string> = {
  'needs-action': 'Not answered',
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Not going',
};

/** What else is on your calendars at the invite's time (the invite itself left out). */
function useClashes(info: InviteInfo | null): CalendarEvent[] | null {
  const [found, setFound] = useState<{ key: string; clashes: CalendarEvent[] | null } | null>(null);
  const wanted = !!info && !info.allDay && info.kind === 'request';
  const key = info ? `${info.startMs}-${info.endMs}-${info.summary}` : '';
  const setClashes = (clashes: CalendarEvent[] | null) => setFound({ key, clashes });
  useEffect(() => {
    if (!info || !wanted) return;
    let live = true;
    void api
      .query('calendar:busy', { startMs: info.startMs, endMs: info.endMs })
      .then((events) => {
        if (!live) return;
        const title = info.summary.trim().toLowerCase();
        setClashes(
          events
            .flatMap((e) => expandEvent(e, info.startMs, info.endMs))
            .filter(
              (e) =>
                !e.allDay &&
                e.transparency !== 'transparent' &&
                e.startMs < info.endMs &&
                e.endMs > info.startMs &&
                // The invite itself, once it's on the calendar.
                !(e.title.trim().toLowerCase() === title && e.startMs === info.startMs),
            )
            .sort((a, b) => a.startMs - b.startMs),
        );
      })
      .catch(() => live && setClashes(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wanted]);
  return wanted && found?.key === key ? found.clashes : null;
}

/** The assistant's one-line read: free or not, and what it clashes with. */
function clashLine(info: InviteInfo, clashes: CalendarEvent[] | null): string | null {
  if (info.kind === 'cancel') return `${first(info.organizer)} cancelled this event. Nothing to answer.`;
  if (info.past) return 'This event has already happened.';
  if (clashes === null) return info.allDay ? null : 'Checking your calendar…';
  if (!clashes.length) return 'You’re free then.';
  const c = clashes[0]!;
  const more = clashes.length > 1 ? ` and ${clashes.length - 1} more` : '';
  return `It clashes with “${c.title || 'Busy'}” (${timeFmt.format(c.startMs)} – ${timeFmt.format(c.endMs)})${more}.`;
}

type Busy = InviteResponse | 'propose' | null;

const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
};

function ProposePanel({
  info,
  onSent,
  onCancel,
  island,
}: {
  info: InviteInfo;
  onSent: (startMs: number) => void;
  onCancel: () => void;
  island: boolean;
}) {
  const duration = Math.max(15 * 60_000, info.endMs - info.startMs);
  const [slots, setSlots] = useState<{ startMs: number; endMs: number }[] | 'loading'>('loading');
  const [picked, setPicked] = useState<number | null>(null);
  const initial = toLocalInput(info.startMs);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  // Times that suit you and everyone on the invite whose calendar Google shows.
  useEffect(() => {
    let live = true;
    const people = [info.organizer, ...info.attendees].filter(
      (p): p is NonNullable<typeof p> => !!p,
    );
    void suggestGroupSlots(people, Math.round(duration / 60_000))
      .then((s) => live && setSlots(s.slots.slice(0, 3)))
      .catch(() => live && setSlots([]));
    return () => {
      live = false;
    };
  }, [info, duration]);

  const custom = () => {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    if (!y || !mo || !d || h === undefined || mi === undefined) return null;
    return new Date(y, mo - 1, d, h, mi).getTime();
  };
  const startMs = picked ?? custom();

  const send = async () => {
    if (startMs === null || Number.isNaN(startMs)) return;
    setSending(true);
    const res = await api.command('invite:propose', {
      messageId: info.messageId,
      startMs,
      endMs: startMs + duration,
      note: note.trim() || undefined,
    });
    setSending(false);
    if (!res.ok) {
      toast(res.error ?? 'Couldn’t send the proposal');
      return;
    }
    onSent(startMs);
  };

  const chip = island ? 'qr-field' : 'ai-tile';
  return (
    <div className="ai-rule mt-3 border-t pt-3">
      <p className="text-ink-muted mb-2 text-[12px]">
        {slots === 'loading'
          ? 'Finding times that suit everyone…'
          : slots.length
            ? 'Times that suit everyone:'
            : 'Pick a time to suggest:'}
      </p>
      <div className="flex flex-wrap gap-2">
        {slots === 'loading' ? (
          <Loader2 size={14} className="text-ink-faint animate-spin" />
        ) : (
          slots.map((s) => (
            <button
              key={s.startMs}
              onClick={() => setPicked(picked === s.startMs ? null : s.startMs)}
              className={cn(
                chip,
                'h-[30px] rounded-full px-3 text-[12.5px] font-medium',
                picked === s.startMs && 'border-accent! bg-accent! text-white',
              )}
            >
              {dayFmt.format(s.startMs)} · {timeFmt.format(s.startMs)}
            </button>
          ))
        )}
      </div>
      <div className={cn('mt-2.5 flex items-center gap-2 text-[12.5px]', picked !== null && 'opacity-50')}>
        <span className="text-ink-muted">Or</span>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPicked(null);
          }}
          className={cn(chip, 'h-[30px] rounded-lg px-2')}
        />
        <input
          type="time"
          value={time}
          step={900}
          onChange={(e) => {
            setTime(e.target.value);
            setPicked(null);
          }}
          className={cn(chip, 'h-[30px] rounded-lg px-2')}
        />
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void send();
        }}
        placeholder={`Note to ${first(info.organizer)} (optional)`}
        className={cn(chip, 'mt-2.5 h-[32px] w-full rounded-lg px-2.5 text-[12.5px]')}
      />
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button onClick={onCancel} className="text-ink-muted hover:text-ink px-2 text-[12.5px]">
          Cancel
        </button>
        <button
          disabled={sending || startMs === null}
          onClick={() => void send()}
          className="bg-accent flex h-[30px] items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
        >
          {sending && <Loader2 size={13} className="animate-spin" />}
          Send proposal
        </button>
      </div>
    </div>
  );
}

export function InviteCard({
  messageId,
  variant = 'reader',
  info: given,
}: {
  messageId: string;
  /** 'island' sits inside the ⌥⌘N glass (no glass-on-glass). */
  variant?: 'reader' | 'island';
  /** Already loaded by the host (skips the query). */
  info?: InviteInfo | null;
}) {
  const own = useInvite(given === undefined ? messageId : undefined);
  // An answer just given, until the host's copy catches up.
  const [answered, setAnswered] = useState<{ id: string; info: InviteInfo } | null>(null);
  const override = answered?.id === messageId ? answered.info : null;
  const setOverride = (next: InviteInfo) => setAnswered({ id: messageId, info: next });
  const info = override ?? (given === undefined ? own.info : given);
  const clashes = useClashes(info);
  const [busy, setBusy] = useState<Busy>(null);
  const [proposing, setProposing] = useState(false);
  const [proposed, setProposed] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  if (!info || info.isOrganizer) return null;
  const island = variant === 'island';
  const canAnswer = info.kind === 'request' && !info.past;
  const line = clashLine(info, clashes);

  const answer = async (response: InviteResponse) => {
    if (busy) return;
    setBusy(response);
    const res = await api.command('invite:respond', {
      messageId,
      response,
      note: note.trim() || undefined,
    });
    setBusy(null);
    if (!res.ok) {
      toast(res.error ?? 'Couldn’t answer the invite');
      return;
    }
    setNote('');
    setNoteOpen(false);
    setOverride(res.info ?? { ...info, myStatus: response });
    toast(
      response === 'accepted'
        ? `Accepted. ${first(info.organizer)} will see you’re going.`
        : response === 'declined'
          ? `Declined. ${first(info.organizer)} will see you’re not going.`
          : `Marked as maybe. ${first(info.organizer)} will see it.`,
    );
  };

  const others = info.attendees;
  const people = [
    info.organizer ? `From ${info.organizer.name || info.organizer.email}` : null,
    others.length
      ? `with ${others
          .slice(0, 2)
          .map((p) => first(p))
          .join(', ')}${others.length > 2 ? ` +${others.length - 2}` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const BUTTONS: { id: InviteResponse; label: string; icon: typeof Check }[] = [
    { id: 'accepted', label: 'Accept', icon: Check },
    { id: 'tentative', label: 'Maybe', icon: HelpCircle },
    { id: 'declined', label: 'Decline', icon: X },
  ];

  return (
    <div
      data-invite-card
      className={cn(
        'relative min-w-0 text-left',
        island ? 'qr-card rounded-[16px] p-3.5' : 'ai-glass mx-4 mb-3 rounded-[18px] p-4',
      )}
    >
      <div className="text-ink-faint flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
        {!island && <AiBadge size={14} />}
        <span className="flex-1 truncate">{info.kind === 'cancel' ? 'Cancelled invite' : 'Invite'}</span>
        {info.kind === 'request' && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-sans text-[10.5px] tracking-normal normal-case',
              info.myStatus === 'accepted' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
              info.myStatus === 'tentative' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
              info.myStatus === 'declined' && 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
              info.myStatus === 'needs-action' && 'text-ink-muted bg-ink/5',
            )}
          >
            {STATUS_LABEL[info.myStatus]}
          </span>
        )}
      </div>

      <p className={cn('mt-2 text-[14.5px] leading-snug font-semibold', info.kind === 'cancel' && 'line-through opacity-70')}>
        {info.summary || 'Invitation'}
      </p>
      <div className="text-ink-muted mt-1.5 flex flex-col gap-1 text-[12.5px]">
        <span className="flex items-center gap-1.5">
          <CalendarDays size={13} className="shrink-0" />
          <span className="truncate">{inviteWhen(info)}</span>
          {info.recurring && (
            <span className="flex shrink-0 items-center gap-1">
              · <Repeat size={11} /> repeats
            </span>
          )}
        </span>
        {info.location && (
          <span className="flex items-center gap-1.5">
            <MapPin size={13} className="shrink-0" />
            <span className="truncate">{info.location}</span>
          </span>
        )}
        {people && (
          <span className="flex items-center gap-1.5">
            <Users size={13} className="shrink-0" />
            <span className="truncate">{people}</span>
          </span>
        )}
      </div>

      {line && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[13px] leading-snug">
          {island && <span className="text-accent mt-px shrink-0">✦</span>}
          <span className={cn(clashes?.length ? 'text-ink' : 'text-ink-muted')}>{line}</span>
        </p>
      )}

      {canAnswer && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {BUTTONS.map((b) => {
              const on = info.myStatus === b.id;
              return (
                <button
                  key={b.id}
                  disabled={!!busy}
                  aria-pressed={on}
                  onClick={() => void answer(b.id)}
                  className={cn(
                    'flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors',
                    on
                      ? 'bg-accent text-white'
                      : cn(island ? 'qr-field' : 'ai-tile', 'hover:border-accent/50'),
                    busy && busy !== b.id && 'opacity-60',
                  )}
                >
                  {busy === b.id ? <Loader2 size={13} className="animate-spin" /> : <b.icon size={13} />}
                  {b.label}
                </button>
              );
            })}
            <button
              disabled={!!busy}
              onClick={() => setProposing((v) => !v)}
              className={cn(
                'flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold',
                proposing ? 'bg-accent/15 text-accent' : cn(island ? 'qr-field' : 'ai-tile', 'hover:border-accent/50'),
              )}
            >
              <CalendarClock size={13} />
              Propose new time
            </button>
            {!noteOpen && !proposing && (
              <button
                onClick={() => setNoteOpen(true)}
                className="text-ink-faint hover:text-ink ml-auto text-[11.5px]"
              >
                Add a note
              </button>
            )}
          </div>
          {noteOpen && !proposing && (
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={`Note to ${first(info.organizer)}, sent with your answer`}
              className={cn(island ? 'qr-field' : 'ai-tile', 'mt-2.5 h-[32px] w-full rounded-lg px-2.5 text-[12.5px]')}
            />
          )}
          {proposing && (
            <ProposePanel
              info={info}
              island={island}
              onCancel={() => setProposing(false)}
              onSent={(ms) => {
                setProposing(false);
                setProposed(ms);
                toast(`New time sent to ${first(info.organizer)}`);
              }}
            />
          )}
          {proposed !== null && !proposing && (
            <p className="text-ink-muted mt-2.5 text-[12px]">
              You proposed {dayFmt.format(proposed)} · {timeFmt.format(proposed)}. {first(info.organizer)} can accept
              it from their calendar.
            </p>
          )}
          <p className="text-ink-faint mt-2.5 text-[11px]">
            {info.via === 'google'
              ? `Answers on your Google Calendar event; Google lets ${first(info.organizer)} know.`
              : `Sends a calendar reply to ${first(info.organizer)}, the way Apple Mail and Outlook do.`}
          </p>
        </>
      )}
    </div>
  );
}
