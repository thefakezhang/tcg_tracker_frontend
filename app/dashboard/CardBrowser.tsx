"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useGame } from "./GameContext";
import { useHeader } from "./HeaderContext";
import { useCardData } from "./use-card-data";
import { createColumns } from "./columns";
import { DataTable } from "./data-table";
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
  const [sorting, setSorting] = useState<SortingState>([
    { id: "roi", desc: true },
  ]);

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
    setHeaderActions(
      <>
        <Switch
          id="psa-toggle"
          checked={psaMode === "psa"}
          onCheckedChange={(checked: boolean) =>
            setPsaMode(checked ? "psa" : "non-psa")
          }
        />
        <label htmlFor="psa-toggle" className="text-sm text-muted-foreground">
          {t("cardBrowser.psa")}
        </label>
      </>
    );
    return () => setHeaderActions(null);
  }, [psaMode, setPsaMode, setHeaderActions]);

  const columnVisibility = {
    psa_grade: psaMode === "psa",
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder={t("cardBrowser.namePlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="basis-1/2"
        />
        <Input
          type="text"
          placeholder={t("cardBrowser.cardNumberPlaceholder")}
          value={searchCardNumber}
          onChange={(e) => setSearchCardNumber(e.target.value)}
          className="basis-1/4"
        />
        <Input
          type="text"
          placeholder={t("cardBrowser.setCodePlaceholder")}
          value={searchSetCode}
          onChange={(e) => setSearchSetCode(e.target.value)}
          className="basis-1/4"
        />
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => setShowSecond((v) => !v)}
        >
          {showSecond ? t("cardBrowser.secondPrices") : t("cardBrowser.bestPrices")}
        </Button>
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
      />
    </div>
  );
}
