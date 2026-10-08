import type { MessageMeta } from '@app/shared';
import { CalendarClock, Globe2, Info, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { keysFor } from '../../actions/registry';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import {
  describeWindow,
  formatSlotChip,
  formatSlotForPeople,
  offHoursNote,
  type AvailabilityAsk,
  type GroupSlot,
} from '../../lib/availability';
import { cn } from '../../lib/utils';
import {
  confirmZones,
  detectAvailabilityAsk,
  loadAvailabilityPrefs,
  messageText,
  othersOn,
  replyWithSlots,
  suggestGroupSlots,
  useAvailabilityForced,
  type GroupSuggestion,
} from '../../state/availability';
import { useZonePrompt } from '../../state/contactZones';
import { useAccounts, useDelta } from '../../state/queries';
import { Keycaps } from '../ui/Keycap';

/** What the strip explains behind its info icon. */
function InfoCard({
  anchor,
  when,
  onClose,
}: {
  anchor: DOMRect;
  when: string;
  onClose: () => void;
}) {
  useEscapeClose(true, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest?.('[data-info-toggle]')) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const width = 300;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="About suggested times"
      style={{
        position: 'fixed',
        top: anchor.bottom + 6,
        left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)),
        width,
      }}
      className="border-hairline bg-surface text-ink z-[60] rounded-xl border p-3 text-[12px] leading-relaxed shadow-lg"
    >
      <p className="mb-1.5 font-semibold">Suggested times</p>
      <p className="text-ink-muted mb-2">
        This email asks when you’re free, so Uniox picked open times in the coming week on {when}.
        Change the days and hours in Settings › Scheduling. It checks every calendar on all your
        accounts, plus the free/busy of everyone on the email when Google shows it to you (usually
        coworkers). Times also fall in their 9:00–18:00, in their own time zone; when nothing fits,
        the closest times are offered and marked. Nothing is added to your calendar.
      </p>
      <ul className="text-ink-muted space-y-1">
        <li>
          <span className="text-ink font-medium">Click</span> a time to reply that you’re available
          then.
        </li>
        <li>
          <span className="text-ink font-medium">Shift-click</span> to pick several, then press{' '}
          <Keycaps keys={['↩']} /> or “Reply with these” to offer them all.
        </li>
        <li className="flex items-center gap-1">
          <Keycaps keys={keysFor('share-availability')} /> shows times on any email, or adds them to
          a reply.
        </li>
      </ul>
    </div>,
    document.body,
  );
}

/**
 * A quiet row under the latest message when it asks for the user's
 * availability: a few open times as chips. Nothing shows until detection
 * and the calendar lookup are done, and it can be dismissed.
 */
