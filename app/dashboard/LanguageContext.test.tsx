// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LanguageProvider, useLanguage } from "./LanguageContext";

function LanguageFixture() {
  const { language, setLanguage } = useLanguage();
  return (
    <button type="button" onClick={() => setLanguage(language === "en" ? "ja" : "en")}>
      {language}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
});

afterEach(cleanup);

describe("LanguageProvider document metadata", () => {
  it("applies the stored language and updates document.lang at runtime", async () => {
    localStorage.setItem("language", "ja");
    render(<LanguageProvider><LanguageFixture /></LanguageProvider>);

    await waitFor(() => expect(document.documentElement.lang).toBe("ja"));
    expect(screen.getByRole("button").textContent).toBe("ja");

    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("language")).toBe("en");
  });
});
