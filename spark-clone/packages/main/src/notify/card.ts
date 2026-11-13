/**
 * The notification card as the overlay draws it. Built in main from a notify
 * delta (plus account colours from the renderer), rendered by the overlay
 * preload. Plain data only: this file is shared by the node and DOM builds.
 */
/** 'inbox' = the "N more" pill: open the app on the inbox. */
export type CardAction = 'open' | 'inbox' | 'reply' | 'archive' | 'read' | 'later' | 'join' | 'snooze' | 'dismiss';

/** Chip colour: Smart Inbox people, priority sender (amber), meeting, everything else. */
export type CardTone = 'people' | 'priority' | 'meeting' | 'quiet';

export interface NotifyCard {
  id: string;
  /** Cards with the same key replace each other (a meeting's lead → start alert). */
  key: string;
  kind: 'mail' | 'event';
  /** Mail: sender. Event: meeting title. */
  title: string;
  /** Mail: subject. */
  line?: string;
  snippet?: string;
  /** "People", "Priority", "Meeting"… */
  chip: string;
  tone: CardTone;
  /** Account (mail) or "Calendar", next to the chip. */
  source: string;
  /** Header right-hand side: "now" (mail), the start time (meetings). */
  when: string;
  /** Meetings: start time, place, and the lead window the countdown bar drains over. */
  startsAt?: number;
  where?: string;
  leadMs?: number;
  actions: CardAction[];
  /** ms on screen; 0 = stays until dismissed. */
  ttl: number;
}

export type OverlayToMain =
  | { kind: 'action'; id: string; action: CardAction }
  /** Pointer over a card: the window must take clicks (it ignores them otherwise). */
  | { kind: 'interactive'; on: boolean }
  /**
   * Every card has left; main hides the window. `shown` counts the cards the
   * overlay has received, so main can drop a stale report that crossed a new card.
   */
  | { kind: 'empty'; shown: number };

export type MainToOverlay =
  | { kind: 'show'; card: NotifyCard }
  | { kind: 'remove'; id: string }
  | { kind: 'theme'; dark: boolean };
