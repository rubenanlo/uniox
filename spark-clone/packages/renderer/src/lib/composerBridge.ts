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

let recipients: { name?: string; email: string }[] = [];

/** The open composer's To field, parsed (tracks edits). */
export function registerComposerRecipients(list: { name?: string; email: string }[]): void {
  recipients = list;
}

export function getComposerRecipients(): { name?: string; email: string }[] {
  return recipients;
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

/** Insert plain text at the cursor (keeps the rest of the draft). */
export function insertDraftText(text: string): void {
  editor?.chain().focus().insertContent(textToHtml(text)).run();
}

/** The draft paragraph whose text starts with `prefix` (e.g. a times block), if any. */
export function findDraftParagraph(
  prefix: string,
): { from: number; to: number; dom: HTMLElement | null } | null {
  if (!editor) return null;
  let found: { from: number; to: number; dom: HTMLElement | null } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'paragraph' && node.textContent.startsWith(prefix)) {
      found = {
        from: pos,
        to: pos + node.nodeSize,
        dom: editor!.view.nodeDOM(pos) as HTMLElement | null,
      };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Replace the paragraph starting with `prefix` by `text` (plain, newlines
 * become line breaks); null removes it. Adds at the cursor when it's gone.
 */
export function replaceDraftParagraph(prefix: string, text: string | null): void {
  if (!editor) return;
  const at = findDraftParagraph(prefix);
  if (!at) {
    if (text) insertDraftText(text);
    return;
  }
  if (text) editor.chain().insertContentAt({ from: at.from, to: at.to }, textToHtml(text)).run();
  else editor.chain().deleteRange({ from: at.from, to: at.to }).run();
}

/** Escape and wrap plain text into paragraph HTML for the rich-text editor. */
export function textToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
