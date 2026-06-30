"use client";

import { useEffect, useState } from "react";
import { Trash2, Plus, GitMerge } from "lucide-react";
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
const PLATFORMS = ["pricecharting", "tcgplayer", "snkrdunk", "collectr"];

export interface ProductLink {
  platform_name: string;
  external_reference_id: string;
}

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
  links: ProductLink[];
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
  const [links, setLinks] = useState<ProductLink[]>(product?.links ?? []);
  const [newPlatform, setNewPlatform] = useState("pricecharting");
  const [newId, setNewId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeResults, setMergeResults] = useState<{ product_id: number; name: string; set_code: string }[]>([]);
  const [mergeTarget, setMergeTarget] = useState<{ product_id: number; name: string } | null>(null);

  useEffect(() => {
    setForm(product);
    setLinks(product?.links ?? []);
    setNewId("");
    setError(null);
    setMergeSearch("");
    setMergeResults([]);
    setMergeTarget(null);
  }, [product]);

  // Debounced target search for merge (excludes the current product).
  useEffect(() => {
    const q = mergeSearch.trim();
    if (!q || !product || mergeTarget) {
      setMergeResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("pokemon_sealed_products")
        .select("product_id, name, set_code")
        .ilike("name", `%${q.replace(/[%,]/g, " ")}%`)
        .neq("product_id", product.product_id)
        .limit(6);
      setMergeResults((data as { product_id: number; name: string; set_code: string }[]) ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [mergeSearch, product, mergeTarget]);

  if (!form) return null;
  const set = (k: keyof EditableProduct, v: string) => setForm({ ...form, [k]: v });

  const saveIdentity = async () => {
    setBusy(true);
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
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSaved();
    onOpenChange(false);
  };

  const addLink = async () => {
    const id = newId.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("card_index_attach_sealed_link", {
      p_product_id: form.product_id,
      p_platform: newPlatform,
      p_external_id: id,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setLinks((prev) => [
      ...prev.filter((l) => l.platform_name !== newPlatform),
      { platform_name: newPlatform, external_reference_id: id },
    ]);
    setNewId("");
    onSaved();
  };

  const removeLink = async (platform: string) => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("card_index_remove_sealed_link", {
      p_product_id: form.product_id,
      p_platform: platform,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setLinks((prev) => prev.filter((l) => l.platform_name !== platform));
    onSaved();
  };

  const doMerge = async () => {
    if (!mergeTarget) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("card_index_merge_sealed_products", {
      p_from_id: form.product_id,
      p_into_id: mergeTarget.product_id,
    });
    setBusy(false);
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

        {/* Platform links - applied immediately (move-the-link). */}
        <div className="space-y-2 border-t pt-3">
          <Label>{t("cardIndex.fLinks")}</Label>
          <div className="space-y-1">
            {links.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("cardIndex.noLinks")}</p>
            )}
            {links
              .slice()
              .sort((a, b) => a.platform_name.localeCompare(b.platform_name))
              .map((l) => (
                <div key={l.platform_name} className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0 text-muted-foreground">{l.platform_name}</span>
                  <span className="flex-1 font-mono text-xs">{l.external_reference_id}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={busy}
                    onClick={() => removeLink(l.platform_name)}
                    title={t("cardIndex.removeLink")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              className={`${selectClass} w-28`}
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value)}
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
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
            />
            <Button variant="outline" size="sm" disabled={busy || !newId.trim()} onClick={addLink}>
              <Plus className="size-3.5" /> {t("cardIndex.addLink")}
            </Button>
          </div>
        </div>

        {/* Merge into another product - destructive (deletes this product). */}
        <div className="space-y-2 border-t pt-3">
          <Label className="flex items-center gap-1.5">
            <GitMerge className="size-3.5" /> {t("cardIndex.mergeTitle")}
          </Label>
          {mergeTarget ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">
                {t("cardIndex.mergeInto")}:{" "}
                <span className="font-medium">{mergeTarget.name}</span>
              </span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMergeTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={doMerge}>
                {t("cardIndex.mergeConfirm")}
              </Button>
            </div>
          ) : (
            <>
              <Input
                placeholder={t("cardIndex.mergeSearch")}
                value={mergeSearch}
                onChange={(e) => setMergeSearch(e.target.value)}
              />
              {mergeResults.length > 0 && (
                <div className="rounded-md border">
                  {mergeResults.map((r) => (
                    <button
                      key={r.product_id}
                      type="button"
                      className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => setMergeTarget({ product_id: r.product_id, name: r.name })}
                    >
                      <span className="truncate">{r.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {r.set_code}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t("cardIndex.mergeHint")}</p>
            </>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={saveIdentity} disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
