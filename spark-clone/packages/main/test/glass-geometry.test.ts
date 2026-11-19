import { describe, expect, it } from 'vitest';
import { backdropBounds, backdropInset, lensCoreBounds, lensRim } from '../src/glass-geometry';

describe('frosted island backdrops', () => {
  it('insets rounder panels further, so the blur window corners stay hidden', () => {
    expect(backdropInset(10)).toBe(0);
    expect(backdropInset(0)).toBe(0);
    expect(backdropInset(20)).toBe(3);
    expect(backdropInset(28)).toBe(6);
  });

  it('moves a panel to the screen and shrinks it by the inset', () => {
    expect(backdropBounds({ x: 310, y: 126, width: 820, height: 500, radius: 20 }, { x: 0, y: 25 })).toEqual({
      x: 313,
      y: 154,
      width: 814,
      height: 494,
    });
  });

  it('skips panels too small to blur', () => {
    expect(backdropBounds({ x: 0, y: 0, width: 3, height: 40, radius: 1 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('lens island (E2) blurred middle', () => {
  it('keeps an 18px clear rim on full panels and a thinner one on small panels', () => {
    expect(lensRim({ x: 0, y: 0, width: 820, height: 500, radius: 20 })).toBe(18);
    expect(lensRim({ x: 0, y: 0, width: 300, height: 60, radius: 16 })).toBe(10);
  });

  it('puts the blur inside the rim', () => {
    expect(lensCoreBounds({ x: 310, y: 126, width: 820, height: 500, radius: 20 }, { x: 0, y: 25 })).toEqual({
      x: 328,
      y: 169,
      width: 784,
      height: 464,
    });
  });

  it('skips panels too small to have a middle', () => {
    expect(lensCoreBounds({ x: 0, y: 0, width: 300, height: 60, radius: 30 }, { x: 0, y: 0 })).toBeNull();
  });
});
