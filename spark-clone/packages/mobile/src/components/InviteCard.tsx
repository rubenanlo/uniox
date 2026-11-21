import { AlertTriangle, CalendarClock, Check, HelpCircle, Video, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { InviteInfo, MobileEvent, RsvpAnswer } from '../data/types';
import { displayName, firstName, shortDate, timeRange } from '../lib/format';
import { go } from '../lib/router';
import { useStore } from '../lib/store';
import { AvatarStack } from './ui';

/* The four tilted answer tiles from the desktop invite card (PR #92). */
const TILES: {
  key: RsvpAnswer | 'propose';
  label: string;
  Icon: typeof Check;
  tilt: number;
  bg: string;
  ic: string;
}[] = [
  {
    key: 'accepted',
    label: 'Accept',
    Icon: Check,
    tilt: -1.6,
    bg: 'linear-gradient(150deg, rgb(160 205 225 / .75), rgb(140 180 230 / .6))',
    ic: '#1f9a6b',
  },
  {
    key: 'tentative',
    label: 'Maybe',
    Icon: HelpCircle,
    tilt: 1.2,
    bg: 'linear-gradient(150deg, rgb(240 200 175 / .75), rgb(230 180 190 / .6))',
    ic: '#d08a1d',
  },
  {
    key: 'declined',
    label: 'Decline',
    Icon: X,
    tilt: 1.4,
    bg: 'linear-gradient(150deg, rgb(240 170 200 / .7), rgb(230 160 215 / .6))',
    ic: '#d4386c',
  },
  {
    key: 'propose',
    label: 'Propose',
    Icon: CalendarClock,
    tilt: -1.1,
    bg: 'linear-gradient(150deg, rgb(190 180 245 / .75), rgb(170 165 240 / .6))',
    ic: '#5a5ee0',
  },
];

const CHOSEN: Record<string, string> = {
  accepted: 'Accepted',
  tentative: 'Maybe',
  declined: 'Declined',
};

export function InviteCard({
  invite,
  accountId,
  threadId,
}: {
  invite: InviteInfo;
  accountId: string;
  threadId: string;
}) {
  const api = useStore((s) => s.api);
  const toast = useStore((s) => s.showToast);
  const [answer, setAnswer] = useState<RsvpAnswer | null>(invite.myAnswer);
  const [busy, setBusy] = useState(false);
  const [clash, setClash] = useState<MobileEvent | null>(null);

  useEffect(() => {
    let live = true;
    void api.events(invite.startMs, invite.endMs).then((evs) => {
      if (!live) return;
      setClash(
        evs.find(
          (e) => e.id !== invite.eventId && !e.free && !e.allDay && e.title !== invite.title,
        ) ?? null,
      );
    });
    return () => {
      live = false;
    };
  }, [api, invite.startMs, invite.endMs, invite.eventId, invite.title]);

  const respond = async (key: RsvpAnswer | 'propose') => {
    if (key === 'propose') {
      go(`compose?reply=${encodeURIComponent(threadId)}&propose=1`);
      return;
    }
    if (!invite.eventId) {
      toast({ text: 'This invite is not on your calendar yet. Try again in a minute.' });
      return;
    }
    const prev = answer;
    setAnswer(key);
    setBusy(true);
    try {
      await api.rsvp(invite.eventId, accountId, key);
    } catch (e) {
      setAnswer(prev);
      toast({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const organizer = invite.organizer;
  return (
    <div className="glass pop" style={{ borderRadius: 24, padding: 16 }}>
      <div className="eyebrow" style={{ color: 'var(--muted)', fontSize: 10.5 }}>
        Invitation
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, letterSpacing: '-.01em' }}>
        {invite.title}
      </div>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12, fontSize: 14.5 }}
      >
        <div className="row-flex muted">
          <CalendarClock size={18} />
          <span style={{ color: 'var(--ink)' }}>
            {shortDate(invite.startMs)} · {timeRange(invite.startMs, invite.endMs)}
          </span>
        </div>
        {invite.meetingUrl && (
          <a className="row-flex" href={invite.meetingUrl} target="_blank" rel="noreferrer">
            <Video size={18} color="var(--muted)" />
            Google Meet
          </a>
        )}
        {invite.guests.length > 0 && (
          <div className="row-flex muted">
            <AvatarStack
              people={[
                ...(organizer ? [organizer] : []),
                ...invite.guests.filter((g) => g.email !== organizer?.email),
              ]}
              size={24}
            />
            <span>
              {firstName(organizer)} +{' '}
              {invite.guests.filter((g) => g.email !== organizer?.email).length} guests
            </span>
          </div>
        )}
      </div>
      {clash && (
        <div
          className="row-flex"
          style={{
            marginTop: 12,
            display: 'inline-flex',
            padding: '6px 11px',
            borderRadius: 12,
            background: 'color-mix(in srgb, var(--danger) 13%, transparent)',
            color: 'var(--danger)',
            fontSize: 13,
          }}
        >
          <AlertTriangle size={14} /> Clashes with “{clash.title}”
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        {TILES.map(({ key, label, Icon, tilt, bg, ic }) => (
          <button
            key={key}
            className={`tile ${answer && key !== answer && key !== 'propose' ? 'dim' : ''} ${answer === key ? 'chosen' : ''}`}
            style={{ transform: `rotate(${tilt}deg)`, background: bg }}
            disabled={busy}
            onClick={() => void respond(key)}
          >
            <span className="ic" style={{ color: ic }}>
              <Icon size={16} strokeWidth={2.4} />
            </span>
            {answer === key ? CHOSEN[key] : label}
          </button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        {displayName(organizer) === 'Unknown' ? 'The organizer' : firstName(organizer)} gets your
        answer from Google ·{' '}
        <button
          style={{ color: 'var(--accent)' }}
          onClick={() => go(`compose?reply=${encodeURIComponent(threadId)}`)}
        >
          Add a note
        </button>
      </div>
    </div>
  );
}
