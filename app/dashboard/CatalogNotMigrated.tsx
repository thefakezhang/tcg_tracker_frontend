"use client";

import { Layers } from "lucide-react";
import { useTranslation, type TranslationKey } from "@/lib/i18n";

// Shown for the Index / Match review when the active game's catalog has not yet
// been through the owned-identity refactor (only pokemon_sealed has, so far).
export default function CatalogNotMigrated({ game }: { game: string }) {
  const { t } = useTranslation();
  const gameName = t(`game.${game}` as TranslationKey);
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
      <Layers className="size-8" />
      <p className="max-w-md text-sm">{t("catalog.notMigrated").replace("{game}", gameName)}</p>
    </div>
  );
}
