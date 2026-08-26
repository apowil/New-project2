import { useStore } from '../state/store.js';
import { describeUpdate, shouldOffer } from '../state/updates.js';

/**
 * "A newer Wisp is ready."
 *
 * Shown only when there is something to take and the person has not already
 * said no. Everything else the update machinery knows — checking, downloading,
 * up to date — belongs in settings, where somebody went looking for it, not
 * over the canvas where they did not.
 */
export function UpdateBanner() {
  const update = useStore((state) => state.update);
  const dismissed = useStore((state) => state.updateDismissed);
  const apply = useStore((state) => state.applyUpdate);
  const dismiss = useStore((state) => state.dismissUpdate);

  if (!shouldOffer(update, dismissed)) return null;

  const desktop = update.channel === 'desktop';

  return (
    <div
      className="panel pointer-events-auto absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 px-3 py-2"
      role="status"
      aria-label="Update available"
    >
      <div className="flex flex-col">
        <span className="text-xs text-primary">
          {update.version ? `Wisp ${update.version} is ready` : 'A newer Wisp is ready'}
        </span>
        <span className="text-[11px] text-muted">
          {desktop ? 'Restarts the app. Your sketch is saved first.' : 'Reloads the page.'}
        </span>
      </div>

      <button type="button" className="chip" onClick={dismiss}>
        Later
      </button>
      <button type="button" className="chip" data-active onClick={apply}>
        {desktop ? 'Restart' : 'Reload'}
      </button>
    </div>
  );
}

/**
 * The same thing, told plainly, for the settings panel.
 *
 * A banner can only ever say "yes there is one". This says the rest: whether
 * the app can update at all, whether it looked recently, and what it found —
 * which is what somebody who came here to ask actually wants.
 */
export function UpdateSection() {
  const update = useStore((state) => state.update);
  const check = useStore((state) => state.checkForUpdate);
  const apply = useStore((state) => state.applyUpdate);

  if (!update.supported) return null;

  const busy = update.status === 'checking' || update.status === 'downloading';

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <span className="section-label">Version</span>
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={update.status === 'ready' ? apply : check}
        >
          {update.status === 'ready' ? 'Install' : busy ? 'Checking…' : 'Check'}
        </button>
      </div>
      <p className="text-[10px] leading-snug text-muted">{describeUpdate(update)}</p>
    </div>
  );
}
