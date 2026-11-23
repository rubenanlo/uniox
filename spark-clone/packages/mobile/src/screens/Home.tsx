import { Bell, ChevronRight, Search, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { MobileEvent, MobileThread } from "../data/types";
import { AiMark, Avatar } from "../components/ui";
import {
  clock,
  dayLabel,
  displayName,
  firstName,
  greeting,
  startOfDay,
  workdayPercent,
} from "../lib/format";
import { go } from "../lib/router";
import { useStore } from "../lib/store";
import { useNow } from "../lib/useNow";
import "./home.css";

type CardKind = "reply" | "plate" | "prep" | "news";
const CARDS: CardKind[] = ["reply", "plate", "prep", "news"];
const TITLE: Record<CardKind, string> = {
  reply: "Needs your reply",
  plate: "On your plate",
  prep: "Coming up",
  news: "Today’s news",
};
const NEWS_Q = "assistant?q=What%20is%20new%20in%20my%20newsletters%3F";

/* Horizon geometry: each day spans 7:00–20:00 on the line. */
const PX = 52;
const H0 = 7;
const H1 = 20;
const GAP = 50;
const DAY_W = (H1 - H0) * PX;
const DAY_MS = 86_400_000;
const LEAD = 110;

const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hourOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60;
};

/** Ambient motion only while the app is on screen and focused. */
function useActive(): boolean {
  const [on, setOn] = useState(() => !document.hidden);
  useEffect(() => {
    const sync = () => setOn(!document.hidden && document.hasFocus());
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return on;
}

/** How far the screen must be pulled down before letting go opens Search. */
const PULL_GO = 90;

/**
 * Pull the Home down to search. Vertical drags anywhere outside the two
 * sideways scrollers move the page with some resistance and grow a glass
 * search bubble under the navbar; letting go past PULL_GO opens Search.
 * Styles are written straight to the nodes so a drag never re-renders Home.
 */
function usePullToSearch(enabled: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const bubble = bubbleRef.current;
    if (!root || !bubble || !enabled) return;
    let g: { id: number; x: number; y: number; axis: "x" | "y" | null } | null =
      null;
    let pulled = 0;
    const paint = (d: number) => {
      pulled = d;
      const shift = d * 0.35;
      root.style.setProperty("--pull", `${shift}px`);
      bubble.style.opacity = String(Math.min(1, d / 60));
      bubble.style.transform = `translateY(${Math.min(d * 0.45, 56) - 24}px) scale(${0.6 + Math.min(d / PULL_GO, 1) * 0.4})`;
      bubble.classList.toggle("ready", d >= PULL_GO);
    };
    const reset = () => {
      root.classList.remove("pulling");
      root.style.removeProperty("--pull");
      bubble.style.opacity = "";
      bubble.style.transform = "";
      bubble.classList.remove("ready");
      pulled = 0;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || g) return;
      const t = e.target as Element;
      if (t.closest(".hz-line, .hz-cards, .hz-peek")) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null };
    };
    const move = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (!g.axis) {
        if (Math.hypot(dx, dy) < 8) return;
        g.axis = dy > 0 && dy > Math.abs(dx) ? "y" : "x";
        if (g.axis === "y") {
          root.classList.add("pulling");
          root.setPointerCapture(e.pointerId);
        }
      }
      if (g.axis !== "y") return;
      // Rubber band: easy at first, stiffer the further it goes.
      const d = Math.max(0, dy);
      paint(d < PULL_GO ? d : PULL_GO + (d - PULL_GO) * 0.4);
    };
    const up = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const go_ = g.axis === "y" && pulled >= PULL_GO;
      g = null;
      reset();
      if (go_) go("search");
    };
    // A pull that ends on a button must not also tap it.
    const click = (e: MouseEvent) => {
      if (root.dataset.pulled) {
        e.stopPropagation();
        e.preventDefault();
        delete root.dataset.pulled;
      }
    };
    const mark = () => {
      if (g?.axis === "y") root.dataset.pulled = "1";
    };
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", mark, true);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    root.addEventListener("click", click, true);
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", mark, true);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", up);
      root.removeEventListener("click", click, true);
      reset();
    };
  }, [enabled]);
  return { rootRef, bubbleRef };
}

