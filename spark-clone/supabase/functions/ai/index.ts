import { admin, callerId } from '../_shared/db.ts';
import { json, preflight } from '../_shared/cors.ts';

/**
 * AI for the phone. Each user adds their own Anthropic key in Settings; it is
 * sent here once, stored encrypted in Supabase Vault, and only ever decrypted
 * inside this function to call Anthropic. It is never returned to a client.
 *   {task:'keyStatus'}                  -> {set, hint?}
 *   {task:'setKey', key}                -> {set:true, hint}
 *   {task:'clearKey'}                   -> {set:false}
 *   {task:'firstRead', threadId}        -> {summary, replyIdeas, freeSlots?}
 *   {task:'rewrite', body, instruction} -> {text}
 *   {task:'assistant', history}         -> {text}
 *   {task:'search', query}              -> {answer|null}
 */
const MODEL = () => Deno.env.get('AI_MODEL') ?? 'claude-opus-4-8';

/** Thrown when the user has not added a key yet; the phone shows it as is. */
const NO_KEY = 'Add your Anthropic key in Settings to use AI.';

async function userKey(db: ReturnType<typeof admin>, userId: string): Promise<string> {
  const { data, error } = await db.rpc('get_ai_key', { p_user: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(NO_KEY);
  return data as string;
}

async function claude(key: string, system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens = 800): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages }),
  });
  if (res.status === 401) throw new Error('Anthropic rejected your key. Update it in Settings.');
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('').trim();
}

function parseJson<T>(s: string): T | null {
  const m = s.match(/\{[\s\S]*\}/);
  try {
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch {
    return null;
  }
}

const fmtWhen = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const userId = await callerId(req);
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const db = admin();
  const b = await req.json();

  try {
    if (b.task === 'keyStatus') {
      const { data } = await db.from('user_ai_keys').select('hint').eq('user_id', userId).maybeSingle();
      return json(data ? { set: true, hint: data.hint } : { set: false });
    }

    if (b.task === 'setKey') {
      const key = String(b.key ?? '').trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) return json({ error: 'That does not look like an Anthropic key (it starts with sk-ant-).' }, 400);
      // Check it works before storing it.
      const probe = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      if (probe.status === 401 || probe.status === 403) return json({ error: 'Anthropic rejected this key. Check it and try again.' }, 400);
      const { error } = await db.rpc('set_ai_key', { p_user: userId, p_key: key });
      if (error) throw new Error(error.message);
      return json({ set: true, hint: key.slice(-4) });
    }

    if (b.task === 'clearKey') {
      const { error } = await db.rpc('clear_ai_key', { p_user: userId });
      if (error) throw new Error(error.message);
      await db.from('ai_cache').delete().eq('user_id', userId);
      return json({ set: false });
    }

    if (b.task === 'firstRead') {
      const { data: thread } = await db.from('threads').select('id, subject, account_id').eq('id', b.threadId).eq('user_id', userId).single();
      if (!thread) return json({ error: 'not found' }, 404);
      const { data: msgs } = await db
        .from('messages')
        .select('id, from_addr, date, body_text, snippet, from_me')
        .eq('thread_id', thread.id)
        .order('date', { ascending: true });
      const last = msgs?.[msgs.length - 1];
      if (!last) return json({ summary: '', replyIdeas: [] });
      const { data: cached } = await db.from('ai_cache').select('last_message_id, result').eq('thread_id', thread.id).maybeSingle();
      if (cached && cached.last_message_id === last.id) return json(cached.result);

      const convo = (msgs ?? [])
        .slice(-6)
        .map((m) => `${m.from_me ? 'Me' : (m.from_addr?.name ?? m.from_addr?.email)} (${fmtWhen(m.date)}):\n${(m.body_text ?? m.snippet ?? '').slice(0, 2500)}`)
        .join('\n\n---\n\n');
      const out = await claude(
        await userKey(db, userId),
        'You read email threads for a busy person. Reply with JSON only: {"summary": one or two plain sentences on what the latest message says and what it needs from me, "replyIdeas": up to 3 short reply chip labels (2-4 words each), "wantsTimes": true if the sender asks me to propose meeting times}.',
        [{ role: 'user', content: `Subject: ${thread.subject}\n\n${convo}` }],
        400,
      );
      const parsed = parseJson<{ summary: string; replyIdeas: string[]; wantsTimes?: boolean }>(out) ?? { summary: out, replyIdeas: [] };
      const result: { summary: string; replyIdeas: string[]; freeSlots?: { startMs: number; endMs: number }[] } = {
        summary: parsed.summary,
        replyIdeas: (parsed.replyIdeas ?? []).slice(0, 3),
      };
      if (parsed.wantsTimes) result.freeSlots = await freeSlots(db, userId);
      await db.from('ai_cache').upsert({ thread_id: thread.id, user_id: userId, last_message_id: last.id, result });
      return json(result);
    }

    if (b.task === 'rewrite') {
      const text = await claude(
        await userKey(db, userId),
        'You edit email drafts. Apply the instruction and return only the new email body, no preamble, same language as the draft unless asked to translate.',
        [{ role: 'user', content: `Instruction: ${b.instruction}\n\nDraft:\n${b.body}` }],
        1200,
      );
      return json({ text });
    }

    if (b.task === 'assistant') {
      const [{ data: threads }, { data: events }] = await Promise.all([
        db
          .from('threads')
          .select('subject, snippet, last_from, last_message_at, unread_count, priority')
          .eq('user_id', userId)
          .eq('in_inbox', true)
          .order('last_message_at', { ascending: false })
          .limit(30),
        db
          .from('events')
          .select('title, start_ms, end_ms, location, attendees')
          .eq('user_id', userId)
          .gte('end_ms', Date.now())
          .lte('start_ms', Date.now() + 7 * 86_400_000)
          .order('start_ms')
          .limit(40),
      ]);
      const ctx = [
        `Now: ${fmtWhen(Date.now())}`,
        'Inbox (newest first):',
        ...(threads ?? []).map((t) => `- ${t.priority ? '[priority] ' : ''}${t.unread_count ? '[unread] ' : ''}${t.last_from?.name ?? t.last_from?.email}: ${t.subject} — ${t.snippet}`),
        'Calendar, next 7 days:',
        ...(events ?? []).map((e) => `- ${fmtWhen(e.start_ms)}–${fmtWhen(e.end_ms).slice(11)} ${e.title}${e.location ? ` @ ${e.location}` : ''}`),
      ].join('\n');
      const history = (b.history ?? []).slice(-12).map((t: { role: 'user' | 'assistant'; text: string }) => ({ role: t.role, content: t.text }));
      const text = await claude(
        await userKey(db, userId),
        `You are the assistant inside Uniox, the user's mail and calendar app, on their phone. Be brief and concrete; plain sentences, no markdown headings. Use this context:\n\n${ctx}`,
        history,
        900,
      );
      return json({ text });
    }

    if (b.task === 'search') {
      const q = String(b.query ?? '').trim();
      if (q.length < 3) return json({ answer: null });
      const { data: hits } = await db
        .from('threads')
        .select('subject, snippet, last_from, last_message_at')
        .eq('user_id', userId)
        .textSearch('search', q.split(/\s+/).join(' & '), { config: 'simple' })
        .order('last_message_at', { ascending: false })
        .limit(8);
      if (!hits?.length) return json({ answer: null });
      const key = await db.rpc('get_ai_key', { p_user: userId });
      if (!key.data) return json({ answer: null });
      const out = await claude(
        key.data as string,
        'Answer the search in one sentence using only these emails, or reply exactly NONE if they do not answer it.',
        [{ role: 'user', content: `Search: ${q}\n\n${hits.map((h) => `${fmtWhen(h.last_message_at)} ${h.last_from?.name}: ${h.subject} — ${h.snippet}`).join('\n')}` }],
        150,
      );
      return json({ answer: out === 'NONE' ? null : out });
    }

    return json({ error: 'unknown task' }, 400);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === NO_KEY) return json({ error: msg, code: 'no_ai_key' }, 400);
    console.error(msg);
    return json({ error: msg }, 500);
  }
});

