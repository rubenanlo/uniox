export const AVATAR_SIZE = 96;

/** Largest centered square inside a width×height image. */
export function cropBox(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
  };
}

/**
 * Decode a user-picked image, center-crop to a square, and downscale to
 * AVATAR_SIZE as a small data-URL (a few KB) suitable for the settings store.
 * Rejects on files the browser cannot decode as images.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    // JPEG has no alpha; fill white so transparent PNGs don't turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const { sx, sy, size } = cropBox(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
}
