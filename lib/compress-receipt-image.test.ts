// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { compressReceiptImage } from "./compress-receipt-image";

const LARGE_BYTES = 700 * 1024;

function receipt(name = "receipt.png", type = "image/png", size = LARGE_BYTES) {
  return new File([new Uint8Array(size)], name, {
    type,
    lastModified: 1234,
  });
}

function bitmap(width = 3200, height = 1600) {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function installCanvas(options: {
  context?: { drawImage: ReturnType<typeof vi.fn> } | null;
  blob?: Blob | null;
  throwOnEncode?: boolean;
}) {
  const context = options.context === undefined
    ? { drawImage: vi.fn() }
    : options.context;
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => {
      if (options.throwOnEncode) throw new Error("encoder unavailable");
      callback(options.blob ?? null);
    }),
  };
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName, opts) =>
    tagName === "canvas"
      ? canvas as unknown as HTMLCanvasElement
      : createElement(tagName, opts),
  );
  return { canvas, context };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("compressReceiptImage", () => {
  it("leaves small and unsupported receipts untouched without decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const small = receipt("small.jpg", "image/jpeg", 1024);
    const pdf = receipt("receipt.pdf", "application/pdf");

    await expect(compressReceiptImage(small)).resolves.toBe(small);
    await expect(compressReceiptImage(pdf)).resolves.toBe(pdf);
    expect(decode).not.toHaveBeenCalled();
  });

  it("falls back to the original when the browser cannot decode the image", async () => {
    const original = receipt();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode failed")));

    await expect(compressReceiptImage(original)).resolves.toBe(original);
  });

  it("falls back when createImageBitmap is unavailable", async () => {
    const original = receipt();
    vi.stubGlobal("createImageBitmap", undefined);

    await expect(compressReceiptImage(original)).resolves.toBe(original);
  });

  it("falls back and closes the bitmap when canvas has no 2d context", async () => {
    const original = receipt();
    const decoded = bitmap();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(decoded));
    installCanvas({ context: null });

    await expect(compressReceiptImage(original)).resolves.toBe(original);
    expect(decoded.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["returns no blob", { blob: null }],
    ["throws", { throwOnEncode: true }],
  ])("falls back when the browser encoder %s", async (_label, options) => {
    const original = receipt();
    const decoded = bitmap();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(decoded));
    installCanvas(options);

    await expect(compressReceiptImage(original)).resolves.toBe(original);
    expect(decoded.close).toHaveBeenCalledOnce();
  });

  it("keeps the original when re-encoding would make it larger", async () => {
    const original = receipt();
    const decoded = bitmap();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(decoded));
    installCanvas({ blob: new Blob([new Uint8Array(LARGE_BYTES + 1)]) });

    await expect(compressReceiptImage(original)).resolves.toBe(original);
    expect(decoded.close).toHaveBeenCalledOnce();
  });

  it("downscales, encodes, renames, and closes a large receipt", async () => {
    const original = receipt("store.WEBP", "image/webp");
    const decoded = bitmap();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(decoded));
    const { canvas, context } = installCanvas({ blob: new Blob([new Uint8Array(100)]) });

    const compressed = await compressReceiptImage(original);

    expect(compressed).not.toBe(original);
    expect(compressed.name).toBe("store.jpg");
    expect(compressed.type).toBe("image/jpeg");
    expect(compressed.lastModified).toBe(1234);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(context?.drawImage).toHaveBeenCalledWith(decoded, 0, 0, 1600, 800);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.8);
    expect(decoded.close).toHaveBeenCalledOnce();
  });
});
