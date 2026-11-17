import { useLayoutEffect, useRef, type RefObject } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

/** Springy ease that overshoots a touch, then settles. */
const SPRING = "cubic-bezier(.34,1.32,.64,1)";
const RISE = "cubic-bezier(.2,.8,.2,1)";
const HEIGHT_MS = 420;
/** Rows past this many start together, so long lists don't trickle in. */
const STAGGER_CAP = 12;

type Snapshot = { top: number; node: HTMLElement };

function motionChildren(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.motion,
  );
}

/**
 * Spring + stagger for the ⌥⌘N list. Children tagged `data-motion="<key>"`
 * are tracked between renders:
 *
 * - `view` changes (tab or account): the list's height springs from its old
 *   size to the new one and the rows rise in one after another.
 * - Same view, rows come and go: leaving rows swipe out to the right, the rest
 *   glide to their new places on the spring, new rows rise in, and the height
 *   follows.
 *
 * Runs only when `view` or `rowKeys` change, uses the Web Animations API (no
 * re-renders), and does nothing under Reduce Motion.
 */
export function useListMotion(
  listRef: RefObject<HTMLElement | null>,
  view: string,
  rowKeys: string,
) {
  const reduce = usePrefersReducedMotion();
  const last = useRef<{
    view: string;
    height: number;
    rows: Map<string, Snapshot>;
  } | null>(null);
  const heightAnim = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const prev = last.current;
    const animating = heightAnim.current?.playState === "running";
    // Mid-animation, start from where the list is now, not where it was headed.
    const fromHeight = animating
      ? list.getBoundingClientRect().height
      : prev?.height;
    heightAnim.current?.cancel();
    const toHeight = list.getBoundingClientRect().height;
    const children = motionChildren(list);

    const record = () => {
      const rows = new Map<string, Snapshot>();
      for (const c of children)
        rows.set(c.dataset.motion!, { top: c.offsetTop, node: c });
      last.current = { view, height: toHeight, rows };
    };
    if (!prev || reduce) return record();

    const springHeight = (delay: number) => {
      if (fromHeight === undefined || Math.abs(fromHeight - toHeight) < 1)
        return;
      list.style.overflowY = "hidden";
      const a = list.animate(
        [{ height: `${fromHeight}px` }, { height: `${toHeight}px` }],
        {
          duration: HEIGHT_MS,
          delay,
          easing: SPRING,
          fill: "backwards",
        },
      );
      const done = () => {
        if (heightAnim.current === a) {
          list.style.overflowY = "";
          heightAnim.current = null;
        }
      };
      a.onfinish = done;
      a.oncancel = done;
      heightAnim.current = a;
    };
    const rise = (el: HTMLElement, delay: number) =>
      el.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 260, delay, easing: RISE, fill: "backwards" },
      );
    const visible = (top: number) =>
      top + 60 > list.scrollTop && top < list.scrollTop + list.clientHeight;

    if (prev.view !== view) {
      springHeight(0);
      let n = 0;
      for (const c of children) {
        if (!visible(c.offsetTop)) continue;
        c.getAnimations().forEach((a) => a.cancel());
        rise(c, 60 + Math.min(n++, STAGGER_CAP) * 28);
      }
      return record();
    }

    // Same view: swipe out what left, glide what moved, rise what's new.
    const keys = new Set(children.map((c) => c.dataset.motion!));
    let removed = 0;
    for (const [key, { top, node }] of prev.rows) {
      if (keys.has(key) || !visible(top)) continue;
      removed++;
      const ghost = node.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-motion");
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "absolute",
        top: `${top}px`,
        left: "0",
        right: "0",
        pointerEvents: "none",
      });
      list.appendChild(ghost);
      const a = ghost.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "translateX(24px)" },
        ],
        { duration: 160, easing: "ease-in", fill: "forwards" },
      );
      a.onfinish = () => ghost.remove();
      a.oncancel = () => ghost.remove();
    }
    const delay = removed ? 90 : 0;
    springHeight(delay);
    let moved = 0;
    for (const c of children) {
      const was = prev.rows.get(c.dataset.motion!);
      if (!was) {
        if (visible(c.offsetTop)) rise(c, delay + 40);
        continue;
      }
      const dy = was.top - c.offsetTop;
      if (Math.abs(dy) < 1 || (!visible(was.top) && !visible(c.offsetTop)))
        continue;
      c.getAnimations().forEach((a) => a.cancel());
      c.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
        duration: HEIGHT_MS,
        delay: delay + Math.min(moved++, STAGGER_CAP) * 12,
        easing: SPRING,
        fill: "backwards",
      });
    }
    record();
    // rowKeys stands in for the rows themselves; the DOM is the source of truth.
  }, [listRef, view, rowKeys, reduce]);
}
