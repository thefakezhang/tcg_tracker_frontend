"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ImageBox } from "@/lib/image-curation-geometry";

// A thumbnail that shows the cropped region of `src` defined by `bbox`,
// scaled to fit a `w` x `h` box. Uses CSS only - no JS image measurement
// and no extra HTTP requests - so it renders the moment the source image
// loads. `object-fit: none` plus a negative `object-position` shows the
// crop region at 1:1 image pixels, then transform:scale shrinks it down
// (or up) so it fills the display rectangle while preserving aspect.
export function CropPreview({ src, bbox, w, h, onClick }: {
  src: string; bbox: ImageBox; w: number; h: number; onClick?: () => void;
}) {
  const cw = Math.max(1, bbox.x1 - bbox.x0);
  const ch = Math.max(1, bbox.y1 - bbox.y0);
  const scale = Math.min(w / cw, h / ch);
  return (
    <div
      onClick={onClick}
      className={`overflow-hidden rounded bg-muted ${onClick ? "cursor-zoom-in" : ""}`}
      style={{ width: `${w}px`, height: `${h}px` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt="" loading="lazy" draggable={false}
        style={{
          width: `${cw}px`, height: `${ch}px`,
          objectFit: "none",
          objectPosition: `-${bbox.x0}px -${bbox.y0}px`,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          maxWidth: "none", maxHeight: "none",
        }}
      />
    </div>
  );
}

// Fullscreen image inspector with proper pan + zoom. Wheel zooms around the
// cursor; click-and-drag pans; double-click resets. Click the dark backdrop
// or the ✕ to close. Replaces an older fit-vs-200% toggle that could only
// zoom in, never let the curator pan around to look at the rest of the
// sheet.
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; t0: { x: number; y: number } } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Esc closes; arrow keys nudge the pan (handy on trackpads). Also lock
  // background page scroll so wheel events on the lightbox never bleed
  // through to the underlying page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const step = 80 / scale;
      if (e.key === "ArrowLeft") setTranslate((t) => ({ x: t.x + step, y: t.y }));
      else if (e.key === "ArrowRight") setTranslate((t) => ({ x: t.x - step, y: t.y }));
      else if (e.key === "ArrowUp") setTranslate((t) => ({ x: t.x, y: t.y + step }));
      else if (e.key === "ArrowDown") setTranslate((t) => ({ x: t.x, y: t.y - step }));
    };
    window.addEventListener("keydown", onKey);
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // React attaches wheel listeners as passive, so onWheel's preventDefault
    // is a no-op. Attach a native non-passive listener on the container so
    // wheel scrolling anywhere inside the lightbox never scrolls the page
    // behind it.
    const el = containerRef.current;
    const nativeWheel = (e: WheelEvent) => e.preventDefault();
    el?.addEventListener("wheel", nativeWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevBodyOverflow;
      el?.removeEventListener("wheel", nativeWheel);
    };
  }, [onClose, scale]);

  const onWheel = (e: React.WheelEvent) => {
    // Zoom around the cursor position so the point under the mouse stays
    // visually anchored - the standard "zoom to cursor" UX. Without this,
    // every wheel tick rubber-bands the focal point back to the center.
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.min(12, Math.max(0.2, scale * factor));
    const ratio = next / scale;
    setTranslate((t) => ({
      x: cx - (cx - t.x) * ratio,
      y: cy - (cy - t.y) * ratio,
    }));
    setScale(next);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, t0: translate };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTranslate({ x: dragRef.current.t0.x + dx, y: dragRef.current.t0.y + dy });
  };
  const stopDrag = () => { dragRef.current = null; };
  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  // Click anywhere in the lightbox EXCEPT on the image itself closes. The
  // image gets stopPropagation on its own click handler so dragging + panning
  // never accidentally closes.
  const onBackdropClick = (e: React.MouseEvent) => {
    if (imgRef.current && e.target instanceof Node && imgRef.current.contains(e.target)) return;
    onClose();
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 overflow-hidden bg-black/85"
      onClick={onBackdropClick}
      onWheel={onWheel}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src} alt="" draggable={false}
          style={{
            maxHeight: "92vh", maxWidth: "92vw",
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: "center",
            transition: dragRef.current ? "none" : "transform 80ms ease-out",
            userSelect: "none",
          }}
        />
      </div>
      <button onClick={onClose} aria-label="Close"
        className="fixed right-3 top-3 rounded-full bg-white/15 p-2 text-white hover:bg-white/25">
        <X className="size-5" />
      </button>
      <div className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-[11px] text-white">
        Wheel: zoom · Drag: pan · Double-click: reset · Esc / click outside: close
      </div>
    </div>
  );
}
