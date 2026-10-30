import type { MessageMeta } from './models';
import type { OutgoingAttachment } from './tasks';

/** What a composer opens with: the mode, account, and any prefilled fields. */
export interface ComposerState {
  mode: 'new' | 'reply' | 'reply-all' | 'forward' | 'edit-draft';
  accountId: string;
  replyTo?: MessageMeta;
  /** The stored draft being edited; sending it replaces the draft. */
  draftMessage?: MessageMeta;
  quotedHtml?: string;
  subject?: string;
  to?: { name?: string; email: string }[];
  /** New messages only (e.g. from a mailto: link). */
  cc?: { name?: string; email: string }[];
  bcc?: { name?: string; email: string }[];
  /** Plain-text body drafted by the assistant, seeded into the editor on open. */
  initialBody?: string;
  /** A half-written draft carried over from another composer (pop-out). */
  restore?: ComposerRestore;
}

/** The composer's fields exactly as typed, so a popped-out draft picks up where it was. */
export interface ComposerRestore {
  to: string;
  cc: string;
  bcc: string;
  showCcBcc: boolean;
  subject: string;
  bodyHtml: string;
  quotedHtml: string;
  signatureRemoved: boolean;
  attachments: OutgoingAttachment[];
}

/** A composer moved into its own window, with the look of the window it came from. */
export interface ComposerWindowState {
  state: ComposerState;
  theme: 'system' | 'light' | 'dark';
  accentColor: string | null;
}
