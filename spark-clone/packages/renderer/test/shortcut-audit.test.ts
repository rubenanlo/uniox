import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({
  api: { query: vi.fn(), command: vi.fn(), onTriageUndo: vi.fn(() => () => {}) },
}));

const { ACTIONS } = await import('../src/actions/registry');
const { CONTEXT_SHORTCUTS } = await import('../src/actions/contextShortcuts');

const comboKey = (c: { key: string; meta?: boolean; shift?: boolean; alt?: boolean }) =>
  `${c.meta ? 'M' : ''}${c.shift ? 'S' : ''}${c.alt ? 'A' : ''}+${c.key}`;

describe('shortcut audit', () => {
  it('no two global actions share a binding', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const a of ACTIONS) {
      for (const c of [a.combo, a.altCombo]) {
        if (!c) continue;
        const k = comboKey(c);
        if (seen.has(k)) clashes.push(`${k}: ${seen.get(k)} vs ${a.id}`);
        else seen.set(k, a.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('lists the surface-specific keys in the shortcuts sheet', () => {
    const labels = CONTEXT_SHORTCUTS.flatMap((s) => s.rows.map((r) => r.label));
    expect(labels).toContain('Open the event Account menu');
    expect(labels).toContain('Accept ⇄ Block, then next / previous card');
    for (const { section, rows } of CONTEXT_SHORTCUTS) {
      const own = rows.map((r) => r.label);
      expect(new Set(own).size, section).toBe(own.length);
      for (const r of rows) expect(r.keys.length, r.label).toBeGreaterThan(0);
    }
  });

  it('includes the global refresh and go-to bindings', () => {
    const ids = ACTIONS.filter((a) => a.combo).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['refresh', 'go-to', 'select-up', 'select-down']));
  });
});
