"use client";

import { useId, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n";

export default function FullyLoadedCostLabel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const label = t("trips.loadedCost");
  const hint = t("trips.loadedCostHint");

  return (
    <Tooltip
      onOpenChange={(nextOpen) => setOpen(nextOpen)}
      open={open}
      triggerId={triggerId}
    >
      <TooltipTrigger
        closeOnClick={false}
        id={triggerId}
        render={
          <button
            aria-label={`${label}. ${hint}`}
            className="inline-flex cursor-help items-center underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpen(true)}
            type="button"
          />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipContent role="tooltip">{hint}</TooltipContent>
    </Tooltip>
  );
}
