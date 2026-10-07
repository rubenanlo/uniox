import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({
  api: { query: vi.fn(), command: vi.fn(), onTriageUndo: vi.fn(() => () => {}) },
}));

import { ACTIONS, matchCombo } from '../src/actions/registry';

const ev = (over: Partial<KeyboardEvent>) =>
  ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over }) as KeyboardEvent;

const dispatchTarget = (e: KeyboardEvent) =>
  ACTIONS.find((a) => matchCombo(e, a.combo) || matchCombo(e, a.altCombo ?? null)) ?? null;

describe('layout shortcuts (⌘⌥1/2/3) on macOS', () => {
  // macOS reports the Option-modified character in e.key (⌥1 → '¡', ⌥2 → '™',
  // ⌥3 → '£' on a US layout); only e.code still says which physical key it was.
  const macCases: [string, string, string][] = [
    ['¡', 'Digit1', 'layout-focused'],
    ['™', 'Digit2', 'layout-cards'],
    ['£', 'Digit3', 'layout-simple'],
  ];

  for (const [key, code, expected] of macCases) {
    it(`⌘⌥ with e.key "${key}" (${code}) dispatches ${expected}`, () => {
      const e = ev({ key, code, metaKey: true, altKey: true });
      expect(dispatchTarget(e)?.id).toBe(expected);
    });
  }

  it('⌘1 (no alt) still switches accounts, not layouts', () => {
    const e = ev({ key: '1', code: 'Digit1', metaKey: true });
    expect(dispatchTarget(e)?.id).toBe('account-all');
  });

  it('plain 1 (no modifiers) matches nothing', () => {
    expect(dispatchTarget(ev({ key: '1', code: 'Digit1' }))).toBeNull();
  });
});
