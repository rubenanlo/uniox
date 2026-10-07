import { randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

/** Collapse whitespace and trim to a list-row snippet. */
export function makeSnippet(text: string | null | undefined, max = 140): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Strip Re:/Fwd: chains for display/fallback grouping. */
export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return '';
  let s = subject.trim();
  const prefix = /^(re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*/i;
  while (prefix.test(s)) s = s.replace(prefix, '');
  return s.trim();
}

/**
 * The message-id chain a new message may attach to: References first
 * (oldest→newest), then In-Reply-To, then its own id (so replies to it
 * can find the thread later).
 */
export function threadReferenceIds(opts: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | string | null;
}): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const t = v?.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const refs = opts.references;
  if (Array.isArray(refs)) refs.forEach(push);
  else if (typeof refs === 'string') refs.split(/\s+/).forEach(push);
  push(opts.inReplyTo);
  return out;
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
