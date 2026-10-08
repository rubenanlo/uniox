import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({
  api: { query: vi.fn(), command: vi.fn(), onTriageUndo: vi.fn(() => () => {}) },
}));

import { ACTIONS, fieldOwnsKey, matchCombo } from '../src/actions/registry';

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

describe('fields keep their own ⌘-keys', () => {
  const toggleRead = ACTIONS.find((a) => a.id === 'toggle-read')!;
  const cmdU = ev({ key: 'u', code: 'KeyU', metaKey: true });

  it('⌘U matches mark read / unread through its alt binding', () => {
    expect(dispatchTarget(cmdU)?.id).toBe('toggle-read');
  });

  it('⌘U inside the composer never marks the replied-to email', () => {
    expect(fieldOwnsKey(cmdU, toggleRead, { editable: false, inComposer: true })).toBe(true);
    expect(fieldOwnsKey(cmdU, toggleRead, { editable: true, inComposer: true })).toBe(true);
  });

  it('⌘U in any text field is left to the field (underline)', () => {
    expect(fieldOwnsKey(cmdU, toggleRead, { editable: true, inComposer: false })).toBe(true);
  });

  it('⌘U on the mail list still toggles read', () => {
    expect(fieldOwnsKey(cmdU, toggleRead, { editable: false, inComposer: false })).toBe(false);
  });

  it('global shortcuts like ⌘R still work from the composer', () => {
    const refresh = ACTIONS.find((a) => a.id === 'refresh')!;
    const cmdR = ev({ key: 'r', code: 'KeyR', metaKey: true });
    expect(fieldOwnsKey(cmdR, refresh, { editable: true, inComposer: true })).toBe(false);
  });
});

describe('⌘I opens the assistant', () => {
  const assistant = ACTIONS.find((a) => a.id === 'assistant')!;
  const cmdI = ev({ key: 'i', code: 'KeyI', metaKey: true });

  it('is bound to ⌘I', () => {
    expect(matchCombo(cmdI, assistant.combo)).toBe(true);
  });

  it('keeps ⌘I as italic in rich text (the composer body)', () => {
    expect(fieldOwnsKey(cmdI, assistant, { editable: true, inComposer: true, richText: true })).toBe(true);
  });

  it('opens the assistant from plain inputs and the composer’s other fields', () => {
    expect(fieldOwnsKey(cmdI, assistant, { editable: true, inComposer: true, richText: false })).toBe(false);
    expect(fieldOwnsKey(cmdI, assistant, { editable: true, inComposer: false })).toBe(false);
    expect(fieldOwnsKey(cmdI, assistant, { editable: false, inComposer: false })).toBe(false);
  });
});
