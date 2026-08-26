import { describe, expect, it } from 'vitest';

import {
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  sliderFromWidth,
  widthFromSlider,
} from './types.js';

describe('stroke width scale', () => {
  it('spans a technical pen to a broad marker', () => {
    // 0.1 mm to 500 mm: fine enough for product detail, broad enough for a room.
    expect(MIN_STROKE_WIDTH * 1000).toBeCloseTo(0.1, 6);
    expect(MAX_STROKE_WIDTH * 1000).toBeCloseTo(500, 6);
  });

  it('reaches both ends exactly', () => {
    expect(widthFromSlider(0)).toBeCloseTo(MIN_STROKE_WIDTH, 10);
    expect(widthFromSlider(1)).toBeCloseTo(MAX_STROKE_WIDTH, 10);
  });

  it('round-trips a width through the slider position', () => {
    for (const mm of [0.1, 0.2, 0.35, 1, 5, 60, 500]) {
      const width = mm / 1000;
      expect(widthFromSlider(sliderFromWidth(width))).toBeCloseTo(width, 9);
    }
  });

  it('gives the fine end a fair share of the track', () => {
    // Everything at or below a millimetre — where product work lives — must
    // occupy a usable stretch of the slider, not a sliver at the very bottom.
    const atOneMillimetre = sliderFromWidth(0.001);
    expect(atOneMillimetre).toBeGreaterThan(0.24);

    // A linear scale would have put 1 mm at 0.2% of the track.
    const linear = (0.001 - MIN_STROKE_WIDTH) / (MAX_STROKE_WIDTH - MIN_STROKE_WIDTH);
    expect(linear).toBeLessThan(0.002);
  });

  it('moves by a constant ratio, so fine control stays fine', () => {
    // A tenth of the track multiplies the width by the same factor wherever
    // you are, which is what makes the low end controllable.
    const step = widthFromSlider(0.1) / widthFromSlider(0);
    expect(widthFromSlider(0.6) / widthFromSlider(0.5)).toBeCloseTo(step, 6);
    expect(widthFromSlider(1) / widthFromSlider(0.9)).toBeCloseTo(step, 6);
  });

  it('clamps anything outside the range rather than exploding', () => {
    expect(sliderFromWidth(0)).toBe(0);
    expect(sliderFromWidth(-5)).toBe(0);
    expect(sliderFromWidth(1000)).toBe(1);
    expect(widthFromSlider(-1)).toBeCloseTo(MIN_STROKE_WIDTH, 10);
    expect(widthFromSlider(2)).toBeCloseTo(MAX_STROKE_WIDTH, 10);
  });

  it('can actually select a 0.2 mm tip', () => {
    // The old slider stepped 2 mm at a time from 8 mm, so this was unreachable.
    const t = sliderFromWidth(0.0002);
    expect(widthFromSlider(t) * 1000).toBeCloseTo(0.2, 6);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });
});
