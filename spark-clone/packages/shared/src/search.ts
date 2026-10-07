/**
 * Spark-style search syntax, shared by the query layer and the renderer.
 *
 * from:/subject: map onto FTS5 columns, to:/has:attachment become SQL
 * predicates, and everything else is a ranked prefix term. It lives in shared
 * because the list also needs to know which sender the user asked for, so a
 * `from:` hit can be labelled with the matching correspondent instead of the
 * thread's most recent one.
 */
export interface ParsedSearch {
  /** FTS5 match expression, or null when only filters were given. */
  fts: string | null;
  /** Substring filter over recipients (the To field isn't FTS-indexed). */
  toLike: string | null;
  hasAttachment: boolean;
  /** Lowercased values of every from: operator, for result labelling. */
  fromTerms: string[];
  /** Nothing to search on at all. */
  isEmpty: boolean;
}

const OPERATOR = /^(from|to|subject|has):(.*)$/i;

/** Quote a term so raw input can't break the FTS5 grammar; prefix-match it. */
function esc(term: string): string {
  return `"${term.replace(/"/g, '')}"*`;
}

export function parseSearchQuery(raw: string): ParsedSearch {
  const empty: ParsedSearch = {
    fts: null,
    toLike: null,
    hasAttachment: false,
    fromTerms: [],
    isEmpty: true,
  };
  const cleaned = raw.trim();
  if (!cleaned) return empty;

  const ftsTerms: string[] = [];
  const fromTerms: string[] = [];
  let toLike: string | null = null;
  let hasAttachment = false;
  // A bare operator ("from:") applies to the next bare token, so the From chip
  // followed by a space behaves the same as typing from:name directly.
  let pendingOp: string | null = null;

  const apply = (op: string, value: string): void => {
    const val = value.trim();
    if (!val) return;
    switch (op) {
      case 'from':
        ftsTerms.push(`from_text:${esc(val)}`);
        fromTerms.push(val.toLowerCase());
        break;
      case 'subject':
        ftsTerms.push(`subject:${esc(val)}`);
        break;
      case 'to':
        toLike = val.toLowerCase();
        break;
      case 'has':
        if (val.toLowerCase().startsWith('attach')) hasAttachment = true;
        break;
    }
  };

  for (const token of cleaned.split(/\s+/)) {
    const m = OPERATOR.exec(token);
    if (m) {
      const op = m[1]!.toLowerCase();
      const val = m[2]!.trim();
      if (val) {
        pendingOp = null;
        apply(op, val);
      } else {
        pendingOp = op; // value comes in the next token
      }
      continue;
    }
    if (pendingOp) {
      apply(pendingOp, token);
      pendingOp = null;
      continue;
    }
    ftsTerms.push(esc(token));
  }

  const fts = ftsTerms.length ? ftsTerms.join(' ') : null;
  return {
    fts,
    toLike,
    hasAttachment,
    fromTerms,
    isEmpty: !fts && !toLike && !hasAttachment,
  };
}
