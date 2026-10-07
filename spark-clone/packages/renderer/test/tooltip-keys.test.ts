import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({
  api: { query: vi.fn(), command: vi.fn(), onTriageUndo: vi.fn(() => () => {}) },
}));

import { ACTIONS } from '../src/actions/registry';

/**
 * Every keyboard shortcut advertised in a hover tooltip must resolve to a
 * BOUND action in the registry — keysFor() on an unknown or unbound id
 * silently renders no keycaps, so a typo would ship an empty tooltip.
 */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

function referencedActionIds(): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  const add = (id: string, file: string) => {
    byId.set(id, [...(byId.get(id) ?? []), file]);
  };
  for (const file of tsxFiles(join(__dirname, '../src'))) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/keysFor\('([^']+)'\)/g)) add(m[1]!, file);
    // Template-literal ids (e.g. keysFor(`layout-${id}`)) can't be resolved
    // statically — expand the known variants for each prefix found.
    for (const m of source.matchAll(/keysFor\(`([a-z-]+)\$\{[^}]+\}`\)/g)) {
      const prefix = m[1]!;
      const variants = ACTIONS.filter((a) => a.id.startsWith(prefix)).map((a) => a.id);
      expect(variants.length, `no registry ids match template prefix "${prefix}" in ${file}`).toBeGreaterThan(0);
      for (const id of variants) add(id, file);
    }
  }
  return byId;
}

describe('tooltip shortcut hints', () => {
  const referenced = referencedActionIds();

  it('finds tooltip key references to validate', () => {
    expect(referenced.size).toBeGreaterThan(0);
  });

  for (const [id, files] of referenced) {
    it(`"${id}" resolves to a bound registry action (${files.map((f) => f.split('/').pop()).join(', ')})`, () => {
      const action = ACTIONS.find((a) => a.id === id);
      expect(action, `action "${id}" is not in the registry`).toBeDefined();
      expect(action!.combo, `action "${id}" has no key binding to show`).not.toBeNull();
    });
  }
});
