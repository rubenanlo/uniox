import type { InviteInfo, InviteResponse } from "@app/shared";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  HelpCircle,
  Loader2,
  MapPin,
  Repeat,
  Video,
  X,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import {
  ProposePanel,
  dayFmt,
  inviteWhen,
  timeFmt,
  useClashes,
} from "../invite/InviteCard";
import { ChatAvatar } from "./ChatParts";

/**
 * The invite as the chat layout shows it (reading pane and ⌥⌘N island): the
 * event's details as the body, a clash line, then four answer tiles in a row
 * that fills the card. Each tile is slightly tilted (its text stays upright)
 * and carries a soft glass tint of its meaning: green, amber, rose, accent.
 * Hover straightens and lifts a tile; once answered, the chosen tile fills and
 * the others fade until "Change" is pressed. Answers act on the invite itself
 * (Google event or iTIP reply), never by writing an email.
 */

type Answer = InviteResponse | "propose";

const ANSWERS: {
  id: Answer;
  label: string;
  done: string;
  icon: typeof Check;
  color: string;
  tilt: number;
}[] = [
  {
    id: "accepted",
    label: "Accept",
    done: "Going",
    icon: Check,
    color: "#10b981",
    tilt: -2,
  },
  {
    id: "tentative",
    label: "Maybe",
    done: "Maybe",
    icon: HelpCircle,
    color: "#f59e0b",
    tilt: 1.5,
  },
  {
    id: "declined",
    label: "Decline",
    done: "Not going",
    icon: X,
    color: "#f43f5e",
    tilt: -1.5,
  },
  {
    id: "propose",
    label: "Propose",
    done: "Proposing",
    icon: CalendarClock,
    color: "var(--color-accent)",
    tilt: 2,
  },
];

const mix = (color: string, pct: number) =>
  `color-mix(in oklab, ${color} ${pct}%, transparent)`;

/** The organizer's first name, never a piece of their email address. */
const organizerName = (info: InviteInfo, capital = false) =>
  info.organizer?.name?.trim().split(/\s+/)[0] ||
  (capital ? "The organizer" : "the organizer");

/** Guests other than the organizer, who is often listed among them too. */
const otherGuests = (info: InviteInfo) =>
  info.attendees.filter(
    (p) => p.email.toLowerCase() !== info.organizer?.email.toLowerCase(),
  );

const isMeet = (loc?: string) =>
  !!loc && /meet\.google\.com|zoom\.us|teams\.microsoft/i.test(loc);

function Faces({ info }: { info: InviteInfo }) {
  const people = [
    ...(info.organizer ? [info.organizer] : []),
    ...otherGuests(info),
  ];
  if (!people.length) return null;
  return (
    <span className="flex shrink-0 items-center">
      {people.slice(0, 4).map((p, i) => (
        <span
          key={p.email}
          className={cn("ring-paper rounded-full ring-2", i > 0 && "-ml-1")}
        >
          <ChatAvatar who={p.name || p.email} small />
        </span>
      ))}
    </span>
  );
}

