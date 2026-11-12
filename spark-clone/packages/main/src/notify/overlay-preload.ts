/**
 * Notification overlay: draws Uniox's own notification cards. Runs as the
 * preload of a sandboxed page with no script of its own, so untrusted mail
 * text only ever lands in textContent.
 *
 * Cost model: no animation frame loop. Cards slide in/out with CSS
 * transitions, auto-dismiss uses one setTimeout per card, and hovering any
 * card pauses every countdown.
 */
import { ipcRenderer } from 'electron';
import type { CardAction, MainToOverlay, NotifyCard, OverlayToMain } from './card';

const MAX_VISIBLE = 3;

const ICONS: Partial<Record<CardAction, string>> = {
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
  read: '<path d="M20 6 9 17l-5-5"/>',
  later: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  join: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
};
const LABELS: Record<CardAction, string> = {
  open: 'Open',
  inbox: 'Inbox',
  reply: 'Reply',
  archive: 'Archive',
  read: 'Read',
  later: 'Later',
  join: 'Join',
  snooze: 'Snooze 5 min',
  dismiss: 'Close',
};

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
/** Newest first; only the first MAX_VISIBLE are in the DOM. */
let order: string[] = [];
let hovering = false;
/** Cards received so far (see OverlayToMain 'empty'). */
let received = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(action: CardAction): SVGSVGElement | null {
  const paths = ICONS[action];
  if (!paths) return null;
  // Static, app-authored markup (never mail content).
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = paths;
  return svg;
}

function button(card: NotifyCard, action: CardAction, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'primary' : undefined);
  const i = icon(action);
  if (i) b.append(i);
  b.append(LABELS[action]);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    act(card.id, action);
  });
  return b;
}

function render(card: NotifyCard): HTMLElement {
  const root = el('div', `card ${card.kind}`);
  root.setAttribute('role', 'alert');

  const close = el('button', 'close', '×');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    act(card.id, 'dismiss');
  });
  root.append(close);

  const head = el('div', 'head');
  const dot = el('span', 'dot');
  dot.style.background = card.sourceColor;
  head.append(el('span', 'logo'), 'Uniox', el('span', undefined, '·'), dot, card.source, el('span', 'when', card.when));
  root.append(head);

  const body = el('div', 'body');
  if (card.kind === 'mail') {
    const av = el('div', 'avatar', card.initials ?? '?');
    av.style.background = `oklch(var(--av-l) 0.14 ${card.hue ?? 250})`;
    body.append(av);
  } else {
    const tile = el('div', 'tile');
    tile.append(el('div', 'm', card.month ?? ''), el('div', 'd', card.day ?? ''));
    body.append(tile);
  }
  const text = el('div', 'text');
  text.append(el('div', 'title', card.title), el('div', 'line', card.line));
  if (card.snippet) text.append(el('div', 'snippet', card.snippet));
  if (card.kind === 'event' && card.actions.length) {
    const row = el('div', 'buttons');
    card.actions.forEach((a, i) => row.append(button(card, a, i === 0 && a === 'join')));
    text.append(row);
  }
  body.append(text);
  root.append(body);

  if (card.kind === 'mail' && card.actions.length) {
    const fold = el('div', 'actions');
    const inner = el('div');
    const row = el('div', 'row');
    row.style.flex = '1';
    card.actions.forEach((a) => row.append(button(card, a)));
    inner.append(row);
    fold.append(inner);
    root.append(fold);
  }

  root.addEventListener('click', () => act(card.id, 'open'));
  root.addEventListener('mouseenter', () => setHover(true));
  root.addEventListener('mouseleave', () => setHover(false));
  return root;
}

function stack(): HTMLElement {
  return document.getElementById('stack')!;
}
function moreEl(): HTMLElement {
  return stack().querySelector('.more') as HTMLElement;
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

/** Put the first MAX_VISIBLE cards in the DOM (newest on top) and update "N more". */
function layout(): void {
  const s = stack();
  const more = moreEl();
  // Meeting alerts hold their place on top; a burst of mail mustn't bury them.
  order = [...order.filter((id) => live.get(id)!.card.kind === 'event'), ...order.filter((id) => live.get(id)!.card.kind !== 'event')];
  const visible = order.slice(0, MAX_VISIBLE);
  visible.forEach((id, i) => {
    const l = live.get(id)!;
    const at = s.children[i];
    if (at !== l.el) s.insertBefore(l.el, at ?? more);
  });
  for (const id of order.slice(MAX_VISIBLE)) live.get(id)!.el.remove();
  const hidden = order.length - visible.length;
  more.hidden = hidden === 0;
  more.textContent = hidden === 1 ? '1 more notification' : `${hidden} more notifications`;
}

function show(card: NotifyCard): void {
  const prev = [...live.values()].find((l) => l.card.key === card.key);
  if (prev) {
    // Same meeting, later stage: swap the content in place, no re-entry.
    const next = render(card);
    prev.el.replaceWith(next);
    if (prev.timer) clearTimeout(prev.timer);
    live.delete(prev.card.id);
    order = order.map((id) => (id === prev.card.id ? card.id : id));
    const l: Live = { card, el: next, timer: null, left: card.ttl, startedAt: 0 };
    live.set(card.id, l);
    arm(l);
    return;
  }
  const l: Live = { card, el: render(card), timer: null, left: card.ttl, startedAt: 0 };
  l.el.classList.add('enter');
  live.set(card.id, l);
  order.unshift(card.id);
  layout();
  // One frame later, drop the offset so the transition plays.
  requestAnimationFrame(() => requestAnimationFrame(() => l.el.classList.remove('enter')));
  arm(l);
}

function remove(id: string): void {
  const l = live.get(id);
  if (!l) return;
  if (l.timer) clearTimeout(l.timer);
  live.delete(id);
  order = order.filter((x) => x !== id);
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    l.el.remove();
    layout();
    if (!live.size) {
      if (hovering) setHover(false);
      send({ kind: 'empty', shown: received });
    }
  };
  if (l.el.isConnected && !l.el.classList.contains('enter')) {
    l.el.classList.add('leave');
    l.el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400); // transitionend can be skipped (reduced motion, hidden window)
  } else done();
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
  }
  else if (msg.kind === 'remove') remove(msg.id);
  else if (msg.kind === 'theme') document.documentElement.classList.toggle('dark', msg.dark);
});

// "N more" opens the app on the inbox and clears the stack.
window.addEventListener('DOMContentLoaded', () => {
  const more = moreEl();
  more.addEventListener('click', () => {
    send({ kind: 'action', id: '', action: 'inbox' });
    for (const id of [...order]) remove(id);
  });
  more.addEventListener('mouseenter', () => setHover(true));
  more.addEventListener('mouseleave', () => setHover(false));
});