/** Three free 30-minute slots in the next working days, 9:00–18:00 in the user's time zone. */
async function freeSlots(db: ReturnType<typeof admin>, userId: string) {
  const { data: s } = await db.from('settings').select('data').eq('user_id', userId).maybeSingle();
  const tz = (s?.data as { timeZone?: string } | undefined)?.timeZone ?? 'Europe/Paris';
  const { data: events } = await db
    .from('events')
    .select('start_ms, end_ms, free, all_day')
    .eq('user_id', userId)
    .gte('end_ms', Date.now())
    .lte('start_ms', Date.now() + 10 * 86_400_000);
  const busy = (events ?? []).filter((e) => !e.free && !e.all_day);
  const slots: { startMs: number; endMs: number }[] = [];
  const offset = (ms: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(ms))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - ms;
  };
  for (let d = 1; d <= 10 && slots.length < 3; d++) {
    const dayUtc = new Date(Date.now() + d * 86_400_000);
    const wall = new Date(dayUtc.getTime() + offset(dayUtc.getTime()));
    if (wall.getUTCDay() === 0 || wall.getUTCDay() === 6) continue;
    let perDay = 0;
    for (let h = 9; h < 18 && perDay < 2 && slots.length < 3; h += 0.5) {
      const localMidnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
      const start = localMidnight + h * 3_600_000 - offset(localMidnight + h * 3_600_000);
      const end = start + 30 * 60_000;
      if (busy.some((e) => e.start_ms < end && e.end_ms > start)) continue;
      slots.push({ startMs: start, endMs: end });
      perDay++;
      h += 1; // spread them out
    }
  }
  return slots;
}
