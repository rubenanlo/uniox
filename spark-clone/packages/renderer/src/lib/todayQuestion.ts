// Pure (no window.api) so it can be unit tested.
const CALENDAR_WORDS =
  /\b(events?|meetings?|calls?|calendar|schedule|agenda|appointments?|busy|free time|plans?)\b/i;
const TODAY_WORDS =
  /\b(today|todays|today's|this (morning|afternoon|evening)|tonight|next|left|rest of (the|my) day)\b/i;

/** A typed question about today's calendar, answered with the timeline card. */
export function asksAboutToday(text: string): boolean {
  return CALENDAR_WORDS.test(text) && (TODAY_WORDS.test(text) || /\bon my calendar\b/i.test(text));
}
