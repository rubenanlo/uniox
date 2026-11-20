import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings: Record<string, unknown> = {};
const replyIdeas = vi.fn();

vi.mock('../src/lib/api', () => ({
  api: {
    query: vi.fn(async (_ch: string, args: { key: string }) => settings[args.key] ?? null),
    command: vi.fn(async (_ch: string, args: { key: string; value: unknown }) => {
      settings[args.key] = args.value;
      return { ok: true };
    }),
  },
}));
vi.mock('../src/lib/quickReplyAi', () => ({ replyIdeas: (c: string) => replyIdeas(c) }));

const read = (summary: string) => ({ summary, suggestions: [], forwardTo: null, meetingMinutes: null });

describe('cachedReplyIdeas', () => {
  beforeEach(() => {
    vi.resetModules();
    replyIdeas.mockReset();
    for (const k of Object.keys(settings)) delete settings[k];
  });

  it('reads an email once, shares in-flight reads, and reuses the saved read in another window', async () => {
    replyIdeas.mockResolvedValue(read('Maya wants the deck'));
    const { cachedReplyIdeas } = await import('../src/lib/replyIdeasCache');
    const [a, b] = await Promise.all([cachedReplyIdeas('m1', 'ctx'), cachedReplyIdeas('m1', 'ctx')]);
    expect(a.summary).toBe('Maya wants the deck');
    expect(b).toBe(a);
    await cachedReplyIdeas('m1', 'ctx');
    expect(replyIdeas).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0)); // let the save land

    // A fresh module (the other window, or after a restart) uses the saved read.
    vi.resetModules();
    const again = await import('../src/lib/replyIdeasCache');
    expect((await again.cachedReplyIdeas('m1', 'ctx')).summary).toBe('Maya wants the deck');
    expect(replyIdeas).toHaveBeenCalledTimes(1);

    // A new message in the thread gets its own read.
    replyIdeas.mockResolvedValue(read('Maya followed up'));
    expect((await again.cachedReplyIdeas('m2', 'ctx2')).summary).toBe('Maya followed up');
    expect(replyIdeas).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed read', async () => {
    replyIdeas.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(read('ok'));
    const { cachedReplyIdeas } = await import('../src/lib/replyIdeasCache');
    await expect(cachedReplyIdeas('m1', 'ctx')).rejects.toThrow('offline');
    expect((await cachedReplyIdeas('m1', 'ctx')).summary).toBe('ok');
  });
});
