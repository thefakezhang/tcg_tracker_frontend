// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuyerSourceReceipts } from "./BuyerSourceReceipts";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: mocks.from }, rpc: mocks.rpc }) }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function props(planId = 7) {
  return { planId, source: " Cardrush ", receiptCount: 0, readOnly: false, onUploaded: vi.fn(), onError: vi.fn() };
}
function uploadFile() {
  fireEvent.change(screen.getByLabelText("buyer.uploadReceipt"), { target: { files: [new File(["receipt fixture"], "領収書.pdf", { type: "application/pdf" })] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ upload: mocks.upload });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe("buyer receipt upload and registration", () => {
  it("provides an enabled native button to open the receipt chooser", () => {
    render(<BuyerSourceReceipts {...props()} />);
    const input = screen.getByLabelText("buyer.uploadReceipt");
    const click = vi.spyOn(input, "click");
    const trigger = screen.getByRole("button", { name: "buyer.uploadReceipt" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("labels registration-only work without implying another upload", async () => {
    let finish!: (value: { error: null }) => void;
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<BuyerSourceReceipts {...props()} />);
    uploadFile();
    const saving = await screen.findByRole("button", { name: "buyer.registeringReceipt" });
    expect(saving).toHaveProperty("disabled", true);
    expect(screen.queryByText("buyer.uploading")).toBeNull();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    await act(async () => finish({ error: null }));
  });

  it("retries a failed registration with the exact uploaded path and no second upload", async () => {
    const input = props();
    mocks.rpc.mockResolvedValueOnce({ error: { message: "registration unavailable" } });
    render(<BuyerSourceReceipts {...input} />);
    uploadFile();
    await waitFor(() => expect(input.onError).toHaveBeenCalledWith("registration unavailable"));
    expect(input.onUploaded).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const path = mocks.upload.mock.calls[0][0];
    expect(path).toMatch(/^plan-receipts\/7\/cardrush\/[a-z0-9-]+-_+\.pdf$/);
    fireEvent.click(screen.getByRole("button", { name: "buyer.retryReceipt" }));
    await waitFor(() => expect(input.onUploaded).toHaveBeenCalledTimes(1));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_plan_id: 7, p_source: "cardrush", p_storage_path: path, p_original_name: "領収書.pdf" });
    expect(screen.queryByRole("button", { name: "buyer.retryReceipt" })).toBeNull();
  });

  it("does not register an upload that failed", async () => {
    const input = props();
    mocks.upload.mockResolvedValueOnce({ error: { message: "upload denied" } });
    render(<BuyerSourceReceipts {...input} />);
    uploadFile();
    await waitFor(() => expect(input.onError).toHaveBeenCalledWith("upload denied"));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "buyer.retryReceipt" })).toBeNull();
  });

  it("ignores a completed old-plan upload after the view changes", async () => {
    let finish!: (value: { error: null }) => void;
    mocks.upload.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const old = props(7), next = props(8);
    const view = render(<BuyerSourceReceipts key="7" {...old} />);
    uploadFile();
    view.rerender(<BuyerSourceReceipts key="8" {...next} />);
    await act(async () => { finish({ error: null }); });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(old.onUploaded).not.toHaveBeenCalled();
    expect(next.onUploaded).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("preserves pending evidence but disables retry after finalization", async () => {
    const input = props();
    mocks.rpc.mockResolvedValueOnce({ error: { message: "retry later" } });
    const view = render(<BuyerSourceReceipts {...input} />);
    uploadFile();
    await waitFor(() => expect(input.onError).toHaveBeenCalledWith("retry later"));
    view.rerender(<BuyerSourceReceipts {...input} readOnly />);
    expect(screen.getByRole("status").textContent).toBe("buyer.receiptAwaitingRegistration");
    expect(screen.queryByRole("button")).toBeNull();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("shows a thrown registration error and retains its retry", async () => {
    const input = props();
    mocks.rpc.mockRejectedValueOnce(new Error("connection lost"));
    render(<BuyerSourceReceipts {...input} />);
    uploadFile();
    await waitFor(() => expect(input.onError).toHaveBeenCalledWith("connection lost"));
    expect(screen.getByRole("button", { name: "buyer.retryReceipt" })).toHaveProperty("disabled", false);
  });
});
