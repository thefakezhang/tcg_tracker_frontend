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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRODUCT_TYPES = [
  "booster_box",
  "booster_bundle",
  "booster_pack",
  "elite_trainer_box",
  "premium_collection",
  "build_battle_box",
  "special_collection",
  "tin",
  "pokecenter_exclusive",
  "vintage_box",
  "other",
];
const EDITIONS = ["standard", "1ed", "unlimited"];
const CONDITIONS = ["standard", "shrink", "no_shrink"];
const PLATFORMS = ["pricecharting", "tcgplayer", "snkrdunk", "collectr"];
const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

const BLANK = {
  name: "",
  english_name: "",
  set_code: "",
  product_type: "booster_box",
  language: "jp",
  misc_info: "",
  variant_edition: "standard",
  sealed_condition: "standard",
  image_url: "",
};

// Bulk paste: the 8-field saved format NAME|SET|VARIANT|TYPE|LANG|MISC|KIND|PC_ID.
interface ParsedRow {
  name: string;
  set_code: string;
  variant_edition: string;
  product_type: string;
  language: string;
  misc_info: string;
  pcid: string;
}
function parseLine(line: string): ParsedRow | null {
  const f = line.split("|").map((s) => s.trim());
  if (f.length < 7 || !f[0]) return null;
  return {
    name: f[0],
    set_code: f[1] || "UNKNOWN",
    variant_edition: f[2] || "standard",
    product_type: f[3] || "other",
    language: f[4] || "jp",
    misc_info: f[5] || "UNKNOWN",
    pcid: f[7] || "",
  };
}
function parseLines(text: string): { rows: ParsedRow[]; bad: number } {
  let bad = 0;
  const rows: ParsedRow[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const r = parseLine(line);
    if (r) rows.push(r);
    else bad++;
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
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; failed: number } | null>(null);

  // Single-product form.
  const [form, setForm] = useState({ ...BLANK });
  const [anchorPlatform, setAnchorPlatform] = useState("pricecharting");
  const [anchorId, setAnchorId] = useState("");
  const [prefill, setPrefill] = useState("");
  const set = (k: keyof typeof BLANK, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // Bulk paste.
  const [bulk, setBulk] = useState("");
  const { rows, bad } = parseLines(bulk);

  const reset = () => {
    setForm({ ...BLANK });
    setAnchorPlatform("pricecharting");
    setAnchorId("");
    setPrefill("");
    setBulk("");
    setError(null);
    setDone(null);
  };

  const doPrefill = () => {
    const r = parseLine(prefill.trim());
    if (!r) {
      setError(t("cardIndex.prefillBad"));
      return;
    }
    setError(null);
    setForm({
      ...BLANK,
      name: r.name,
      set_code: r.set_code,
      variant_edition: r.variant_edition,
      product_type: r.product_type,
      language: r.language,
      misc_info: r.misc_info,
    });
    if (r.pcid) {
      setAnchorPlatform("pricecharting");
      setAnchorId(r.pcid);
    }
  };

  const createSingle = async () => {
    if (!form.name.trim()) {
      setError(t("cardIndex.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("card_index_create_sealed_product", {
      p_name: form.name,
      p_english_name: form.english_name,
      p_set_code: form.set_code,
      p_product_type: form.product_type,
      p_language: form.language,
      p_misc_info: form.misc_info,
      p_variant_edition: form.variant_edition,
      p_sealed_condition: form.sealed_condition,
      p_image_url: form.image_url,
      p_platform: anchorId.trim() ? anchorPlatform : null,
      p_external_id: anchorId.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onCreated();
    onOpenChange(false);
  };

  const createBulk = async () => {
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
        p_image_url: "",
        p_platform: r.pcid ? "pricecharting" : null,
        p_external_id: r.pcid || null,
      });
      if (rpcError) {
        failed++;
        if (errs.length < 3) errs.push(`${r.name}: ${rpcError.message}`);
      } else created++;
    }
    setBusy(false);
    setDone({ created, failed });
    if (errs.length) setError(errs.join(" · "));
    onCreated();
    if (failed === 0) setBulk("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("cardIndex.createTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1">
          <Button
            variant={mode === "single" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("single")}
          >
            {t("cardIndex.modeSingle")}
          </Button>
          <Button
            variant={mode === "bulk" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("bulk")}
          >
            {t("cardIndex.modeBulk")}
          </Button>
        </div>

        {mode === "single" ? (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label>{t("cardIndex.prefillLabel")}</Label>
                <Input
                  className="font-mono text-xs"
                  placeholder="NAME|SET|VARIANT|TYPE|LANG|MISC|KIND|PC_ID"
                  value={prefill}
                  onChange={(e) => setPrefill(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={doPrefill} disabled={!prefill.trim()}>
                {t("cardIndex.prefill")}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>{t("cardIndex.fName")}</Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>{t("cardIndex.fEnglish")}</Label>
                <Input
                  value={form.english_name}
                  onChange={(e) => set("english_name", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("cardIndex.fSet")}</Label>
                <Input value={form.set_code} onChange={(e) => set("set_code", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("cardIndex.fLanguage")}</Label>
                <Input value={form.language} onChange={(e) => set("language", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("cardIndex.fType")}</Label>
                <select
                  className={selectClass}
                  value={form.product_type}
                  onChange={(e) => set("product_type", e.target.value)}
                >
                  {PRODUCT_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t("cardIndex.fEdition")}</Label>
                <select
                  className={selectClass}
                  value={form.variant_edition}
                  onChange={(e) => set("variant_edition", e.target.value)}
                >
                  {EDITIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t("cardIndex.fCondition")}</Label>
                <select
                  className={selectClass}
                  value={form.sealed_condition}
                  onChange={(e) => set("sealed_condition", e.target.value)}
                >
                  {CONDITIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t("cardIndex.fMisc")}</Label>
                <Input value={form.misc_info} onChange={(e) => set("misc_info", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>{t("cardIndex.fImage")}</Label>
                <Input
                  value={form.image_url}
                  onChange={(e) => set("image_url", e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>

            <div className="space-y-1 border-t pt-3">
              <Label>{t("cardIndex.anchorLink")}</Label>
              <div className="flex items-center gap-2">
                <select
                  className={`${selectClass} w-28`}
                  value={anchorPlatform}
                  onChange={(e) => setAnchorPlatform(e.target.value)}
                >
                  {PLATFORMS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <Input
                  className="flex-1"
                  placeholder={t("cardIndex.linkIdPlaceholder")}
                  value={anchorId}
                  onChange={(e) => setAnchorId(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("cardIndex.anchorHint")}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>{t("cardIndex.pasteLabel")}</Label>
            <textarea
              className="h-40 w-full resize-y rounded-md border bg-transparent p-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={"NAME|SET|VARIANT|TYPE|LANG|MISC|KIND|PRICECHARTING_ID"}
              value={bulk}
              onChange={(e) => {
                setBulk(e.target.value);
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
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          {mode === "single" ? (
            <Button onClick={createSingle} disabled={busy || !form.name.trim()}>
              {busy ? t("common.saving") : t("cardIndex.create")}
            </Button>
          ) : (
            <Button onClick={createBulk} disabled={busy || rows.length === 0}>
              {busy ? t("common.saving") : t("cardIndex.createN").replace("{n}", String(rows.length))}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
