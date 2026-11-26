import type { Address } from "@app/shared";
import { useEffect, useMemo, useState } from "react";
import { avatarColor, displayName, firstName, initials } from "../lib/format";
import { useStore } from "../lib/store";

type Block = { startMs: number; endMs: number };
export type GuestBusy = { me: string; busy: Record<string, Block[] | null> };

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** "Anna", "Anna and Tara", "Anna, Tara and Hugo", "Anna, Tara and 2 more". */
export function guestNames(guests: Address[]): string {
  const n = guests.map(firstName);
  if (n.length <= 1) return n[0] ?? "";
  if (n.length <= 3)
    return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  return `${n.slice(0, 2).join(", ")} and ${n.length - 2} more`;
}

/**
 * People you write with, most recent first, for the "with" picker: everyone
 * on your recent threads, minus your own addresses.
 */
function useKnownPeople(): Address[] {
  const threads = useStore((s) => s.threads);
  const accounts = useStore((s) => s.accounts);
  return useMemo(() => {
    const mine = new Set(accounts.map((a) => a.email.toLowerCase()));
    const seen = new Map<string, Address>();
    const sorted = [...threads].sort(
      (a, b) => b.lastMessageAt - a.lastMessageAt,
    );
    for (const t of sorted) {
      for (const p of [t.lastFrom, ...t.participants]) {
        if (!p?.email) continue;
        const e = p.email.toLowerCase();
        if (mine.has(e) || /no-?reply|notifications?@|mailer-daemon/.test(e))
          continue;
        const had = seen.get(e);
        if (!had)
          seen.set(e, { email: e, ...(p.name ? { name: p.name } : {}) });
        else if (!had.name && p.name) had.name = p.name;
      }
    }
    return [...seen.values()];
  }, [threads, accounts]);
}

