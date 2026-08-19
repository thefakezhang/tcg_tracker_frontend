// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import {
  POKEMON_CURATOR_FLAGS,
  PokemonCuratorFlagChips,
  PokemonCuratorFlagSwitches,
  pokemonCuratorFlagValues,
  setPokemonCuratorFlag,
} from "./PokemonCuratorFlags";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

afterEach(cleanup);
beforeEach(() => mocks.rpc.mockReset());

function withLanguage(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe("Pokémon curator flags", () => {
  it("defines exactly the two flags, each with its own RPC", () => {
    expect(POKEMON_CURATOR_FLAGS.map((f) => [f.key, f.rpc])).toEqual([
      ["is_japan_exclusive", "set_pokemon_japan_exclusive"],
      ["is_cute", "set_pokemon_cute"],
    ]);
  });

  it("normalises null, undefined and partial rows to booleans", () => {
    expect(pokemonCuratorFlagValues(null)).toEqual({ is_japan_exclusive: false, is_cute: false });
    expect(pokemonCuratorFlagValues({ is_cute: true })).toEqual({ is_japan_exclusive: false, is_cute: true });
    expect(pokemonCuratorFlagValues({ is_japan_exclusive: null, is_cute: null })).toEqual({
      is_japan_exclusive: false,
      is_cute: false,
    });
  });

  it("writes a flag through its RPC and reports the error message, if any", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null });
    expect(await setPokemonCuratorFlag("is_cute", 1995087, true)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("set_pokemon_cute", { p_card_id: 1995087, p_value: true });

    mocks.rpc.mockResolvedValueOnce({ error: { message: "permission denied" } });
    expect(await setPokemonCuratorFlag("is_japan_exclusive", 7, false)).toBe("permission denied");
    expect(mocks.rpc).toHaveBeenLastCalledWith("set_pokemon_japan_exclusive", { p_card_id: 7, p_value: false });
  });

  it("renders no chip for an unflagged card and one labelled chip per set flag", () => {
    const { container, rerender } = withLanguage(<PokemonCuratorFlagChips card={{ is_japan_exclusive: false, is_cute: null }} />);
    expect(container.textContent).toBe("");

    rerender(
      <LanguageProvider>
        <PokemonCuratorFlagChips card={{ is_japan_exclusive: true, is_cute: true }} />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("curator-flag-is_japan_exclusive").textContent).toContain("JP-exclusive");
    expect(screen.getByTestId("curator-flag-is_japan_exclusive").getAttribute("title")).toBe("Japanese exclusive");
    expect(screen.getByTestId("curator-flag-is_cute").textContent).toContain("Cute");
  });

  it("saves a toggled switch immediately and tells the caller the new value", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null });
    const onChange = vi.fn();
    withLanguage(
      <PokemonCuratorFlagSwitches
        cardId={1995087}
        values={{ is_japan_exclusive: false, is_cute: false }}
        onChange={onChange}
      />,
    );

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    expect(screen.getByText("🩷 Cute")).toBeTruthy();

    fireEvent.click(screen.getByText("🩷 Cute"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("is_cute", true));
    expect(mocks.rpc).toHaveBeenCalledWith("set_pokemon_cute", { p_card_id: 1995087, p_value: true });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the switch where it was and shows the RPC error when the save fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "permission denied for function set_pokemon_japan_exclusive" } });
    const onChange = vi.fn();
    withLanguage(
      <PokemonCuratorFlagSwitches
        cardId={7}
        values={{ is_japan_exclusive: true, is_cute: false }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("🇯🇵 Japanese exclusive"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("permission denied");
    expect(mocks.rpc).toHaveBeenCalledWith("set_pokemon_japan_exclusive", { p_card_id: 7, p_value: false });
    expect(onChange).not.toHaveBeenCalled();
  });
});
