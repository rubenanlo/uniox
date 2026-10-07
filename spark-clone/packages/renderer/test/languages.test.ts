import { describe, expect, it } from 'vitest';
import { LANGUAGES, languageOptions } from '../src/lib/languages';

describe('languageOptions', () => {
  it('lists recent picks first, then the catalog, without duplicates', () => {
    const rows = languageOptions('', ['Catalan', 'Basque']);
    expect(rows.slice(0, 3)).toEqual(['Catalan', 'Basque', 'English']);
    expect(rows.filter((l) => l === 'Catalan')).toHaveLength(1);
    expect(rows).toHaveLength(LANGUAGES.length + 1);
  });

  it('filters by the start of any word, case-insensitively', () => {
    expect(languageOptions('trad')).toEqual(['Chinese (Traditional)', 'Trad']);
    expect(languageOptions('SPAN')[0]).toBe('Spanish');
  });

  it('offers a typed language that is not in the catalog', () => {
    expect(languageOptions('esperanto')).toEqual(['Esperanto']);
  });

  it('does not duplicate an exact match', () => {
    expect(languageOptions('german')).toEqual(['German']);
  });
});
