import { toast } from 'sonner';
import { create } from 'zustand';
import {
  normalizeAvailability,
  type Address,
  type AvailabilityPrefs,
  type MessageMeta,
  type PersonFreeBusy,
} from '@app/shared';
import { api } from '../lib/api';
import {
  addLocalDays,
  busyIntervals,
  daysRange,
  describeWindow,
  DEFAULT_DURATION_MIN,
  findGroupSlots,
  formatSlotForPeople,
  looksLikeAvailabilityAsk,
  nextMeetingDays,
  offHoursNote,
  parseAvailabilityAsk,
  parseZoneGuesses,
  templateGroupReply,
  timesBlock,
  type AvailabilityAsk,
  type GroupSlot,
  type Participant,
  type Slot,
} from '../lib/availability';
import { stripHtml } from '../lib/assistantContext';
import { getComposerRecipients, replaceDraftParagraph } from '../lib/composerBridge';
import { askForZones, loadContactZones, myZone, type ZoneQuestion } from './contactZones';
import { expandEvent } from '../lib/rrule';
import { useAssistant } from './assistant';
import { useUi } from './store';

/**
 * Messages the user asked (⌘⇧A) to show times for, even though detection
 * didn't flag them.
 */
export const useAvailabilityForced = create<{
  /** messageId → how many times it was forced (a new value re-shows a dismissed row). */
  forced: Map<string, number>;
  force(messageId: string): void;
}>((set) => ({
  forced: new Map(),
  force: (id) => set((s) => ({ forced: new Map(s.forced).set(id, (s.forced.get(id) ?? 0) + 1) })),
}));

/**
 * The times block ⌘⇧A last wrote into the open draft, so the hover bar can
 * review time zones or reopen the calendar and rewrite the block in place.
 */
export const useComposerTimes = create<{
  header: string;
  picks: Slot[];
  found: GroupSuggestion;
} | null>(() => null);

/** Rewrite the draft's times block with `picks` (empty removes it). */
export function setComposerPicks(picks: Slot[]): void {
  const cur = useComposerTimes.getState();
  if (!cur) return;
  replaceDraftParagraph(
    cur.header,
    picks.length ? timesBlock(cur.header, picks, cur.found.participants) : null,
  );
  useComposerTimes.setState(picks.length ? { ...cur, picks } : null, true);
}

/**
 * 🌐 on the draft's times: review everyone's zone, then rewrite the block
 * with the new local times (the picks stay).
 */
export async function reviewComposerZones(): Promise<void> {
  const cur = useComposerTimes.getState();
  if (!cur) return;
  if (!(await confirmZones(cur.found.participants))) return;
  const people = cur.found.participants.map((p) => ({ email: p.email, name: p.name }));
  const found = await suggestGroupSlots(people, cur.found.grid.durationMin);
  useComposerTimes.setState({ ...cur, found }, true);
  setComposerPicks(cur.picks);
}

/**
 * ⌘⇧A in the composer while it looks up calendars: drives the "Checking
 * availability" overlay, and `cancel` (Esc) drops the result.
 */
export const useAvailabilityCheck = create<{
  checking: boolean;
  cancel: (() => void) | null;
}>(() => ({ checking: false, cancel: null }));

/** Esc while checking: cancel and report true so the key does nothing else. */
export function cancelAvailabilityCheck(): boolean {
  const { cancel } = useAvailabilityCheck.getState();
  if (!cancel) return false;
  cancel();
  return true;
}

/** Plain text of a message body (empty while it's still downloading). */
export async function messageText(messageId: string): Promise<string> {
  const body = await api.query('message:body', { messageId });
  return (body?.text?.trim() || (body?.html ? stripHtml(body.html) : '')).slice(0, 6000);
}

const NOT_ASKED: AvailabilityAsk = {
  asks: false,
  durationMinutes: DEFAULT_DURATION_MIN,
  senderTimeZone: null,
};

/** One detection per message per session: opening an email twice costs nothing. */
const detections = new Map<string, Promise<AvailabilityAsk>>();

/**
 * Does this message ask for the user's availability? The keyword pre-filter
 * runs first so most mail never reaches the model; a positive goes to the
 * model to confirm and to read the meeting length and the sender's zone.
 * Without an API key, a pre-filter hit alone counts.
 */
