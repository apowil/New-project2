import { useEffect, useState } from 'react';
import qr from 'qrcode-generator';

import { desktopBridge } from '../ops/desktopRunner.js';

/**
 * Sharing this machine's processor with tablets on the same network.
 *
 * Two separate things happen when this is on, and the panel says both plainly
 * because conflating them is the easiest mistake to make: the tablet can
 * *load* the app from here, and it can *send work* here. Only the second makes
 * anything faster.
 */

export interface HostState {
  running: boolean;
  port: number;
  addresses: string[];
  pairingCode: string | null;
  devices: Array<{ id: string; name: string; jobs: number }>;
}

export function HostPanel() {
  const [state, setState] = useState<HostState | null>(null);
  const [busy, setBusy] = useState(false);

  const bridge = desktopBridge();

  useEffect(() => {
    if (!bridge) return;
    void bridge.hostState().then((next) => setState(next as HostState | null));
    return bridge.onHostChanged((next) => setState(next as HostState | null));
  }, [bridge]);

  // Only the desktop app can serve anything; in a browser this is not a
  // feature that is switched off, it is one that cannot exist.
  if (!bridge) return null;

  const running = state?.running ?? false;
  const address = state?.addresses[0];
  const url = address ? `http://${address}:${state?.port}` : null;

  const toggle = async () => {
    setBusy(true);
    try {
      const next = running ? await bridge.stopHost() : await bridge.startHost();
      setState(next as HostState);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <span className="section-label">Share with tablets</span>
        <button
          type="button"
          className="chip"
          data-active={running}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {running ? 'On' : 'Off'}
        </button>
      </div>

      {!running && (
        <p className="text-[11px] leading-snug text-muted">
          Serves this app to tablets on the same Wi-Fi, and runs their heavy
          operations on this machine. Drawing still happens on the tablet — only
          the slow work travels.
        </p>
      )}

      {running && !url && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--color-danger)' }}>
          No network connection found, so nothing can reach this machine. Join a
          Wi-Fi network and switch this off and on again.
        </p>
      )}

      {running && url && (
        <>
          <div className="flex flex-col items-center gap-2 rounded-lg bg-sunken p-3">
            <QrCode text={url} />
            <span className="font-mono text-[11px] text-secondary">{url}</span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="section-label">Pairing code</span>
            <span className="text-center font-mono text-2xl tracking-widest text-primary">
              {state?.pairingCode}
            </span>
            <p className="text-[11px] leading-snug text-muted">
              Typed once on each tablet. Without it a device can open the app but
              cannot spend this machine's processor.
            </p>
          </div>

          <div className="flex flex-col gap-1 border-t border-line pt-2">
            <span className="section-label">
              Connected · {state?.devices.length ?? 0}
            </span>
            {(state?.devices.length ?? 0) === 0 ? (
              <span className="text-[11px] text-muted">Nothing paired yet.</span>
            ) : (
              state?.devices.map((device) => (
                <div key={device.id} className="flex justify-between text-xs">
                  <span className="text-secondary">{device.name}</span>
                  <span className="tabular-nums text-muted">
                    {device.jobs > 0 ? `${device.jobs} running` : 'idle'}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The address as a scannable code.
 *
 * Typing `192.168.1.42:7823` on a tablet is miserable and easy to get wrong,
 * and getting it wrong looks identical to the feature being broken.
 */
function QrCode({ text }: { text: string }) {
  const cells = useState(() => {
    const code = qr(0, 'M');
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    const dark: Array<[number, number]> = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) dark.push([row, column]);
      }
    }
    return { count, dark };
  })[0];

  return (
    <svg
      viewBox={`0 0 ${cells.count} ${cells.count}`}
      className="h-40 w-40 rounded bg-white p-1"
      role="img"
      aria-label={`QR code for ${text}`}
    >
      {cells.dark.map(([row, column]) => (
        <rect key={`${row}-${column}`} x={column} y={row} width={1} height={1} fill="#000" />
      ))}
    </svg>
  );
}
