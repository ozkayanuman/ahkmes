import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ApiError: actual.ApiError, apiGet: (...args: unknown[]) => apiGet(...args) };
});
vi.mock("../lib/socket", () => ({ useInvalidateOn: () => undefined }));
vi.mock("react-router-dom", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("../components/oee-charts", () => ({
  OeeTrendChart: () => <div>OEE chart</div>,
  DowntimeParetoChart: () => <div>Downtime chart</div>,
}));

import { DashboardPage } from "./dashboard";

const DASHBOARD = {
  workOrderCounts: {},
  activeWorkOrders: [],
  pendingQuotes: [],
  criticalStock: [],
  recentRuns: [],
  openNonConformanceCount: 0,
  plants: [
    { id: "plant-1", name: "Ana Fabrika" },
    { id: "plant-2", name: "İkinci Fabrika" },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>);
}

describe("DashboardPage OEE scope", () => {
  beforeEach(() => {
    apiGet.mockReset().mockImplementation((path: string) => {
      if (path === "/dashboard") return Promise.resolve(DASHBOARD);
      return Promise.resolve([]);
    });
  });

  it("only requests OEE projections after the operator explicitly selects a plant", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("option", { name: "Ana Fabrika" });
    expect(apiGet.mock.calls.map(([path]) => path)).not.toContain("/oee/trend?days=14");
    expect(apiGet.mock.calls.map(([path]) => path)).not.toContain("/oee/downtime-pareto?days=14");

    await user.selectOptions(screen.getByLabelText("OEE tesisi"), "plant-2");
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/oee\/trend\?/)));

    const path = apiGet.mock.calls.map(([item]) => item).find((item) => item.startsWith("/oee/trend?"));
    const params = new URL(path, "http://localhost").searchParams;
    expect(params.get("plantId")).toBe("plant-2");
    expect(params.get("from")).not.toBeNull();
    expect(params.get("to")).not.toBeNull();
    expect(params.get("asOf")).not.toBeNull();
    expect(params.get("days")).toBeNull();
  });
});
