/** Address-level helpers shared by the categorizer (sync) and db backfills. */

export function domainOf(address: string): string {
  return address.slice(address.indexOf('@') + 1).toLowerCase();
}

/** Consumer mail domains: sharing one says nothing about being colleagues. */
const FREEMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'web.de',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'laposte.net',
]);

/** True when two addresses share a custom (non-freemail) domain. */
export function sameOrgDomain(senderAddress: string, accountEmail: string): boolean {
  const domain = domainOf(senderAddress);
  return domain.length > 0 && domain === domainOf(accountEmail) && !FREEMAIL.has(domain);
}
