import { toFileName } from './files.js';

/**
 * Exporting a picture of the sketch.
 *
 * PNG and JPEG come from the WebGL framebuffer, rendered at a multiple of the
 * on-screen size so an export is not limited to the tablet's resolution. SVG
 * is a genuinely different path: it re-renders the scene through Three's
 * SVGRenderer, which emits real vector polygons rather than tracing pixels.
 */

export type ImageFormat = 'png' | 'jpg' | 'svg';

export const IMAGE_FORMAT_LABELS: Record<ImageFormat, string> = {
  png: 'PNG image',
  jpg: 'JPEG image',
  svg: 'SVG vector',
};

const MIME: Record<'png' | 'jpg', string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
};

/** Saves a data URL or text blob under a name derived from the sketch. */
export function downloadExport(name: string, format: ImageFormat, payload: string): void {
  const fileName = toFileName(name).replace(/\.wisp$/, `.${format}`);

  let href = payload;
  if (format === 'svg') {
    href = URL.createObjectURL(new Blob([payload], { type: 'image/svg+xml' }));
  }

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  if (format === 'svg') {
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }
}

export const rasterMime = (format: 'png' | 'jpg'): string => MIME[format];
