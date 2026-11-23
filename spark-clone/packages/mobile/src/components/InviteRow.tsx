import { useEffect, useState } from 'react';
import type { InviteInfo, MobileThread, RsvpAnswer } from '../data/types';
import { firstName, timeRange } from '../lib/format';
import { go } from '../lib/router';
import { useStore } from '../lib/store';
import { TILES } from './InviteCard';
import { ProposeTime } from './ProposeTime';

const DONE: Record<RsvpAnswer, string> = {
  accepted: 'Accepted',
  tentative: 'Maybe',
  declined: 'Declined',
};

/**
 * An invite waiting for an answer, right in the Inbox: date tile, title, time
 * and the four tilted answer tiles. Answering sends the RSVP to Google, then
 * the email leaves the list (Undo brings it back).
 */
export function InviteRow({
  thread,
  invite: given,
}: {
  thread: MobileThread;
  invite?: InviteInfo | null;
}) {
  const { api, act, showToast } = useStore();
  const [invite, setInvite] = useState<InviteInfo | null>(given ?? null);
  const [answer, setAnswer] = useState<RsvpAnswer | null>(null);
  const [proposing, setProposing] = useState(false);

  useEffect(() => {
    if (given) return;
    let live = true;
    void api
      .thread(thread.id)
      .then(({ messages }) => {
        const m = [...messages].reverse().find((x) => x.invite);
        if (live && m?.invite) setInvite(m.invite);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, thread.id, given]);

  const respond = async (key: RsvpAnswer | 'propose') => {
    if (key === 'propose') {
      // With the event on the calendar, pick a time and send a real proposal;
      // otherwise fall back to suggesting times in a reply.
      if (invite?.eventId) setProposing(true);
      else go(`compose?reply=${encodeURIComponent(thread.id)}&propose=1`);
      return;
    }
    if (!invite?.eventId) {
      showToast({
        text: 'This invite is not on your calendar yet. Try again in a minute.',
      });
      return;
    }
    setAnswer(key);
    try {
      await api.rsvp(invite.eventId, thread.accountId, key);
      setTimeout(() => void act(thread, { kind: 'archive' }, `${DONE[key]}. Email archived`), 1100);
    } catch (e) {
      setAnswer(null);
      showToast({ text: (e as Error).message });
    }
  };

  const start = invite ? new Date(invite.startMs) : null;
  const who = firstName(invite?.organizer ?? thread.lastFrom);
  return (
    <div className={`ib-inv ${answer ? 'picked' : ''}`}>
      <button className="ib-inv-top" onClick={() => go(`thread/${encodeURIComponent(thread.id)}`)}>
        <span className="ib-date">
          <small>{start ? start.toLocaleDateString(undefined, { weekday: 'short' }) : '·'}</small>
          {start ? start.getDate() : ''}
        </span>
        <span className="ib-inv-tx">
          <b>{invite?.title ?? thread.subject.replace(/^Invitation:\s*/i, '')}</b>
          <span>
            {invite ? timeRange(invite.startMs, invite.endMs) : 'Loading…'} · from {who}
          </span>
        </span>
      </button>
      <div className="ib-tiles">
        {TILES.map(({ key, label, Icon, tilt, bg, ic }) => (
          <button
            key={key}
            className={`ib-tile ${answer === key ? 'sel' : ''}`}
            style={{ ['--tilt' as string]: `${tilt}deg`, background: bg }}
            disabled={!!answer}
            onClick={() => void respond(key)}
          >
            <Icon size={14} strokeWidth={2.4} color={ic} />
            {key === 'accepted' ? 'Going' : label}
          </button>
        ))}
      </div>
      {answer && <div className="ib-sent-ok">Sent. {who} sees it in Google Calendar.</div>}
      {proposing && invite && (
        <ProposeTime
          invite={invite}
          accountId={thread.accountId}
          onClose={() => setProposing(false)}
        />
      )}
    </div>
  );
}
