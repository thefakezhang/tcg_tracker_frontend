"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/dates";
import { formatUsd } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useLanguage } from "./LanguageContext";
import { conditionLabel, editionLabel } from "./use-sealed-data";

type FulfillmentLeg = "import" | "export";
type MarketRegion = "NA" | "JP";

export interface SealedListingHolding {
  game: "pokemon_sealed";
  item_type: "sealed";
  leg: FulfillmentLeg;
  product_id: number;
  name: string;
  set_code: string;
  sealed_condition: string;
  variant_edition: string;
  qty_on_hand: number;
}

export interface ListingPlatform {
  platform: string;
  market_region: MarketRegion;
  fulfillment_leg: FulfillmentLeg;
  is_active: boolean;
}

export interface SealedListingExposure {
  listing_id: number;
  platform: string;
  external_listing_id: string | null;
  status: "draft" | "active";
  leg: FulfillmentLeg;
  game: "pokemon_sealed";
  product_id: number;
  item_name: string | null;
  set_code: string | null;
  sealed_condition: string;
  variant_edition: string;
  quantity_listed: number;
  qty_on_hand: number;
  over_promised: number;
  last_pushed_quantity: number | null;
  desired_quantity: number;
  needs_push: boolean;
  can_push: boolean;
  ask_price_usd: number | null;
  listed_at: string;
  market_region: MarketRegion;
}

export interface SealedListingData {
  holdings: SealedListingHolding[];
  platforms: ListingPlatform[];
  listings: SealedListingExposure[];
}

type SupabaseClient = ReturnType<typeof createClient>;

export async function fetchSealedListingData(
  client: SupabaseClient = createClient(),
): Promise<SealedListingData> {
  const [holdings, platforms, listings] = await Promise.all([
    selectAll<SealedListingHolding>(
      () => client
        .from("inventory_holdings_v")
        .select("game, item_type, leg, product_id, name, set_code, sealed_condition, variant_edition, qty_on_hand")
        .eq("game", "pokemon_sealed")
        .eq("item_type", "sealed"),
      ["product_id", "leg", "sealed_condition", "variant_edition"],
    ),
    selectAll<ListingPlatform>(
      () => client
        .from("inventory_listing_platforms")
        .select("platform, market_region, fulfillment_leg, is_active")
        .eq("is_active", true),
      ["platform"],
    ),
    selectAll<SealedListingExposure>(
      () => client
        .from("inventory_listing_exposure_v")
        .select("listing_id, platform, external_listing_id, status, leg, game, product_id, item_name, set_code, sealed_condition, variant_edition, quantity_listed, qty_on_hand, over_promised, last_pushed_quantity, desired_quantity, needs_push, can_push, ask_price_usd, listed_at, market_region")
        .eq("game", "pokemon_sealed"),
      ["listing_id"],
    ),
  ]);
  return { holdings, platforms, listings };
}

export interface SealedListingInsert {
  platform: string;
  external_listing_id: string | null;
  game: "pokemon_sealed";
  item_type: "sealed";
  card_id: null;
  product_id: number;
  condition_id: null;
  psa_grade: 0;
  sealed_condition: string;
  variant_edition: string;
  leg: FulfillmentLeg;
  quantity_listed: number;
  ask_price_usd: number | null;
  status: "draft" | "active";
}

export function buildSealedListingInsert(
  holding: SealedListingHolding,
  platform: ListingPlatform,
  quantity: number,
  askPriceUsd: number | null,
  externalListingId: string,
): SealedListingInsert {
  const platformLeg = platform.fulfillment_leg.trim() as FulfillmentLeg;
  const normalizedExternalId = externalListingId.trim();
  if (holding.game !== "pokemon_sealed" || holding.item_type !== "sealed") {
    throw new Error("A sealed listing requires a pokemon_sealed holding");
  }
  if (platformLeg !== holding.leg.trim()) {
    throw new Error("The platform market region cannot fulfill this inventory leg");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > holding.qty_on_hand) {
    throw new Error("Listing quantity must be within the available on-hand quantity");
  }
  if (askPriceUsd != null && (!Number.isFinite(askPriceUsd) || askPriceUsd < 0)) {
    throw new Error("Listing price must be zero or greater");
  }

  return {
    platform: platform.platform,
    external_listing_id: normalizedExternalId || null,
    game: "pokemon_sealed",
    item_type: "sealed",
    card_id: null,
    product_id: holding.product_id,
    condition_id: null,
    psa_grade: 0,
    sealed_condition: holding.sealed_condition,
    variant_edition: holding.variant_edition,
    leg: holding.leg,
    quantity_listed: quantity,
    ask_price_usd: askPriceUsd,
    status: normalizedExternalId ? "active" : "draft",
  };
}

function holdingKey(holding: SealedListingHolding): string {
  return [
    holding.product_id,
    holding.leg,
    holding.sealed_condition,
    holding.variant_edition,
  ].join(":");
}

