// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import { classifyQueryError, QueryError } from "./use-query";

afterEach(cleanup);

describe("classifyQueryError", () => {
  it.each([
    { status: 401 },
    { code: "PGRST301", message: "JWT expired" },
    { message: "Auth session missing!" },
  ])("recognizes expired sessions: %#", (error) => {
    expect(classifyQueryError(error)).toBe("session-expired");
  });

  it.each([
    { status: 403 },
    { code: "403" },
    { message: "permission denied for relation candidates" },
  ])("keeps authorization failures distinct: %#", (error) => {
    expect(classifyQueryError(error)).toBe("forbidden");
  });

  it("does not mistake a network failure for an authentication failure", () => {
    expect(classifyQueryError(new Error("network request failed"))).toBe("generic");
  });
});

describe("QueryError", () => {
  it("guides expired sessions back to sign-in instead of offering a futile retry", () => {
    render(
      <LanguageProvider>
        <QueryError error={{ status: 401 }} onRetry={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByText("Your session has expired.")).toBeTruthy();
    const signIn = screen.getByRole("link", { name: "Sign in again" });
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(signIn.className).toContain("min-h-11");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps retry available for non-authentication failures", () => {
    const retry = vi.fn();
    render(
      <LanguageProvider>
        <QueryError error={new Error("network request failed")} onRetry={retry} />
      </LanguageProvider>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("names external-identifier failures without exposing the raw cause", () => {
    const retry = vi.fn();
    render(
      <LanguageProvider>
        <QueryError
          error={{
            name: "ExternalIdentifierLookupError",
            code: "external_identifier_lookup_failed",
            message: "External identifier lookup is temporarily unavailable.",
            cause: new Error("permission denied for pokemon_external_identifiers"),
          }}
          onRetry={retry}
        />
      </LanguageProvider>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("External ID lookup is temporarily unavailable.");
    expect(alert.textContent).toContain("Any last successful results remain visible. Retry when the catalog link service is available.");
    expect(alert.textContent).not.toContain("permission denied");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("explains authorization failures without claiming the session expired", () => {
    render(
      <LanguageProvider>
        <QueryError error={{ status: 403 }} onRetry={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByText("You don't have permission to view this data.")).toBeTruthy();
    expect(screen.queryByText("Your session has expired.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  // The outage this distinction exists for. net_roi reached
  // pokemon_price_summaries and never reached the view the browser reads, so
  // every card-browser request answered 400 42703 for both games on every
  // device. The operator was shown "Couldn't load data" and a Retry button,
  // neither of which said anything true: nothing was transient and nothing the
  // operator could do would help. The relation name in PostgREST's message is
  // what finally identified it, so it is shown rather than discarded.
  it("names the relation when a read asks for a column the database lacks", () => {
    const retry = vi.fn();
    render(
      <LanguageProvider>
        <QueryError
          error={{
            status: 400,
            code: "42703",
            message: "column pokemon_price_summaries_browser_v.net_roi does not exist",
          }}
          onRetry={retry}
        />
      </LanguageProvider>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This view is asking the database for something it doesn't have.");
    expect(alert.textContent).toContain("pokemon_price_summaries_browser_v.net_roi");
    expect(alert.textContent).toContain("42703");
    expect(alert.textContent).not.toContain("Couldn't load data.");
    // A migration is the only fix, so offering Retry would be a lie.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });

  it("treats a missing relation as a schema failure too", () => {
    render(
      <LanguageProvider>
        <QueryError
          error={{ status: 404, code: "42P01", message: 'relation "public.gone_v" does not exist' }}
          onRetry={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(screen.getByRole("alert").textContent).toContain("public.gone_v");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  // Opposite of a schema error: the query was fine and the database gave up, so
  // the next attempt may well land.
  it("offers Retry when the database cancelled the query", () => {
    const retry = vi.fn();
    render(
      <LanguageProvider>
        <QueryError
          error={{ status: 500, code: "57014", message: "canceling statement due to statement timeout" }}
          onRetry={retry}
        />
      </LanguageProvider>,
    );

    expect(screen.getByRole("alert").textContent).toContain("The database took too long to answer.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  // A schema error must not be mistaken for an auth one: the two have opposite
  // remedies, and "sign in again" on a missing column sends the operator to do
  // something that cannot work.
  it("keeps a schema failure out of the session-expired path", () => {
    render(
      <LanguageProvider>
        <QueryError error={{ status: 400, code: "42703", message: "column x does not exist" }} onRetry={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.queryByText("Your session has expired.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in again" })).toBeNull();
  });
});
