import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
vi.mock("../lib/api", () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

import { OeeCockpitPage } from "./oee-cockpit";

const COCKPIT = {
  context: { asOf: "2026-08-26T12:00:00.000Z" },
  summary: { metrics: { oee: { value: 0.5 }, availability: { value: 0.8 }, performance: { value: 0.75 }, quality: { value: 0.9 }, dataQuality: "PARTIAL", issues: [{ code: "STALE_SOURCE" }] } },
  machines: [{ id: "m1", name: "CNC-1", currentStatus: "RUNNING", activeWorkOrder: { id: "wo-1", woNo: "WO-1", status: "IN_PROGRESS" }, oee: { value: null, dataQuality: "INSUFFICIENT_DATA", facts: { goodCount: 0, scrapCount: 0 }, issues: [] }, maintenanceOrderIds: [] }],
  blockers: { maintenance: [], qualityHolds: [], materialExceptions: [] },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><OeeCockpitPage /></QueryClientProvider>);
}

describe("OeeCockpitPage", () => {
  beforeEach(() => apiGet.mockReset().mockImplementation((path: string) => path === "/plants" ? Promise.resolve([{ id: "p1", name: "Ana Fabrika" }]) : Promise.resolve(COCKPIT)));

  it("uses an explicit plant/time context and preserves unavailable OEE rather than displaying zero", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("option", { name: "Ana Fabrika" });
    await user.selectOptions(await screen.findByLabelText("Tesis"), "p1");

    await screen.findByText("OEE Cockpit");
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/oee\/cockpit\?/)));
    expect(screen.getByText("Veri yetersiz")).toBeInTheDocument();
    expect(screen.getByText("%50")).toBeInTheDocument();
  });
});
