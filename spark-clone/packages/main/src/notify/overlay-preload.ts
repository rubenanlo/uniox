/**
 * Notification overlay ("Island"): draws Uniox's own notification cards.
 * Runs as the preload of a sandboxed page with no script of its own, so
 * untrusted mail text only ever lands in textContent.
 *
 * Layout: the newest mail is a glass capsule (avatar, sender, subject) with
 * older mail tucked behind it as a deck; meeting alerts sit below as their
 * own capsules. Hovering a capsule opens it into a full card with actions.
 *
 * Cost model: no animation frame loop. Cards slide with CSS transitions,
 * auto-dismiss is one setTimeout per card (hovering pauses them all), and a
 * meeting's countdown steps every 30 s instead of animating continuously.
 */
import { ipcRenderer } from 'electron';
import type { CardAction, MainToOverlay, NotifyCard, OverlayToMain } from './card';

const MAX_EVENTS = 2;
const TICK_MS = 30_000;

/** The hover pills for mail, in order. */
const MAIL_BUTTONS: { action: CardAction; label: string; icon: string; primary?: boolean }[] = [
  { action: 'reply', label: 'Quick reply', icon: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>', primary: true },
  { action: 'read', label: 'Read', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>' },
  { action: 'archive', label: 'Done', icon: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>' },
];
const JOIN_ICON = '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>';
const SNOOZE_ICON = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
const CAL_ICON = '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><circle cx="16" cy="16" r="2.4"/>';

const send = (msg: OverlayToMain) => ipcRenderer.send('notify-overlay', msg);

interface Live {
  card: NotifyCard;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  /** ms left on the countdown (paused while hovered). */
  left: number;
  startedAt: number;
}

const live = new Map<string, Live>();
/** Newest first. */
let mails: string[] = [];
let events: string[] = [];
let hovering = false;
/** Cards received so far (see OverlayToMain 'empty'). */
let received = 0;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let deck: HTMLElement | null = null;

/* ── Frosted island ──────────────────────────────────────────────────────
   The cards are clear and macOS blurs what's behind each one (a vibrancy
   window per card, in main). Main needs to know where the cards are: while a
   transition moves them, report once a frame; otherwise nothing runs.
   Cards sliding in or out get no blur (they paint their own fill, see
   .moving in the page), and rects are the cards' layout boxes, so a small
   settle (swap, rise) keeps the glass still under it. */
let frosted = false;
let glassRaf = 0;
let glassUntil = 0;
let lastGlass = '';

function reportGlass(): void {
  const s = stack();
  const rects = frosted
    ? [...s.querySelectorAll<HTMLElement>('.card:not(.moving):not(.gone)')].map((c) => {
        const r = { x: s.offsetLeft + c.offsetLeft, y: s.offsetTop + c.offsetTop, width: c.offsetWidth, height: c.offsetHeight };
        // CSS clamps a radius to half the box (the resting capsule).
        const radius = Math.min(parseFloat(getComputedStyle(c).borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
        return { ...r, radius };
      })
    : [];
  const key = JSON.stringify(rects);
  if (key === lastGlass) return;
  lastGlass = key;
  send({ kind: 'glass', rects });
}

function followGlass(ms = 600): void {
  if (!frosted && lastGlass === '[]') return;
  glassUntil = Math.max(glassUntil, performance.now() + ms);
  if (glassRaf) return;
  const step = () => {
    reportGlass();
    glassRaf = performance.now() < glassUntil ? requestAnimationFrame(step) : 0;
  };
  glassRaf = requestAnimationFrame(step);
}
document.addEventListener('transitionrun', () => followGlass(), true);
document.addEventListener('transitionend', () => followGlass(80), true);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function stack(): HTMLElement {
  return document.getElementById('stack')!;
}

function onClick(node: HTMLElement, id: string, action: CardAction): void {
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    act(id, action);
  });
}

function meetingLine(card: NotifyCard, now: number): string {
  const mins = Math.ceil(((card.startsAt ?? now) - now) / 60_000);
  const when = mins >= 1 ? `Starts in ${mins} min` : 'Starting now';
  return card.where ? `${when} · ${card.where}` : when;
}

function meetingFraction(card: NotifyCard, now: number): number {
  const left = (card.startsAt ?? now) - now;
  return Math.min(1, Math.max(0, left / (card.leadMs || 1)));
}

/** Static, app-authored icon markup only (never mail text). */
function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = paths;
  return svg;
}

function button(id: string, action: CardAction, label: string, paths: string, primary = false, cls = ''): HTMLButtonElement {
  const b = el('button', `btn${primary ? ' primary' : ''}${cls ? ` ${cls}` : ''}`);
  b.append(icon(paths), label);
  onClick(b, id, action);
  return b;
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return ((words[0]![0] ?? '') + (words.length > 1 ? (words[words.length - 1]![0] ?? '') : '')).toUpperCase();
}

/** The same sender always gets the same avatar colour (the app's hueOf). */
function hue(name: string): number {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function render(card: NotifyCard): HTMLElement {
  const root = el('div', `card ${card.kind}${card.tone === 'priority' ? ' priority' : ''}`);
  root.setAttribute('role', 'alert');

  const close = el('button', 'close', '×');
  close.setAttribute('aria-label', 'Close');
  onClick(close, card.id, 'dismiss');
  root.append(close);

  const top = el('div', 'top');
  let av: HTMLElement;
  if (card.kind === 'mail') {
    av = el('span', 'av', initials(card.title));
    const h = hue(card.title);
    av.style.background = `linear-gradient(135deg, hsl(${h} 62% 58%), hsl(${(h + 40) % 360} 62% 48%))`;
  } else {
    av = el('span', 'av cal');
    av.append(icon(CAL_ICON));
  }
  const head = el('div', 'head');
  const name = el('div', 'name');
  name.append(el('span', 'title', card.title));
  if (card.kind === 'mail') {
    const count = el('span', 'count');
    count.hidden = true;
    name.append(count);
  }
  if (card.tone === 'priority') name.append(el('span', 'chip priority', 'Important'));
  name.append(el('span', 'when', card.when));
  head.append(name);
  top.append(av, head);
  root.append(top);

  const more = el('div', 'more');
  const inner = el('div');
  more.append(inner);
  const row = el('div', 'buttons');

  if (card.kind === 'mail') {
    head.append(el('div', 'line', card.line || card.snippet || ''));
    if (card.snippet && card.line) inner.append(el('div', 'snippet', card.snippet));
    for (const b of MAIL_BUTTONS) {
      if (card.actions.includes(b.action)) row.append(button(card.id, b.action, b.label, b.icon, b.primary));
    }
  } else {
    const now = Date.now();
    head.append(el('div', 'line', meetingLine(card, now)));
    if (card.actions.includes('join')) top.append(button(card.id, 'join', 'Join', JOIN_ICON, true, 'inline-join'));
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.transform = `scaleX(${meetingFraction(card, now)})`;
    bar.append(fill);
    inner.append(bar);
    if (card.actions.includes('join')) row.append(button(card.id, 'join', 'Join now', JOIN_ICON, true));
    if (card.actions.includes('snooze')) row.append(button(card.id, 'snooze', 'Snooze 5 min', SNOOZE_ICON));
  }
  if (row.childElementCount) inner.append(row);
  if (inner.childElementCount) root.append(more);

  root.addEventListener('click', () => act(card.id, 'open'));
  root.addEventListener('mouseenter', () => setHover(true));
  root.addEventListener('mouseleave', () => setHover(false));
  return root;
}

function deckEl(): HTMLElement {
  if (deck) return deck;
  deck = el('div', 'deck');
  deck.title = 'Open the inbox';
  deck.append(el('div', 'd1'), el('div', 'd2'));
  deck.addEventListener('click', () => {
    send({ kind: 'action', id: '', action: 'inbox' });
    for (const id of [...mails]) remove(id);
  });
  deck.addEventListener('mouseenter', () => setHover(true));
  deck.addEventListener('mouseleave', () => setHover(false));
  return deck;
}

/** Bring the DOM in line with mails/events: top mail, its deck, then meetings. */
function layout(): void {
  const s = stack();
  const desired: HTMLElement[] = [];
  const topMail = mails[0] ? live.get(mails[0]) : undefined;
  if (topMail) {
    desired.push(topMail.el);
    const behind = mails.length - 1;
    const count = topMail.el.querySelector('.count') as HTMLElement | null;
    if (count) {
      count.hidden = behind === 0;
      count.textContent = `+${behind}`;
    }
    if (behind > 0) {
      const d = deckEl();
      (d.querySelector('.d2') as HTMLElement).hidden = behind < 2;
      desired.push(d);
    }
    // The top mail carries the countdown for the whole deck (see arm).
    if (!topMail.timer) arm(topMail);
  }
  for (const id of events.slice(0, MAX_EVENTS)) desired.push(live.get(id)!.el);

  const keep = new Set(desired);
  for (const child of [...s.children]) {
    if (!keep.has(child as HTMLElement) && !child.classList.contains('gone')) child.remove();
  }
  let ref: ChildNode | null = s.firstChild;
  for (const node of desired) {
    while (ref && ref !== node && (ref as HTMLElement).classList.contains('gone')) ref = ref.nextSibling;
    if (ref === node) {
      ref = ref.nextSibling;
      continue;
    }
    const fresh = !node.isConnected;
    s.insertBefore(node, ref);
    // A mail coming off the deck rises into place (new cards slide in instead).
    if (fresh && node.classList.contains('card') && !node.classList.contains('enter') && !node.classList.contains('swap')) {
      node.classList.add('rise');
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('rise')));
    }
  }
  // Centre the deck under the capsule it belongs to.
  if (topMail && deck?.isConnected) deck.style.width = `${topMail.el.offsetWidth}px`;
}

/**
 * Start (or resume) a card's countdown. Mail in the deck has none: the deck
 * leaves together with the top mail. Giving each its own made the "+N" tick
 * down one by one behind a capsule that never changed, and the older mail
 * never showed anyway (it always ran out before the newer one on top).
 */
function arm(l: Live): void {
  if (l.timer) clearTimeout(l.timer);
  l.timer = null;
  if (!l.card.ttl || hovering) return;
  const top = l.card.kind === 'mail';
  if (top && mails[0] !== l.card.id) return;
  l.startedAt = Date.now();
  l.timer = setTimeout(() => remove(l.card.id, top), l.left);
}

function disarm(l: Live): void {
  if (l.timer) clearTimeout(l.timer);
  l.timer = null;
}

/** Mark a card as sliding in or out (no glass under it until it settles). */
function slideIn(node: HTMLElement): void {
  node.classList.add('enter', 'moving');
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    node.removeEventListener('transitionend', onEnd);
    node.classList.remove('moving');
    followGlass();
  };
  const onEnd = (e: TransitionEvent) => {
    if (e.target === node && e.propertyName === 'transform') settle();
  };
  node.addEventListener('transitionend', onEnd);
  setTimeout(settle, 500); // transitionend can be skipped (reduced motion, hidden window)
  // One frame later, drop the offset so the transition plays.
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('enter')));
}

