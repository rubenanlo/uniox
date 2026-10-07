import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from '../src/search';

describe('parseSearchQuery', () => {
  it('maps from: onto the FTS sender column', () => {
    expect(parseSearchQuery('from:grayson').fts).toBe('from_text:"grayson"*');
  });

  it('binds a spaced operator to the token after it', () => {
    // The From chip inserts a bare "from:", so users naturally type a space
    // before the name; that must mean the same thing as from:grayson.
    expect(parseSearchQuery('from: grayson').fts).toBe('from_text:"grayson"*');
  });

  it('maps subject: onto the FTS subject column', () => {
    expect(parseSearchQuery('subject: budget').fts).toBe('subject:"budget"*');
  });

  it('turns to: into a recipient filter rather than an FTS term', () => {
    const q = parseSearchQuery('to: bob@example.com');
    expect(q.toLike).toBe('bob@example.com');
    expect(q.fts).toBeNull();
  });

  it('recognises has:attachment', () => {
    expect(parseSearchQuery('has:attachment').hasAttachment).toBe(true);
  });

  it('ANDs bare words as prefix terms', () => {
    expect(parseSearchQuery('pause closing').fts).toBe('"pause"* "closing"*');
  });

  it('reports the sender terms so results can show the matching sender', () => {
    expect(parseSearchQuery('from:grayson report').fromTerms).toEqual(['grayson']);
  });

  it('treats a lone trailing operator as not yet filtering', () => {
    const q = parseSearchQuery('from:');
    expect(q.fts).toBeNull();
    expect(q.fromTerms).toEqual([]);
  });

  it('strips quotes so raw input cannot break FTS5', () => {
    expect(parseSearchQuery('a"b').fts).toBe('"ab"*');
  });

  it('returns an empty query for blank input', () => {
    expect(parseSearchQuery('   ').isEmpty).toBe(true);
  });
});
