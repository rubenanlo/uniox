import type { Address } from '@app/shared';

/** `Name <a@b.c>, d@e.f` → addresses (anything without an @ is dropped). */
export function parseAddresses(raw: string): Address[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)\s*<([^>]+)>$/);
      if (m) return { name: m[1]?.replace(/^"|"$/g, '') || undefined, email: m[2]! };
      return { email: part };
    })
    .filter((a) => a.email.includes('@'));
}

/** Addresses → `Name <a@b.c>, d@e.f`, the way the composer's fields hold them. */
export function formatAddresses(list: Address[] | undefined): string {
  return (list ?? []).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ');
}
