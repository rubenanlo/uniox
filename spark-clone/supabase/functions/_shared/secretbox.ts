/**
 * Encryption at rest for Google grants in `account_tokens`. The key is the
 * TOKEN_KEY Edge Function secret, which never touches the database, so the
 * table alone (a leaked database password, a backup) reveals nothing usable.
 *
 * Without TOKEN_KEY values are stored as they are, and plain values written
 * before the key existed are still readable; they are sealed on next write.
 */
const PREFIX = 'enc1:';
let cached: Promise<CryptoKey | null> | null = null;

function key(): Promise<CryptoKey | null> {
  cached ??= (async () => {
    const secret = Deno.env.get('TOKEN_KEY');
    if (!secret) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
  })();
  return cached;
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const isSealed = (value: string | null | undefined): boolean => !!value?.startsWith(PREFIX);

export async function canSeal(): Promise<boolean> {
  return (await key()) !== null;
}

export async function seal(value: string): Promise<string>;
export async function seal(value: string | null): Promise<string | null>;
export async function seal(value: string | null): Promise<string | null> {
  const k = await key();
  if (value === null || !k || isSealed(value)) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(value)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return PREFIX + b64(out);
}

export async function open(value: string): Promise<string>;
export async function open(value: string | null): Promise<string | null>;
export async function open(value: string | null): Promise<string | null> {
  if (value === null || !isSealed(value)) return value;
  const k = await key();
  if (!k) throw new Error('TOKEN_KEY is missing but stored Google sign-ins are encrypted');
  const raw = unb64(value.slice(PREFIX.length));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, k, raw.slice(12));
  return new TextDecoder().decode(pt);
}
