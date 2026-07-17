"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * A thumbnail that opens a full-size lightbox on click. In the lightbox the
 * image can be panned (drag) and zoomed (mouse wheel / the +/- buttons), so a
 * small card scan in a dense table can be inspected up close. Esc or a click on
 * the backdrop closes it.
 */
export function ZoomableImage({
  src,
  alt = "",
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={className}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{ cursor: "zoom-in" }}
      />
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
  const zoomBy = useCallback((factor: number) => {
    setScale((s) => {
      const next = clamp(s * factor);
      if (next === MIN_SCALE) setPos({ x: 0, y: 0 }); // recenter when back to fit
      return next;
    });
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale === 1) return; // nothing to pan when fit-to-screen
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    setPos({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
  };
  const endDrag = () => {
    drag.current = null;
  };

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
      onClick={onClose}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <div className="absolute right-3 top-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          className="rounded bg-white/10 px-2 py-1 text-lg leading-none text-white hover:bg-white/20"
          onClick={() => zoomBy(1 / 1.4)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className="rounded bg-white/10 px-2 py-1 text-lg leading-none text-white hover:bg-white/20"
          onClick={() => zoomBy(1.4)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          className="rounded bg-white/10 px-2 py-1 text-white hover:bg-white/20"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        draggable={false}
        className="max-h-[90vh] max-w-[90vw] select-none rounded shadow-2xl"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: scale > 1 ? (drag.current ? "grabbing" : "grab") : "default",
          transition: drag.current ? "none" : "transform 80ms ease-out",
        }}
      />
    </div>,
    document.body,
  );
}
