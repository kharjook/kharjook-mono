/**
 * Compress & square-crop an image File entirely client-side.
 *
 * Why this exists: users will pick raw camera photos (multi-MB). Uploading
 * those as-is would slaughter bandwidth on every list render (icons are
 * rendered as plain <img>, served directly from Supabase Storage, no CDN
 * optimizer). A ~256px WebP at q=0.85 lands well under 50 KB.
 *
 * No external deps — uses the browser's canvas + toBlob.
 */
export async function compressImageToSquareWebp(
  file: File,
  {
    maxSize = 256,
    quality = 0.85,
  }: { maxSize?: number; quality?: number } = {}
): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are accepted.');
  }

  const bitmap = await loadBitmap(file);

  // Center square crop so the circular avatar mask looks right regardless of
  // the source aspect ratio.
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);

  const target = Math.min(maxSize, side);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, target, target);

  // Prefer WebP (widely supported, smaller than JPEG at same quality). Fall
  // back to PNG only if the browser somehow refuses WebP.
  const blob = await canvasToBlob(canvas, 'image/webp', quality);
  return blob ?? (await canvasToBlobOrThrow(canvas, 'image/png', 1));
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Some browsers still fail on HEIC/odd inputs — fall through to <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

async function canvasToBlobOrThrow(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  const b = await canvasToBlob(canvas, type, quality);
  if (!b) throw new Error('Failed to encode image.');
  return b;
}
