/**
 * The notification overlay's page: styles only. All markup is built by the
 * overlay preload (textContent, never innerHTML), so the page itself runs no
 * script and its CSP forbids any.
 *
 * Motion is CSS transitions on transform/opacity only: they run on the
 * compositor for the ~300 ms a card enters or leaves and nothing animates
 * while a card just sits there.
 */
export const OVERLAY_WIDTH = 392;
export const OVERLAY_HEIGHT = 640;

const CSS = `
:root {
  --surface: rgb(255 255 255 / 0.93);
  --rim: rgb(255 255 255 / 0.7);
  --sunken: rgb(0 0 0 / 0.05);
  --sunken-hover: rgb(0 0 0 / 0.09);
  --ink: #1c1c1f;
  --ink-muted: #6d6d75;
  --ink-faint: #a3a3ab;
  --hairline: rgb(0 0 0 / 0.09);
  --accent: #2f63e7;
  --on-accent: #ffffff;
  --aqua: oklch(0.72 0.13 178);
  --azure: oklch(0.6 0.16 250);
  --violet: oklch(0.58 0.19 295);
  --priority: #c47b0a;
  --shadow: 0 14px 36px rgb(20 20 40 / 0.18), 0 2px 8px rgb(20 20 40 / 0.08);
}
.dark {
  --surface: rgb(32 32 38 / 0.92);
  --rim: rgb(255 255 255 / 0.09);
  --sunken: rgb(255 255 255 / 0.07);
  --sunken-hover: rgb(255 255 255 / 0.12);
  --ink: #e8e8ec;
  --ink-muted: #9b9ba4;
  --ink-faint: #64646d;
  --hairline: rgb(255 255 255 / 0.1);
  --accent: #7fa2ff;
  --on-accent: #0f1730;
  --aqua: oklch(0.82 0.13 178);
  --azure: oklch(0.7 0.15 250);
  --violet: oklch(0.68 0.19 295);
  --priority: #eba13f;
  --shadow: 0 12px 34px rgb(0 0 0 / 0.5), 0 2px 6px rgb(0 0 0 / 0.3);
}
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; overflow: hidden; }
body {
  font: 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  user-select: none;
  cursor: default;
}
#stack { position: absolute; top: 0; right: 0; width: 100%; padding: 8px 16px 24px 10px; display: flex; flex-direction: column; align-items: flex-end; }
#stack > .card + .card, #stack > .deck + .card { margin-top: 10px; }
/* "Island": a glass capsule (avatar, sender, subject) that opens into a full
   card while hovered. Same glass as the quick-reply widget: a near-opaque
   fill with soft aqua/violet light, since a transparent window can't blur
   what's behind it. Width animates from fit-content via interpolate-size. */
.card {
  interpolate-size: allow-keywords;
  position: relative;
  z-index: 1;
  width: fit-content;
  max-width: 100%;
  background:
    radial-gradient(120% 90% at 0% 0%, color-mix(in oklab, var(--aqua) 16%, transparent), transparent 55%),
    radial-gradient(110% 90% at 100% 100%, color-mix(in oklab, var(--violet) 14%, transparent), transparent 60%),
    var(--surface);
  border: 1px solid var(--rim);
  border-radius: 28px;
  box-shadow: var(--shadow);
  padding: 7px 16px 7px 7px;
  transition:
    transform 320ms cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 220ms ease-out,
    width 220ms cubic-bezier(0.2, 0.8, 0.2, 1) 250ms, border-radius 220ms ease-out 250ms, padding 220ms ease-out 250ms;
}
/* Opens at once, closes after a beat: moving down to the next card doesn't
   pull it out from under the pointer. */
.card:hover { width: 100%; border-radius: 22px; padding: 11px 12px 12px; transition-delay: 0ms; }
.card.enter { transform: translateX(calc(100% + 24px)); opacity: 0; }
/* A newer mail taking the top spot: it settles in where the capsule already
   is (the old one tucks into the deck) instead of the whole capsule sliding
   off and back in for every message. */
.card.swap { transform: translateY(-6px) scale(0.97); opacity: 0; transition-duration: 260ms, 180ms; }
/* The previous top mail sinking into the deck (a copy; the real one waits there). */
.card.tuck { pointer-events: none; z-index: 2; }
/* The next mail rising off the deck. */
.card.rise { transform: translateY(-10px) scale(0.97); opacity: 0.4; transition-duration: 260ms, 200ms; }
.card.leave { transform: translateX(calc(100% + 24px)); opacity: 0; transition-timing-function: cubic-bezier(0.5, 0, 0.75, 0), ease-in; transition-duration: 220ms, 200ms; }
.top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.av {
  flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  color: #fff; font-size: 11.5px; font-weight: 650; letter-spacing: 0.01em;
}
.priority .av { box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--priority); }
.av.cal { color: var(--violet); background: color-mix(in oklab, var(--violet) 15%, transparent); }
.av svg, .btn svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.btn svg { width: 13px; height: 13px; }
.head { min-width: 0; flex: 1; }
.name { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.title { font-size: 13.5px; font-weight: 650; letter-spacing: -0.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.when { flex: none; font-size: 11px; color: var(--ink-faint); }
.card:hover .when { margin-left: auto; }
.count { flex: none; font-size: 10.5px; font-weight: 650; color: var(--ink-muted); background: var(--sunken); border-radius: 999px; padding: 1px 6px; }
.chip { flex: none; font-size: 10.5px; line-height: 16px; padding: 0 7px; border-radius: 999px; border: 1px solid; }
.chip { display: none; }
.card:hover .chip { display: inline; }
.chip.priority { color: var(--priority); border-color: color-mix(in oklab, var(--priority) 45%, transparent); }
.chip.meeting { color: var(--violet); border-color: color-mix(in oklab, var(--violet) 45%, transparent); }
.line { font-size: 12.5px; color: var(--ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px; }
.card:hover .line { max-width: none; color: var(--ink); font-weight: 600; }
.event .line { font-weight: 400 !important; color: var(--ink-muted) !important; }
.inline-join { margin-left: 4px; }
.card:hover .inline-join { display: none; }
/* The rest opens with the card (rows 0fr -> 1fr, no layout work while resting). */
.more { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 220ms cubic-bezier(0.2, 0.8, 0.2, 1) 250ms, opacity 160ms ease-out 250ms; }
.more > div { overflow: hidden; min-width: 0; }
.card:hover .more { grid-template-rows: 1fr; opacity: 1; transition-delay: 0ms; }
.snippet { font-size: 12.5px; color: var(--ink-muted); margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.close {
  position: absolute; top: -6px; left: -6px; width: 20px; height: 20px; border-radius: 50%; z-index: 2;
  border: 0.5px solid var(--hairline); background: var(--surface); color: var(--ink-muted);
  display: grid; place-items: center; font-size: 12px; line-height: 1; padding: 0;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); opacity: 0; transition: opacity 120ms;
}
.card:hover .close { opacity: 1; }
/* Older mail tucked behind the top capsule. */
.deck { position: relative; height: 12px; margin-top: -4px; z-index: 0; width: 240px; }
.deck div {
  position: absolute; height: 12px; border-radius: 0 0 14px 14px;
  background: var(--surface); border: 1px solid var(--rim); border-top: 0; box-shadow: 0 4px 10px rgb(0 0 0 / 0.08);
}
.deck .d1 { top: 0; left: 14px; right: 14px; opacity: 0.9; }
.deck .d2 { top: 5px; left: 30px; right: 30px; opacity: 0.6; }
.deck[hidden], .deck .d2[hidden] { display: none; }
/* Meetings: a bar that drains toward the start time (stepped every 30 s, not animated per frame). */
.bar { height: 3px; border-radius: 3px; background: var(--sunken); margin-top: 10px; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--aqua), var(--azure), var(--violet)); transform-origin: left; transition: transform 600ms ease-out; }
.buttons { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
.btn {
  font: inherit; font-size: 12px; font-weight: 550; border: 1px solid var(--hairline); border-radius: 999px; padding: 4px 10px;
  background: var(--sunken); color: var(--ink); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
}
.btn:hover { background: var(--sunken-hover); }
.btn.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.btn.primary:hover { filter: brightness(1.08); }
/* Glass looks (Frosted / Liquid glass): smoked glass. macOS's glass turns
   mid-grey over busy or dark windows and the theme's grey ink vanished on
   it, so the glass gets a dark smoked tint with white ink, the same in light
   and dark mode (like the system volume HUD). Settings → Transparency behind
   can only make the smoke denser, never thinner than the floor. */
.frosted, .dark.frosted {
  --smoke: 16 16 20;
  --smoke-floor: 0.62;
  --ink: #ffffff;
  --ink-muted: rgb(255 255 255 / 0.78);
  --ink-faint: rgb(255 255 255 / 0.58);
  --sunken: rgb(255 255 255 / 0.12);
  --sunken-hover: rgb(255 255 255 / 0.18);
  --hairline: rgb(255 255 255 / 0.14);
  --surface: #1d1d22;
  --accent: #ffffff;
  --on-accent: #111216;
  --aqua: oklch(0.82 0.13 178);
  --azure: oklch(0.7 0.15 250);
  --violet: oklch(0.72 0.17 295);
  --priority: #eba13f;
}
.dark.frosted { --smoke: 10 10 14; --smoke-floor: 0.7; }
.frosted .card {
  background: rgb(var(--smoke) / max(var(--smoke-floor), var(--glass-frost, 0)));
  border-color: rgb(255 255 255 / 0.22);
  border-width: 0.5px;
  box-shadow: 0 14px 36px rgb(0 0 0 / 0.28);
}
.frosted .deck div { background: rgb(28 28 34 / 0.82); border-color: rgb(255 255 255 / 0.16); }
/* Liquid Glass can't follow a card while it slides (the glass window trails
   it by a frame or more and showed as an empty capsule), so a card in motion
   gets a painted fill instead, and the glass takes over once it has settled:
   the fill fades out just as the glass appears under it. */
.card::before {
  content: ''; position: absolute; inset: -1px; z-index: -1; border-radius: inherit; pointer-events: none;
  background: rgb(30 30 36 / 0.92);
  border: 0.5px solid rgb(255 255 255 / 0.2);
  opacity: 0; transition: opacity 200ms ease-out 120ms;
}
.liquid .card.moving::before { opacity: 1; transition: none; }
@media (prefers-reduced-motion: reduce) {
  .card, .card.leave, .card.rise, .card.swap, .more, .bar i { transition-duration: 1ms !important; }
}
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>${CSS}</style></head><body><div id="stack"></div></body></html>`;

export const OVERLAY_URL = `data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`;
