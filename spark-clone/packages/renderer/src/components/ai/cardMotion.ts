// Motion for the Home AI cards ("Unfold with a spring", option C of the
// card-animation mockups): a card opens top to bottom with its lines
// cascading in and one light sweep across the glass; it folds back up on the
// way out. Cards already on screen glide to their new slot and height, and
// the Home layout (timeline height, card row) makes room on the same spring.

/** Shared by the card row, the cards and the Home timeline. */
export const CARD_SPRING = 'cubic-bezier(.34,1.32,.5,1)';
export const CARD_LAYOUT_MS = 560;
const EASE_IN = 'cubic-bezier(.4,0,1,1)';

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The card's own drop shadow sits outside its box; keep it inside the clip so
// it does not pop in when the clip is dropped at the end.
const OPEN = 'inset(0px -40px -80px -40px round 18px)';
const SHUT = 'inset(0px -40px 100% -40px round 18px)';

/** The card's parts in reading order: label, headline, each line, footer. */
const parts = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-ai-part], [data-ai-lines] > *'));

export function enterCard(el: HTMLElement, { first }: { first: boolean }): void {
  if (prefersReducedMotion()) return;
  // The first card waits a beat for the layout to start making room.
  const d0 = first ? 120 : 40;
  el.animate(
    [
      { clipPath: SHUT, transform: 'translateY(-10px)', opacity: 0.4 },
      { clipPath: OPEN, transform: 'none', opacity: 1 },
    ],
    { duration: CARD_LAYOUT_MS, delay: d0, easing: CARD_SPRING, fill: 'backwards' },
  );
  parts(el).forEach((p, i) =>
    p.animate(
      [
        { opacity: 0, transform: 'translateY(7px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 380, delay: d0 + 140 + i * 45, easing: CARD_SPRING, fill: 'backwards' },
    ),
  );
  const sheen = el.querySelector<HTMLElement>('[data-ai-sheen]');
  sheen?.animate(
    [
      { transform: 'translateX(-140%) skewX(-18deg)' },
      { transform: 'translateX(320%) skewX(-18deg)' },
    ],
    {
      duration: 900,
      delay: d0 + 380,
      easing: 'cubic-bezier(.4,0,.2,1)',
      fill: 'backwards',
    },
  );
}

/** Folds the card up; resolves when it is gone (rejects if cancelled). */
export function exitCard(el: HTMLElement): Promise<unknown> {
  if (prefersReducedMotion()) {
    return el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })
      .finished;
  }
  parts(el)
    .reverse()
    .forEach((p, i) =>
      p.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-5px)' }], {
        duration: 160,
        delay: i * 30,
        easing: EASE_IN,
        fill: 'forwards',
      }),
    );
  return el.animate(
    [
      { clipPath: OPEN, transform: 'none', opacity: 1 },
      { clipPath: SHUT, transform: 'translateY(-8px)', opacity: 0.3 },
    ],
    { duration: 340, delay: 80, easing: EASE_IN, fill: 'forwards' },
  ).finished;
}

export interface CardBox {
  left: number;
  height: number;
}
export const boxOf = (el: HTMLElement): CardBox => {
  const r = el.getBoundingClientRect();
  return { left: r.left, height: r.height };
};

/** Glides a card from its old slot and height to the current ones (FLIP). */
export function glideCard(el: HTMLElement, from: CardBox): void {
  if (prefersReducedMotion()) return;
  const to = boxOf(el);
  const dx = from.left - to.left;
  if (Math.abs(dx) < 0.5 && Math.abs(from.height - to.height) < 0.5) return;
  el.animate(
    [
      { transform: `translateX(${dx}px)`, height: `${from.height}px` },
      { transform: 'none', height: `${to.height}px` },
    ],
    { duration: CARD_LAYOUT_MS, easing: CARD_SPRING },
  );
}
