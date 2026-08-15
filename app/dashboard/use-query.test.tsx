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
});
