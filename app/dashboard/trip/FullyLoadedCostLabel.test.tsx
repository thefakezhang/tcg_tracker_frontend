// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../LanguageContext";
import FullyLoadedCostLabel from "./FullyLoadedCostLabel";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("FullyLoadedCostLabel", () => {
  function renderLabel() {
    render(
      <LanguageProvider>
        <FullyLoadedCostLabel />
      </LanguageProvider>,
    );

    return screen.getByText("Fully loaded cost");
  }

  it("names the complete cost and opens its explanation from keyboard focus", async () => {
    const label = renderLabel();

    expect(label.getAttribute("aria-label")).toBe(
      "Fully loaded cost. Landed cost plus an allocated share of all expenses attached to the trip, including airfare, lodging, food, and other trip expenses.",
    );

    fireEvent.focus(label);
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toContain(
        "Landed cost plus an allocated share of all expenses attached to the trip",
      );
    });
  });

  it("opens its explanation from a touch click while initially closed", async () => {
    const label = renderLabel();

    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerDown(label, { pointerType: "touch" });
    fireEvent.click(label);
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toContain(
        "airfare, lodging, food, and other trip expenses",
      );
    });
  });
});
