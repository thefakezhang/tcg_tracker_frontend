"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { Download, GripVertical, Hash, ImageOff, Layers } from "lucide-react";
import jsPDF from "jspdf";
import { useTranslation } from "@/lib/i18n";
import { useCurrency } from "./CurrencyContext";
import { type CardRowData } from "./use-card-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ExportBuyListModalProps {
  open: boolean;
  onClose: () => void;
  cards: CardRowData[];
  buylistName: string;
}

function SortableCard({ card }: { card: CardRowData }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const misc =
    card.card.misc_info && card.card.misc_info !== "UNKNOWN"
      ? card.card.misc_info
      : null;
  const cardNumber =
    card.card.card_number && card.card.card_number !== "UNKNOWN"
      ? card.card.card_number
      : null;

  return (
    <div ref={setNodeRef} style={style}>
      <Card size="sm" className="h-full gap-0 !py-0 relative">
        <button
          {...attributes}
          {...listeners}
          className="absolute top-1 left-1 z-10 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        {card.card.image_url ? (
          <img
            src={card.card.image_url}
            alt={card.card.regional_name}
            className="aspect-[5/7] w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex aspect-[5/7] w-full items-center justify-center bg-muted">
            <ImageOff className="size-8 text-muted-foreground" />
          </div>
        )}
        <CardHeader className="pt-1">
          <CardAction>
            <div className="flex flex-col items-end gap-1">
              {cardNumber && (
                <Badge variant="secondary" className="h-auto px-1.5 py-px">
                  <Hash className="size-3" />
                  {cardNumber}
                </Badge>
              )}
              <Badge variant="secondary" className="h-auto px-1.5 py-px">
                <Layers className="size-3" />
                {card.card.set_code}
              </Badge>
            </div>
          </CardAction>
          <CardTitle className="truncate text-lg">
            {card.card.regional_name}
          </CardTitle>
          {misc && (
            <CardDescription className="truncate text-xs">
              {misc}
            </CardDescription>
          )}
        </CardHeader>
        <div className="pb-1" />
      </Card>
    </div>
  );
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    // Proxy through our API to avoid CORS issues
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Render text to a canvas image so the browser handles Unicode/CJK fonts
// pdfAspect = width/height of the PDF slot this image will be placed into
function renderTextImage(
  text: string,
  fontSizePx: number,
  color: string,
  pdfAspect: number
): string {
  const scale = 3;
  const height = fontSizePx + 4;
  const width = Math.round(height * pdfAspect);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.font = `600 ${fontSizePx}px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";

  // Shrink font to fit if needed
  let currentSize = fontSizePx;
  const minSize = 6;
  while (ctx.measureText(text).width > width && currentSize > minSize) {
    currentSize -= 0.5;
    ctx.font = `600 ${currentSize}px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  }

  const yOffset = (height - currentSize) / 2;
  ctx.fillText(text, width / 2, yOffset);
  return canvas.toDataURL("image/png");
}

// Dark theme colors (from globals.css .dark)
const BG = { r: 28, g: 28, b: 34 };       // --background oklch(0.141 0.005 285.823)
const CARD_BG = { r: 46, g: 46, b: 54 };   // --card oklch(0.21 0.006 285.885)
const SECONDARY = { r: 60, g: 60, b: 68 }; // --secondary oklch(0.274 0.006 286.033)
const BORDER = { r: 255, g: 255, b: 255, a: 0.1 }; // --border white/10%

interface PdfCard extends CardRowData {
  targetPriceUsd?: number | null;
}

