/**
 * Recognising, and remembering, the desktop that served this page.
 *
 * A tablet reaches the host over plain HTTP on the local network, so the
 * simplest reliable signal that a host is present is the address the page was
 * loaded from: anything that is not localhost and not a file is a candidate.
 */

const CODE_KEY = 'wisp.pairing-code';
const DECLINED_KEY = 'wisp.pairing-declined';
const NAME_KEY = 'wisp.device-name';

/** The WebSocket the host listens on, or null if this page came from nowhere. */
export function hostLinkUrl(): string | null {
  if (typeof location === 'undefined') return null;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;

  // Loopback means the desktop app's own window, or a dev server on this very
  // machine — neither is a host worth pairing with.
  const local = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
  if (local.includes(location.hostname)) return null;

  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/link`;
}

export function readPairing(): string | null {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

export function rememberPairing(code: string): void {
  try {
    localStorage.setItem(CODE_KEY, code);
    localStorage.removeItem(DECLINED_KEY);
  } catch {
    /* the offer simply reappears next time */
  }
}

export function pairingDeclined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberPairingDeclined(): void {
  try {
    localStorage.setItem(DECLINED_KEY, '1');
  } catch {
    /* nothing to do */
  }
}

/**
 * What this device calls itself in the host's device list.
 *
 * Generated once and kept, so the same tablet reads as the same entry across
 * sessions rather than appearing as a new arrival every time.
 */
export function deviceName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    const name = `Tablet ${String(Math.floor(Math.random() * 90) + 10)}`;
    localStorage.setItem(NAME_KEY, name);
    return name;
  } catch {
    return 'Tablet';
  }
}
