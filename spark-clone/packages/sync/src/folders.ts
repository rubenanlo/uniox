import type { Account, Category, FolderRole } from '@app/shared';

/**
 * App-managed labels live under one namespace so every client (desktop, a
 * future mobile app, Gmail web) can read the app's state back from the server.
 * `SparkClone` is the pre-rebrand namespace; existing folders are migrated to
 * `Uniox` on connect (see AccountSync.migrateLegacyAppFolders).
 */
export const APP_NAMESPACE = 'Uniox';
export const LEGACY_APP_NAMESPACE = 'SparkClone';

export function appFolderPath(name: string, delimiter: string): string {
  return `${APP_NAMESPACE}${delimiter}${name}`;
}

/** Path lives in the app namespace (current or legacy)? */
export function isAppNamespacePath(path: string): boolean {
  return (
    path === APP_NAMESPACE ||
    path.startsWith(`${APP_NAMESPACE}/`) ||
    path.startsWith(`${APP_NAMESPACE}.`) ||
    path === LEGACY_APP_NAMESPACE ||
    path.startsWith(`${LEGACY_APP_NAMESPACE}/`) ||
    path.startsWith(`${LEGACY_APP_NAMESPACE}.`)
  );
}

/**
 * User category overrides mirror to these labels so every client agrees on a
 * sender's category. 'personal' is the default and has no label — overriding
 * to personal removes the sender from all category labels. Heuristic guesses
 * never label (that would spray labels over every newsletter Gmail sees).
 */
export const CATEGORY_LABELS: Record<Exclude<Category, 'personal'>, string> = {
  invites: 'Invites',
  notifications: 'Notifications',
  newsletters: 'Newsletters',
  promotions: 'Promotions',
};

export function categoryLabelName(category: Category): string | null {
  return category === 'personal' ? null : CATEGORY_LABELS[category];
}

/**
 * Is `path` the app-managed folder called `name` (current or legacy
 * namespace)? Used to target one specific label — e.g. unsnooze must pull from
 * Uniox/Snoozed without also draining Uniox/Priority.
 */
export function isAppFolder(path: string, name: string): boolean {
  return isAppNamespacePath(path) && path.endsWith(name);
}

/**
 * Gmail is the only provider whose folders are labels (multi-homing, virtual
 * mirrors, label-based archive). Detected by IMAP host so app-password and
 * OAuth accounts both qualify.
 */
export function isGmailAccount(account: Pick<Account, 'imap'>): boolean {
  const host = account.imap.host.toLowerCase();
  return host === 'imap.gmail.com' || host.endsWith('.gmail.com') || host.endsWith('.googlemail.com');
}

interface ListedMailbox {
  path: string;
  name: string;
  delimiter?: string;
  specialUse?: string;
  flags?: Set<string>;
}

const SPECIAL_USE: Record<string, FolderRole> = {
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'spam',
  '\\Archive': 'archive',
  '\\All': 'other', // Gmail All Mail is not our archive role
};

const NAME_FALLBACK: [RegExp, FolderRole][] = [
  [/^inbox$/i, 'inbox'],
  [/^snoozed$/i, 'snoozed'],
  [/^sent( (mail|items|messages))?$/i, 'sent'],
  [/^drafts?$/i, 'drafts'],
  [/^(deleted( items)?|trash)$/i, 'trash'],
  [/^(junk( e-?mail)?|spam)$/i, 'spam'],
  [/^archive$/i, 'archive'],
  [/^outbox$/i, 'outbox'],
];

export function mapFolderRole(box: ListedMailbox): FolderRole {
  if (box.path.toUpperCase() === 'INBOX') return 'inbox';
  if (box.specialUse && SPECIAL_USE[box.specialUse]) return SPECIAL_USE[box.specialUse]!;
  for (const [re, role] of NAME_FALLBACK) {
    if (re.test(box.name)) return role;
  }
  return 'other';
}

const GMAIL_MIRROR_LEAF = /^(all mail|important|starred)$/i;

/**
 * Gmail's label model multi-homes a message into every label it carries, so
 * All Mail / Important / Starred are *mirror* folders whose messages already
 * live in a real folder (INBOX, Sent, …). Syncing them creates duplicate rows
 * of the same Message-ID (report §5.2). Only `\All` is an RFC 6154 special-use
 * flag; `\Important` / `\Starred` are Gmail-specific and never surface in
 * `specialUse`, so we also match the well-known `[Gmail]` / `[Google Mail]`
 * paths. User labels (Priority, Blocked, …) are NOT mirrors — they are real
 * folders the user may browse; cross-label overlap is handled by display dedupe.
 */
export function isMirrorFolder(box: ListedMailbox): boolean {
  // Our own labels are the app's server-side state — always synced, never mirrors.
  if (isAppNamespacePath(box.path)) return false;
  const su = box.specialUse;
  if (su === '\\All' || su === '\\Important' || su === '\\Flagged') return true;
  const parts = box.path.split(box.delimiter || '/');
  const top = (parts[0] ?? '').toLowerCase();
  const leaf = parts[parts.length - 1] ?? '';
  return (top === '[gmail]' || top === '[google mail]') && GMAIL_MIRROR_LEAF.test(leaf);
}
