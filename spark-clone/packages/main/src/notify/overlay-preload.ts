/**
 * Notification overlay ("Daylight deck"): draws Uniox's own notification
 * cards. Runs as the preload of a sandboxed page with no script of its own,
 * so untrusted mail text only ever lands in textContent.
 *
 * Layout: the newest mail is a full card with older mail stacked as a deck
 * behind it; meeting alerts sit below as their own cards.
 *
 * Cost model: no animation frame loop. Cards slide with CSS transitions,
 * auto-dismiss is one setTimeout per card (hovering pauses them all), and a
 * meeting's countdown steps every 30 s instead of animating continuously.
 */
import { ipcRenderer } from 'electron';
import type { CardAction, MainToOverlay, NotifyCard, OverlayToMain } from './card';

const MAX_EVENTS = 2;
const TICK_MS = 30_000;

/** The app's own shortcuts for these actions, shown on the mail card's buttons. */
const KEYS: Partial<Record<CardAction, { key: string; label: string }>> = {
  open: { key: '↩', label: 'Open' },
  reply: { key: '⇧R', label: 'Reply' },
  archive: { key: 'E', label: 'Done' },
  later: { key: 'S', label: 'Later' },
};
const JOIN_ICON = '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>';

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

function render(card: NotifyCard): HTMLElement {
  const root = el('div', `card ${card.kind}${card.tone === 'priority' ? ' priority' : ''}`);
  root.setAttribute('role', 'alert');

  const close = el('button', 'close', '×');
  close.setAttribute('aria-label', 'Close');
  onClick(close, card.id, 'dismiss');
  root.append(close);

  const top = el('div', 'top');
  top.append(el('span', `chip ${card.tone}`, card.chip));
  if (card.source) top.append(el('span', 'source', card.source));
  top.append(el('span', 'when', card.when));
  if (card.kind === 'mail') {
    const count = el('span', 'count');
    count.hidden = true;
    top.append(count);
  }
  root.append(top, el('div', 'title', card.title));

  if (card.kind === 'mail') {
    if (card.line) root.append(el('div', 'line', card.line));
    if (card.snippet) root.append(el('div', 'snippet', card.snippet));
    const keyed = card.actions.filter((a) => KEYS[a]);
    if (keyed.length) {
      const fold = el('div', 'keys');
      const inner = el('div');
      const row = el('div', 'row');
      for (const a of keyed) {
        const k = KEYS[a]!;
        const b = el('button', 'key');
        b.append(el('b', undefined, k.key), k.label);
        onClick(b, card.id, a);
        row.append(b);
      }
      inner.append(row);
      fold.append(inner);
      root.append(fold);
    }
  } else {
    const now = Date.now();
    root.append(el('div', 'line', meetingLine(card, now)));
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.transform = `scaleX(${meetingFraction(card, now)})`;
    bar.append(fill);
    root.append(bar);
    const row = el('div', 'buttons');
    for (const a of card.actions) {
      if (a === 'join') {
        const b = el('button', 'btn primary');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.innerHTML = JOIN_ICON; // static, app-authored markup
        b.append(svg, 'Join now');
        onClick(b, card.id, 'join');
        row.append(b);
      } else if (a === 'snooze') {
        const b = el('button', 'btn', 'Snooze 5 min');
        onClick(b, card.id, 'snooze');
        row.append(b);
      }
    }
    root.append(row);
  }

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
  }
  for (const id of events.slice(0, MAX_EVENTS)) desired.push(live.get(id)!.el);

  const keep = new Set(desired);
  for (const child of [...s.children]) {
    if (!keep.has(child as HTMLElement) && !child.classList.contains('leave')) child.remove();
  }
  let ref: ChildNode | null = s.firstChild;
  for (const node of desired) {
    while (ref && ref !== node && (ref as HTMLElement).classList.contains('leave')) ref = ref.nextSibling;
    if (ref === node) {
      ref = ref.nextSibling;
      continue;
    }
    const fresh = !node.isConnected;
    s.insertBefore(node, ref);
    // A mail coming off the deck rises into place (new cards slide in instead).
    if (fresh && node.classList.contains('card') && !node.classList.contains('enter')) {
      node.classList.add('rise');
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('rise')));
    }
  }
}

function arm(l: Live): void {
  if (l.timer) clearTimeout(l.timer);
  l.timer = null;
  if (!l.card.ttl || hovering) return;
  l.startedAt = Date.now();
  l.timer = setTimeout(() => remove(l.card.id), l.left);
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
    l.el.classList.add('enter');
    live.set(card.id, l);
    listFor(card).unshift(card.id);
    // One frame later, drop the offset so the transition plays.
    requestAnimationFrame(() => requestAnimationFrame(() => l.el.classList.remove('enter')));
  }
  layout();
  arm(l);
  if (card.kind === 'event' && !tickTimer) tickTimer = setTimeout(tick, TICK_MS);
}

function remove(id: string): void {
  const l = live.get(id);
  if (!l) return;
  if (l.timer) clearTimeout(l.timer);
  live.delete(id);
  mails = mails.filter((x) => x !== id);
  events = events.filter((x) => x !== id);
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
  if (l.el.isConnected && !l.el.classList.contains('enter')) {
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
    l.el.classList.add('leave');
    l.el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400); // transitionend can be skipped (reduced motion, hidden window)
  } else done();
  layout();
  // A card removed from under the pointer never gets its mouseleave; re-read
  // hover once things have moved, or the countdowns would stay paused.
  setTimeout(syncHover, 60);
}

function syncHover(): void {
  setHover(!!document.querySelector('#stack > .card:not(.leave):hover, .deck:hover'));
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
});
