import type { Category } from '@app/shared';

export interface CategorizeInput {
  /** lowercased header map: list-id, list-unsubscribe, auto-submitted, precedence */
  headers: Map<string, string>;
  fromAddress: string;
  subject: string;
  /** message carries a text/calendar part (meeting invitation) */
  hasCalendar: boolean;
  /** the thread already contains mail we sent */
  threadHasOurReply: boolean;
  /** we have ever sent mail to this sender (a human contact) */
  knownCorrespondent?: boolean;
  /** sender shares the account's own (non-freemail) domain — a colleague */
  sameOrgSender?: boolean;
  /** distinct visible addresses in To + Cc; 0 when unknown */
  recipientCount?: number;
}

const NOREPLY = /^(no-?reply|do-?not-?reply|noreply|notifications?|alerts?|mailer-daemon|postmaster)@/i;
const PROMO_SUBJECT =
  /(\d+\s?%(\s?off)?|percent off|sale\b|deal\b|discount|promo\b|coupon|voucher|free shipping|black friday|cyber monday|limited time|last chance|don'?t miss|special offer|flash sale)/i;
const PROMO_SENDER = /^(promo(tions?)?|deals?|offers?|marketing|sales?)@|@(deals?|promo|offers?|marketing)\./i;

/**
 * Stage-1 ordered rule engine (report §6.4), extended with Spark-style
 * Promotions and Invites groups. Deterministic and explainable; the caller
 * checks the sticky per-sender override table first — overrides always beat
 * these rules. Fallback is Personal: burying a human's mail is the worst
 * failure mode.
 */
/**
 * Bulk mail is broadcast to you alone (or an undisclosed list). A visible
 * handful of named people in To/Cc is a human discussion — Google Groups and
 * team aliases stamp List-Id on those too, so headers alone can't decide.
 * Very large visible recipient lists read as mass mail again.
 */
const GROUP_DISCUSSION_MIN = 2;
const GROUP_DISCUSSION_MAX = 12;

export function categorize(input: CategorizeInput): Category {
  const { headers, fromAddress, subject, hasCalendar, threadHasOurReply } = input;

  // Calendar invitations outrank everything — they are actionable and timed.
  if (hasCalendar) return 'invites';

  // A thread we participate in is a conversation, whatever its headers say.
  if (threadHasOurReply) return 'personal';

  // Someone we have written to, or a colleague on our own domain, is a human
  // contact (Spark behavior): contact evidence beats bulk headers, which team
  // aliases put on ordinary mail. Automated org senders (noreply@) still fall
  // through to the notifications rules below via the sameOrgSender guard.
  if (input.knownCorrespondent) return 'personal';
  if (input.sameOrgSender && !NOREPLY.test(fromAddress)) return 'personal';

  // List-Id / List-Unsubscribe: near-universal on legitimate bulk mail.
  // Marketing language or a marketing sender splits bulk into Promotions.
  if (headers.has('list-id') || headers.has('list-unsubscribe')) {
    const recipients = input.recipientCount ?? 0;
    if (recipients >= GROUP_DISCUSSION_MIN && recipients <= GROUP_DISCUSSION_MAX) {
      return 'personal';
    }
    if (PROMO_SUBJECT.test(subject) || PROMO_SENDER.test(fromAddress)) return 'promotions';
    return 'newsletters';
  }

  const auto = headers.get('auto-submitted');
  if (auto && auto !== 'no') return 'notifications';
  const precedence = headers.get('precedence');
  if (precedence === 'junk' || precedence === 'bulk') return 'notifications';
  if (NOREPLY.test(fromAddress)) return 'notifications';

  return 'personal';
}

export { domainOf, sameOrgDomain } from '@app/shared';
