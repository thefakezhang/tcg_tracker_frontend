"use client";

import { Label } from "@/components/ui/label";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { JapanExclusivityMode } from "./japan-exclusivity";

export type JapanExclusivityCriterionMode = Exclude<JapanExclusivityMode, "all">;

export const JAPAN_EXCLUSIVITY_LABELS: Record<JapanExclusivityCriterionMode, TranslationKey> = {
  artwork: "customers.japanExclusivity.artwork",
  stamps: "customers.japanExclusivity.stamps",
  either: "customers.japanExclusivity.either",
  both: "customers.japanExclusivity.both",
  legacy: "customers.japanExclusivity.legacy",
};

export function JapanExclusivityCriterionField({
  value,
  onValueChange,
  id = "customer-japan-exclusivity-mode",
}: {
  value: "" | JapanExclusivityCriterionMode;
  onValueChange: (value: "" | JapanExclusivityCriterionMode) => void;
  id?: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <Label className="mb-1 block text-xs" htmlFor={id}>
        {t("customers.japanExclusivity.label")}
      </Label>
      <select
        id={id}
        className="h-11 w-full rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring sm:h-9"
        value={value}
        onChange={(event) => onValueChange(event.target.value as "" | JapanExclusivityCriterionMode)}
      >
        <option value="">{t("customers.japanExclusivity.any")}</option>
        {(Object.keys(JAPAN_EXCLUSIVITY_LABELS) as JapanExclusivityCriterionMode[]).map((mode) => (
          <option key={mode} value={mode}>{t(JAPAN_EXCLUSIVITY_LABELS[mode])}</option>
        ))}
      </select>
      <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {t("customers.japanExclusivity.hint")}
      </p>
    </div>
  );
}