/** Guests as removable chips, a field to add more, and matching people under it. */
export function GuestPicker({
  guests,
  onChange,
}: {
  guests: Address[];
  onChange: (g: Address[]) => void;
}) {
  const known = useKnownPeople();
  const [q, setQ] = useState("");
  const picked = new Set(guests.map((g) => g.email.toLowerCase()));
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? known
        .filter(
          (p) =>
            !picked.has(p.email) &&
            (p.email.includes(needle) ||
              (p.name ?? "").toLowerCase().includes(needle)),
        )
        .slice(0, 4)
    : [];
  const add = (p: Address) => {
    if (!picked.has(p.email.toLowerCase())) onChange([...guests, p]);
    setQ("");
  };
  const commit = () => {
    const typed = needle.replace(/[,;]+$/, "");
    if (EMAIL.test(typed)) add({ email: typed });
    else if (matches[0]) add(matches[0]);
  };
  return (
    <div className="cal-guests">
      <div className="chips">
        {guests.map((g) => (
          <button
            key={g.email}
            className="chip cal-guest"
            aria-label={`Remove ${displayName(g)}`}
            onClick={() => onChange(guests.filter((x) => x !== g))}
          >
            <span
              className="face"
              style={{ background: avatarColor(g) }}
              aria-hidden="true"
            >
              {initials(g)}
            </span>
            {firstName(g)}
          </button>
        ))}
        <input
          aria-label="Add someone"
          placeholder={guests.length ? "Add someone" : "Name or email"}
          value={q}
          inputMode="email"
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => {
            const v = e.target.value;
            // A comma or space after a full address adds it.
            if (
              /[,;\s]$/.test(v) &&
              EMAIL.test(v.trim().replace(/[,;]+$/, ""))
            ) {
              add({
                email: v
                  .trim()
                  .replace(/[,;]+$/, "")
                  .toLowerCase(),
              });
            } else setQ(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !q && guests.length) {
              onChange(guests.slice(0, -1));
            }
          }}
        />
      </div>
      {matches.length > 0 && (
        <div className="cal-people" role="listbox" aria-label="People">
          {matches.map((p) => (
            <button
              key={p.email}
              role="option"
              aria-selected="false"
              onClick={() => add(p)}
            >
              <span
                className="face"
                style={{ background: avatarColor(p) }}
                aria-hidden="true"
              >
                {initials(p)}
              </span>
              <span className="who">
                <span>{displayName(p)}</span>
                {p.name && <span className="muted">{p.email}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Busy times of you and the guests across the day, fetched again when the guests change. */
export function useGuestBusy(
  accountId: string,
  guests: Address[],
  fromMs: number,
  toMs: number,
): GuestBusy | null {
  const api = useStore((s) => s.api);
  const key = guests.map((g) => g.email.toLowerCase()).join(",");
  const ask = key && accountId ? `${accountId}|${key}|${fromMs}|${toMs}` : "";
  // The answer is kept with the question it answers, so a stale one is never shown.
  const [got, setGot] = useState<{ ask: string; busy: GuestBusy } | null>(null);
  useEffect(() => {
    if (!ask) return;
    let live = true;
    void api
      .freeBusy(accountId, key.split(","), fromMs, toMs)
      .then((busy) => live && setGot({ ask, busy }))
      .catch(() => live && setGot({ ask, busy: { me: "", busy: {} } }));
    return () => {
      live = false;
    };
  }, [api, ask, accountId, key, fromMs, toMs]);
  return got && got.ask === ask ? got.busy : null;
}

/**
 * Design A: one thin lane per person under the slot bar, the picked slot a band
 * across every lane. The band is teal when everyone is free, orange when not.
 */
export function GuestLanes({
  guests,
  busy,
  lo,
  hi,
  start,
  end,
}: {
  guests: Address[];
  busy: GuestBusy | null;
  lo: number;
  hi: number;
  start: number;
  end: number;
}) {
  const pct = (t: number) =>
    `${((Math.min(hi, Math.max(lo, t)) - lo) / (hi - lo)) * 100}%`;
  const blocksOf = (email: string) => busy?.busy[email.toLowerCase()];
  const rows = [
    {
      key: "me",
      label: "You",
      blocks: busy ? (busy.busy[busy.me] ?? []) : undefined,
    },
    ...guests.map((g) => ({
      key: g.email,
      label: firstName(g),
      blocks: blocksOf(g.email),
    })),
  ];
  const clashes = (bl: Block[] | null | undefined) =>
    !!bl?.some(
      (b) =>
        b.startMs < end && b.endMs > start && b.endMs > lo && b.startMs < hi,
    );
  const busyNow = guests.filter((g) => clashes(blocksOf(g.email)));
  const youBusy = !!busy && clashes(busy.busy[busy.me]);
  const hidden = busy ? guests.filter((g) => blocksOf(g.email) === null) : [];
  const loading = !busy;
  const ok = !loading && busyNow.length === 0 && !youBusy;

  let line: string;
  if (loading) line = "Checking their calendars…";
  else if (busyNow.length)
    line = `${guestNames(busyNow)} ${busyNow.length > 1 ? "are" : "is"} busy then.`;
  else if (youBusy) line = "You are busy then.";
  else {
    const seen = guests.filter((g) => blocksOf(g.email) !== null);
    line =
      seen.length === 0
        ? ""
        : seen.length === guests.length
          ? "Everyone is free then."
          : `${guestNames(seen)} ${seen.length > 1 ? "are" : "is"} free then.`;
  }
  const hiddenLine = hidden.length
    ? `${guestNames(hidden)}${hidden.length > 1 ? "'s calendars aren't" : "'s calendar isn't"} shared with you.`
    : "";

  return (
    <div className={`cal-lanes${loading ? " loading" : ""}`}>
      <div className="cal-lane-rows">
        {rows.map((r) => (
          <div className="cal-lane-row" key={r.key}>
            <span className="cal-lane-lb">{r.label}</span>
            {r.blocks === null ? (
              <span className="lane hidden">calendar not shared</span>
            ) : (
              <span className="lane">
                {(r.blocks ?? [])
                  .filter((b) => b.endMs > lo && b.startMs < hi)
                  .map((b) => (
                    <span
                      key={`${b.startMs}-${b.endMs}`}
                      className="busy"
                      style={{
                        left: pct(b.startMs),
                        width: `calc(${pct(b.endMs)} - ${pct(b.startMs)})`,
                      }}
                    />
                  ))}
              </span>
            )}
          </div>
        ))}
        <span className="bandwrap" aria-hidden="true">
          <span
            className={`band${ok ? " ok" : loading ? "" : " warn"}`}
            style={{
              left: pct(start),
              width: `calc(${pct(end)} - ${pct(start)})`,
            }}
          />
        </span>
      </div>
      {(line || hiddenLine) && (
        <p
          className={`cal-lanes-say${ok ? " ok" : busyNow.length || youBusy ? " warn" : ""}`}
          aria-live="polite"
        >
          {line} {hiddenLine}
        </p>
      )}
    </div>
  );
}
