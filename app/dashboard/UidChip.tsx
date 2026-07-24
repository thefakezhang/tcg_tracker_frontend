"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

// The Card Index display convention for the durable identity: the 8-hex uid
// prefix in muted mono. One click copies the FULL uid, and clicks never bubble
// because every host row/tile opens a modal on click.
export function UidChip({
  uid,
  className = "",
}: {
  uid?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!uid) return null;
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground ${className}`}
      title={copied ? t("uid.copied") : t("uid.copy")}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(uid).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {uid.slice(0, 8)}
      {copied
        ? <Check className="size-3 text-emerald-500" />
        : <Copy className="size-3 opacity-60" />}
    </button>
  );
}
