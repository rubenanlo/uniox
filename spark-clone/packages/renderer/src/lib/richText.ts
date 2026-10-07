import { sanitizeEmailHtml } from '@app/email-render';

/**
 * Event descriptions arrive either as Google's HTML or as plain text typed
 * locally. Normalize both into safe HTML the rich editor / details pane can
 * render: HTML is sanitized (descriptions are hostile input, same as mail),
 * plain text is escaped with line breaks and auto-linked URLs.
 */
export function descriptionToHtml(input: string): string {
  if (!input) return '';
  if (/<[a-z!/][\s\S]*>/i.test(input)) return sanitizeEmailHtml(input).html;
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>');
}
