"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";
import type { CardDefinition } from "./use-card-data";

// An MTG catalog card is one (language, finish) variant of a printing, and
// every variant is its own row with its own prices and its own ROI. An English
// and a Japanese copy of the same printing are therefore two rows that share a
// name, set and number, and nothing else on the row told them apart: the
// Language and Foil Type columns hide below xl and lg, and the grid tile and
// the detail header never showed either. These badges put both facts next to
// the name wherever an MTG card is identified.
//
// Language is always shown. Finish is shown only for foils - nonfoil is the
// default reading, matching the Card Index convention.
export function MtgPrintingBadges({
  card,
  className = "",
}: {
  card: Pick<CardDefinition, "language" | "is_foil" | "foil_type">;
  className?: string;
}) {
  const { t } = useTranslation();
  const language = card.language?.trim().toLowerCase();
  const languageLabel = mtgLanguageLabel(language, t);
  const foil = card.is_foil === true;
  const foilType = card.foil_type?.trim();
  const foilLabel = foilType && foilType !== "STANDARD" ? foilType : t("foil.foil");
  if (!languageLabel && !foil) return null;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
      {languageLabel && (
        <Badge
          variant="secondary"
          className="h-auto px-1.5 py-px font-mono"
          title={languageLabel.name}
          aria-label={languageLabel.name}
          data-testid="mtg-language-badge"
        >
          {languageLabel.code}
        </Badge>
      )}
      {foil && (
        // Capped: on a grid tile these share a row with a truncating title, and
        // a treatment name such as ダブルレインボウ would otherwise squeeze it.
        <Badge
          variant="outline"
          className="h-auto max-w-24 border-amber-500/50 px-1.5 py-px text-amber-600"
          title={foilLabel}
          data-testid="mtg-foil-badge"
        >
          <span className="truncate">{foilLabel}</span>
        </Badge>
      )}
    </span>
  );
}

type TranslateFn = ReturnType<typeof useTranslation>["t"];

// Catalog languages are stored as "en" and "jp". "jp" is the catalog's code,
// not the UI locale "ja", so the two are deliberately not conflated here.
export function mtgLanguageLabel(
  language: string | null | undefined,
  t: TranslateFn,
): { code: string; name: string } | null {
  switch (language) {
    case "en":
      return { code: "EN", name: t("cardLanguage.en") };
    case "jp":
      return { code: "JP", name: t("cardLanguage.jp") };
    case undefined:
    case null:
    case "":
      return null;
    default:
      return { code: language.toUpperCase(), name: language };
  }
}
