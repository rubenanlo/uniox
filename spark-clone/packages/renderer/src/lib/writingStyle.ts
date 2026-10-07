import { api } from './api';

/**
 * "Rewrite in my style": a per-account style profile learned from the user's
 * own sent mail. Claude distills recent sent bodies (quotes and signatures
 * stripped) into a short style guide plus a few short excerpts; both are
 * cached in the sync DB settings and reused for every rewrite until stale.
 */
export interface StyleProfile {
  /** Claude's style guide, a short bullet list. */
  guide: string;
  /** A few short, verbatim excerpts used as examples at rewrite time. */
  examples: string[];
  sampleCount: number;
  builtAt: number;
}

const KEY = (accountId: string) => `writing-style:${accountId}`;
const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_SAMPLES = 3;
const MAX_SAMPLES = 25;
const MAX_SAMPLE_CHARS = 1200;

/** Lines that open a quoted reply/forward in common clients and languages. */
const QUOTE_HEADER =
  /^(on\b.*\bwrote:|el\b.*\bescribi[oó]:|le\b.*\ba [ée]crit ?:|am\b.*\bschrieb.*:|il\b.*\bha scritto:|em\b.*\bescreveu:|-{2,}\s*original message\s*-{2,}|-{2,}\s*forwarded message\s*-{2,}|_{10,}|from:\s.*)$/i;

/**
 * The part of a sent body the user actually wrote: everything above the first
 * quote header or signature delimiter, minus `>`-quoted lines.
 */
export function ownText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '--' || line === '-- ') break;
    // "On Mon, 5 Oct … <a@b.c>" often wraps before "wrote:".
    const joined = `${line} ${lines[i + 1]?.trim() ?? ''}`.trim();
    if (QUOTE_HEADER.test(line) || (/^on\b/i.test(line) && /\bwrote:$/i.test(joined))) break;
    if (line.startsWith('>')) continue;
    out.push(lines[i]!.trimEnd());
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text of an HTML body with quoted history removed. */
function htmlOwnText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll('blockquote, .gmail_quote, .gmail_signature, #appendonsend, [id^="divRplyFwdMsg"], style, script')
    .forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, div, li').forEach((el) => el.append('\n'));
  return ownText(doc.body.textContent ?? '');
}

/** Clean, de-duplicated samples worth learning from (not one-liners). */
export function cleanSamples(raw: { html: string | null; text: string | null }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = r.text?.trim() ? ownText(r.text) : r.html ? htmlOwnText(r.html) : '';
    if (t.length < 40 || seen.has(t)) continue;
    seen.add(t);
    out.push(t.slice(0, MAX_SAMPLE_CHARS));
    if (out.length >= MAX_SAMPLES) break;
  }
  return out;
}

export async function loadStyleProfile(accountId: string): Promise<StyleProfile | null> {
  const v = await api.query('settings:get', { key: KEY(accountId) });
  return v && typeof v === 'object' && 'guide' in v ? (v as StyleProfile) : null;
}

export async function forgetStyleProfile(accountId: string): Promise<void> {
  await api.command('settings:set', { key: KEY(accountId), value: null });
}

const building = new Map<string, Promise<StyleProfile>>();

/**
 * Learn (or re-learn) the account's style from its sent mail. `complete` is
 * the assistant's one-shot completion, injected to keep this module free of
 * store wiring.
 */
export function buildStyleProfile(
  accountId: string,
  complete: (prompt: string, system?: string) => Promise<string>,
): Promise<StyleProfile> {
  const inFlight = building.get(accountId);
  if (inFlight) return inFlight;
  const run = (async () => {
    const raw = await api.query('style:samples', { accountId, limit: 40 });
    const samples = cleanSamples(raw);
    if (samples.length < MIN_SAMPLES) {
      throw new Error(
        'Not enough sent mail to learn your style yet. Try again once a few more sent emails have synced.',
      );
    }
    const guide = await complete(
      'Study the emails below, all written by the same person, and describe their personal ' +
        'writing style as a concise bullet list (at most 12 bullets) that another writer could ' +
        'follow. Cover: language(s) used; typical greeting and sign-off (quote them exactly); ' +
        'length and paragraphing; formality and warmth; sentence structure; punctuation, ' +
        'capitalization and emoji habits; recurring words or phrases. Describe patterns only: ' +
        'do not repeat names, numbers, addresses or other private details. Return only the list.\n\n' +
        samples.map((s, i) => `--- Email ${i + 1} ---\n${s}`).join('\n\n'),
    );
    const examples = samples
      .filter((s) => s.length <= 600)
      .slice(0, 3);
    const profile: StyleProfile = {
      guide: guide.trim(),
      examples,
      sampleCount: samples.length,
      builtAt: Date.now(),
    };
    await api.command('settings:set', { key: KEY(accountId), value: profile });
    return profile;
  })();
  building.set(accountId, run);
  void run.finally(() => building.delete(accountId)).catch(() => {});
  return run;
}

/** The cached profile, re-learned first when missing or older than two weeks. */
export async function ensureStyleProfile(
  accountId: string,
  complete: (prompt: string, system?: string) => Promise<string>,
): Promise<StyleProfile> {
  const cached = await loadStyleProfile(accountId);
  if (cached && Date.now() - cached.builtAt < STALE_MS) return cached;
  try {
    return await buildStyleProfile(accountId, complete);
  } catch (e) {
    // A stale profile still beats none (e.g. offline or sent folder not synced).
    if (cached) return cached;
    throw e;
  }
}

/** System context for a rewrite: the guide plus the verbatim examples. */
export function styleSystem(profile: StyleProfile): string {
  const examples = profile.examples.length
    ? '\n\nShort examples of their real emails:\n\n' +
      profile.examples.map((e, i) => `--- Example ${i + 1} ---\n${e}`).join('\n\n')
    : '';
  return `The user's personal writing style:\n${profile.guide}${examples}`;
}
