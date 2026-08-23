/**
 * Display units.
 *
 * One scene unit is one metre, everywhere, always. Units are a *presentation*
 * concern: nothing in the document, the geometry or the file format changes
 * when you switch from millimetres to inches. Keeping the internal unit fixed
 * is what stops a sketch drawn in mm and reopened in inches from silently
 * changing size.
 */

export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export const UNITS: Unit[] = ['mm', 'cm', 'm', 'in', 'ft'];

/** How many of each unit fit in a metre. */
const PER_METRE: Record<Unit, number> = {
  mm: 1000,
  cm: 100,
  m: 1,
  in: 1 / 0.0254,
  ft: 1 / 0.3048,
};

/** Sensible decimal places, so a millimetre reading is not "6.0000 mm". */
const DECIMALS: Record<Unit, number> = {
  mm: 1,
  cm: 2,
  m: 3,
  in: 3,
  ft: 3,
};

export const UNIT_LABELS: Record<Unit, string> = {
  mm: 'Millimetres',
  cm: 'Centimetres',
  m: 'Metres',
  in: 'Inches',
  ft: 'Feet',
};

export const toUnit = (metres: number, unit: Unit): number => metres * PER_METRE[unit];

export const fromUnit = (value: number, unit: Unit): number => value / PER_METRE[unit];

/** Trims trailing zeros, so 6.00 reads as 6 but 6.25 keeps its precision. */
function trim(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** "6 cm". Pass `withUnit: false` for a bare number in an input field. */
export function formatLength(metres: number, unit: Unit, withUnit = true): string {
  const text = trim(toUnit(metres, unit), DECIMALS[unit]);
  return withUnit ? `${text} ${unit}` : text;
}

/** Step size that feels right for a slider or number field in this unit. */
export const stepFor = (unit: Unit): number => Number(`1e-${DECIMALS[unit]}`);

/**
 * Reads a typed length. Accepts a bare number in the current unit, or an
 * explicit suffix that overrides it — typing "5mm" while set to metres does
 * what you meant rather than making a five-metre rectangle.
 *
 * Returns metres, or null when the text is not a length.
 */
export function parseLength(text: string, unit: Unit): number | null {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  const match = /^([+-]?\d*\.?\d+)\s*(mm|cm|m|in|ft|")?$/.exec(trimmed);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const suffix = match[2];
  const resolved: Unit = suffix === '"' ? 'in' : ((suffix as Unit | undefined) ?? unit);
  return fromUnit(value, resolved);
}