function exposureHoldingKey(listing: SealedListingExposure): string {
  return [
    listing.product_id,
    listing.leg,
    listing.sealed_condition,
    listing.variant_edition,
  ].join(":");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

export default function InventoryListingPanel() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [data, setData] = useState<SealedListingData | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [holdingId, setHoldingId] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [askPrice, setAskPrice] = useState("");
  const [externalId, setExternalId] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setReadError(null);
    try {
      setData(await fetchSealedListingData());
    } catch (error) {
      setData(null);
      setReadError(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedHolding = useMemo(
    () => data?.holdings.find((holding) => holdingKey(holding) === holdingId) ?? null,
    [data, holdingId],
  );
  const eligiblePlatforms = useMemo(
    () => data?.platforms.filter(
      (platform) => platform.fulfillment_leg.trim() === selectedHolding?.leg.trim(),
    ) ?? [],
    [data, selectedHolding],
  );
  const holdingsByAxis = useMemo(
    () => new Map((data?.holdings ?? []).map((holding) => [holdingKey(holding), holding])),
    [data],
  );

  const chooseHolding = useCallback((nextHoldingId: string) => {
    setHoldingId(nextHoldingId);
    const holding = data?.holdings.find((candidate) => holdingKey(candidate) === nextHoldingId);
    const firstPlatform = data?.platforms.find(
      (platform) => platform.fulfillment_leg.trim() === holding?.leg.trim(),
    );
    setPlatformId(firstPlatform?.platform ?? "");
    setQuantity("1");
  }, [data]);

  const beginListing = useCallback(() => {
    const first = data?.holdings[0];
    if (!first) return;
    setMutationError(null);
    setAskPrice("");
    setExternalId("");
    chooseHolding(holdingKey(first));
    setOpen(true);
  }, [chooseHolding, data]);

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setMutationError(null);
    const platform = eligiblePlatforms.find((candidate) => candidate.platform === platformId);
    if (!selectedHolding || !platform) {
      setMutationError(t("inventoryListings.invalidSelection"));
      return;
    }
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > selectedHolding.qty_on_hand) {
      setMutationError(t("inventoryListings.invalidQuantity", { max: selectedHolding.qty_on_hand }));
      return;
    }
    const parsedAskPrice = askPrice.trim() === "" ? null : Number(askPrice);
    if (parsedAskPrice != null && (!Number.isFinite(parsedAskPrice) || parsedAskPrice < 0)) {
      setMutationError(t("inventoryListings.invalidPrice"));
      return;
    }
    setIsSaving(true);
    try {
      const payload = buildSealedListingInsert(
        selectedHolding,
        platform,
        parsedQuantity,
        parsedAskPrice,
        externalId,
      );
      const { error } = await createClient().from("inventory_listings").insert(payload);
      if (error) throw error;
      setOpen(false);
      await load();
    } catch (error) {
      setMutationError(t("inventoryListings.writeError", { error: errorMessage(error) }));
    } finally {
      setIsSaving(false);
    }
  }, [askPrice, eligiblePlatforms, externalId, load, platformId, quantity, selectedHolding, t]);

  const legLabel = (leg: FulfillmentLeg) => t(
    leg.trim() === "export" ? "trips.legExport" : "trips.legImport",
  );
  const regionLabel = (region: MarketRegion) => t(
    region.trim() === "JP" ? "inventoryListings.regionJapan" : "inventoryListings.regionNorthAmerica",
  );

  return (
    <section className="space-y-3 rounded-xl border p-3 sm:p-4" aria-labelledby="sealed-listings-title">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h3 id="sealed-listings-title" className="font-semibold">{t("inventoryListings.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("inventoryListings.help")}</p>
        </div>
        <Button
          type="button"
          className="min-h-12 sm:ml-auto sm:min-h-9"
          disabled={isLoading || !data?.holdings.length}
          onClick={beginListing}
        >
          {t("inventoryListings.create")}
        </Button>
      </div>

      {readError && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <div>
            {t("inventoryListings.readError", { error: readError })}
            <Button type="button" variant="link" className="min-h-12 px-2 sm:min-h-9" onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

      {data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h4 className="text-sm font-medium">{t("inventoryListings.availableTitle")}</h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{t("trips.item")}</TableHead>
                  <TableHead>{t("inventory.detail")}</TableHead>
                  <TableHead>{t("inventoryListings.fulfillmentLeg")}</TableHead>
                  <TableHead>{t("inventory.available")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.holdings.map((holding) => (
                    <TableRow key={holdingKey(holding)}>
                      <TableCell>{holding.name}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {conditionLabel(t, holding.sealed_condition)} · {editionLabel(t, holding.variant_edition)}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{legLabel(holding.leg)}</Badge></TableCell>
                      <TableCell className="tabular-nums">{holding.qty_on_hand}</TableCell>
                    </TableRow>
                  ))}
                  {data.holdings.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-muted-foreground">{t("inventoryListings.noAvailable")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="min-w-0 space-y-2">
            <h4 className="text-sm font-medium">{t("inventoryListings.liveTitle")}</h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{t("inventoryListings.platform")}</TableHead>
                  <TableHead>{t("trips.item")}</TableHead>
                  <TableHead>{t("inventoryListings.status")}</TableHead>
                  <TableHead>{t("inventoryListings.marketRegion")}</TableHead>
                  <TableHead>{t("inventoryListings.fulfillmentLeg")}</TableHead>
                  <TableHead>{t("inventoryListings.quantity")}</TableHead>
                  <TableHead>{t("inventoryListings.reconciliation")}</TableHead>
                  <TableHead>{t("inventoryListings.askPrice")}</TableHead>
                  <TableHead>{t("inventoryListings.listedAt")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.listings.map((listing) => {
                    const holding = holdingsByAxis.get(exposureHoldingKey(listing));
                    const itemName = listing.item_name || holding?.name;
                    const setCode = listing.set_code || holding?.set_code;
                    const pushedQuantity = listing.last_pushed_quantity ?? listing.quantity_listed;
                    return (
                      <TableRow key={listing.listing_id}>
                      <TableCell>
                        <div>{listing.platform}</div>
                        {listing.external_listing_id && <div className="text-xs text-muted-foreground">{listing.external_listing_id}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {itemName ?? t("inventoryListings.productId", { id: listing.product_id })}
                          </div>
                          <div className="whitespace-nowrap text-xs text-muted-foreground">
                            {setCode ? `${setCode} · ` : ""}
                            {t("inventoryListings.productId", { id: listing.product_id })} · {conditionLabel(t, listing.sealed_condition)} · {editionLabel(t, listing.variant_edition)}
                          </div>
                        </TableCell>
                      <TableCell>{t(listing.status === "draft" ? "inventoryListings.statusDraft" : "inventoryListings.statusActive")}</TableCell>
                      <TableCell>{regionLabel(listing.market_region)}</TableCell>
                      <TableCell><Badge variant="secondary">{legLabel(listing.leg)}</Badge></TableCell>
                      <TableCell className={listing.over_promised > 0 ? "font-medium text-destructive" : ""}>
                        <div>{listing.quantity_listed} / {listing.qty_on_hand}</div>
                        {listing.over_promised > 0 ? (
                          <div className="text-xs">{t("inventoryListings.overPromised", { count: listing.over_promised })}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-52 text-sm">
                        {listing.needs_push
                          ? listing.can_push
                            ? t("inventoryListings.automaticPush", { from: pushedQuantity, to: listing.desired_quantity })
                            : t("inventoryListings.manualPush", { from: pushedQuantity, to: listing.desired_quantity })
                          : t("inventoryListings.inSync", { quantity: listing.desired_quantity })}
                      </TableCell>
                      <TableCell>{listing.ask_price_usd == null ? t("inventoryListings.notSet") : formatUsd(Number(listing.ask_price_usd))}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(listing.listed_at, language)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {data.listings.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-muted-foreground">{t("inventoryListings.noLive")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader><DialogTitle>{t("inventoryListings.createTitle")}</DialogTitle></DialogHeader>

            {mutationError && (
              <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {mutationError}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="listing-holding">{t("inventoryListings.sealedItem")}</Label>
              <select
                id="listing-holding"
                value={holdingId}
                onChange={(event) => chooseHolding(event.target.value)}
                className="min-h-12 w-full rounded-md border bg-background px-3 text-sm sm:min-h-9"
              >
                {data?.holdings.map((holding) => (
                  <option key={holdingKey(holding)} value={holdingKey(holding)}>
                    {holding.name} · {conditionLabel(t, holding.sealed_condition)} · {editionLabel(t, holding.variant_edition)} · {legLabel(holding.leg)} · {holding.qty_on_hand}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="listing-platform">{t("inventoryListings.platform")}</Label>
              <select
                id="listing-platform"
                value={platformId}
                onChange={(event) => setPlatformId(event.target.value)}
                className="min-h-12 w-full rounded-md border bg-background px-3 text-sm sm:min-h-9"
              >
                {eligiblePlatforms.map((platform) => (
                  <option key={platform.platform} value={platform.platform}>
                    {platform.platform} · {regionLabel(platform.market_region)} · {legLabel(platform.fulfillment_leg)}
                  </option>
                ))}
              </select>
              {eligiblePlatforms.length === 0 && <p className="text-sm text-destructive">{t("inventoryListings.noEligiblePlatform")}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="listing-quantity">{t("inventoryListings.quantity")}</Label>
                <Input
                  id="listing-quantity"
                  type="number"
                  min={1}
                  max={selectedHolding?.qty_on_hand ?? 1}
                  step={1}
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="min-h-12 sm:min-h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="listing-price">{t("inventoryListings.askPrice")}</Label>
                <Input
                  id="listing-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={askPrice}
                  onChange={(event) => setAskPrice(event.target.value)}
                  className="min-h-12 sm:min-h-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="listing-external-id">{t("inventoryListings.externalId")}</Label>
              <Input
                id="listing-external-id"
                value={externalId}
                onChange={(event) => setExternalId(event.target.value)}
                className="min-h-12 sm:min-h-9"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-12 sm:min-h-9" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" className="min-h-12 sm:min-h-9" disabled={isSaving || eligiblePlatforms.length === 0}>
                {isSaving ? t("common.saving") : t("inventoryListings.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