export function detectAvailabilityAsk(message: MessageMeta): Promise<AvailabilityAsk> {
  const cached = detections.get(message.id);
  if (cached) return cached;
  const run = (async (): Promise<AvailabilityAsk> => {
    const text = await messageText(message.id);
    if (!text) {
      detections.delete(message.id); // body not downloaded yet; retry on next render
      return NOT_ASKED;
    }
    if (!looksLikeAvailabilityAsk(`${message.subject}\n${text}`)) return NOT_ASKED;
    if (!useAssistant.getState().configured) return { ...NOT_ASKED, asks: true };
    try {
      const raw = await useAssistant
        .getState()
        .complete(
          'Does this email ask me (the recipient) for my availability, or ask me to propose or ' +
            'agree on a time to meet or talk? Reply with JSON only, no prose: ' +
            '{"asks": boolean, "durationMinutes": number | null, "senderTimeZone": string | null}. ' +
            'durationMinutes: the meeting length the email asks for, else null. senderTimeZone: an ' +
            "IANA zone (e.g. America/New_York) only when the email states or clearly implies the sender's " +
            'time zone or city, else null.',
          `Email from ${message.from?.name || message.from?.email || 'unknown'}, sent ${new Date(
            message.date,
          ).toISOString()}, subject "${message.subject}":\n\n${text}`,
        );
      return parseAvailabilityAsk(raw);
    } catch {
      detections.delete(message.id);
      return NOT_ASKED;
    }
  })();
  detections.set(message.id, run);
  return run;
}

/** The user's suggested-time window (Settings › Scheduling). */
export async function loadAvailabilityPrefs(): Promise<AvailabilityPrefs> {
  return normalizeAvailability(await api.query('settings:get', { key: 'availability' }));
}

/** Times to offer, and who they were checked against. */
export interface GroupSuggestion {
  slots: GroupSlot[];
  participants: Participant[];
  /** People whose zone neither Google nor the user has confirmed. */
  unconfirmed: Participant[];
  /** What the calendar picker draws. */
  grid: AvailabilityGrid;
}

/** How far ahead the calendar picker reaches. */
export const CALENDAR_DAYS = 21;

export interface AvailabilityGrid {
  /** Local midnights of every day the picker can scroll through. */
  days: number[];
  /** The Settings weekdays among them (this week and next), shown first. */
  chosenDays: number[];
  /** The user's busy time across own calendars. */
  myBusy: Slot[];
  startHour: number;
  endHour: number;
  /** Meeting length a single click picks. */
  durationMin: number;
}

/**
 * Open times on the user's chosen days and hours, across every own calendar
 * and, for each other person, their Google free/busy when visible. Zones
 * come from their calendar, else what the user saved, else `hints` (read
 * from the thread, unconfirmed).
 */
export async function suggestGroupSlots(
  people: Address[],
  durationMin: number,
  hints: Record<string, string | null> = {},
): Promise<GroupSuggestion> {
  const prefs = await loadAvailabilityPrefs();
  const days = nextMeetingDays(Date.now(), prefs.weekdays);
  // Same weekdays a week later, used only when the coming days don't fit everyone.
  const laterDays = days.map((d) => addLocalDays(d, 7));
  // The calendar picker scrolls through every day of the next three weeks.
  const firstDay = addLocalDays(new Date(new Date().setHours(0, 0, 0, 0)).getTime(), 1);
  const calendarDays = Array.from({ length: CALENDAR_DAYS }, (_, i) => addLocalDays(firstDay, i));
  const range = daysRange([...calendarDays, ...days, ...laterDays].sort((a, b) => a - b));
  const emails = people.map((p) => p.email.toLowerCase());
  const [events, freeBusy, saved] = await Promise.all([
    api.query('calendar:busy', range),
    emails.length
      ? api
          .query('calendar:freebusy', { emails, ...range })
          .catch((): Record<string, PersonFreeBusy> => ({}))
      : Promise.resolve<Record<string, PersonFreeBusy>>({}),
    loadContactZones(),
  ]);
  const fb = freeBusy;
  const unconfirmed: Participant[] = [];
  const participants = people.map((p): Participant => {
    const email = p.email.toLowerCase();
    const google = fb[email]?.timeZone ?? null;
    const hint = hints[email] ?? null;
    const [timeZone, zoneSource] = saved[email]
      ? [saved[email]!, 'saved' as const]
      : google
        ? [google, 'google' as const]
        : hint
          ? [hint, 'thread' as const]
          : [null, undefined];
    const participant = {
      email,
      name: p.name,
      timeZone,
      zoneSource,
      busy: fb[email]?.busy ?? null,
    };
    // Every new person is confirmed once, even when Google shows a zone:
    // calendars often carry the company default rather than where they are.
    if (zoneSource !== 'saved') unconfirmed.push(participant);
    return participant;
  });
  const expanded = events.flatMap((e) => expandEvent(e, range.startMs, range.endMs));
  const grid: AvailabilityGrid = {
    days: calendarDays,
    chosenDays: [...days, ...laterDays],
    myBusy: busyIntervals(expanded),
    startHour: prefs.startMinutes / 60,
    endHour: prefs.endMinutes / 60,
    durationMin,
  };
  const slots = findGroupSlots({
    days,
    busy: grid.myBusy,
    startHour: grid.startHour,
    endHour: grid.endHour,
    durationMin,
    participants,
    laterDays,
  });
  return { slots, participants, unconfirmed, grid };
}

