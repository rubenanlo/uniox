/** Languages offered by "Translate into…"; anything else can be typed. */
export const LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Catalan',
  'Dutch',
  'Swedish',
  'Danish',
  'Norwegian',
  'Polish',
  'Czech',
  'Greek',
  'Turkish',
  'Russian',
  'Ukrainian',
  'Arabic',
  'Hebrew',
  'Hindi',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Japanese',
  'Korean',
  'Indonesian',
  'Vietnamese',
  'Thai',
] as const;

/**
 * Rows for the picker: recent picks first, then the catalog, filtered by a
 * case-insensitive prefix-of-any-word match. A typed name that matches no row
 * exactly is offered as the last row, so any language can be used while ↵
 * still picks the best catalog match.
 */
export function languageOptions(query: string, recent: string[] = []): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const ordered = [...recent, ...LANGUAGES].filter((l) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!q) return ordered;
  const matches = ordered.filter((l) =>
    l
      .toLowerCase()
      .split(/[\s()]+/)
      .some((w) => w.startsWith(q)) || l.toLowerCase().startsWith(q),
  );
  const exact = matches.some((l) => l.toLowerCase() === q);
  return exact ? matches : [...matches, titleCase(query.trim())];
}

function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
