// Shrink a receipt photo in the browser before it is uploaded.
//
// Why: the receipt uploaders sent the raw File. A modern phone camera writes a
// 3-7MB JPEG (the largest one in lot-receipts is 6.9MB), the uploads run one
// after another with no retry, and on a hotel or mobile connection abroad
// WebKit gives up on the request and reports "Fetch is aborted" - the exact
// failure seen uploading lot receipts from Japan. A receipt only has to stay
// readable, so downscaling to 1600px on the long edge at quality 0.8 turns a
// ~3MB photo into ~250KB: an upload short enough that the connection does not
// have time to drop under it.
//
// Everything here is best-effort. A PDF, an unsupported type, a file that is
// already small, a browser that cannot decode the image, or a canvas that
// refuses to encode all return the ORIGINAL file rather than failing the
// upload - a large upload that might work beats a certain error.

const MAX_EDGE = 1600;
const QUALITY = 0.8;
// Below this, re-encoding costs more than it saves.
const SKIP_UNDER_BYTES = 600 * 1024;

function canCompress(file: File): boolean {
  // HEIC/HEIF decode is not reliable across browsers; leave those alone.
  return file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp";
}

async function loadBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

export async function compressReceiptImage(file: File): Promise<File> {
  if (!canCompress(file) || file.size <= SKIP_UNDER_BYTES) return file;

  const bitmap = await loadBitmap(file);
  if (!bitmap) return file;

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob) return file;
    // A re-encode that grew the file is not worth keeping (already-optimised
    // sources, or a PNG screenshot that JPEG handles badly).
    if (blob.size >= file.size) return file;

    const renamed = file.name.replace(/\.(png|webp|jpeg|jpg)$/i, "") + ".jpg";
    return new File([blob], renamed, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
