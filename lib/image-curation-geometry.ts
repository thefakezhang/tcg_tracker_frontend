export interface ImageBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ImageGeometry {
  card: ImageBox;
  price: ImageBox | null;
}

export type GridBBoxJSON =
  | ImageBox
  | { card?: ImageBox | null; price?: ImageBox | null }
  | null
  | undefined;

export type GeometryHandle = "move" | "nw" | "ne" | "sw" | "se";

export function parseGridGeometry(raw: GridBBoxJSON): ImageGeometry | null {
  if (!raw) return null;
  if ("card" in raw || "price" in raw) {
    if (!raw.card) return null;
    return { card: { ...raw.card }, price: raw.price ? { ...raw.price } : null };
  }
  if ("x0" in raw && "y0" in raw && "x1" in raw && "y1" in raw) {
    return { card: { ...raw }, price: null };
  }
  return null;
}

export function clampImageBox(
  box: ImageBox,
  width: number,
  height: number,
  minimumSize = 4,
): ImageBox {
  if (![width, height, box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) {
    throw new Error("Image coordinates and dimensions must be finite.");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Natural image dimensions must be positive integers.");
  }
  const x0 = Math.max(0, Math.min(width, Math.round(box.x0)));
  const y0 = Math.max(0, Math.min(height, Math.round(box.y0)));
  const x1 = Math.max(0, Math.min(width, Math.round(box.x1)));
  const y1 = Math.max(0, Math.min(height, Math.round(box.y1)));
  if (x1 - x0 < minimumSize || y1 - y0 < minimumSize) {
    throw new Error("Image box is too small after clamping.");
  }
  return { x0, y0, x1, y1 };
}

export function displayDeltaToImage(
  dx: number,
  dy: number,
  displayWidth: number,
  displayHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): { dx: number; dy: number } {
  if (displayWidth <= 0 || displayHeight <= 0) return { dx: 0, dy: 0 };
  return {
    dx: dx * naturalWidth / displayWidth,
    dy: dy * naturalHeight / displayHeight,
  };
}

export function editImageBox(
  initial: ImageBox,
  handle: GeometryHandle,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
): ImageBox {
  let next = { ...initial };
  if (handle === "move") {
    const boxWidth = initial.x1 - initial.x0;
    const boxHeight = initial.y1 - initial.y0;
    const x0 = Math.max(0, Math.min(width - boxWidth, initial.x0 + deltaX));
    const y0 = Math.max(0, Math.min(height - boxHeight, initial.y0 + deltaY));
    next = { x0, y0, x1: x0 + boxWidth, y1: y0 + boxHeight };
  } else {
    if (handle.includes("n")) next.y0 += deltaY;
    if (handle.includes("s")) next.y1 += deltaY;
    if (handle.includes("w")) next.x0 += deltaX;
    if (handle.includes("e")) next.x1 += deltaX;
  }
  try {
    return clampImageBox(next, width, height, 8);
  } catch {
    return clampImageBox(initial, width, height, 1);
  }
}

export function sameGeometry(a: ImageGeometry | null, b: ImageGeometry | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function shouldSubmitGeometryCorrection(
  geometry: ImageGeometry | null,
  baseline: ImageGeometry | null,
  hasRenderableSource: boolean,
  naturalWidth: number,
  naturalHeight: number,
): boolean {
  return Boolean(
    geometry
    && baseline
    && hasRenderableSource
    && naturalWidth > 0
    && naturalHeight > 0
    && !sameGeometry(geometry, baseline),
  );
}
