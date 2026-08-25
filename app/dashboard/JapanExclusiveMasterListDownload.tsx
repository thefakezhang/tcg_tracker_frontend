"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

export const JAPAN_EXCLUSIVE_MASTER_LIST_PATH = "/pokemon-japan-exclusives-master-list.csv";

export function JapanExclusiveMasterListDownload() {
  const { t } = useTranslation();
  return (
    <Button
      nativeButton={false}
      variant="outline"
      className="h-11 max-w-full shrink-0 sm:h-8"
      title={t("cardBrowser.jpExclusiveMasterDownloadHint")}
      render={(
        <a
          href={JAPAN_EXCLUSIVE_MASTER_LIST_PATH}
          download="pokemon-japan-exclusives-master-list.csv"
          aria-label={t("cardBrowser.jpExclusiveMasterDownload")}
          data-testid="japan-exclusive-master-list-download"
        />
      )}
    >
      <Download className="size-4" />
      <span className="truncate">{t("cardBrowser.jpExclusiveMasterDownload")}</span>
    </Button>
  );
}
