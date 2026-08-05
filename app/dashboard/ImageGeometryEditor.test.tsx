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

  it("moves both boxes from dedicated phone touch targets without changing their size", () => {
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

    const cardMove = screen.getByRole("button", { name: "Move Card box" });
    const priceMove = screen.getByRole("button", { name: "Move Price box" });
    expect(cardMove.className).toContain("min-h-11");
    expect(cardMove.className).toContain("min-w-11");
    expect(priceMove.className).toContain("min-h-11");
    expect(priceMove.className).toContain("min-w-11");

    drag(cardMove, 11, { x: 20, y: 20 }, { x: 30, y: 30 });
    expect(geometry().card).toEqual({ x0: 150, y0: 150, x1: 350, y1: 350 });
    expect(geometry().card.x1 - geometry().card.x0).toBe(200);
    expect(geometry().card.y1 - geometry().card.y0).toBe(200);

    drag(priceMove, 12, { x: 80, y: 80 }, { x: 70, y: 70 });
    expect(geometry().price).toEqual({ x0: 550, y0: 300, x1: 850, y1: 400 });
    expect(geometry().price!.x1 - geometry().price!.x0).toBe(300);
    expect(geometry().price!.y1 - geometry().price!.y0).toBe(100);

    expect(capture).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("keeps four 44px corner targets per box and resizes the intended bounds", () => {
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

    for (const kind of ["Card", "Price"]) {
      for (const corner of ["nw", "ne", "sw", "se"]) {
        expect(screen.getByRole("button", { name: `Resize ${kind} from the ${corner} corner` }).className).toContain("size-11");
      }
    }

    const cardHandle = screen.getByRole("button", { name: "Resize Card from the se corner" });
    expect(screen.getByText("Card").className).toContain("left-11");
    drag(cardHandle, 21, { x: 30, y: 30 }, { x: 40, y: 35 });
    expect(geometry().card).toEqual({ x0: 100, y0: 100, x1: 350, y1: 325 });

    const priceHandle = screen.getByRole("button", { name: "Resize Price from the se corner" });
    drag(priceHandle, 22, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(geometry().price).toEqual({ x0: 600, y0: 350, x1: 950, y1: 500 });

    expect(capture).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("supports keyboard adjustment and removing and restoring the price box", () => {
    render(<Harness />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Card box" }), {
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
