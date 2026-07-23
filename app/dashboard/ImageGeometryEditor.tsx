"use client";

import { useRef } from "react";
import {
  displayDeltaToImage,
  editImageBox,
  GeometryHandle,
  ImageBox,
  ImageGeometry,
} from "@/lib/image-curation-geometry";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

interface DragState {
  kind: "card" | "price";
  handle: GeometryHandle;
  pointerId: number;
  startX: number;
  startY: number;
  initial: ImageBox;
  displayWidth: number;
  displayHeight: number;
}

export function ImageGeometryEditor({
  src,
  geometry,
  naturalWidth,
  naturalHeight,
  onNaturalSize,
  onChange,
  onReset,
}: {
  src: string;
  geometry: ImageGeometry;
  naturalWidth: number;
  naturalHeight: number;
  onNaturalSize: (width: number, height: number) => void;
  onChange: (geometry: ImageGeometry) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const start = (
    event: React.PointerEvent<HTMLElement>,
    kind: "card" | "price",
    handle: GeometryHandle,
    initial: ImageBox,
  ) => {
    const image = imageRef.current;
    if (!image) return;
    const rect = image.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      kind,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initial,
      displayWidth: rect.width,
      displayHeight: rect.height,
    };
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = displayDeltaToImage(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
      drag.displayWidth,
      drag.displayHeight,
      naturalWidth,
      naturalHeight,
    );
    const next = editImageBox(
      drag.initial,
      drag.handle,
      delta.dx,
      delta.dy,
      naturalWidth,
      naturalHeight,
    );
    onChange({ ...geometry, [drag.kind]: next });
  };

  const stop = (event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    dragRef.current = null;
  };

  const keyAdjust = (
    event: React.KeyboardEvent<HTMLElement>,
    kind: "card" | "price",
    handle: GeometryHandle,
    initial: ImageBox,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.altKey ? 1 : event.shiftKey ? 10 : 4;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const next = editImageBox(initial, handle, dx, dy, naturalWidth, naturalHeight);
    onChange({ ...geometry, [kind]: next });
  };

  const overlay = (kind: "card" | "price", box: ImageBox, tone: string) => {
    const style = {
      left: `${box.x0 / naturalWidth * 100}%`,
      top: `${box.y0 / naturalHeight * 100}%`,
      width: `${(box.x1 - box.x0) / naturalWidth * 100}%`,
      height: `${(box.y1 - box.y0) / naturalHeight * 100}%`,
    };
    const kindLabel = t(`curation.geometry.${kind}` as "curation.geometry.card" | "curation.geometry.price");
    const handles: Array<[GeometryHandle, string, string]> = [
      ["nw", "left-0 top-0 cursor-nwse-resize items-start justify-start", "rounded-br-full"],
      ["ne", "right-0 top-0 cursor-nesw-resize items-start justify-end", "rounded-bl-full"],
      ["sw", "bottom-0 left-0 cursor-nesw-resize items-end justify-start", "rounded-tr-full"],
      ["se", "bottom-0 right-0 cursor-nwse-resize items-end justify-end", "rounded-tl-full"],
    ];
    return (
      <div
        key={kind}
        role="group"
        tabIndex={0}
        aria-label={t("curation.geometry.cropLabel", { kind: kindLabel })}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        className={`absolute touch-none border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone}`}
        style={style}
        onPointerDown={(event) => start(event, kind, "move", box)}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={(event) => keyAdjust(event, kind, "move", box)}
      >
        <span className="pointer-events-none absolute left-0 top-0 bg-black/70 px-1 text-[10px] text-white">
          {kindLabel}
        </span>
        {handles.map(([handle, position, markerShape]) => (
          <button
            key={handle}
            type="button"
            aria-label={t("curation.geometry.resizeLabel", { kind: kindLabel, handle })}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            className={`absolute flex size-11 touch-none bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${position}`}
            onPointerDown={(event) => start(event, kind, handle, box)}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            onKeyDown={(event) => keyAdjust(event, kind, handle, box)}
          >
            <span className={`block size-3 border-2 border-white bg-primary ${markerShape}`} />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-md border bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={src}
          alt={t("curation.geometry.sourceAlt")}
          draggable={false}
          onLoad={(event) => onNaturalSize(
            event.currentTarget.naturalWidth,
            event.currentTarget.naturalHeight,
          )}
          className="block h-auto w-full select-none"
        />
        {naturalWidth > 0 && naturalHeight > 0 && (
          <>
            {overlay("card", geometry.card, "border-sky-400")}
            {geometry.price && overlay("price", geometry.price, "border-amber-400")}
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={onReset}>
          {t("curation.geometry.reset")}
        </Button>
        {geometry.price ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => onChange({ ...geometry, price: null })}
          >
            {t("curation.geometry.removePrice")}
          </Button>
        ) : naturalWidth > 0 && naturalHeight > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => onChange({
              ...geometry,
              price: {
                x0: Math.round(naturalWidth * 0.25),
                y0: Math.round(naturalHeight * 0.75),
                x1: Math.round(naturalWidth * 0.75),
                y1: Math.round(naturalHeight * 0.9),
              },
            })}
          >
            {t("curation.geometry.addPrice")}
          </Button>
        ) : null}
        <p className="basis-full text-xs text-muted-foreground">
          {t("curation.geometry.keyboardHint")}
        </p>
      </div>
    </div>
  );
}