export function InviteChatCard({ info: given }: { info: InviteInfo }) {
  // An answer just given, until the host's copy catches up.
  const [answered, setAnswered] = useState<{
    id: string;
    info: InviteInfo;
  } | null>(null);
  const info = answered?.id === given.messageId ? answered.info : given;
  const clashes = useClashes(info);
  const [busy, setBusy] = useState<InviteResponse | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposed, setProposed] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [changing, setChanging] = useState(false);

  const canAnswer = info.kind === "request" && !info.past;
  const cancelled = info.kind === "cancel";
  const guests = otherGuests(info).length;
  const who = organizerName(info);
  const answeredNow = info.myStatus !== "needs-action" && !changing;

  const answer = async (response: InviteResponse) => {
    if (busy) return;
    setBusy(response);
    const res = await api.command("invite:respond", {
      messageId: info.messageId,
      response,
      note: note.trim() || undefined,
    });
    setBusy(null);
    if (!res.ok) {
      toast(res.error ?? "Couldn’t answer the invite");
      return;
    }
    setNote("");
    setNoteOpen(false);
    setChanging(false);
    setAnswered({
      id: info.messageId,
      info: res.info ?? { ...info, myStatus: response },
    });
    toast(
      response === "accepted"
        ? `Accepted. ${organizerName(info, true)} will see you’re going.`
        : response === "declined"
          ? `Declined. ${organizerName(info, true)} will see you’re not going.`
          : `Marked as maybe. ${organizerName(info, true)} will see it.`,
    );
  };

  const c = clashes?.[0];

  return (
    <div data-invite-card className="min-w-0 text-left">
      <span className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
        {cancelled ? "Cancelled invitation" : "Invitation"}
      </span>
      <h3
        className={cn(
          "mt-1 text-[17px] leading-snug font-semibold",
          cancelled && "line-through opacity-70",
        )}
      >
        {info.summary || "Invitation"}
      </h3>
      <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[13px]">
        <CalendarClock size={14} className="text-ink-muted" />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{inviteWhen(info)}</span>
          {info.recurring && (
            <span className="text-ink-muted flex shrink-0 items-center gap-1">
              · <Repeat size={11} /> repeats
            </span>
          )}
        </span>
        {info.location && (
          <>
            {isMeet(info.location) ? (
              <Video size={14} className="text-ink-muted" />
            ) : (
              <MapPin size={14} className="text-ink-muted" />
            )}
            <span
              className={cn(
                "truncate",
                isMeet(info.location) && "text-accent font-medium",
              )}
            >
              {/meet\.google\.com/i.test(info.location)
                ? "Google Meet"
                : info.location}
            </span>
          </>
        )}
        {(info.organizer || guests > 0) && (
          <>
            <span className="text-ink-muted text-[12px]">From</span>
            <span className="flex min-w-0 items-center gap-2">
              <Faces info={info} />
              <span className="text-ink-muted truncate text-[12px]">
                {info.organizer?.name || info.organizer?.email}
                {guests > 0 && ` + ${guests} guest${guests > 1 ? "s" : ""}`}
              </span>
            </span>
          </>
        )}
      </div>

      {cancelled ? (
        <p className="text-ink-muted mt-3 text-[12.5px]">
          {organizerName(info, true)} cancelled this event. Nothing to answer.
        </p>
      ) : info.past ? (
        <p className="text-ink-muted mt-3 text-[12.5px]">
          This event has already happened.
        </p>
      ) : c ? (
        <p className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 text-[12px] text-amber-800 dark:text-amber-200">
          <AlertTriangle size={12} className="shrink-0" />
          <span className="truncate">
            Clashes with “{c.title || "Busy"}” at {timeFmt.format(c.startMs)}
            {clashes!.length > 1 && ` and ${clashes!.length - 1} more`}
          </span>
        </p>
      ) : clashes && !info.allDay ? (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[12px] text-emerald-800 dark:text-emerald-200">
          <Check size={12} /> You’re free then
        </p>
      ) : null}

      {canAnswer && (
        <>
          <div className="mt-5 mb-1 grid grid-cols-4 gap-2.5 px-1">
            {ANSWERS.map((a) => {
              const on =
                a.id === "propose" ? proposing : info.myStatus === a.id;
              const faded = (answeredNow || proposing) && !on;
              const loading = busy === a.id;
              return (
                <button
                  key={a.id}
                  disabled={!!busy}
                  aria-pressed={on}
                  onClick={() =>
                    a.id === "propose"
                      ? setProposing((v) => !v)
                      : void answer(a.id as InviteResponse)
                  }
                  style={
                    {
                      "--tilt": `${on ? 0 : a.tilt}deg`,
                      "--untilt": `${on ? 0 : -a.tilt}deg`,
                      borderColor: on ? mix(a.color, 55) : undefined,
                      boxShadow: on
                        ? `0 16px 30px -16px ${mix(a.color, 80)}`
                        : undefined,
                    } as CSSProperties
                  }
                  className={cn(
                    "group relative h-[86px] min-w-0 rounded-[16px] text-left",
                    "border border-white/55 bg-white/45 backdrop-blur-xl backdrop-saturate-150 dark:border-white/12 dark:bg-white/[.07]",
                    "rotate-(--tilt) shadow-[0_8px_18px_-14px_rgba(0,0,0,.28)]",
                    "transition-[rotate,translate,scale,opacity,filter,box-shadow] duration-300 ease-out",
                    "hover:-translate-y-[3px] hover:rotate-0 hover:opacity-100 hover:shadow-[0_14px_26px_-14px_rgba(0,0,0,.35)] hover:saturate-100",
                    "active:scale-96 disabled:cursor-default",
                    on && "-translate-y-1",
                    faded && "opacity-45 saturate-0",
                    busy && !loading && "opacity-60",
                  )}
                >
                  {/* The tint lives on its own layer so hover can deepen it with a fade. */}
                  <span
                    aria-hidden
                    style={{ background: mix(a.color, 42) }}
                    className={cn(
                      "absolute inset-0 rounded-[inherit] transition-opacity duration-300",
                      on
                        ? "opacity-100"
                        : "opacity-50 group-hover:opacity-65 group-active:opacity-80",
                    )}
                  />
                  <span className="absolute inset-0 flex rotate-(--untilt) flex-col justify-between p-3 transition-[rotate] duration-300 group-hover:rotate-0">
                    <span
                      className="grid size-[24px] place-items-center rounded-full"
                      style={{
                        background: on ? a.color : mix(a.color, 22),
                        color: on ? "white" : a.color,
                      }}
                    >
                      {loading ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <a.icon size={13} strokeWidth={on ? 3 : 2.25} />
                      )}
                    </span>
                    <span className="text-ink truncate text-[17px] leading-none font-semibold tracking-[-0.02em]">
                      {on ? a.done : a.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {noteOpen && !proposing && (
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={`Note to ${who}, sent with your answer`}
              className="qr-field mt-3 h-[32px] w-full rounded-lg px-2.5 text-[12.5px]"
            />
          )}
          {proposing && (
            <ProposePanel
              info={info}
              island
              onCancel={() => setProposing(false)}
              onSent={(ms) => {
                setProposing(false);
                setProposed(ms);
                toast(`New time sent to ${who}`);
              }}
            />
          )}
          {proposed !== null && !proposing && (
            <p className="text-ink-muted mt-2.5 text-[12px]">
              You proposed {dayFmt.format(proposed)} ·{" "}
              {timeFmt.format(proposed)}. {organizerName(info, true)} can accept
              it from their calendar.
            </p>
          )}
          <p className="text-ink-faint mt-3 text-[11.5px]">
            {answeredNow
              ? info.via === "google"
                ? `Sent. ${organizerName(info, true)} sees it in Google Calendar`
                : `Sent as a calendar reply to ${who}`
              : info.via === "google"
                ? `${organizerName(info, true)} gets your answer from Google`
                : `${organizerName(info, true)} gets a calendar reply, no email to write`}
            {answeredNow ? (
              <>
                {" · "}
                <button
                  onClick={() => setChanging(true)}
                  className="text-accent font-medium hover:underline"
                >
                  Change
                </button>
              </>
            ) : (
              !noteOpen &&
              !proposing && (
                <>
                  {" · "}
                  <button
                    onClick={() => setNoteOpen(true)}
                    className="text-accent font-medium hover:underline"
                  >
                    Add a note
                  </button>
                </>
              )
            )}
          </p>
        </>
      )}
    </div>
  );
}
