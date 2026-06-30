"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Paste-the-lines create. The old workflow was "fill the PriceCharting ID into a
// saved_insertions line and move it over"; here the curator pastes those same
// lines and the products are created immediately (no seeder run). Each line is
// the 8-field saved format: NAME|SET|VARIANT|TYPE|LANG|MISC|KIND|PRICECHARTING_ID.

interface ParsedRow {
  name: string;
  set_code: string;
  variant_edition: string;
  product_type: string;
  language: string;
  misc_info: string;
  pcid: string;
}

function parseLines(text: string): { rows: ParsedRow[]; bad: number } {
  let bad = 0;
  const rows: ParsedRow[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const f = line.split("|").map((s) => s.trim());
    if (f.length < 7 || !f[0]) {
      bad++;
      continue;
    }
    rows.push({
      name: f[0],
      set_code: f[1] || "UNKNOWN",
      variant_edition: f[2] || "standard",
      product_type: f[3] || "other",
      language: f[4] || "jp",
      misc_info: f[5] || "UNKNOWN",
      pcid: f[7] || "", // f[6] is sealed_kind (not part of identity)
    });
  }
  return { rows, bad };
}

export default function CardIndexCreateModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; failed: number } | null>(null);

  const { rows, bad } = parseLines(text);

  const createAll = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    const supabase = createClient();
    let created = 0;
    let failed = 0;
    const errs: string[] = [];
    for (const r of rows) {
      const { error: rpcError } = await supabase.rpc("card_index_create_sealed_product", {
        p_name: r.name,
        p_english_name: "",
        p_set_code: r.set_code,
        p_product_type: r.product_type,
        p_language: r.language,
        p_misc_info: r.misc_info,
        p_variant_edition: r.variant_edition,
        p_sealed_condition: "standard",
        p_platform: r.pcid ? "pricecharting" : null,
        p_external_id: r.pcid || null,
      });
      if (rpcError) {
        failed++;
        if (errs.length < 3) errs.push(`${r.name}: ${rpcError.message}`);
      } else {
        created++;
      }
    }
    setBusy(false);
    setDone({ created, failed });
    if (errs.length) setError(errs.join(" · "));
    onCreated();
    if (failed === 0) setText("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setText("");
          setError(null);
          setDone(null);
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("cardIndex.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t("cardIndex.pasteLabel")}</Label>
          <textarea
            className="h-40 w-full resize-y rounded-md border bg-transparent p-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={"NAME|SET|VARIANT|TYPE|LANG|MISC|KIND|PRICECHARTING_ID"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDone(null);
            }}
          />
          <p className="text-xs text-muted-foreground">{t("cardIndex.pasteHint")}</p>
          <p className="text-sm">
            {t("cardIndex.parsedCount").replace("{n}", String(rows.length))}
            {bad > 0 && (
              <span className="text-amber-600">
                {" · "}
                {t("cardIndex.parsedBad").replace("{n}", String(bad))}
              </span>
            )}
          </p>
          {done && (
            <p className="text-sm">
              {t("cardIndex.createdSummary")
                .replace("{created}", String(done.created))
                .replace("{failed}", String(done.failed))}
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={createAll} disabled={busy || rows.length === 0}>
            {busy
              ? t("common.saving")
              : t("cardIndex.createN").replace("{n}", String(rows.length))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
