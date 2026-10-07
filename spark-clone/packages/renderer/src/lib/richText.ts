import { escapeAndLinkify, sanitizeRichText } from '@app/email-render';

/**
 * Event descriptions arrive either as Google's HTML or as plain text typed
 * locally. Normalize both into safe HTML the rich editor / details pane can
 * render: HTML is sanitized (descriptions are hostile input, same as mail),
 * plain text is escaped with line breaks and auto-linked URLs.
 */
export function descriptionToHtml(input: string): string {
  if (!input) return '';
  // Rendered into the app window itself (no iframe/CSP), so HTML gets the
  // strict rich-text profile rather than the email one.
  if (/<[a-z!/][\s\S]*>/i.test(input)) return sanitizeRichText(input);
  return escapeAndLinkify(input).replace(/\n/g, '<br>');
}
