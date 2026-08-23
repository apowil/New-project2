import { UNITS, type Unit } from '@wisp/core';

/**
 * The display unit is a per-person preference rather than a document property:
 * the same sketch opened by someone working in inches should read in inches
 * without the file changing.
 */
const STORAGE_KEY = 'wisp.unit';

export function readUnit(): Unit {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (UNITS as string[]).includes(stored)) return stored as Unit;
  } catch {
    /* storage disabled */
  }
  return 'cm';
}

export function writeUnit(unit: Unit): void {
  try {
    localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    /* the choice simply will not persist */
  }
}
