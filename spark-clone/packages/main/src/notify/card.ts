/**
 * The notification card as the overlay draws it. Built in main from a notify
 * delta (plus account colours from the renderer), rendered by the overlay
 * preload. Plain data only: this file is shared by the node and DOM builds.
 */
/** 'inbox' = the "N more" pill: open the app on the inbox. */
export type CardAction = 'open' | 'inbox' | 'reply' | 'archive' | 'read' | 'later' | 'join' | 'snooze' | 'dismiss';

export interface NotifyCard {
  id: string;
  /** Cards with the same key replace each other (a meeting's lead → start alert). */
  key: string;
  kind: 'mail' | 'event';
  title: string;
  /** Mail: subject. Event: time range · place. */
  line: string;
  snippet?: string;
  /** Header: "Work", "Calendar"… with its colour dot. */
  source: string;
  sourceColor: string;
  /** Header right-hand side: "now", "in 10 min". */
  when: string;
  /** Avatar initials + hue (mail), or the calendar date tile (event). */
  initials?: string;
  hue?: number;
  month?: string;
  day?: string;
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
