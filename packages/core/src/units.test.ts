import { describe, expect, it } from 'vitest';
import { formatLength, fromUnit, parseLength, toUnit, UNITS } from './units.js';

describe('unit conversion', () => {
  it('treats one scene unit as one metre', () => {
    expect(toUnit(1, 'm')).toBe(1);
    expect(toUnit(1, 'cm')).toBe(100);
    expect(toUnit(1, 'mm')).toBe(1000);
    expect(toUnit(1, 'in')).toBeCloseTo(39.3701, 3);
    expect(toUnit(1, 'ft')).toBeCloseTo(3.28084, 4);
  });

  it('round-trips through every unit', () => {
    for (const unit of UNITS) {
      expect(fromUnit(toUnit(0.0637, unit), unit)).toBeCloseTo(0.0637, 9);
    }
  });
});

describe('formatLength', () => {
  it('shows a brush width in whichever unit is chosen', () => {
    // The 6 cm default brush, seen four ways.
    expect(formatLength(0.06, 'mm')).toBe('60 mm');
    expect(formatLength(0.06, 'cm')).toBe('6 cm');
    expect(formatLength(0.06, 'm')).toBe('0.06 m');
    expect(formatLength(0.06, 'in')).toBe('2.362 in');
  });

  it('trims trailing zeros but keeps real precision', () => {
    expect(formatLength(0.5, 'm')).toBe('0.5 m');
    expect(formatLength(0.1234, 'm')).toBe('0.123 m');
    expect(formatLength(1, 'm')).toBe('1 m');
  });

  it('omits the suffix when asked, for use in an input', () => {
    expect(formatLength(0.06, 'cm', false)).toBe('6');
  });

  it('handles zero and negatives', () => {
    expect(formatLength(0, 'cm')).toBe('0 cm');
    expect(formatLength(-0.25, 'm')).toBe('-0.25 m');
  });
});

describe('parseLength', () => {
  it('reads a bare number in the current unit', () => {
    expect(parseLength('6', 'cm')).toBeCloseTo(0.06, 9);
    expect(parseLength('60', 'mm')).toBeCloseTo(0.06, 9);
    expect(parseLength('2.5', 'm')).toBeCloseTo(2.5, 9);
  });

  it('lets an explicit suffix override the current unit', () => {
    // Typing "5mm" while set to metres must not mean five metres.
    expect(parseLength('5mm', 'm')).toBeCloseTo(0.005, 9);
    expect(parseLength('12 in', 'mm')).toBeCloseTo(0.3048, 6);
    expect(parseLength('1ft', 'cm')).toBeCloseTo(0.3048, 6);
    expect(parseLength('2"', 'cm')).toBeCloseTo(0.0508, 6);
  });

  it('tolerates whitespace and leading signs', () => {
    expect(parseLength('  7.5  ', 'cm')).toBeCloseTo(0.075, 9);
    expect(parseLength('-3', 'cm')).toBeCloseTo(-0.03, 9);
    expect(parseLength('+.5', 'm')).toBeCloseTo(0.5, 9);
  });

  it('rejects anything that is not a length', () => {
    expect(parseLength('', 'cm')).toBeNull();
    expect(parseLength('abc', 'cm')).toBeNull();
    expect(parseLength('5 furlongs', 'cm')).toBeNull();
    expect(parseLength('1.2.3', 'cm')).toBeNull();
  });

  it('round-trips what formatLength produced', () => {
    for (const unit of UNITS) {
      const text = formatLength(0.075, unit, false);
      expect(parseLength(text, unit)).toBeCloseTo(0.075, 4);
    }
  });
});