/** Everyone on a message except the user's own addresses. */
export function othersOn(message: MessageMeta, ownEmails: Set<string>): Address[] {
  const seen = new Set<string>();
  return [message.from, ...message.to, ...message.cc].filter((a): a is Address => {
    const e = a?.email.toLowerCase();
    if (!e || ownEmails.has(e) || seen.has(e)) return false;
    seen.add(e);
    return true;
  });
}

async function ownEmails(): Promise<Set<string>> {
  const accounts = await api.query('accounts:list', undefined);
  return new Set(accounts.map((a) => a.email.toLowerCase()));
}

/** The assistant's best guess at each person's zone from the thread, if any. */
async function guessZones(people: Participant[], text: string): Promise<Record<string, string>> {
  const assistant = useAssistant.getState();
  if (!assistant.configured || !text || !people.length) return {};
  try {
    const raw = await assistant.complete(
      'For each person below, guess their IANA time zone from this email thread (signatures, ' +
        'cities, offices, phone prefixes, times they mention, their email domain). Reply with JSON ' +
        'only, mapping each email to a zone or null when there is no real clue: {"a@b.com": ' +
        '"Europe/Madrid"}.\n\nPeople:\n' +
        people.map((p) => `${p.name ? `${p.name} ` : ''}<${p.email}>`).join('\n'),
      text,
    );
    return parseZoneGuesses(raw);
  } catch {
    return {};
  }
}

/**
 * Ask the user, once, for the zones nobody has confirmed. Resolves true when
 * they saved answers (the caller should recompute), false when skipped.
 */
export async function confirmZones(
  people: Participant[],
  threadText = '',
  /** Called once the guesses are in, right before the dialog opens; false aborts. */
  beforeAsk: () => boolean = () => true,
): Promise<boolean> {
  if (!people.length) return false;
  const guesses = await guessZones(
    people.filter((p) => !p.timeZone),
    threadText,
  );
  if (!beforeAsk()) return false;
  const answers = await askForZones(
    people.map((p): ZoneQuestion => {
      if (p.timeZone && p.zoneSource) {
        return { email: p.email, name: p.name, guess: p.timeZone, source: p.zoneSource };
      }
      const guess = guesses[p.email];
      return guess
        ? { email: p.email, name: p.name, guess, source: 'assistant' }
        : { email: p.email, name: p.name, guess: myZone(), source: 'yours' };
    }),
  );
  return !!answers && Object.keys(answers).length > 0;
}

/** A one-line heads-up when some offered times stretch someone's day. */
export function stretchNote(s: GroupSuggestion): string {
  const notes = s.slots.map((slot) => offHoursNote(slot)).filter(Boolean);
  return notes.length
    ? `Your hours didn’t fit everyone’s 9:00–18:00, so some times are ${notes[0]}.`
    : '';
}