export function Home() {
  const { threads, me, api, accounts } = useStore();
  const nowMs = useNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [fanned, setFanned] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const active = useActive();
  const { rootRef, bubbleRef } = usePullToSearch(!fanned);

  useEffect(() => {
    const from = startOfDay(nowMs);
    void api.events(from, from + 3 * DAY_MS).then(setEvents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, threads]);

  const priority = useMemo(
    () =>
      threads
        .filter((t) => t.priority)
        .sort((a, b) => a.lastMessageAt - b.lastMessageAt),
    [threads],
  );
  const needsReply = useMemo(
    () =>
      priority
        .filter((t) => t.unreadCount > 0)
        .slice(-3)
        .reverse(),
    [priority],
  );
  const plate = priority
    .filter((t) => t.pinned || t.unreadCount > 0)
    .slice(-4)
    .reverse();
  const today0 = startOfDay(nowMs);
  const todays = events.filter(
    (e) =>
      !e.allDay &&
      !e.free &&
      e.startMs >= today0 &&
      e.startMs < today0 + DAY_MS,
  );
  const meetingsLeft = todays.filter((e) => e.startMs > nowMs).length;
  const nextMeetings = events
    .filter((e) => !e.allDay && !e.free && e.endMs > nowMs)
    .slice(0, 3);
  const unread = priority.filter((t) => t.unreadCount > 0).length;
  const full = accounts.find((a) => a.email === me?.email)?.displayName ?? "";
  const name = /\s/.test(full)
    ? firstName({ email: "", name: full })
    : (me?.email.split(/[.@]/)[0] ?? "there");
  const pct = workdayPercent(now);

  // The line: today on the right, earlier days with priority mail to its left
  // (the same four days the old timeline showed).
  const recent = priority.filter((t) => t.lastMessageAt > nowMs - 4 * DAY_MS);
  const days = [
    ...new Set([...recent.map((t) => startOfDay(t.lastMessageAt)), today0]),
  ].sort((a, b) => a - b);
  const dayX = (day: number) => LEAD + days.indexOf(day) * (DAY_W + GAP);
  const xOf = (ms: number) =>
    dayX(startOfDay(ms)) + (Math.min(H1, Math.max(H0, hourOf(ms))) - H0) * PX;
  const trackW = dayX(today0) + DAY_W + 60;
  const next = todays.find((e) => e.startMs > nowMs);
  const selThread = recent.find((t) => t.id === sel) ?? null;

  const lineRef = useRef<HTMLDivElement>(null);
  const briefRef = useRef<HTMLButtonElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);
  const [closing, setClosing] = useState(false);

  // Open on "now", once the line has its width.
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    const el = lineRef.current;
    if (!el || scrolled.current || !days.length) return;
    el.scrollLeft = xOf(nowMs) - el.clientWidth * 0.62;
    scrolled.current = true;
  });

  // The pill's width follows its label (both labels sit in one grid cell).
  const sizeBrief = (fold: boolean) => {
    const btn = briefRef.current;
    const lbl = btn?.querySelector<HTMLElement>(
      fold ? ".lb-fold" : ".lb-brief",
    );
    if (!btn || !lbl) return;
    btn.style.width = `${Math.ceil(9 + 22 + 8 + lbl.getBoundingClientRect().width + 15 + 2)}px`;
  };
  useLayoutEffect(() => sizeBrief(fanned), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** One move: width eases, the labels cross over, the mark turns, a ring breathes out. */
  const morph = (fold: boolean) => {
    const btn = briefRef.current;
    if (!btn) return;
    sizeBrief(fold);
    const inL = btn.querySelector<HTMLElement>(
      fold ? ".lb-fold" : ".lb-brief",
    )!;
    const outL = btn.querySelector<HTMLElement>(
      fold ? ".lb-brief" : ".lb-fold",
    )!;
    outL.classList.remove("in", "down");
    outL.classList.add("up");
    inL.classList.remove("up", "in");
    inL.classList.add("down");
    void inL.offsetWidth;
    inL.classList.replace("down", "in");
    window.setTimeout(() => {
      if (!outL.classList.contains("up")) return;
      outL.classList.add("notrans");
      outL.classList.replace("up", "down");
      void outL.offsetWidth;
      outL.classList.remove("notrans");
    }, 420);
    if (reduceMotion()) return;
    btn
      .querySelector(".ai-mark")
      ?.animate(
        [
          { transform: "rotate(0)" },
          { transform: `rotate(${fold ? 180 : -180}deg)` },
        ],
        { duration: 520, easing: "cubic-bezier(.2,.9,.3,1)" },
      );
    btn.animate(
      [
        {
          boxShadow:
            "var(--glass-shadow), 0 0 0 0 color-mix(in oklab, var(--accent) 35%, transparent)",
        },
        {
          boxShadow:
            "var(--glass-shadow), 0 0 0 12px color-mix(in oklab, var(--accent) 0%, transparent)",
        },
      ],
      { duration: 700, easing: "ease-out" },
    );
  };

  /** Vector from a card's centre to the button's centre. */
  const toButton = (el: Element) => {
    const b = briefRef.current!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return [
      b.left + b.width / 2 - (r.left + r.width / 2),
      b.top + b.height / 2 - (r.top + r.height / 2),
    ];
  };

  // Cards bloom out of the button, one after another, then their rows cascade.
  useLayoutEffect(() => {
    if (!fanned || closing || reduceMotion()) return;
    const cards = [...(cardsRef.current?.querySelectorAll(".hz-card") ?? [])];
    const rot = [-6, -2, 2, 6];
    cards.forEach((c, i) => {
      const [dx, dy] = toButton(c);
      c.animate(
        [
          {
            transform: `translate(${dx}px,${dy}px) rotate(${rot[i]}deg) scale(.15)`,
            opacity: 0,
            filter: "blur(10px)",
            borderRadius: "999px",
          },
          { opacity: 1, filter: "blur(0)", offset: 0.55 },
          {
            transform: "none",
            opacity: 1,
            filter: "blur(0)",
            borderRadius: "22px",
          },
        ],
        {
          duration: 720,
          delay: i * 80,
          easing: "cubic-bezier(.34,1.3,.5,1)",
          fill: "backwards",
        },
      );
      c.querySelectorAll(".hz-row").forEach((r, j) =>
        r.animate(
          [
            { opacity: 0, transform: "translateY(6px)" },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: 450,
            delay: i * 80 + 300 + j * 60,
            easing: "cubic-bezier(.22,1,.36,1)",
            fill: "backwards",
          },
        ),
      );
      c.querySelector(".sheen")?.animate(
        [
          { transform: "translateX(-140%) skewX(-18deg)" },
          { transform: "translateX(320%) skewX(-18deg)" },
        ],
        {
          duration: 1100,
          delay: i * 80 + 360,
          easing: "cubic-bezier(.22,1,.36,1)",
        },
      );
    });
  }, [fanned]); // eslint-disable-line react-hooks/exhaustive-deps

  const openBrief = () => {
    setSel(null);
    setFanned(true);
    setSlide(0);
    morph(true);
  };
  const foldBrief = () => {
    if (!fanned || closing) return;
    morph(false);
    const cards = [...(cardsRef.current?.querySelectorAll(".hz-card") ?? [])];
    if (reduceMotion() || !cards.length) {
      setFanned(false);
      return;
    }
    setClosing(true);
    cards.forEach((c, i) => {
      const [dx, dy] = toButton(c);
      c.animate(
        [
          { transform: "none", opacity: 1 },
          {
            transform: `translate(${dx}px,${dy}px) scale(.12)`,
            opacity: 0,
            filter: "blur(8px)",
            borderRadius: "999px",
          },
        ],
        {
          duration: 420,
          delay: (cards.length - 1 - i) * 50,
          easing: "cubic-bezier(.55,0,.75,.3)",
          fill: "forwards",
        },
      );
    });
    window.setTimeout(
      () => {
        setFanned(false);
        setClosing(false);
      },
      420 + cards.length * 50,
    );
  };

  const peek = (id: string) => {
    if (fanned) foldBrief();
    setSel((s) => (s === id ? null : id));
  };

  const row = (
    key: string,
    lead: ReactNode,
    title: string,
    sub: string,
    to: string,
  ) => (
    <button key={key} className="hz-row" onClick={() => go(to)}>
      {lead}
      <span className="tx">
        <b>{title}</b>
        <span>{sub}</span>
      </span>
      <ChevronRight size={16} color="var(--faint)" />
    </button>
  );
  const threadRow = (t: MobileThread) =>
    row(
      t.id,
      <Avatar who={t.lastFrom} size={30} />,
      displayName(t.lastFrom),
      t.subject,
      `thread/${encodeURIComponent(t.id)}`,
    );

  const cardBody = (k: CardKind) => {
    if (k === "reply")
      return needsReply.length ? (
        needsReply.map(threadRow)
      ) : (
        <div className="empty">You’re all caught up.</div>
      );
    if (k === "plate")
      return plate.length ? (
        plate.map(threadRow)
      ) : (
        <div className="empty">Nothing pinned or waiting.</div>
      );
    if (k === "prep")
      return nextMeetings.length ? (
        nextMeetings.map((e) =>
          row(
            e.id,
            <span className="bar" style={{ background: e.color }} />,
            e.title,
            `${dayLabel(e.startMs)} · ${clock(e.startMs)}${e.attendees.length ? ` · ${e.attendees.length} guests` : ""}`,
            `calendar?event=${encodeURIComponent(e.id)}`,
          ),
        )
      ) : (
        <div className="empty">Nothing else on the calendar.</div>
      );
    return row(
      "news",
      <AiMark size={30} />,
      "What’s new in my newsletters?",
      "Ask the assistant for today’s digest",
      NEWS_Q,
    );
  };

  // The sun's place in the sky follows the day.
  const p = Math.min(1, Math.max(0, (hourOf(nowMs) - 7.5) / 12));
  const skyPos = {
    "--sx": `${10 + p * 80}%`,
    "--sy": `${80 - Math.sin(p * Math.PI) * 55}%`,
  } as CSSProperties;

  return (
    <>
      <div
        ref={rootRef}
        className={`hz ${fanned ? "fanned" : ""} ${selThread ? "peeking" : ""} ${active ? "" : "hz-idle"}`}
      >
        <div className="hz-sky" style={skyPos}>
          <i />
          <i />
          <i />
        </div>
        <div className="navbar" style={{ padding: "0 18px" }}>
          <button
            className="row-flex"
            aria-label="Settings"
            onClick={() => go("settings")}
          >
            <Avatar
              who={{ email: me?.email ?? "me", name: me?.email }}
              size={30}
            />
          </button>
          <div className="row-flex">
            <button
              className="navbtn g"
              aria-label="Notifications"
              onClick={() => go("notifications")}
            >
              <Bell size={20} />
            </button>
            <button
              className="navbtn g accent"
              aria-label="Assistant"
              onClick={() => go("assistant")}
            >
              <AiMark size={24} />
            </button>
          </div>
        </div>

        <div className="hz-head">
          <div className="eyebrow">
            {now.toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
          <div className="greet">
            {greeting(now)}, <b>{name}</b>
          </div>
          <div className="sub">{workdayLine(now)}</div>
          <p className="hz-sent">
            You have{" "}
            <button className="hz-w" onClick={() => go("inbox")}>
              {count(unread, "priority email", "priority emails")}
            </button>{" "}
            and{" "}
            <button className="hz-w" onClick={() => go("calendar")}>
              {count(meetingsLeft, "meeting", "meetings")}
            </button>{" "}
            left today.{" "}
            <span className="hz-nb">
              <button className="hz-w" onClick={() => go("compose")}>
                Write something
              </button>
              ,
            </span>{" "}
            or pull down to{" "}
            <span className="hz-nb">
              <button className="hz-w" onClick={() => go("search")}>
                search
              </button>
              .
            </span>
          </p>
        </div>

        <div className="hz-mid">
          {fanned && (
            <>
              <div
                className="hz-cards"
                ref={cardsRef}
                onScroll={(e) =>
                  setSlide(Math.round(e.currentTarget.scrollLeft / 310))
                }
              >
                {CARDS.map((k) => (
                  <div key={k} className="hz-card glass">
                    <div className="hd">
                      <AiMark />
                      <b>{TITLE[k]}</b>
                      <button
                        className="x"
                        aria-label="Fold the brief"
                        onClick={foldBrief}
                      >
                        <X size={17} />
                      </button>
                    </div>
                    {cardBody(k)}
                    <span className="sheen" aria-hidden />
                  </div>
                ))}
              </div>
              <div
                className="hz-dots"
                style={{ opacity: closing ? 0 : 1, transition: "opacity .2s" }}
              >
                {CARDS.map((k, i) => (
                  <i key={k} className={i === slide ? "on" : ""} />
                ))}
              </div>
            </>
          )}
        </div>

        <button
          ref={briefRef}
          className="hz-brief glass"
          aria-label={fanned ? "Fold the brief" : "Brief me"}
          onClick={fanned ? foldBrief : openBrief}
        >
          <AiMark size={22} />
          <span className="hz-lbs">
            <span className={`hz-lb lb-brief ${fanned ? "down" : "in"}`}>
              Brief me
            </span>
            <span className={`hz-lb lb-fold ${fanned ? "in" : "down"}`}>
              Fold the brief
            </span>
          </span>
        </button>

        <div
          className="hz-line"
          ref={lineRef}
          aria-label="Priority mail across the last days"
        >
          <div className="hz-track" style={{ width: trackW }}>
            <span className="hz-end">
              That’s
              <br />
              everything
            </span>
            {days.map((d) => (
              <span key={d}>
                <span
                  className="hz-base"
                  style={{ left: dayX(d), width: DAY_W }}
                />
                <span className="hz-day" style={{ left: dayX(d) }}>
                  {dayLabel(d, nowMs)}
                </span>
                {[9, 12, 15, 18].map((h) => (
                  <span
                    key={h}
                    className="hz-tick"
                    style={{ left: dayX(d) + (h - H0) * PX }}
                  >
                    {h}:00
                  </span>
                ))}
              </span>
            ))}
            <span
              className="hz-lit"
              style={{
                left: dayX(today0) + (9 - H0) * PX,
                width: Math.max(0, Math.min(18, hourOf(nowMs)) - 9) * PX,
              }}
            />
            {todays.map((e) => (
              <button
                key={e.id}
                className={`hz-meet ${e.endMs <= nowMs ? "past" : ""}`}
                style={{
                  left: xOf(e.startMs),
                  width: Math.max(
                    8,
                    ((e.endMs - e.startMs) / 3_600_000) * PX - 3,
                  ),
                }}
                aria-label={`${e.title}, ${clock(e.startMs)}`}
                onClick={() => go(`calendar?event=${encodeURIComponent(e.id)}`)}
              >
                {e === next && (
                  <span>
                    {clock(e.startMs)} {e.title}
                  </span>
                )}
              </button>
            ))}
            {recent.map((t) => (
              <button
                key={t.id}
                className={`hz-pin ${t.unreadCount > 0 ? "unread" : ""} ${sel === t.id ? "sel" : ""}`}
                style={{ left: xOf(t.lastMessageAt) }}
                aria-label={`${displayName(t.lastFrom)}: ${t.subject}`}
                onClick={() => peek(t.id)}
              >
                <i />
              </button>
            ))}
            <span className="hz-now" style={{ left: xOf(nowMs) }}>
              <span>
                Now · {clock(nowMs)} · {pct}%
              </span>
            </span>
          </div>
        </div>
        <div className="hz-hint">
          Tap a dot to peek · swipe the line to go back in time
        </div>
      </div>

      <button
        className={`hz-peek ${selThread ? "on" : ""}`}
        aria-hidden={!selThread}
        tabIndex={selThread ? 0 : -1}
        onClick={() =>
          selThread && go(`thread/${encodeURIComponent(selThread.id)}`)
        }
      >
        {selThread && (
          <>
            <Avatar who={selThread.lastFrom} size={36} />
            <span className="tx">
              <b>{displayName(selThread.lastFrom)}</b>
              <span>{selThread.subject}</span>
              <em>
                {dayLabel(selThread.lastMessageAt, nowMs)} ·{" "}
                {clock(selThread.lastMessageAt)} · tap to open
              </em>
            </span>
            <ChevronRight size={16} color="var(--faint)" />
          </>
        )}
      </button>
      <div className="hz-pull glass" ref={bubbleRef} aria-hidden>
        <Search size={20} />
      </div>
    </>
  );
}

function count(n: number, one: string, many: string): string {
  if (n === 0) return `no ${many}`;
  return `${n} ${n === 1 ? one : many}`;
}

function workdayLine(now: Date): string {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 9) return "Workday starts at 9:00";
  if (h > 18) return "Workday wrapped at 18:00";
  const m = Math.round((18 - h) * 60);
  return `${Math.floor(m / 60)}h ${m % 60}m left in the workday`;
}
