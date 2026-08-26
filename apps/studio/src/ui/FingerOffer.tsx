import { useStore } from '../state/store.js';

/**
 * The rescue for a tablet with no stylus.
 *
 * By default a pen draws and one finger orbits, which is exactly right on a
 * pen tablet and leaves everyone else unable to draw a single stroke — every
 * attempt just spins the view. The setting that fixes it sits behind a gear
 * icon nobody has a reason to open, so the app has to raise its hand.
 *
 * Shown once, the first time a finger moves the camera on a device that has
 * never reported a pen, and never again once answered either way.
 */
export function FingerOffer() {
  const open = useStore((state) => state.offerFingerDrawing);
  const dismiss = useStore((state) => state.dismissFingerOffer);

  if (!open) return null;

  return (
    <div
      className="panel pointer-events-auto absolute bottom-28 left-1/2 z-40 flex w-80 -translate-x-1/2 flex-col gap-2 p-3"
      role="dialog"
      aria-label="Draw with your finger"
    >
      <span className="text-sm text-primary">Draw with your finger?</span>
      <p className="text-[11px] leading-snug text-muted">
        Right now a finger moves the view and only a pen draws. If this tablet
        has no pen, switch and your finger will draw instead — two fingers will
        still pan and zoom.
      </p>
      <div className="grid grid-cols-2 gap-1 pt-1">
        <button type="button" className="chip" onClick={() => dismiss(false)}>
          Keep as is
        </button>
        <button type="button" className="chip" data-active onClick={() => dismiss(true)}>
          Finger draws
        </button>
      </div>
    </div>
  );
}
