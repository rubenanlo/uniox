import type { Editor } from '@tiptap/react';

/**
 * A thin handle onto the open composer's TipTap editor, so the assistant orb
 * can read the current draft (for "rewrite" / "translate") and write results
 * back into it. The Composer registers its editor on mount and clears it on
 * unmount; only one composer is ever open, so a single slot is enough.
 */
let editor: Editor | null = null;
/** The account the open composer sends from (tracks the From picker). */
let accountId: string | null = null;

export function registerComposerEditor(e: Editor | null): void {
  editor = e;
}

export function registerComposerAccount(id: string | null): void {
  accountId = id;
}

export function getComposerAccountId(): string | null {
  return accountId;
}

export function isComposerOpen(): boolean {
  return editor !== null;
}

/** Plain-text of the current draft (excludes any quoted reply block markup). */
export function getDraftText(): string {
  return editor?.getText().trim() ?? '';
}

/** Replace the draft body with plain text, preserving paragraph breaks. */
export function replaceDraftBody(text: string): void {
  editor?.commands.setContent(textToHtml(text));
  editor?.commands.focus('end');
}

/** Escape and wrap plain text into paragraph HTML for the rich-text editor. */
export function textToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
