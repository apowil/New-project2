/**
 * Picking a reference image off the device.
 *
 * The image is held as a data URL rather than an object URL: object URLs are
 * tied to the document that created them, and a reference has to survive being
 * moved between panels and re-rendered without going stale.
 */

/** Refuse anything large enough to bog the page down as a base64 string. */
const MAX_BYTES = 12 * 1024 * 1024;

export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    // Cancelling the picker fires no event in some browsers, so clean up when
    // focus comes back to the page as well.
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(input.files?.[0] ?? null), 400),
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}

export async function readImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('That image could not be read.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
}