/** Open a reply to `message` saying the user is available at `slots`. */
export async function replyWithSlots(
  message: MessageMeta,
  slots: Slot[],
  participants: Participant[],
): Promise<void> {
  if (!slots.length) return;
  const only = participants.length === 1 ? participants[0] : undefined;
  const greeting = only ? (only.name || '').split(/\s+/)[0] || undefined : undefined;
  const lines = slots.map((s) => `• ${formatSlotForPeople(s, participants)}`);
  let body = templateGroupReply(slots, participants, greeting);
  const assistant = useAssistant.getState();
  if (assistant.configured) {
    const id = toast.loading('Drafting your reply…');
    try {
      const out = await assistant.complete(
        `Write a short reply to this email saying I'm available at ${
          slots.length > 1 ? 'any of these times, and asking which works best' : 'this time'
        }:\n${lines.join('\n')}\n\nMatch the email's language, tone and formality. Copy each time ` +
          'exactly as given, keeping the times, the bracketed time zones and the names after ' +
          "other people's local times verbatim (only translate weekday and month names if you " +
          "reply in another language). List several times one per line with '• '. Greet the " +
          'sender by first name, or everyone if several people are on the thread. Return only ' +
          'the body: no subject, no signature, no placeholders.',
        `The email:\n\n${await messageText(message.id)}`,
      );
      if (out.trim()) body = out.trim();
      toast.dismiss(id);
    } catch {
      toast.error('Couldn’t draft with the assistant, so a standard reply was used.', { id });
    }
  }
  const recipients = participants.length > 1 ? 'reply-all' : 'reply';
  useUi.getState().openComposer({
    mode: recipients,
    accountId: message.accountId,
    replyTo: message,
    initialBody: body,
  });
}

/**
 * ⌘⇧A: in a draft, insert times that suit everyone in To (asking for any
 * unknown time zone first); in an open email, show the time suggestions
 * under its latest message.
 */
export async function shareAvailability(): Promise<void> {
  const ui = useUi.getState();
  if (ui.composer) {
    if (useAvailabilityCheck.getState().checking) return;
    let cancelled = false;
    const checking = (on: boolean) =>
      useAvailabilityCheck.setState({
        checking: on,
        cancel: on
          ? () => {
              cancelled = true;
              checking(false);
            }
          : null,
      });
    checking(true);
    try {
      const replyTo = ui.composer.replyTo;
      const ask = replyTo ? await detections.get(replyTo.id) : undefined;
      const own = await ownEmails();
      const people = getComposerRecipients().filter((p) => !own.has(p.email.toLowerCase()));
      const duration = ask?.asks ? ask.durationMinutes : DEFAULT_DURATION_MIN;
      const hints: Record<string, string | null> =
        replyTo?.from && ask?.senderTimeZone
          ? { [replyTo.from.email.toLowerCase()]: ask.senderTimeZone }
          : {};
      let found = await suggestGroupSlots(people, duration, hints);
      if (cancelled) return;
      const threadText = replyTo ? await messageText(replyTo.id) : '';
      // The time zone dialog takes over from the animation while it's open.
      const saved = await confirmZones(found.unconfirmed, threadText, () => {
        if (cancelled) return false;
        checking(false);
        return true;
      });
      if (cancelled) return;
      if (saved) {
        checking(true);
        found = await suggestGroupSlots(people, duration, hints);
        if (cancelled) return;
      }
      if (!found.slots.length) {
        return void toast(
          people.length
            ? `No time in the next two weeks fits both your hours and everyone’s 9:00–18:00.`
            : `No free time on ${describeWindow(await loadAvailabilityPrefs())}.`,
        );
      }
      const header = people.length
        ? 'These times work for me:'
        : "I'm available at any of these times:";
      // A second ⌘⇧A replaces the earlier block rather than adding another.
      replaceDraftParagraph(header, timesBlock(header, found.slots, found.participants));
      useComposerTimes.setState({ header, picks: found.slots, found }, true);
      const note = stretchNote(found);
      if (note) toast(note);
    } finally {
      if (!cancelled) checking(false);
    }
    return;
  }
  const threadId = ui.selectedThreadId;
  if (!threadId) return void toast('Open an email or a reply to share your availability.');
  const messages = await api.query('thread:messages', { threadId });
  const last = [...messages].reverse().find((m) => !m.draft);
  if (!last) return;
  useAvailabilityForced.getState().force(last.id);
}