/**
 * The top capsule as it looks right now, lifted out of the flow and sunk
 * toward the deck while the newer mail settles in on top of it.
 */
function tuck(node: HTMLElement): void {
  const s = stack();
  const style = getComputedStyle(node);
  const ghost = node.cloneNode(true) as HTMLElement;
  ghost.classList.remove('enter', 'moving', 'swap', 'rise');
  ghost.classList.add('tuck', 'gone');
  ghost.removeAttribute('role');
  Object.assign(ghost.style, {
    position: 'absolute',
    top: `${node.offsetTop}px`,
    left: `${node.offsetLeft}px`,
    width: `${node.offsetWidth}px`,
    marginTop: '0',
    transform: style.transform === 'none' ? '' : style.transform,
    opacity: style.opacity,
    transition: 'none',
  });
  s.insertBefore(ghost, node);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      Object.assign(ghost.style, {
        transition: 'transform 240ms cubic-bezier(0.4, 0, 0.6, 1), opacity 160ms ease-in',
        transform: 'translateY(8px) scale(0.94)',
        opacity: '0',
      });
    }),
  );
  setTimeout(() => ghost.remove(), 320);
}

function setHover(on: boolean): void {
  if (on === hovering) return;
  hovering = on;
  send({ kind: 'interactive', on });
  for (const l of live.values()) {
    if (on && l.timer) {
      clearTimeout(l.timer);
      l.timer = null;
      l.left = Math.max(1500, l.left - (Date.now() - l.startedAt));
    } else if (!on) {
      // A short grace after the pointer leaves, so a card doesn't vanish mid-glance.
      l.left = Math.max(l.left, 2500);
      arm(l);
    }
  }
}

