"use client";

import { useTranslation } from "@/lib/i18n";

export default function ViewLoading() {
  const { t } = useTranslation();
  return <p role="status" className="p-4 text-sm text-muted-foreground">{t("common.loading")}</p>;
}
