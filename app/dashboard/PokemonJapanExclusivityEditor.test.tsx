// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import {
  PokemonJapanExclusivityEditor,
  pokemonJapanExclusivityValues,
  setPokemonJapanExclusivityDimension,
} from "./PokemonJapanExclusivityEditor";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

afterEach(cleanup);
beforeEach(() => mocks.rpc.mockReset());

function renderEditor(
  values = pokemonJapanExclusivityValues(null),
  onChange = vi.fn(),
) {
  render(
    <LanguageProvider>
      <PokemonJapanExclusivityEditor cardId={42} values={values} onChange={onChange} />
    </LanguageProvider>,
  );
  return onChange;
}

describe("Pokémon Japanese-exclusivity editor", () => {
  it("normalizes missing evidence fields", () => {
    expect(pokemonJapanExclusivityValues({
      japan_exclusive_artwork: true,
      japan_exclusive_artwork_reason: null,
    })).toEqual({
      japan_exclusive_artwork: true,
      japan_exclusive_artwork_reason: "",
      japan_exclusive_artwork_evidence_url: "",
      japan_exclusive_stamps: false,
      japan_exclusive_stamps_reason: "",
      japan_exclusive_stamps_evidence_url: "",
    });
  });

  it("sends evidence with an enabled dimension and clears it when disabled", async () => {
    mocks.rpc.mockResolvedValue({ error: null });

    expect(await setPokemonJapanExclusivityDimension(
      42,
      "stamps",
      true,
      "  Japanese Domino's logo  ",
      "  https://example.test/028-l-p  ",
    )).toBeNull();
    expect(mocks.rpc).toHaveBeenLastCalledWith("set_pokemon_japan_exclusivity_dimension", {
      p_card_id: 42,
      p_dimension: "stamps",
      p_value: true,
      p_reason: "Japanese Domino's logo",
      p_evidence_url: "https://example.test/028-l-p",
    });

    await setPokemonJapanExclusivityDimension(42, "stamps", false, "ignored", "ignored");
    expect(mocks.rpc).toHaveBeenLastCalledWith("set_pokemon_japan_exclusivity_dimension", {
      p_card_id: 42,
      p_dimension: "stamps",
      p_value: false,
      p_reason: null,
      p_evidence_url: null,
    });
  });

  it("requires evidence before enabling and saves the complete stamp classification", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null });
    const onChange = renderEditor();

    fireEvent.click(screen.getByRole("switch", { name: "Exclusive stamp / marking" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("reason");
    expect(mocks.rpc).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: /Exclusive stamp.*Reason/i }), {
      target: { value: "Japanese Domino's logo" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Exclusive stamp.*Evidence URL/i }), {
      target: { value: "https://example.test/028-l-p" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      japan_exclusive_stamps: true,
      japan_exclusive_stamps_reason: "Japanese Domino's logo",
      japan_exclusive_stamps_evidence_url: "https://example.test/028-l-p",
    })));
  });

  it("turns an active classification off immediately", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null });
    const values = pokemonJapanExclusivityValues({
      japan_exclusive_artwork: true,
      japan_exclusive_artwork_reason: "Japanese-only artwork",
      japan_exclusive_artwork_evidence_url: "https://example.test/art",
    });
    const onChange = renderEditor(values);

    fireEvent.click(screen.getByRole("switch", { name: "Exclusive artwork" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      japan_exclusive_artwork: false,
      japan_exclusive_artwork_reason: "",
      japan_exclusive_artwork_evidence_url: "",
    })));
  });
});
