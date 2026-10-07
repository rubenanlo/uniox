import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base64url,
  buildAuthUrl,
  defaultGoogleClient,
  emailFromIdToken,
  makePkcePair,
} from '../src/google-auth';

describe('PKCE', () => {
  it('generates url-safe verifier and matching S256 challenge', () => {
    const { verifier, challenge } = makePkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(base64url(createHash('sha256').update(verifier).digest()));
    expect(makePkcePair().verifier).not.toBe(verifier);
  });
});

describe('auth url', () => {
  it('carries the mail scope, PKCE challenge, offline access, and forces account + consent prompts', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:9999/callback',
        challenge: 'chal',
        state: 'st',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    expect(p.get('scope')).toContain('https://mail.google.com/');
    expect(p.get('scope')).toContain('email');
    expect(p.get('code_challenge')).toBe('chal');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('select_account consent');
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:9999/callback');
  });
});

describe('built-in client from env', () => {
  it('returns the pair when both vars are set, trimmed', () => {
    expect(
      defaultGoogleClient({
        MAIN_VITE_GOOGLE_CLIENT_ID: ' cid.apps.googleusercontent.com ',
        MAIN_VITE_GOOGLE_CLIENT_SECRET: 'sec\n',
      }),
    ).toEqual({ clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec' });
  });
  it('returns null when either var is missing or blank', () => {
    expect(defaultGoogleClient({})).toBeNull();
    expect(defaultGoogleClient({ MAIN_VITE_GOOGLE_CLIENT_ID: 'cid' })).toBeNull();
    expect(
      defaultGoogleClient({ MAIN_VITE_GOOGLE_CLIENT_ID: 'cid', MAIN_VITE_GOOGLE_CLIENT_SECRET: '  ' }),
    ).toBeNull();
  });
});

describe('id_token parsing', () => {
  it('extracts the email claim', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'ruben@gmail.com', sub: '1' })).toString('base64');
    expect(emailFromIdToken(`hdr.${payload}.sig`)).toBe('ruben@gmail.com');
  });
  it('returns null for garbage', () => {
    expect(emailFromIdToken('not-a-jwt')).toBeNull();
    expect(emailFromIdToken('a.b.c')).toBeNull();
  });
});
