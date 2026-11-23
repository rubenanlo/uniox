import { describe, expect, it } from 'vitest';
import { parseBlocks } from '../src/lib/markdown';
import { asksAboutToday } from '../src/lib/todayQuestion';

describe('Assistant markdown blocks', () => {
  it('splits paragraphs and numbered lists', () => {
    const blocks = parseBlocks(
      'You have 4 events today:\n\n1. **07:30 AM** — Vitamin D\n2. **2:00 PM** — Check-in\n\nThat is all.',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ol', 'p']);
    expect(blocks[1]).toMatchObject({
      items: ['**07:30 AM** — Vitamin D', '**2:00 PM** — Check-in'],
    });
  });

  it('keeps bullets, headings and line breaks', () => {
    const blocks = parseBlocks('## Today\nLine one\nLine two\n- a\n- b');
    expect(blocks).toEqual([
      { kind: 'h', level: 2, text: 'Today' },
      { kind: 'p', lines: ['Line one', 'Line two'] },
      { kind: 'ul', items: ['a', 'b'], start: 1 },
    ]);
  });
});

describe('asksAboutToday', () => {
  it.each([
    'What events do I have today?',
    "what's my next meeting",
    'Anything on my calendar?',
    'Do I have calls this afternoon?',
  ])('matches %s', (q) => expect(asksAboutToday(q)).toBe(true));

  it.each([
    'Summarize my emails',
    'Draft a reply to Maya',
    'What happened at the meeting last week?',
  ])('ignores %s', (q) => expect(asksAboutToday(q)).toBe(false));
});
