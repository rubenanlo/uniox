import { describe, expect, it } from 'vitest';
import { cropBox } from '../src/lib/avatar';

describe('cropBox', () => {
  it('takes the horizontal center of a landscape image', () => {
    expect(cropBox(200, 100)).toEqual({ sx: 50, sy: 0, size: 100 });
  });

  it('takes the vertical center of a portrait image', () => {
    expect(cropBox(100, 300)).toEqual({ sx: 0, sy: 100, size: 100 });
  });

  it('keeps a square image whole', () => {
    expect(cropBox(96, 96)).toEqual({ sx: 0, sy: 0, size: 96 });
  });

  it('floors offsets for odd dimensions', () => {
    expect(cropBox(101, 100)).toEqual({ sx: 0, sy: 0, size: 100 });
    expect(cropBox(103, 100)).toEqual({ sx: 1, sy: 0, size: 100 });
  });

  it('never produces a crop larger than the source', () => {
    const { sx, sy, size } = cropBox(37, 251);
    expect(sx + size).toBeLessThanOrEqual(37);
    expect(sy + size).toBeLessThanOrEqual(251);
  });
});
