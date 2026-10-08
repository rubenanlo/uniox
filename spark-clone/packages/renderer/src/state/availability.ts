import { toast } from 'sonner';
import { create } from 'zustand';
import { normalizeAvailability, type AvailabilityPrefs, type MessageMeta } from '@app/shared';
import { api } from '../lib/api';
import {
  busyIntervals,
  daysRange,
  describeWindow,
  DEFAULT_DURATION_MIN,
  findFreeSlots,
  formatSlotLong,
  looksLikeAvailabilityAsk,
  nextMeetingDays,
  parseAvailabilityAsk,
  templateReply,
  type AvailabilityAsk,
  type Slot,
} from '../lib/availability';
import { stripHtml } from '../lib/assistantContext';
import { insertDraftText } from '../lib/composerBridge';
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

/** Open times on the user's chosen days and hours, across every own calendar. */
export async function suggestSlots(durationMin: number): Promise<Slot[]> {
  const prefs = await loadAvailabilityPrefs();
  const days = nextMeetingDays(Date.now(), prefs.weekdays);
  const range = daysRange(days);
  const events = await api.query('calendar:busy', range);
  const expanded = events.flatMap((e) => expandEvent(e, range.startMs, range.endMs));
  return findFreeSlots({
    days,
    busy: busyIntervals(expanded),
    startHour: prefs.startMinutes / 60,
    endHour: prefs.endMinutes / 60,
    durationMin,
  });
}

/** Open a reply to `message` saying the user is available at `slots`. */
export async function replyWithSlots(
  message: MessageMeta,
  slots: Slot[],
  ask: AvailabilityAsk,
): Promise<void> {
  if (!slots.length) return;
  const firstName = (message.from?.name || '').split(/\s+/)[0] || undefined;
  let body = templateReply(slots, ask.senderTimeZone, firstName);
  const assistant = useAssistant.getState();
  if (assistant.configured) {
    const id = toast.loading('Drafting your reply…');
    try {
      const times = slots.map((s) => `• ${formatSlotLong(s, ask.senderTimeZone)}`).join('\n');
      const out = await assistant.complete(
        `Write a short reply to this email saying I'm available at ${
          slots.length > 1 ? 'any of these times, and asking which works best' : 'this time'
        }:\n${times}\n\nMatch the email's language, tone and formality. Copy each time exactly as ` +
          'given, keeping the times and the bracketed time zones verbatim (only translate weekday and ' +
          "month names if you reply in another language). List several times one per line with '• '. " +
          'Greet the sender by first name. Return only the body: no subject, no signature, no placeholders.',
        `The email:\n\n${await messageText(message.id)}`,
      );
      if (out.trim()) body = out.trim();
      toast.dismiss(id);
    } catch {
      toast.error('Couldn’t draft with the assistant, so a standard reply was used.', { id });
    }
  }
  useUi
    .getState()
    .openComposer({
      mode: 'reply',
      accountId: message.accountId,
      replyTo: message,
      initialBody: body,
    });
}

/**
 * ⌘⇧A: in a reply, insert open times at the cursor; in an open email,
 * show the time suggestions under its latest message.
 */
export async function shareAvailability(): Promise<void> {
  const ui = useUi.getState();
  if (ui.composer) {
    const replyTo = ui.composer.replyTo;
    const ask = replyTo ? await detections.get(replyTo.id) : undefined;
    const slots = await suggestSlots(ask?.asks ? ask.durationMinutes : DEFAULT_DURATION_MIN);
    if (!slots.length)
      return void toast(`No free time on ${describeWindow(await loadAvailabilityPrefs())}.`);
    insertDraftText(
      `I'm available at any of these times:\n${slots
        .map((s) => `• ${formatSlotLong(s, ask?.senderTimeZone)}`)
        .join('\n')}`,
    );
    return;
  }
  const threadId = ui.selectedThreadId;
  if (!threadId) return void toast('Open an email or a reply to share your availability.');
  const messages = await api.query('thread:messages', { threadId });
  const last = [...messages].reverse().find((m) => !m.draft);
  if (!last) return;
  useAvailabilityForced.getState().force(last.id);
}
