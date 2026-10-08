import {
  Briefcase,
  CalendarDays,
  Coffee,
  Fingerprint,
  Inbox,
  KanbanSquare,
  Languages,
  PenLine,
  Reply,
  ScrollText,
  Wand2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ACTIONS } from '../../actions/registry';
import type { AssistantAction } from '../../lib/assistantContext';

export interface OrbAction {
  label: string;
  icon: LucideIcon;
  /** An AI action (routed through the assistant) … */
  action?: AssistantAction;
  /** … or a plain handler (e.g. open the composer). */
  run?: () => void;
  /** Ask for a target language first ("Translate into…"). */
  pickLanguage?: boolean;
}

const HOME_ACTIONS: OrbAction[] = [
  { label: 'Summarize new emails', icon: Inbox, action: 'summarize-emails' },
  { label: 'Summarize new tasks', icon: KanbanSquare, action: 'summarize-tasks' },
  { label: 'Show me the events for today', icon: CalendarDays, action: 'today-events' },
];

const MAIL_ACTIONS: OrbAction[] = [
  {
    label: 'Write an email',
    icon: PenLine,
    run: () => ACTIONS.find((a) => a.id === 'compose')?.perform(null),
  },
];

const COMPOSER_ACTIONS: OrbAction[] = [
  { label: 'Rewrite the email to make it flow', icon: Wand2, action: 'rewrite-composer' },
  { label: 'Rewrite in my style', icon: Fingerprint, action: 'style-composer' },
  { label: 'Turn this email formal', icon: Briefcase, action: 'formal-composer' },
  { label: 'Turn this email informal', icon: Coffee, action: 'informal-composer' },
  { label: 'Translate into…', icon: Languages, action: 'translate-composer', pickLanguage: true },
];

/** Offered while an email is open in the reading pane. */
const READING_ACTIONS: OrbAction[] = [
  { label: 'Translate into English', icon: Languages, action: 'translate-thread' },
  { label: 'Make a summary', icon: ScrollText, action: 'summarize-thread' },
  { label: 'Create a reply', icon: Reply, action: 'reply-thread' },
];

/**
 * The assistant's suggested actions for what's on screen: the open composer,
 * Home, an email in the reading pane, or the mail list. Shared by the corner
 * orb's hover menu and the ⌘I palette.
 */
export function orbActionsFor(
  view: string,
  composerOpen: boolean,
  selectedThreadId: string | null,
): OrbAction[] {
  if (composerOpen) return COMPOSER_ACTIONS;
  if (view === 'home') return HOME_ACTIONS;
  const reading = !!selectedThreadId && !selectedThreadId.startsWith('bundle:');
  return reading ? READING_ACTIONS : MAIL_ACTIONS;
}
