import { describe, expect, it } from 'vitest';
import { mergeCloudPrefs, toCloudPrefs, toDesktopPrefs } from '../src/cloudPrefs';

const known = { light: ['classic', 'linen', 'glacier', 'sage'], dark: ['classic', 'midnight', 'ember', 'aubergine'] };

describe('cloud prefs mapping', () => {
  it('translates desktop names to the phone names and back', () => {
    const cloud = toCloudPrefs({ theme: 'system', lightPalette: 'classic', darkPalette: 'ember', readingLayout: 'classic' });
    expect(cloud).toEqual({ theme: 'auto', palette: 'default', paletteDark: 'ember', threadLayout: 'cards' });
    expect(toDesktopPrefs(cloud, known)).toEqual({
      theme: 'system',
      lightPalette: 'classic',
      darkPalette: 'ember',
      readingLayout: 'classic',
    });
  });

  it('ignores a palette this build does not know', () => {
    expect(toDesktopPrefs({ palette: 'neon', paletteDark: 'midnight' }, known)).toEqual({ darkPalette: 'midnight' });
  });
});

describe('mergeCloudPrefs', () => {
  it('first sync: the desktop wins', () => {
    const r = mergeCloudPrefs({ theme: 'dark', palette: 'sage' }, { theme: 'auto' }, null);
    expect(r.push).toEqual({ theme: 'dark', palette: 'sage' });
    expect(r.apply).toEqual({});
    expect(r.merged).toEqual({ theme: 'dark', palette: 'sage' });
  });

  it('a change on the phone is applied, a change here is pushed', () => {
    const base = { theme: 'dark', threadLayout: 'chat' } as const;
    const r = mergeCloudPrefs({ theme: 'dark', threadLayout: 'cards' }, { theme: 'light', threadLayout: 'chat' }, base);
    expect(r.apply).toEqual({ theme: 'light' });
    expect(r.push).toEqual({ threadLayout: 'cards' });
    expect(r.merged).toEqual({ theme: 'light', threadLayout: 'cards' });
  });

  it('both changed: the phone wins; nothing changed: nothing moves', () => {
    const base = { theme: 'auto' } as const;
    expect(mergeCloudPrefs({ theme: 'dark' }, { theme: 'light' }, base).apply).toEqual({ theme: 'light' });
    const same = mergeCloudPrefs({ theme: 'auto' }, { theme: 'auto' }, base);
    expect(same.push).toEqual({});
    expect(same.apply).toEqual({});
  });
});
