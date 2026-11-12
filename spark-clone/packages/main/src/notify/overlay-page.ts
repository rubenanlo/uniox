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
  --tile: #ffffff;
  --ink: #1c1c1f;
  --ink-muted: #6d6d75;
  --ink-faint: #a3a3ab;
  --hairline: rgb(0 0 0 / 0.09);
  --accent: #2f63e7;
  --on-accent: #ffffff;
  --shadow: 0 10px 30px rgb(0 0 0 / 0.16), 0 2px 6px rgb(0 0 0 / 0.08);
  --av-l: 0.6;
}
.dark {
  --surface: rgb(32 32 36 / 0.97);
  --sunken: rgb(255 255 255 / 0.07);
  --sunken-hover: rgb(255 255 255 / 0.12);
  --tile: #2a2a2f;
  --ink: #e8e8ec;
  --ink-muted: #9b9ba4;
  --ink-faint: #64646d;
  --hairline: rgb(255 255 255 / 0.1);
  --accent: #7fa2ff;
  --on-accent: #0f1730;
  --shadow: 0 12px 34px rgb(0 0 0 / 0.5), 0 2px 6px rgb(0 0 0 / 0.3);
  --av-l: 0.62;
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
#stack { position: absolute; top: 0; right: 0; width: 100%; padding: 8px 10px 24px; display: flex; flex-direction: column; gap: 10px; }
.card {
  position: relative;
  background: var(--surface);
  border: 0.5px solid var(--hairline);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 12px 14px;
  transition: transform 320ms cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 220ms ease-out;
}
.card.enter { transform: translateX(calc(100% + 24px)); opacity: 0; }
.card.leave { transform: translateX(calc(100% + 24px)); opacity: 0; transition-timing-function: cubic-bezier(0.5, 0, 0.75, 0), ease-in; transition-duration: 220ms, 200ms; }
.head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-muted); margin-bottom: 8px; }
.logo { width: 14px; height: 14px; border-radius: 4px; background: linear-gradient(135deg, oklch(0.72 0.13 178), oklch(0.6 0.16 250) 55%, oklch(0.58 0.19 295)); }
.dot { width: 6px; height: 6px; border-radius: 50%; }
.when { margin-left: auto; }
.close {
  position: absolute; top: -6px; left: -6px; width: 20px; height: 20px; border-radius: 50%;
  border: 0.5px solid var(--hairline); background: var(--tile); color: var(--ink-muted);
  display: grid; place-items: center; font-size: 12px; line-height: 1; padding: 0;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); opacity: 0; transition: opacity 120ms;
}
.card:hover .close { opacity: 1; }
.body { display: flex; gap: 11px; }
.text { min-width: 0; flex: 1; }
.avatar {
  width: 36px; height: 36px; border-radius: 50%; flex: none; display: grid; place-items: center;
  font-size: 13px; font-weight: 650; color: #fff;
}
.tile { width: 36px; height: 40px; flex: none; border-radius: 9px; overflow: hidden; text-align: center; background: var(--tile); border: 0.5px solid var(--hairline); }
.tile .m { font-size: 9px; font-weight: 700; color: #fff; background: #e5484d; padding: 2px 0; letter-spacing: 0.04em; }
.tile .d { font-size: 16px; font-weight: 650; line-height: 22px; }
.title { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.line { font-weight: 500; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.event .line { font-weight: 400; color: var(--ink-muted); }
.snippet { font-size: 12.5px; color: var(--ink-muted); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* Mail actions fold open on hover; meeting buttons are always there. */
.actions { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 160ms ease-out; }
.actions > div { overflow: hidden; display: flex; gap: 6px; }
.card:hover .actions, .card:focus-within .actions { grid-template-rows: 1fr; }
.actions .row { display: flex; gap: 6px; padding-top: 10px; margin-top: 10px; border-top: 0.5px solid var(--hairline); }
.actions button { flex: 1; justify-content: center; }
.event .buttons { display: flex; gap: 6px; margin-top: 9px; }
button {
  font: inherit; font-size: 12px; font-weight: 550; border: 0; border-radius: 8px; padding: 6px 10px;
  background: var(--sunken); color: var(--ink); display: inline-flex; align-items: center; gap: 6px;
}
button:hover { background: var(--sunken-hover); }
button.primary { background: var(--accent); color: var(--on-accent); }
button.primary:hover { filter: brightness(1.08); }
button svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.more {
  align-self: stretch; text-align: center; font-size: 11.5px; color: var(--ink-muted); padding: 6px;
  background: var(--surface); border: 0.5px solid var(--hairline); border-radius: 12px; box-shadow: var(--shadow);
}
.more[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) {
  .card, .card.leave, .actions { transition-duration: 1ms !important; }
}
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>${CSS}</style></head><body><div id="stack"><div class="more" hidden></div></div></body></html>`;

export const OVERLAY_URL = `data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`;
