// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { LanguageProvider } from "./LanguageContext";
import { ImageGeometryEditor } from "./ImageGeometryEditor";
import { ImageGeometry } from "@/lib/image-curation-geometry";

const initialGeometry: ImageGeometry = {
  card: { x0: 100, y0: 100, x1: 300, y1: 300 },
  price: { x0: 600, y0: 350, x1: 900, y1: 450 },
};

function Harness() {
  const [geometry, setGeometry] = useState(initialGeometry);
  return (
    <LanguageProvider>
      <ImageGeometryEditor
        src="https://example.test/buylist.jpg"
        geometry={geometry}
        naturalWidth={1000}
        naturalHeight={500}
        onNaturalSize={() => undefined}
        onChange={setGeometry}
        onReset={() => setGeometry(initialGeometry)}
      />
      <output data-testid="geometry">{JSON.stringify(geometry)}</output>
    </LanguageProvider>
  );
}

function geometry(): ImageGeometry {
  return JSON.parse(screen.getByTestId("geometry").textContent ?? "{}") as ImageGeometry;
}

function drag(
  target: HTMLElement,
  pointerId: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType: "mouse" | "touch" = "touch",
) {
  fireEvent.pointerDown(target, {
    pointerId,
    pointerType,
    clientX: from.x,
    clientY: from.y,
  });
  fireEvent.pointerMove(target, {
    pointerId,
    pointerType,
    clientX: to.x,
    clientY: to.y,
  });
  fireEvent.pointerUp(target, {
    pointerId,
    pointerType,
    clientX: to.x,
    clientY: to.y,
  });
}

describe("ImageGeometryEditor", () => {
  const capture = vi.fn();
  const release = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: capture,
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: release,
    });
  });

  afterEach(() => {
    cleanup();
    capture.mockReset();
    release.mockReset();
  });

  it("moves and resizes both boxes with captured phone pointers and scaled coordinates", () => {
    render(<Harness />);
    const image = screen.getByAltText("Source buylist with editable card and price crop boxes");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      toJSON: () => ({}),
    });

    drag(screen.getByRole("group", { name: "Card crop" }), 11, { x: 20, y: 20 }, { x: 30, y: 30 });
    expect(geometry().card).toEqual({ x0: 150, y0: 150, x1: 350, y1: 350 });

    const cardHandle = screen.getByRole("button", { name: "Resize Card from the se corner" });
    expect(cardHandle.className).toContain("size-11");
    drag(cardHandle, 12, { x: 30, y: 30 }, { x: 40, y: 35 });
    expect(geometry().card).toEqual({ x0: 150, y0: 150, x1: 400, y1: 375 });

    drag(screen.getByRole("group", { name: "Price crop" }), 13, { x: 80, y: 80 }, { x: -200, y: -200 });
    expect(geometry().price).toEqual({ x0: 0, y0: 0, x1: 300, y1: 100 });

    const priceHandle = screen.getByRole("button", { name: "Resize Price from the se corner" });
    expect(priceHandle.className).toContain("size-11");
    drag(priceHandle, 14, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(geometry().price).toEqual({ x0: 0, y0: 0, x1: 350, y1: 150 });

    expect(capture).toHaveBeenCalledTimes(4);
    expect(release).toHaveBeenCalledTimes(4);
  });

  it("supports keyboard adjustment and removing and restoring the price box", () => {
    render(<Harness />);

    fireEvent.keyDown(screen.getByRole("group", { name: "Card crop" }), {
      key: "ArrowLeft",
      altKey: true,
    });
    expect(geometry().card).toEqual({ x0: 99, y0: 100, x1: 299, y1: 300 });

    fireEvent.click(screen.getByRole("button", { name: "Remove price box" }));
    expect(geometry().price).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add price box" }));
    expect(geometry().price).toEqual({ x0: 250, y0: 375, x1: 750, y1: 450 });
  });
});
