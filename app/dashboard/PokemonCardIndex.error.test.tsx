// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CardIndexMutationError } from "./PokemonCardIndex";

afterEach(cleanup);

describe("Card Index mutation feedback", () => {
  it("announces and focuses a newly rendered mutation error", async () => {
    const { rerender } = render(<CardIndexMutationError message={null} />);

    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<CardIndexMutationError message="This card changed while the editor was open." />);

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("aria-atomic")).toBe("true");
    expect(alert.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });
});
