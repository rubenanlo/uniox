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
  --surface: rgb(255 255 255 / 0.96);
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
  --shadow: 0 10px 30px rgb(0 0 0 / 0.16), 0 2px 6px rgb(0 0 0 / 0.08);
}
.dark {
  --surface: rgb(32 32 36 / 0.97);
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
#stack { position: absolute; top: 0; right: 0; width: 100%; padding: 8px 10px 24px; display: flex; flex-direction: column; }
#stack > .card + .card, #stack > .deck + .card { margin-top: 10px; }
.card {
  position: relative;
  z-index: 1;
  /* The daylight edge (amber for a priority sender) is a background layer
     painted from the border box, so the card's own radius clips it and it
     runs the full height. */
  --edge: linear-gradient(180deg, var(--aqua), var(--azure) 55%, var(--violet));
  background: var(--edge) left top / 4px 100% no-repeat border-box, var(--surface);
  border: 0.5px solid var(--hairline);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: 13px 14px 12px 18px;
  transition: transform 320ms cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 220ms ease-out;
}
.card.priority { --edge: linear-gradient(var(--priority), var(--priority)); }
.card.enter { transform: translateX(calc(100% + 24px)); opacity: 0; }
/* The next mail rising off the deck. */
.card.rise { transform: translateY(-10px) scale(0.97); opacity: 0.4; transition-duration: 260ms, 200ms; }
.card.leave { transform: translateX(calc(100% + 24px)); opacity: 0; transition-timing-function: cubic-bezier(0.5, 0, 0.75, 0), ease-in; transition-duration: 220ms, 200ms; }
.top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.chip { flex: none; font-size: 10.5px; font-weight: 650; letter-spacing: 0.02em; text-transform: uppercase; padding: 2px 7px; border-radius: 6px; }
.chip.people { color: var(--azure); background: color-mix(in oklab, var(--azure) 14%, transparent); }
.chip.priority { color: var(--priority); background: color-mix(in oklab, var(--priority) 14%, transparent); }
.chip.meeting { color: var(--aqua); background: color-mix(in oklab, var(--aqua) 16%, transparent); }
.chip.quiet { color: var(--ink-muted); background: var(--sunken); }
.source { font-size: 11px; color: var(--ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.when { margin-left: auto; flex: none; font-size: 11px; color: var(--ink-faint); }
.count { flex: none; font-size: 10.5px; font-weight: 650; color: var(--ink-muted); background: var(--sunken); border-radius: 999px; padding: 1px 6px; }
.title { font-size: 14px; font-weight: 650; margin-top: 8px; letter-spacing: -0.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.line { margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snippet { font-size: 12.5px; color: var(--ink-muted); margin-top: 3px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.event .line { color: var(--ink-muted); font-size: 12.5px; margin-top: 3px; }
.close {
  position: absolute; top: -6px; left: -6px; width: 20px; height: 20px; border-radius: 50%; z-index: 2;
  border: 0.5px solid var(--hairline); background: var(--surface); color: var(--ink-muted);
  display: grid; place-items: center; font-size: 12px; line-height: 1; padding: 0;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); opacity: 0; transition: opacity 120ms;
}
.card:hover .close { opacity: 1; }
/* Mail: the app's keys fold open on hover (they are buttons; the card never takes keyboard focus). */
.keys { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 160ms ease-out; }
.keys > div { overflow: hidden; }
.card:hover .keys { grid-template-rows: 1fr; }
.keys .row { display: flex; gap: 4px; padding-top: 9px; }
.key {
  font: inherit; font-size: 11.5px; color: var(--ink-muted); background: transparent; border: 0;
  border-radius: 6px; padding: 3px 6px 3px 3px; display: inline-flex; align-items: center; gap: 5px;
}
.key:hover { background: var(--sunken); color: var(--ink); }
.key b { font-weight: 600; color: var(--ink); background: var(--sunken); border-radius: 5px; padding: 1px 5px; font-size: 10.5px; min-width: 18px; text-align: center; }
.key:hover b { background: var(--sunken-hover); }
/* Older mail stacked behind the top card. */
.deck { position: relative; height: 14px; margin-top: -2px; z-index: 0; }
.deck div {
  position: absolute; height: 12px; border-radius: 0 0 14px 14px;
  background: var(--surface); border: 0.5px solid var(--hairline); border-top: 0; box-shadow: 0 4px 10px rgb(0 0 0 / 0.08);
}
.deck .d1 { top: 0; left: 8px; right: 8px; opacity: 0.9; }
.deck .d2 { top: 6px; left: 18px; right: 18px; opacity: 0.6; }
.deck[hidden], .deck .d2[hidden] { display: none; }
/* Meetings: a bar that drains toward the start time (stepped every 30 s, not animated per frame). */
.bar { height: 3px; border-radius: 3px; background: var(--sunken); margin-top: 10px; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--aqua), var(--azure)); transform-origin: left; transition: transform 600ms ease-out; }
.buttons { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.buttons .primary { margin-left: auto; }
.btn {
  font: inherit; font-size: 12px; font-weight: 550; border: 0; border-radius: 8px; padding: 6px 10px;
  background: var(--sunken); color: var(--ink); display: inline-flex; align-items: center; gap: 6px;
}
.btn:hover { background: var(--sunken-hover); }
.btn.primary { background: var(--accent); color: var(--on-accent); }
.btn.primary:hover { filter: brightness(1.08); }
.btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: reduce) {
  .card, .card.leave, .card.rise, .keys, .bar i { transition-duration: 1ms !important; }
}
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>${CSS}</style></head><body><div id="stack"></div></body></html>`;

export const OVERLAY_URL = `data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`;