async function generatePdf(
  cards: PdfCard[],
  buylistName: string,
  formatTargetPrice: (usd: number | null | undefined) => string | null
) {
  const COLS = 6;
  const PAGE_W = 210; // A4 portrait width mm
  const PAGE_H = 297; // A4 portrait height mm
  const MARGIN = 8;
  const GAP = 3;
  const CARD_W = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
  const IMG_ASPECT = 5 / 7;
  const IMG_H = CARD_W / IMG_ASPECT;
  const NAME_H = 3.5;
  const META_H = 2.8;
  const PRICE_GAP = 1;
  const PRICE_H = 3.2;
  const TEXT_PAD_TOP = 1.2;
  const TEXT_PAD_BOTTOM = 0.5;
  const TEXT_H = TEXT_PAD_TOP + NAME_H + META_H + PRICE_GAP + PRICE_H + TEXT_PAD_BOTTOM;
  const CARD_H = IMG_H + TEXT_H;
  const CARD_R = 1.2;

  const ROWS_PER_PAGE = Math.floor(
    (PAGE_H - 2 * MARGIN + GAP) / (CARD_H + GAP)
  );

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Pre-load all card images via proxy
  const imagePromises = cards.map((c) =>
    c.card.image_url ? loadImageAsDataUrl(c.card.image_url) : Promise.resolve(null)
  );
  const images = await Promise.all(imagePromises);

  // Pre-render all text labels to canvas images (handles CJK/Unicode)
  const textW = CARD_W - 1.5;
  const nameAspect = textW / NAME_H;
  const metaAspect = textW / META_H;
  const priceAspect = textW / PRICE_H;
  const textImages = cards.map((card) => {
    const cardNumber =
      card.card.card_number && card.card.card_number !== "UNKNOWN"
        ? card.card.card_number
        : null;
    const misc =
      card.card.misc_info && card.card.misc_info !== "UNKNOWN"
        ? card.card.misc_info
        : null;

    const nameImg = renderTextImage(
      card.card.regional_name,
      14,
      "rgb(251,251,251)", // --foreground
      nameAspect
    );

    const metaParts: string[] = [card.card.set_code];
    if (cardNumber) metaParts.push(`#${cardNumber}`);
    if (misc) metaParts.push(misc);
    const metaImg = renderTextImage(
      metaParts.join(" \u00B7 "),
      10,
      "rgb(161,161,176)", // --muted-foreground
      metaAspect
    );

    const priceText = formatTargetPrice((card as PdfCard).targetPriceUsd);
    const priceImg = priceText
      ? renderTextImage(
          priceText,
          12,
          "rgb(251,251,251)", // --foreground
          priceAspect
        )
      : null;

    return { nameImg, metaImg, priceImg };
  });

  const totalPages = Math.ceil(cards.length / (COLS * ROWS_PER_PAGE));

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) pdf.addPage();

    // Page background
    pdf.setFillColor(BG.r, BG.g, BG.b);
    pdf.rect(0, 0, PAGE_W, PAGE_H, "F");

    const startIdx = page * COLS * ROWS_PER_PAGE;
    const endIdx = Math.min(startIdx + COLS * ROWS_PER_PAGE, cards.length);

    for (let i = startIdx; i < endIdx; i++) {
      const posInPage = i - startIdx;
      const col = posInPage % COLS;
      const row = Math.floor(posInPage / COLS);

      const x = MARGIN + col * (CARD_W + GAP);
      const y = MARGIN + row * (CARD_H + GAP);

      // Card background
      pdf.setFillColor(CARD_BG.r, CARD_BG.g, CARD_BG.b);
      pdf.roundedRect(x, y, CARD_W, CARD_H, CARD_R, CARD_R, "F");

      // Card border (subtle white/10%)
      pdf.setDrawColor(
        BG.r + (BORDER.r - BG.r) * BORDER.a,
        BG.g + (BORDER.g - BG.g) * BORDER.a,
        BG.b + (BORDER.b - BG.b) * BORDER.a
      );
      pdf.setLineWidth(0.15);
      pdf.roundedRect(x, y, CARD_W, CARD_H, CARD_R, CARD_R, "S");

      // Draw card image
      const imgData = images[i];
      if (imgData) {
        try {
          pdf.addImage(imgData, "PNG", x, y, CARD_W, IMG_H);
        } catch {
          pdf.setFillColor(SECONDARY.r, SECONDARY.g, SECONDARY.b);
          pdf.rect(x, y, CARD_W, IMG_H, "F");
        }
      } else {
        pdf.setFillColor(SECONDARY.r, SECONDARY.g, SECONDARY.b);
        pdf.rect(x, y, CARD_W, IMG_H, "F");
      }

      // Draw text labels (rendered via canvas for Unicode support)
      const { nameImg, metaImg, priceImg } = textImages[i];
      try {
        pdf.addImage(nameImg, "PNG", x + 0.75, y + IMG_H + TEXT_PAD_TOP, textW, NAME_H);
        pdf.addImage(metaImg, "PNG", x + 0.75, y + IMG_H + TEXT_PAD_TOP + NAME_H, textW, META_H);
        if (priceImg) {
          pdf.addImage(priceImg, "PNG", x + 0.75, y + IMG_H + TEXT_PAD_TOP + NAME_H + META_H + PRICE_GAP, textW, PRICE_H);
        }
      } catch {
        // text rendering fallback — skip
      }
    }
  }

  pdf.save(`${buylistName}.pdf`);
}

export default function ExportBuyListModal({
  open,
  onClose,
  cards,
  buylistName,
}: ExportBuyListModalProps) {
  const { t } = useTranslation();
  const { displayCurrency, convertPrice } = useCurrency();
  const [orderedCards, setOrderedCards] = useState<CardRowData[]>([]);
  const [generating, setGenerating] = useState(false);

  // Sync cards when modal opens
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setOrderedCards([...cards]);
    }
    prevOpen.current = open;
  }, [open, cards]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setOrderedCards((items) => {
          const oldIndex = items.findIndex((i) => i.key === active.id);
          const newIndex = items.findIndex((i) => i.key === over.id);
          return arrayMove(items, oldIndex, newIndex);
        });
      }
    },
    []
  );

  const formatTargetPrice = useCallback(
    (usd: number | null | undefined): string | null => {
      if (usd == null) return null;
      if (displayCurrency !== "none") {
        const converted = convertPrice(usd, "USD");
        return `${converted.symbol}${converted.price}`;
      }
      return `$${usd.toFixed(2)}`;
    },
    [displayCurrency, convertPrice]
  );

  const handleExport = useCallback(async () => {
    setGenerating(true);
    try {
      await generatePdf(orderedCards, buylistName, formatTargetPrice);
    } finally {
      setGenerating(false);
    }
  }, [orderedCards, buylistName, formatTargetPrice]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("buyList.exportTitle")}</DialogTitle>
          <DialogDescription>{t("buyList.exportDescription")}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 -mx-4 px-4 min-h-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToParentElement]}
          >
            <SortableContext
              items={orderedCards.map((c) => c.key)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-6 gap-2">
                {orderedCards.map((card) => (
                  <SortableCard key={card.key} card={card} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("buyList.cancel")}
          </Button>
          <Button onClick={handleExport} disabled={generating}>
            <Download className="size-4 mr-1" />
            {generating ? t("dataTable.loading") : t("buyList.exportConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
