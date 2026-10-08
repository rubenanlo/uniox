import type { MailtoDraft } from '@app/shared';
import { toast } from 'sonner';
import { useUi } from '../state/store';
import { api } from './api';

const toRecipients = (emails: string[]) => emails.map((email) => ({ email }));

/** Open a new-message composer seeded from a mailto: link. */
export function composeFromMailto(draft: MailtoDraft): void {
  const ui = useUi.getState();
  // The composer keeps no autosaved copy, so replacing an open one would
  // silently discard what's been typed there.
  if (ui.composer) {
    toast('Close the open draft to start the new email');
    return;
  }
  void api.query('accounts:list', undefined).then((accounts) => {
    const acc = accounts.find((a) => a.id === ui.accountFilter) ?? accounts[0];
    if (!acc) {
      toast('Add an email account to send mail');
      return;
    }
    useUi.getState().openComposer({
      mode: 'new',
      accountId: acc.id,
      to: toRecipients(draft.to),
      cc: toRecipients(draft.cc),
      bcc: toRecipients(draft.bcc),
      ...(draft.subject ? { subject: draft.subject } : {}),
      ...(draft.body ? { initialBody: draft.body } : {}),
    });
  });
}
