"use client";

import { useEffect, useState } from "react";
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

// The identity attributes a curator can edit. Constrained fields are dropdowns so
// the value always satisfies the DB CHECK / enum.
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

export interface EditableProduct {
  product_id: number;
  name: string;
  english_name: string | null;
  set_code: string;
  product_type: string;
  language: string;
  misc_info: string;
  variant_edition: string;
  sealed_condition: string;
}

const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

export default function CardIndexEditModal({
  product,
  open,
  onOpenChange,
  onSaved,
}: {
  product: EditableProduct | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<EditableProduct | null>(product);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(product);
    setError(null);
  }, [product]);

  if (!form) return null;
  const set = (k: keyof EditableProduct, v: string) => setForm({ ...form, [k]: v });

  const save = async () => {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("card_index_edit_sealed_product", {
      p_product_id: form.product_id,
      p_name: form.name,
      p_english_name: form.english_name ?? "",
      p_set_code: form.set_code,
      p_product_type: form.product_type,
      p_language: form.language,
      p_misc_info: form.misc_info,
      p_variant_edition: form.variant_edition,
      p_sealed_condition: form.sealed_condition,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("cardIndex.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>{t("cardIndex.fName")}</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>{t("cardIndex.fEnglish")}</Label>
            <Input
              value={form.english_name ?? ""}
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
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
