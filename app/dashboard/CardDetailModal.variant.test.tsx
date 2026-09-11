// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  language: "en" as "en" | "ja",
  activeGame: "pokemon" as "pokemon" | "mtg" | "pokemon_sealed",
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./LanguageContext", () => ({
  useLanguage: () => ({ language: mocks.language }),
}));
vi.mock("./GameContext", () => ({
  useGame: () => ({ activeGame: mocks.activeGame }),
}));
vi.mock("./CurrencyContext", () => ({
  useCurrency: () => ({
    displayCurrency: "none",
    convertPrice: (price: number) => ({ price, symbol: "$" }),
  }),
}));
vi.mock("./BuyListContext", () => ({
  useBuyList: () => ({ buylists: [], addToBuylist: vi.fn() }),
}));
vi.mock("@/lib/use-fx-rate", () => ({
  useFxRate: () => ({ rateFor: () => 1 }),
  fmtRate: () => "1",
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const pending = new Promise<never>(() => {});
      const builder: Record<string, unknown> = {
        then: pending.then.bind(pending),
      };
      for (const method of ["select", "eq", "gt", "order", "update", "maybeSingle"]) {
        builder[method] = vi.fn(() => builder);
      }
      return builder;
    },
    rpc: vi.fn(),
  }),
}));
vi.mock("./use-card-data", async (importOriginal) => ({
  ...await importOriginal<typeof import("./use-card-data")>(),
  fetchRateMap: vi.fn().mockResolvedValue(new Map()),
  fetchLocationMap: vi.fn().mockResolvedValue(new Map()),
  refreshLocationMap: vi.fn().mockResolvedValue(new Map()),
  fetchConditionsCache: vi.fn().mockResolvedValue({ map: new Map(), tiers: [1] }),
}));
vi.mock("./owned-inventory", () => ({
  useOwnedInventoryVersion: () => 0,
  bumpOwnedInventory: vi.fn(),
}));
vi.mock("./AddToLotPopover", () => ({ AddToLotPopover: () => null }));
vi.mock("./RefreshPricesAction", () => ({ RefreshPricesAction: () => null }));
vi.mock("./UidChip", () => ({ UidChip: () => null }));
vi.mock("./FreshnessChip", () => ({ FreshnessChip: () => null }));
vi.mock("./GradeEvidencePanel", () => ({ default: () => null }));
vi.mock("./DecisionActions", () => ({ decisionSnapshot: () => ({}) }));
vi.mock("./opportunity-exposures", () => ({
  detailOpportunityPayloads: () => [],
  recordOpportunityExposures: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./MarketEvidenceCallout", () => ({ MarketEvidenceCallout: () => null }));
vi.mock("./JapanExclusiveEvidence", () => ({ JapanExclusiveEvidence: () => null }));
vi.mock("./PokemonCuratorFlags", () => ({
  PokemonCuratorFlagSwitches: () => null,
  pokemonCuratorFlagValues: () => ({ is_cute: false }),
}));
vi.mock("./PokemonJapanExclusivityEditor", () => ({
  PokemonJapanExclusivityEditor: () => null,
  pokemonJapanExclusivityValues: () => ({
    japan_exclusive_artwork: false,
    japan_exclusive_artwork_reason: null,
    japan_exclusive_artwork_evidence_url: null,
    japan_exclusive_stamps: false,
    japan_exclusive_stamps_reason: null,
    japan_exclusive_stamps_evidence_url: null,
  }),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

import CardDetailModal from "./CardDetailModal";
import type { CardRowData } from "./use-card-data";

afterEach(cleanup);

beforeEach(() => {
  mocks.language = "en";
  mocks.activeGame = "pokemon";
});

function pokemonRow(miscInfo: string): CardRowData {
  return {
    key: "42",
    card: {
      card_id: "42",
      card_uid: "da807f6b-e540-44a1-bbbc-1b3179cf9211",
      regional_name: "カード",
      english_name: "Card",
      set_code: "SV-P",
      card_number: "124",
      misc_info: miscInfo,
      edition: "first",
      foil_treatment: "mirror",
      variant_attrs: ["SA"],
      image_url: null,
      language: "jp",
    },
    prices: { highestBuy: null, lowestSell: null },
    roi: null,
  };
}

describe("CardDetailModal typed Pokemon variant", () => {
  it.each([
    { viewport: "desktop", width: 1440, language: "en", expectedName: "Card" },
    { viewport: "desktop", width: 1440, language: "ja", expectedName: "カード" },
    { viewport: "phone", width: 390, language: "en", expectedName: "Card" },
    { viewport: "phone", width: 390, language: "ja", expectedName: "カード" },
  ] as const)("keeps compound and residual labels equal on $viewport in $language", ({ width, language, expectedName }) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    mocks.language = language;

    for (const miscInfo of ["SA,ミラー,1ED", "SA"]) {
      const view = render(
        <CardDetailModal card={pokemonRow(miscInfo)} open onClose={vi.fn()} />,
      );

      expect(screen.getByText("SA,ミラー,1ED")).toBeTruthy();
      expect(screen.getByText(expectedName)).toBeTruthy();
      view.unmount();
    }
  });

  it("keeps an MTG detail label unchanged", () => {
    mocks.activeGame = "mtg";
    const row = pokemonRow("Showcase,etched");
    delete row.card.edition;
    delete row.card.foil_treatment;
    delete row.card.variant_attrs;

    render(<CardDetailModal card={row} open onClose={vi.fn()} />);

    expect(screen.getByText("Showcase,etched")).toBeTruthy();
  });
});
