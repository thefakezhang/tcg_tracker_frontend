"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type SortingState } from "@tanstack/react-table";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGame } from "./GameContext";
import { useHeader } from "./HeaderContext";
import { useCardData, type CardRowData } from "./use-card-data";
import { createColumns, PriceCell } from "./columns";
import { DataTable } from "./data-table";
import CardDetailModal from "./CardDetailModal";
import { Card, CardContent } from "@/components/ui/card";
import { ImageOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export default function CardBrowser() {
  const { t } = useTranslation();
  const { activeGame, psaMode, setPsaMode } = useGame();
  const { setHeaderActions } = useHeader();
  const [search, setSearch] = useState("");
  const [searchCardNumber, setSearchCardNumber] = useState("");
  const [searchSetCode, setSearchSetCode] = useState("");
  const [selectedTiers, setSelectedTiers] = useState<number[]>([1]);
  const [showSecond, setShowSecond] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "roi", desc: true },
  ]);
  const [selectedCard, setSelectedCard] = useState<CardRowData | null>(null);

  const { data, loading, error, availableTiers } = useCardData({
    activeGame,
    psaMode,
    search,
    searchCardNumber,
    searchSetCode,
    selectedTiers,
  });

  useEffect(() => {
    setSearch("");
    setSearchCardNumber("");
    setSearchSetCode("");
    setSelectedTiers([1]);
  }, [activeGame]);

  useEffect(() => {
    setHeaderActions(null);
    return () => setHeaderActions(null);
  }, [setHeaderActions]);

  const columnVisibility = {
    psa_grade: psaMode === "psa",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input
          type="text"
          placeholder={t("cardBrowser.namePlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2"
        />
        <Input
          type="text"
          placeholder={t("cardBrowser.cardNumberPlaceholder")}
          value={searchCardNumber}
          onChange={(e) => setSearchCardNumber(e.target.value)}
        />
        <Input
          type="text"
          placeholder={t("cardBrowser.setCodePlaceholder")}
          value={searchSetCode}
          onChange={(e) => setSearchSetCode(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}
          className="shrink-0"
        >
          <TabsList>
            <TabsTrigger value="list">{t("cardBrowser.list")}</TabsTrigger>
            <TabsTrigger value="grid">{t("cardBrowser.grid")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {psaMode === "non-psa" && availableTiers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="shrink-0" />
                }
              >
                {t("cardBrowser.tierPrefix")}{selectedTiers.sort((a, b) => a - b).join(", ") || t("cardBrowser.tierNone")}
                <ChevronDown className="ml-1 size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {availableTiers.map((tier) => (
                  <DropdownMenuCheckboxItem
                    key={tier}
                    checked={selectedTiers.includes(tier)}
                    onCheckedChange={(checked) => {
                      setSelectedTiers((prev) =>
                        checked
                          ? [...prev, tier]
                          : prev.filter((t) => t !== tier)
                      );
                    }}
                  >
                    {t("cardBrowser.tierItem", { tier })}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Tabs
            value={showSecond ? "second" : "first"}
            onValueChange={(v) => setShowSecond(String(v) === "second")}
            className="shrink-0"
          >
            <TabsList>
              <TabsTrigger value="first">{t("cardBrowser.bestPrices")}</TabsTrigger>
              <TabsTrigger value="second">{t("cardBrowser.secondPrices")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs
            value={psaMode === "psa" ? "psa" : "non-psa"}
            onValueChange={(v) => setPsaMode(String(v) === "psa" ? "psa" : "non-psa")}
            className="shrink-0"
          >
            <TabsList>
              <TabsTrigger value="non-psa">{t("modal.tabNonPsa")}</TabsTrigger>
              <TabsTrigger value="psa">{t("modal.tabPsa")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {error && (
        <p className="text-destructive text-sm">{t("cardBrowser.error", { message: error })}</p>
      )}

      <DataTable
        columns={useMemo(() => createColumns(t, showSecond), [t, showSecond])}
        data={data}
        loading={loading}
        sorting={sorting}
        onSortingChange={setSorting}
        columnVisibility={columnVisibility}
        onRowClick={setSelectedCard}
        viewMode={viewMode}
        renderGridItem={useCallback(
          (row: CardRowData) => {
            const misc =
              row.card.misc_info && row.card.misc_info !== "UNKNOWN"
                ? row.card.misc_info
                : null;
            const cardNumber =
              row.card.card_number && row.card.card_number !== "UNKNOWN"
                ? row.card.card_number
                : null;
            const buyEntry = showSecond
              ? row.prices.secondLowestBuy
              : row.prices.lowestBuy;
            const sellEntry = showSecond
              ? row.prices.secondHighestSell
              : row.prices.highestSell;

            return (
              <Card
                size="sm"
                className="h-full cursor-pointer pt-0 transition-colors hover:bg-accent/50"
                onClick={() => setSelectedCard(row)}
              >
                {row.card.image_url ? (
                  <img
                    src={row.card.image_url}
                    alt={row.card.regional_name}
                    className="aspect-[2/3] w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-muted">
                    <ImageOff className="size-8 text-muted-foreground" />
                  </div>
                )}
                <CardContent className="flex flex-1 flex-col gap-2">
                  <div>
                    <div className="truncate font-medium leading-snug">{row.card.regional_name}</div>
                    {misc && (
                      <div className="truncate text-xs text-muted-foreground">{misc}</div>
                    )}
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    {cardNumber && (
                      <div>{t("modal.number")}: {cardNumber}</div>
                    )}
                    <div>{t("modal.set")}: {row.card.set_code}</div>
                  </div>
                  <div className="mt-auto space-y-1 rounded-md bg-muted/50 px-2.5 py-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="shrink-0 text-muted-foreground">{t("column.lowestBuy")}</span>
                      <div className="text-right">
                        <PriceCell entry={buyEntry} />
                      </div>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="shrink-0 text-muted-foreground">{t("column.highestSell")}</span>
                      <div className="text-right">
                        <PriceCell entry={sellEntry} />
                      </div>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-foreground/10 pt-1">
                      <span className="text-muted-foreground">{t("column.roi")}</span>
                      <span>{row.roi !== null ? `${Math.round(row.roi * 100) / 100}%` : "\u2014"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          },
          [showSecond, t]
        )}
      />

      <CardDetailModal
        card={selectedCard}
        open={!!selectedCard}
        onClose={() => setSelectedCard(null)}
      />
    </div>
  );
}
