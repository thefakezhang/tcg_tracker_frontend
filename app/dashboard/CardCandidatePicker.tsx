"use client";

// Given an image and a ranked list of card candidates, let a person compare
// visually, search for an alternative, and choose one.
//
// That sentence is the whole contract. This component takes its data as props
// and returns a chosen card; it knows nothing about scanner batches, inventory,
// buylists or price observations, and it must stay that way. If it ever needs
// to know which pipeline it is serving - an `isScanBatch` branch or equivalent -
// it was shared too deeply and should be split rather than parameterised.
//
// Two callers are anticipated: the scanner review screen and, later, the
// image-buylist curation override picker. See docs/scanner_review_screen.md
// in the backend repo, "What is shared".

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff, Loader2, Search } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useDebouncedValue } from "./use-card-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PickerCandidate {
  cardUid: string;
  name: string;
  /** Caller-formatted subtitle, e.g. "SV4a 205/190 · Reverse Holo". */
  meta: string;
  imageUrl: string | null;
  rarity: string | null;
  /** Recognizer score, or null when this candidate came from a search. */
  score: number | null;
  /** Gap to the next-strongest candidate. Only meaningful on the shortlist head. */
  marginToNext: number | null;
  price: number | null;
  currency: string | null;
}

export interface PickerImage {
  url: string | null;
  label: string;
}

export interface CardCandidatePickerProps {
  /** The images being identified, in display order. First is shown by default. */
  images: PickerImage[];
  candidates: PickerCandidate[];
  selectedCardUid: string | null;
  onSelect: (cardUid: string) => void;
  /** Must be able to reach any card, not just the shortlist. Without this a
   *  capture whose recognizer returned nothing is a dead end. */
  onSearch: (term: string) => Promise<PickerCandidate[]>;
  disabled?: boolean;
}

function formatPrice(price: number | null, currency: string | null): string | null {
  if (price == null) return null;
  const symbol = currency === "JPY" ? "¥" : currency === "USD" ? "$" : "";
  const rounded = currency === "JPY" ? Math.round(price) : Math.round(price * 100) / 100;
  return `${symbol}${rounded.toLocaleString()}${symbol ? "" : ` ${currency ?? ""}`}`.trim();
}

export function CardCandidatePicker(props: CardCandidatePickerProps) {
  const { t } = useTranslation();
  const { images, candidates, selectedCardUid, onSelect, onSearch, disabled } = props;

  const [activeImage, setActiveImage] = useState(0);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PickerCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounced = useDebouncedValue(term, 300);
  const requestSeq = useRef(0);

  useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const seq = ++requestSeq.current;
    setSearching(true);
    onSearch(trimmed)
      .then((found) => {
        // Drop a stale response: a slower earlier query must never overwrite a
        // newer one, or the operator picks from results for a term they have
        // already replaced.
        if (seq === requestSeq.current) setResults(found);
      })
      .catch(() => {
        if (seq === requestSeq.current) setResults([]);
      })
      .finally(() => {
        if (seq === requestSeq.current) setSearching(false);
      });
  }, [debounced, onSearch]);

  const shown = results ?? candidates;
  const isSearchResults = results != null;
  const current = images[activeImage] ?? images[0] ?? null;

  const choose = useCallback(
    (cardUid: string) => {
      if (!disabled) onSelect(cardUid);
    },
    [disabled, onSelect],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
          {current?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.url}
              alt={current.label}
              className="h-full w-full object-contain"
            />
          ) : (
            // An absent image is stated, never implied. A list that renders
            // normally beside a missing scan looks decidable when it is not.
            <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <ImageOff className="size-8" aria-hidden />
              <span>{t("scanReview.imageUnavailable")}</span>
            </div>
          )}
        </div>
        {images.length > 1 && (
          <div className="flex gap-1">
            {images.map((image, index) => (
              <Button
                key={image.label}
                size="sm"
                variant={index === activeImage ? "secondary" : "ghost"}
                className="flex-1"
                onClick={() => setActiveImage(index)}
              >
                {image.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("scanReview.searchPlaceholder")}
            className="pl-8"
            aria-label={t("scanReview.searchPlaceholder")}
          />
          {searching && (
            <Loader2 className="absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {isSearchResults
            ? t("scanReview.searchResultsCount", { count: String(shown.length) })
            : t("scanReview.shortlistCount", { count: String(shown.length) })}
        </p>

        {shown.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {isSearchResults ? t("scanReview.searchNoResults") : t("scanReview.shortlistEmpty")}
          </p>
        ) : (
          <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
            {shown.map((candidate, index) => {
              const selected = candidate.cardUid === selectedCardUid;
              const price = formatPrice(candidate.price, candidate.currency);
              return (
                <li key={candidate.cardUid}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => choose(candidate.cardUid)}
                    aria-pressed={selected}
                    className={`flex w-full items-start gap-3 rounded-lg border p-2 text-left transition-colors disabled:opacity-50 ${
                      selected
                        ? "border-primary bg-primary/10"
                        : "hover:border-muted-foreground/40 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex h-24 w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/30">
                      {candidate.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={candidate.imageUrl} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <ImageOff className="size-5 text-muted-foreground" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium">{candidate.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{candidate.meta}</p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {candidate.rarity && (
                          <Badge variant="outline" className="text-[10px]">{candidate.rarity}</Badge>
                        )}
                        {candidate.score != null && (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {Math.round(candidate.score * 100)}
                          </Badge>
                        )}
                        {/* The margin belongs to the shortlist head: it is how
                            unsure the machine was, and why it stopped there. */}
                        {index === 0 && candidate.marginToNext != null && !isSearchResults && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {t("scanReview.marginShort", {
                              margin: candidate.marginToNext.toFixed(2),
                            })}
                          </Badge>
                        )}
                        {price && (
                          <span className="text-xs font-medium tabular-nums text-muted-foreground">
                            {price}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CardCandidatePicker;
