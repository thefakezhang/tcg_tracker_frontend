"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

export const JAPAN_EXCLUSIVE_MASTER_LIST_PATH = "/pokemon-japan-exclusives-master-list.csv";

export function JapanExclusiveMasterListDownload() {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 max-w-72 flex-col gap-1">
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
      <p
        className="break-words text-[10px] leading-tight text-muted-foreground"
        data-testid="japan-exclusive-corpus-scope"
      >
        {t("cardBrowser.jpExclusiveCorpusScope")}
      </p>
    </div>
  );
}
