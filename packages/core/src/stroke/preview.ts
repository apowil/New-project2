/**
 * Keeping the live preview affordable, however long a stroke gets.
 *
 * While a stroke is being drawn its surface is swept from scratch on every
 * frame, because the shape of *every* ring depends on the whole stroke: the
 * taper is a fraction of total length, and the U coordinate is a position
 * along it. Adding a sample at the tip changes the radius of the first ring.
 * There is no correct way to append to the previous frame's mesh.
 *
 * So the cost of one frame is proportional to the stroke so far, and the cost
 * of drawing a whole stroke is proportional to its length *squared*. Measured:
 * a stroke growing to 200 samples spends 5 ms sweeping, 400 spends 21 ms, 800
 * spends 89 ms, 1600 spends 378 ms — four times the work for twice the stroke.
 * A long shading pass reaches several thousand samples, and every one of them
 * is paid for on the main thread, between the pen moving and the ink arriving.
 *
 * The way out is to notice that the preview does not need a ring per sample.
 * Samples are collected roughly a screen pixel apart, so a long stroke is
 * carrying far more rings than the screen can show. Capping the count makes a
 * frame cost the same whether the stroke is one centimetre or ten metres long,
 * and the full-resolution surface is built once, at commit, where it is paid
 * for a single time rather than sixty times a second.
 */

import { type StrokeSample } from './resample.js';

/**
 * The rings a single frame of preview may sweep, across every copy of it.
 *
 * A total rather than a per-copy figure, because symmetry draws the same
 * stroke up to eight times and it is the sum that has to fit in a frame. The
 * caller divides by the number of copies it is about to build, so drawing
 * without symmetry — the ordinary case — gets the whole budget and the finest
 * preview, and turning symmetry on trades fidelity for keeping up rather than
 * multiplying the cost by eight.
 *
 * At this size one sweep costs around a millisecond on a desktop CPU. Strokes
 * shorter than the budget — nearly all of them — are passed through untouched
 * and pay nothing.
 */
export const PREVIEW_RING_BUDGET = 768;

/**
 * How much of the budget is spent on the newest part of the stroke.
 *
 * The tip is where the pen is and where the eye is, so it keeps every sample.
 * Thinning is confined to the part already drawn and no longer being watched,
 * where the samples it drops sit about a pixel apart.
 */
const TIP_SHARE = 0.25;

/**
 * Thins a stroke down to at most `budget` samples for previewing.
 *
 * Returns the input array itself when it is already short enough — which is
 * the common case, so an ordinary stroke pays nothing at all for this.
 *
 * The result is for display only. It must never be committed to the document:
 * it is a deliberately lossy view of the samples, and the samples are what the
 * stroke actually is.
 */
export function previewSamples(
  samples: readonly StrokeSample[],
  budget: number = PREVIEW_RING_BUDGET,
): readonly StrokeSample[] {
  const count = samples.length;
  if (budget < 4 || count <= budget) return samples;

  const tip = Math.max(2, Math.floor(budget * TIP_SHARE));
  const settledCount = count - tip;
  const settledBudget = budget - tip;

  // How many samples to step over in the settled part to make it fit.
  const stride = Math.ceil(settledCount / settledBudget);

  const out: StrokeSample[] = [];
  // Starts at 0, so the beginning of the stroke — which the start taper is
  // measured from — is always present.
  for (let i = 0; i < settledCount; i += stride) out.push(samples[i]!);
  for (let i = settledCount; i < count; i += 1) out.push(samples[i]!);

  return out;
}
