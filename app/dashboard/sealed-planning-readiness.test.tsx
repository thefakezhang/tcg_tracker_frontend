// @vitest-environment jsdom

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.fn();
const select = vi.fn(() => ({ limit }));
const from = vi.fn(() => ({ select }));
const rpc = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from, rpc }),
}));
vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  readSealedPlanningReadiness,
  SEALED_PLANNING_CANDIDATE_VIEW,
  SealedPlanningReadinessNotice,
  useSealedPlanningReadiness,
} from "./sealed-planning-readiness";

afterEach(cleanup);

beforeEach(() => {
  limit.mockReset();
  select.mockClear();
  from.mockClear();
  rpc.mockClear();
});

describe("sealed planning schema readiness", () => {
  it("uses only an authenticated zero-row view read", async () => {
    limit.mockResolvedValue({ data: [], error: null });

    await expect(readSealedPlanningReadiness()).resolves.toBe("ready");

    expect(from).toHaveBeenCalledWith(SEALED_PLANNING_CANDIDATE_VIEW);
    expect(select).toHaveBeenCalledWith("product_id");
    expect(limit).toHaveBeenCalledWith(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { code: "42P01", message: "relation does not exist" },
    { code: "PGRST205", message: "Could not find the table in the schema cache" },
  ])("treats a missing planning schema as unavailable: $code", async (error) => {
    limit.mockResolvedValue({ data: null, error });

    await expect(readSealedPlanningReadiness()).resolves.toBe("unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { code: "42501", status: 403, message: "permission denied" },
    { code: "PGRST301", status: 401, message: "JWT expired" },
    { code: "FETCH_ERROR", message: "network request failed" },
    { code: "PGRST204", message: "an unrelated response shape changed" },
    { code: "PGRST204", status: 403, message: `permission denied while reading ${SEALED_PLANNING_CANDIDATE_VIEW} from the schema cache` },
  ])("keeps non-schema failures visible and retryable: $code", async (error) => {
    limit.mockResolvedValue({ data: null, error });

    await expect(readSealedPlanningReadiness()).rejects.toBe(error);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("offers retry for authentication and transport failures", () => {
    const retry = vi.fn();
    render(
      <SealedPlanningReadinessNotice
        id="readiness"
        state="error"
        error={{ code: "PGRST301", status: 401, message: "JWT expired" }}
        retry={retry}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("sealedPlanning.checkFailed");
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("lets the operator check again from the unavailable state", () => {
    const retry = vi.fn();
    render(
      <SealedPlanningReadinessNotice
        id="readiness"
        state="unavailable"
        retry={retry}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("sealedPlanning.unavailableHelp");
    fireEvent.click(screen.getByRole("button", { name: "sealedPlanning.checkAgain" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("recovers from unavailable to ready by repeating only the zero-row read", async () => {
    limit
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST205", message: "missing view" } })
      .mockResolvedValueOnce({ data: [], error: null });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    );
    const { result } = renderHook(() => useSealedPlanningReadiness(), { wrapper });

    await waitFor(() => expect(result.current.state).toBe("unavailable"));
    await act(async () => { await result.current.retry(); });
    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenNthCalledWith(1, 0);
    expect(limit).toHaveBeenNthCalledWith(2, 0);
    expect(rpc).not.toHaveBeenCalled();
  });
});
