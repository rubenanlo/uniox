/**
 * Keys that live outside the action registry: handled by one surface (the
 * composer, calendar, Sprint board, card strip…) rather than dispatched
 * globally. Listed here only so the Keyboard shortcuts sheet can show them;
 * the handlers stay with their surfaces. Each entry is one row: a label and
 * one or more key combos (shown with "or" between them).
 *
 * When a surface gains a key, add its row to that surface's section here.
 * Global shortcuts belong in ACTIONS (registry.ts) instead, which the sheet,
 * Command Center and tooltips all read.
 */
export interface ContextShortcut {
  label: string;
  keys: string[][];
}

export const CONTEXT_SHORTCUTS: { section: string; rows: ContextShortcut[] }[] = [
  {
    section: 'Lists & panels',
    rows: [
      { label: 'Move between sidebar, list and email', keys: [['←'], ['→']] },
      { label: 'Step into the panel on the right', keys: [['↩']] },
      { label: 'Back out (email, search, group, view)', keys: [['Esc']] },
      { label: 'Walk messages in an open thread', keys: [['↑'], ['↓']] },
      { label: 'Select a range of emails', keys: [['⇧', 'click']] },
      { label: 'Add or remove one email', keys: [['⌘', 'click']] },
      { label: 'Clear the selection', keys: [['Esc']] },
      { label: 'Switch between Commands and Go to', keys: [['⌘', 'K'], ['⌘', 'L']] },
    ],
  },
  {
    section: 'New senders',
    rows: [
      { label: 'Step up into the cards (from the first email)', keys: [['↑']] },
      { label: 'Accept ⇄ Block, then next / previous card', keys: [['←'], ['→']] },
      { label: 'Accept or block the focused sender', keys: [['↩']] },
      { label: 'Back to the list', keys: [['↓']] },
    ],
  },
  {
    section: 'Search',
    rows: [
      { label: 'Run the search', keys: [['↩']] },
      { label: 'Walk recent searches', keys: [['↑'], ['↓']] },
      { label: 'Jump into the results', keys: [['↓']] },
      { label: 'Clear and close', keys: [['Esc']] },
    ],
  },
  {
    section: 'Composer',
    rows: [
      { label: 'Send', keys: [['⌘', '↩']] },
      { label: 'Close (asks before discarding)', keys: [['Esc']] },
      { label: 'Insert link', keys: [['⇧', '⌘', 'K']] },
      { label: 'Bold / Italic / Underline', keys: [['⌘', 'B'], ['⌘', 'I'], ['⌘', 'U']] },
      { label: 'Go to To / Cc / Bcc', keys: [['⌘', '1'], ['⌘', '2'], ['⌘', '3']] },
      { label: 'Go to Subject / Body / From', keys: [['⌘', '4'], ['⌘', '5'], ['⌘', '6']] },
    ],
  },
  {
    section: 'Calendar',
    rows: [
      { label: 'Go to today', keys: [['T']] },
      { label: 'New event', keys: [['C']] },
      { label: 'New event on the focused day', keys: [['↩']] },
      { label: 'Month / Week / Day', keys: [['M'], ['W'], ['D']] },
      { label: 'Previous / next day (pages weeks)', keys: [['←'], ['→']] },
      { label: 'Week up / down, or scroll hours', keys: [['↑'], ['↓']] },
      { label: 'Open the event Account menu', keys: [['⌥', '↓']] },
      { label: 'Calendar sidebar', keys: [['⌘', '\\']] },
      { label: 'Side panel', keys: [['⌘', '/']] },
      { label: 'Mail sidebar', keys: [['/']] },
      { label: 'Close the panel, then back to mail', keys: [['Esc']] },
    ],
  },
  {
    section: 'Sprint board',
    rows: [
      { label: 'Move between cards', keys: [['←', '→', '↑', '↓']] },
      { label: 'Open the card', keys: [['↩']] },
      { label: 'Close the card, then leave the board', keys: [['Esc']] },
    ],
  },
  {
    section: 'Assistant',
    rows: [
      { label: 'Send', keys: [['↩']] },
      { label: 'New line', keys: [['⇧', '↩']] },
      { label: 'Close', keys: [['Esc']] },
    ],
  },
];
