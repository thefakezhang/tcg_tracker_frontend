// @vitest-environment jsdom
//
// The first render/interaction test in this app. It exists because a real crash
// shipped undetected: the account menu's DropdownMenuLabel was rendered outside a
// Group, so base-ui's GroupLabel threw "MenuGroupContext is missing" the instant
// the menu opened - and nothing caught it. tsc doesn't encode "must render inside
// a Group", `next build` never opens the click-gated menu, and every other test
// here is pure logic. So: actually mount the menu content open, and fail if it
// throws.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TranslationKey } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { AccountMenuContent } from "./AccountMenuContent";

afterEach(cleanup);

const noop = () => {};
// Stub translator: return the key so assertions are deterministic.
const idT = (k: TranslationKey) => k;

describe("AccountMenuContent", () => {
  it("mounts its content when the menu opens (no MenuGroupContext crash)", () => {
    // defaultOpen forces the portal content to mount immediately. If any
    // DropdownMenuLabel were outside a Group, this render would throw.
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<button>account</button>} />
        <AccountMenuContent
          t={idT}
          language="en"
          onLanguageChange={noop}
          currency="none"
          onCurrencyChange={noop}
          onLogout={noop}
        />
      </DropdownMenu>,
    );
    // The section labels, an option, and logout all rendered => content mounted.
    expect(screen.getByText("sidebar.language")).toBeTruthy();
    expect(screen.getByText("English (US)")).toBeTruthy();
    expect(screen.getByText("sidebar.convertCurrency")).toBeTruthy();
    expect(screen.getByText("sidebar.logOut")).toBeTruthy();
  });

  it("documents the footgun: a bare GroupLabel outside a group throws", () => {
    expect(() =>
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger render={<button>x</button>} />
          <DropdownMenuContent>
            <DropdownMenuLabel>bare label</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>,
      ),
    ).toThrow(/Menu group parts must be used within/);
  });
});
