import { describe, expect, it } from 'vitest';

import { glyphFor, hasGlyph } from './font.js';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = LOWER.toUpperCase();

/** Every point in a glyph, flattened. */
const points = (character: string): number[][] => glyphFor(character).flat();

describe('font', () => {
  it('covers the whole alphabet in both cases', () => {
    for (const character of LOWER + UPPER) {
      expect(hasGlyph(character), character).toBe(true);
      expect(glyphFor(character).length, character).toBeGreaterThan(0);
    }
  });

  it('draws lowercase differently from capitals', () => {
    // The point of adding lowercase is that it is not just small capitals.
    for (const character of LOWER) {
      expect(
        JSON.stringify(glyphFor(character)),
        `${character} matches its capital`,
      ).not.toBe(JSON.stringify(glyphFor(character.toUpperCase())));
    }
  });

  it('keeps lowercase below cap height except for ascenders', () => {
    const ascenders = new Set(['b', 'd', 'f', 'h', 'k', 'l', 't']);
    for (const character of LOWER) {
      const top = Math.max(...points(character).map((p) => p[1]!));
      if (ascenders.has(character)) {
        expect(top, character).toBeGreaterThan(0.7);
      } else {
        // 0.95 covers the dot on i and j, which sits above the x-height.
        expect(top, character).toBeLessThanOrEqual(0.95);
      }
    }
  });

  it('gives descenders to exactly the letters that should have them', () => {
    const descenders = new Set(['g', 'j', 'p', 'q', 'y']);
    for (const character of LOWER) {
      const bottom = Math.min(...points(character).map((p) => p[1]!));
      if (descenders.has(character)) expect(bottom, character).toBeLessThan(-0.1);
      else expect(bottom, character).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every glyph inside the em box horizontally', () => {
    for (const character of LOWER + UPPER + '0123456789') {
      for (const [x] of points(character)) {
        expect(x, character).toBeGreaterThanOrEqual(0);
        expect(x, character).toBeLessThanOrEqual(0.75);
      }
    }
  });

  it('has no zero-length polyline, which would sweep to nothing', () => {
    for (const character of LOWER + UPPER) {
      for (const polyline of glyphFor(character)) {
        expect(polyline.length, character).toBeGreaterThan(1);

        const spans = polyline.some(
          ([x, y], i) => i > 0 && (x !== polyline[i - 1]![0] || y !== polyline[i - 1]![1]),
        );
        expect(spans, `${character} has a polyline going nowhere`).toBe(true);
      }
    }
  });

  it('keeps digits and space working alongside the letters', () => {
    for (const character of '0123456789') {
      expect(hasGlyph(character), character).toBe(true);
    }
    // Space is a real glyph with no strokes, not a missing one.
    expect(hasGlyph(' ')).toBe(true);
    expect(glyphFor(' ')).toEqual([]);
  });

  it('draws a box for a character it does not have at all', () => {
    const tofu = glyphFor('中');
    expect(tofu.length).toBe(1);
    expect(hasGlyph('中')).toBe(false);
  });
});
