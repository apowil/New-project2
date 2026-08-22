/**
 * Moving a sketch in and out of the app as a `.wisp` file — the escape hatch
 * from device-only storage, and the way to move work between the tablet and
 * the PC before the compute link exists.
 */

import { deserializeDocument, serializeDocument, type SketchDocument } from '@wisp/core';

const EXTENSION = '.wisp';

/** Turns a sketch name into something a filesystem will accept. */
export function toFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${cleaned || 'sketch'}${EXTENSION}`;
}

/** Prompts a download of the document. */
export function downloadDocument(doc: SketchDocument): void {
  const blob = new Blob([serializeDocument(doc)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = toFileName(doc.name);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Reads a user-chosen file. Throws with a readable message if it is not a sketch. */
export async function readDocumentFile(file: File): Promise<SketchDocument> {
  const buffer = await file.arrayBuffer();
  return deserializeDocument(buffer);
}

/** Opens the system file picker and resolves with the chosen file, if any. */
export function pickDocumentFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${EXTENSION},application/octet-stream`;
    input.style.display = 'none';

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    // Cancelling the picker fires no event in older browsers, so the input is
    // also cleaned up when focus returns to the page.
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(input.files?.[0] ?? null), 400),
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}
