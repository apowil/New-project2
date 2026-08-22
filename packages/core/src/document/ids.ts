/**
 * Id generation. Avoids `crypto.randomUUID` so the core stays usable in any
 * runtime (older WebViews included) without a polyfill.
 */

let counter = 0;

export function createId(prefix = 'n'): string {
  counter += 1;
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}_${time}${counter.toString(36)}${random}`;
}