/** Step every meeting card's countdown; runs only while one is on screen. */
function tick(): void {
  tickTimer = null;
  const now = Date.now();
  for (const id of events) {
    const l = live.get(id)!;
    const line = l.el.querySelector('.line');
    if (line) line.textContent = meetingLine(l.card, now);
    const fill = l.el.querySelector('.bar i') as HTMLElement | null;
    if (fill) fill.style.transform = `scaleX(${meetingFraction(l.card, now)})`;
  }
  if (events.length) tickTimer = setTimeout(tick, TICK_MS);
}

function listFor(card: NotifyCard): string[] {
  return card.kind === 'event' ? events : mails;
}

function show(card: NotifyCard): void {
  const prev = [...live.values()].find((l) => l.card.key === card.key);
  const l: Live = { card, el: render(card), timer: null, left: card.ttl, startedAt: 0 };
  if (prev) {
    // Same meeting at its next stage (or a new message in the same thread):
    // swap the content in place, no re-entry.
    if (prev.timer) clearTimeout(prev.timer);
    live.delete(prev.card.id);
    if (prev.el.isConnected) prev.el.replaceWith(l.el);
    live.set(card.id, l);
    if (card.kind === 'event') events = events.map((id) => (id === prev.card.id ? card.id : id));
    else mails = [card.id, ...mails.filter((id) => id !== prev.card.id)];
  } else {
    const prevTop = card.kind === 'mail' && mails[0] ? live.get(mails[0]) : undefined;
    if (prevTop) disarm(prevTop); // it joins the deck, which follows the top's countdown
    live.set(card.id, l);
    listFor(card).unshift(card.id);
    if (prevTop?.el.isConnected) {
      // A capsule is already up: change what it says, don't fly it out and back.
      tuck(prevTop.el);
      l.el.classList.add('swap');
      requestAnimationFrame(() => requestAnimationFrame(() => l.el.classList.remove('swap')));
    } else slideIn(l.el);
  }
  layout();
  followGlass();
  arm(l);
  if (card.kind === 'event' && !tickTimer) tickTimer = setTimeout(tick, TICK_MS);
}

