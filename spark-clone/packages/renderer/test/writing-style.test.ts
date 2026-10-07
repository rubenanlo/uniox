import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({ api: {} }));
const { cleanSamples, ownText, styleSystem } = await import('../src/lib/writingStyle');

describe('ownText', () => {
  it('drops a quoted reply after an "On … wrote:" header, even when it wraps', () => {
    const body = 'Hi Ana,\n\nSounds good, see you then.\n\nBest,\nRuben\n\nOn Mon, 5 Oct 2026 at 10:00, Ana <ana@x.com>\nwrote:\n> Are we on for Friday?';
    expect(ownText(body)).toBe('Hi Ana,\n\nSounds good, see you then.\n\nBest,\nRuben');
  });

  it('handles Spanish and Outlook-style headers', () => {
    expect(ownText('Perfecto, gracias.\n\nEl lun, 5 oct 2026, Ana escribió:\n> Hola')).toBe('Perfecto, gracias.');
    expect(ownText('Thanks!\n\n-----Original Message-----\nFrom: Ana')).toBe('Thanks!');
  });

  it('cuts the signature and skips stray quoted lines', () => {
    expect(ownText('> earlier\nYes, agreed.\n-- \nRuben Andino\nCEO')).toBe('Yes, agreed.');
  });
});

describe('cleanSamples', () => {
  it('keeps substantive, unique bodies only', () => {
    const long = 'Hi team, quick update on the launch: everything is on track for Friday.';
    const out = cleanSamples([
      { html: null, text: 'ok' },
      { html: null, text: long },
      { html: null, text: `${long}\n\nOn Tue, Bob wrote:\n> hi` },
    ]);
    expect(out).toEqual([long]);
  });
});

describe('styleSystem', () => {
  it('includes the guide and the examples', () => {
    const s = styleSystem({ guide: '- Signs off "Best, R"', examples: ['Hey! Done.'], sampleCount: 5, builtAt: 0 });
    expect(s).toContain('Signs off');
    expect(s).toContain('Example 1');
    expect(s).toContain('Hey! Done.');
  });
});
