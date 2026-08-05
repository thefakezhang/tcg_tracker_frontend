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

const resizeKinds = ["Card", "Price"] as const;
const resizeCorners = ["nw", "ne", "sw", "se"] as const;

interface ResizeHitArea {
  kind: typeof resizeKinds[number];
  corner: typeof resizeCorners[number];
  element: HTMLElement;
  rect: DOMRect;
}

function installResizeHitMap(): { areas: ResizeHitArea[]; restore: () => void } {
  const areas = resizeKinds.flatMap((kind, kindIndex) => resizeCorners.map((corner, cornerIndex) => {
    const element = screen.getByRole("button", { name: `Resize ${kind} from the ${corner} corner` });
    const left = (cornerIndex % 2) * 168;
    const top = kindIndex * 120 + Math.floor(cornerIndex / 2) * 52;
    const rect = {
      width: 160,
      height: 44,
      x: left,
      y: top,
      top,
      left,
      right: left + 160,
      bottom: top + 44,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
    return { kind, corner, element, rect };
  }));
  const descriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: (x: number, y: number) => [...areas].reverse().find(({ rect }) => (
      x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
    ))?.element ?? null,
  });
  return {
    areas,
    restore: () => {
      if (descriptor) Object.defineProperty(document, "elementFromPoint", descriptor);
      else Reflect.deleteProperty(document, "elementFromPoint");
    },
  };
}

function overlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
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
    vi.restoreAllMocks();
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

  it("keeps overlay markers noninteractive and gives every corner a distinct external 44px hit area", () => {
    render(<Harness />);

    for (const kind of ["card", "price"]) {
      const overlay = document.querySelector(`[data-geometry-overlay="${kind}"]`);
      const controlGroup = document.querySelector(`[data-geometry-resize-group="${kind}"]`);
      expect(overlay).not.toBeNull();
      expect(overlay!.className).toContain("pointer-events-none");
      expect(overlay!.querySelectorAll("button")).toHaveLength(0);
      expect(overlay!.querySelectorAll(`[data-geometry-marker^="${kind}-"]`)).toHaveLength(4);
      expect(controlGroup).not.toBeNull();
      expect(controlGroup!.className).toContain("min-w-0");
    }

    const { areas, restore } = installResizeHitMap();
    try {
      for (const area of areas) {
        expect(area.element.className).toContain("min-h-11");
        expect(area.element.className).toContain("min-w-11");
        expect(area.element.className).toContain("w-full");
        expect(area.element.className).not.toContain("absolute");
        expect(area.element.closest("[data-geometry-overlay]")).toBeNull();
        expect(area.rect.height).toBe(44);
        expect(area.rect.right).toBeLessThanOrEqual(390);
        expect(document.elementFromPoint(
          area.rect.left + area.rect.width / 2,
          area.rect.top + area.rect.height / 2,
        )).toBe(area.element);
      }
      for (let left = 0; left < areas.length; left += 1) {
        for (let right = left + 1; right < areas.length; right += 1) {
          expect(overlap(areas[left].rect, areas[right].rect)).toBe(false);
        }
      }
    } finally {
      restore();
    }
  });

  it("routes every external corner hit target to its intended pair of boundaries", () => {
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
    const expected: Record<typeof resizeKinds[number], Record<typeof resizeCorners[number], ImageGeometry["card"]>> = {
      Card: {
        nw: { x0: 150, y0: 125, x1: 300, y1: 300 },
        ne: { x0: 100, y0: 125, x1: 350, y1: 300 },
        sw: { x0: 150, y0: 100, x1: 300, y1: 325 },
        se: { x0: 100, y0: 100, x1: 350, y1: 325 },
      },
      Price: {
        nw: { x0: 650, y0: 375, x1: 900, y1: 450 },
        ne: { x0: 600, y0: 375, x1: 950, y1: 450 },
        sw: { x0: 650, y0: 350, x1: 900, y1: 475 },
        se: { x0: 600, y0: 350, x1: 950, y1: 475 },
      },
    };
    const { areas, restore } = installResizeHitMap();
    try {
      areas.forEach((area, index) => {
        const x = area.rect.left + area.rect.width / 2;
        const y = area.rect.top + area.rect.height / 2;
        const target = document.elementFromPoint(x, y);
        expect(target).toBe(area.element);
        drag(target as HTMLElement, 20 + index, { x, y }, { x: x + 10, y: y + 5 });
        const key = area.kind.toLowerCase() as "card" | "price";
        expect(geometry()[key]).toEqual(expected[area.kind][area.corner]);
        fireEvent.click(screen.getByRole("button", { name: "Reset detector boxes" }));
      });
    } finally {
      restore();
    }

    expect(capture).toHaveBeenCalledTimes(8);
    expect(release).toHaveBeenCalledTimes(8);
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