/** Take a card away; `withDeck` also clears the older mail tucked behind it. */
function remove(id: string, withDeck = false): void {
  const l = live.get(id);
  if (!l) return;
  if (l.timer) clearTimeout(l.timer);
  live.delete(id);
  mails = mails.filter((x) => x !== id);
  events = events.filter((x) => x !== id);
  if (withDeck && l.card.kind === 'mail') {
    for (const other of mails) {
      const o = live.get(other);
      if (o) disarm(o);
      live.delete(other);
    }
    mails = [];
  }
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    l.el.remove();
    if (!live.size) {
      deck?.remove();
      if (hovering) setHover(false);
      send({ kind: 'empty', shown: received });
    }
  };
  if (l.el.isConnected && !l.el.classList.contains('enter') && !l.el.classList.contains('swap')) {
    // Lift the card out of the flow where it stands, so what's below (or the
    // next mail off the deck) moves up while it slides away on top.
    const { offsetTop, offsetLeft, offsetWidth } = l.el;
    Object.assign(l.el.style, {
      position: 'absolute',
      top: `${offsetTop}px`,
      left: `${offsetLeft}px`,
      width: `${offsetWidth}px`,
      zIndex: '3',
      marginTop: '0',
    });
    l.el.classList.add('leave', 'moving', 'gone');
    l.el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400); // transitionend can be skipped (reduced motion, hidden window)
  } else done();
  layout();
  followGlass();
  // A card removed from under the pointer never gets its mouseleave; re-read
  // hover once things have moved, or the countdowns would stay paused.
  setTimeout(syncHover, 60);
}

function syncHover(): void {
  setHover(!!document.querySelector('#stack > .card:not(.gone):hover, .deck:hover'));
}

function act(id: string, action: CardAction): void {
  if (!live.has(id)) return;
  if (action !== 'dismiss') send({ kind: 'action', id, action });
  remove(id);
}

ipcRenderer.on('notify-overlay', (_e, msg: MainToOverlay) => {
  if (msg.kind === 'show') {
    received++;
    show(msg.card);
  } else if (msg.kind === 'remove') remove(msg.id);
  else if (msg.kind === 'theme') document.documentElement.classList.toggle('dark', msg.dark);
  else if (msg.kind === 'island') {
    frosted = msg.frosted;
    document.documentElement.classList.toggle('frosted', frosted);
    document.documentElement.classList.toggle('liquid', !!msg.liquid);
    lastGlass = '';
    followGlass(80);
  }
});
