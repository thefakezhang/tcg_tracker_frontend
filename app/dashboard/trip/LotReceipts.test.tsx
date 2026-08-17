// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../LanguageContext";
import LotReceipts from "./LotReceipts";

// A failed receipt upload used to surface as window.alert(): blocking, unstyled
// and gone without a trace. It now renders inline (role="alert") under the
// upload control, per file, and clears on the next attempt.
const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: mocks.upload,
        createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/r.jpg" } }),
        remove: async () => ({ error: null }),
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      }),
      insert: mocks.insert,
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

beforeEach(() => {
  mocks.upload.mockReset();
  mocks.insert.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pickFiles(names: string[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const files = names.map((n) => new File(["x"], n, { type: "image/jpeg" }));
  fireEvent.change(input, { target: { files } });
}

describe("LotReceipts upload errors", () => {
  it("renders a storage failure inline, names the file, and never calls window.alert", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "Payload too large" } });
    render(<LanguageProvider><LotReceipts lotId={7} /></LanguageProvider>);
    pickFiles(["receipt-1.jpg"]);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("receipt-1.jpg: Payload too large");
    expect(window.alert).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("collects one entry per failed file and clears on the next successful upload", async () => {
    mocks.upload
      .mockResolvedValueOnce({ error: { message: "denied" } })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "quota" } });
    render(<LanguageProvider><LotReceipts lotId={7} /></LanguageProvider>);
    pickFiles(["a.jpg", "b.jpg", "c.jpg"]);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("a.jpg: denied · c.jpg: quota");
    // the middle file still went through
    expect(mocks.insert).toHaveBeenCalledTimes(1);

    mocks.upload.mockResolvedValue({ error: null });
    pickFiles(["d.jpg"]);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