export function AvailabilitySuggestions({ message }: { message: MessageMeta }) {
  const { accounts, loaded } = useAccounts();
  const forceCount = useAvailabilityForced((s) => s.forced.get(message.id) ?? 0);
  const forced = forceCount > 0;
  const [ask, setAsk] = useState<AvailabilityAsk | null>(null);
  const [found, setFound] = useState<GroupSuggestion | null>(null);
  const slots = found?.slots ?? null;
  const zonesVersion = useZonePrompt((s) => s.version);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Dismissing hides the row until the next ⌘⇧A on this message.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [info, setInfo] = useState<DOMRect | null>(null);
  const [replying, setReplying] = useState(false);
  const [windowText, setWindowText] = useState('');
  const rowRef = useRef<HTMLDivElement>(null);

  const fromMe =
    !!message.from &&
    accounts.some((a) => a.email.toLowerCase() === message.from!.email.toLowerCase());

  // Detect once per message (cached), unless it's the user's own mail.
  useEffect(() => {
    if (!loaded || fromMe) return;
    let live = true;
    void detectAvailabilityAsk(message).then((a) => live && setAsk(a));
    return () => {
      live = false;
    };
  }, [loaded, fromMe, message]);

  const active = forced || (!!ask?.asks && !fromMe);
  const duration = ask?.asks ? ask.durationMinutes : undefined;

  const own = new Set(accounts.map((a) => a.email.toLowerCase()));
  const people = othersOn(message, own);
  const peopleKey = people.map((p) => p.email).join();
  const senderZone = ask?.senderTimeZone ?? null;
  const compute = useCallback(
    () =>
      suggestGroupSlots(
        people,
        duration ?? 30,
        message.from && senderZone ? { [message.from.email.toLowerCase()]: senderZone } : {},
      ),
    // people is derived from message + accounts; peopleKey stands in for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peopleKey, duration, senderZone, message.from],
  );
  const load = useCallback(() => {
    if (!active) return;
    void Promise.all([compute(), loadAvailabilityPrefs()]).then(
      ([f, prefs]) => {
        setWindowText(describeWindow(prefs));
        setFound(f);
      },
      () => setFound({ slots: [], participants: [], unconfirmed: [] }),
    );
    // zonesVersion: a saved time zone changes which times fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, compute, zonesVersion]);
  useEffect(load, [load]);
  // The calendar changed under us (sync, an edit): offer fresh times.
  useDelta((e) => {
    if (e.kind === 'calendar-changed') load();
  });

  // ⌘⇧A: bring the row into view and put focus on the first time.
  useEffect(() => {
    if (!forceCount || !slots) return;
    rowRef.current?.scrollIntoView({ block: 'nearest' });
    rowRef.current?.querySelector<HTMLButtonElement>('[data-slot]')?.focus();
  }, [forceCount, slots]);

  if (!active || dismissedAt === forceCount || !found || !slots) return null;

  const askZones = async (force = false) =>
    confirmZones(found.unconfirmed, await messageText(message.id), force);
  const reply = (picked: GroupSlot[]) => {
    if (replying || !picked.length) return;
    setReplying(true);
    void (async () => {
      let use = found;
      let chosen = picked;
      // First time offering times to someone with no known zone: ask, then
      // re-check the picks against their working day.
      if (await askZones()) {
        use = await compute();
        setFound(use);
        chosen = use.slots.filter((s) => picked.some((p) => p.startMs === s.startMs));
        if (chosen.length < picked.length) {
          toast('Updated the times for everyone’s time zones. Pick again.');
          return;
        }
      }
      await replyWithSlots(message, chosen, use.participants);
    })().finally(() => {
      setReplying(false);
      setSelected(new Set());
    });
  };
  const unknownNames = found.unconfirmed.map((p) => (p.name || p.email).split(/\s+/)[0]!);
  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const pickedSlots = () => slots.filter((_, i) => selected.has(i));

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="Suggested times to reply with"
      className="border-hairline mx-4 mt-1 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed px-3 py-2"
    >
      <CalendarClock size={14} className="text-ink-muted shrink-0" aria-hidden />
      <span className="text-ink-muted mr-1 text-[12px] font-semibold">You’re free</span>
      {slots.length === 0 && (
        <span className="text-ink-faint text-[12px]">No open time on {windowText}.</span>
      )}
      {slots.map((s, i) => (
        <button
          key={s.startMs}
          data-slot
          title={[formatSlotForPeople(s, found.participants), offHoursNote(s, found.participants)]
            .filter(Boolean)
            .join(' · ')}
          aria-pressed={selected.has(i)}
          disabled={replying}
          onClick={(e) => (e.shiftKey ? toggle(i) : reply([s]))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && selected.size > 0) {
              e.preventDefault();
              reply(pickedSlots());
            } else if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              toggle(i);
            }
          }}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[12px] font-medium tabular-nums transition-colors disabled:opacity-60',
            selected.has(i)
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-hairline text-ink hover:border-accent hover:text-accent',
          )}
        >
          {formatSlotChip(s)}
          {(s.offHours.length > 0 || s.outsideMine) && (
            <span
              aria-label={offHoursNote(s, found.participants)}
              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle"
            />
          )}
        </button>
      ))}
      {selected.size > 0 && (
        <button
          onClick={() => reply(pickedSlots())}
          disabled={replying}
          className="bg-accent rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-white disabled:opacity-60"
        >
          Reply with these ({selected.size})
        </button>
      )}
      <span className="flex-1" />
      {found.unconfirmed.length > 0 && (
        <button
          onClick={() => void askZones(true)}
          title="Their calendar doesn’t show a time zone"
          className="text-ink-faint hover:text-ink flex items-center gap-1 rounded-md px-1 text-[11.5px]"
        >
          <Globe2 size={12} />
          Set time zone{unknownNames.length > 1 ? 's' : ''} for {unknownNames.join(', ')}
        </button>
      )}
      <button
        aria-label="About suggested times"
        data-info-toggle
        onClick={(e) => setInfo(info ? null : e.currentTarget.getBoundingClientRect())}
        className="text-ink-faint hover:text-ink rounded-md p-1"
      >
        <Info size={13} />
      </button>
      <button
        aria-label="Hide suggested times"
        onClick={() => setDismissedAt(forceCount)}
        className="text-ink-faint hover:text-ink rounded-md p-1"
      >
        <X size={13} />
      </button>
      {info && <InfoCard anchor={info} when={windowText} onClose={() => setInfo(null)} />}
    </div>
  );
}
