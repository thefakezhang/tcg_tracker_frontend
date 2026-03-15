"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type SortingState } from "@tanstack/react-table";
import { ChevronDown, Hash, Layers } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
              ? row.prices.secondHighestBuy
              : row.prices.highestBuy;
            const sellEntry = showSecond
              ? row.prices.secondLowestSell
              : row.prices.lowestSell;

            return (
              <Card
                size="sm"
                className="h-full cursor-pointer gap-0 !py-0 transition-colors hover:bg-accent/50"
                onClick={() => setSelectedCard(row)}
              >
                {row.card.image_url ? (
                  <img
                    src={row.card.image_url}
                    alt={row.card.regional_name}
                    className="aspect-[5/7] w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-[5/7] w-full items-center justify-center bg-muted">
                    <ImageOff className="size-8 text-muted-foreground" />
                  </div>
                )}
                <CardHeader className="pt-1">
                  <CardAction>
                    <div className="flex flex-col items-end gap-1">
                      {cardNumber && (
                        <Badge variant="secondary" className="h-auto px-1.5 py-px">
                          <Hash className="size-3" />
                          {cardNumber}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="h-auto px-1.5 py-px">
                        <Layers className="size-3" />
                        {row.card.set_code}
                      </Badge>
                    </div>
                  </CardAction>
                  <CardTitle className="truncate text-lg">{row.card.regional_name}</CardTitle>
                  {misc && (
                    <CardDescription className="truncate text-xs">
                      {misc}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardFooter className="mt-auto flex-col gap-2 text-xs">
                  <div className="grid w-full grid-cols-[1fr_auto_1fr] gap-2">
                    <div className="space-y-1">
                      <div className="text-muted-foreground">{t("column.highestBuy")}</div>
                      <PriceCell entry={buyEntry} badgeVariant="outline" />
                    </div>
                    <div className="w-px self-stretch bg-foreground/10" />
                    <div className="space-y-1 text-right">
                      <div className="text-muted-foreground">{t("column.lowestSell")}</div>
                      <PriceCell entry={sellEntry} align="right" badgeVariant="outline" />
                    </div>
                  </div>
                  <div className="flex w-full justify-between gap-2 border-t border-foreground/10 pt-2">
                    <span className="text-muted-foreground">{t("column.roi")}</span>
                    <span>{row.roi !== null ? `${Math.round(row.roi * 100) / 100}%` : "\u2014"}</span>
                  </div>
                </CardFooter>
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
