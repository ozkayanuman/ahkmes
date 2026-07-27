import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ApiError: actual.ApiError, apiGet: (...args: unknown[]) => apiGet(...args) };
});

import { GenealogyPage } from "./genealogy";

const GENEALOGY_DATA = {
  workOrder: { id: "wo-1", woNo: "WO-2026-0001", status: "IN_PRODUCTION", quantity: "10" },
  part: { id: "p1", partNo: "P-100", revision: "A", name: "Mil" },
  customer: { id: "c1", name: "ACME" },
  quoteNo: "TKF-2026-0001",
  backward: {
    materialsConsumed: [
      { id: "mc-1", type: "CONSUMED", quantity: "5", date: "2026-07-27T10:00:00.000Z", material: { code: "C1040", name: "Çubuk" } },
    ],
  },
  forward: {
    productionRuns: [
      {
        id: "run-1",
        goodCount: 3,
        scrapCount: 0,
        startedAt: "2026-07-27T09:00:00.000Z",
        endedAt: null,
        machine: { name: "Tezgah 1" },
        operator: { name: "Operatör" },
      },
    ],
    finishedGoodsEntries: [],
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GenealogyPage />
    </QueryClientProvider>,
  );
}

describe("GenealogyPage", () => {
  beforeEach(() => {
    apiGet.mockReset().mockImplementation((path: string) => {
      if (path === "/work-orders") return Promise.resolve([{ id: "wo-1", woNo: "WO-2026-0001" }]);
      if (path.startsWith("/work-orders/wo-1/genealogy")) return Promise.resolve(GENEALOGY_DATA);
      return Promise.resolve([]);
    });
  });

  it("iş emri seçilince backward/forward kartlarını gösterir", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("option", { name: "WO-2026-0001" });
    await user.selectOptions(screen.getByLabelText("İş Emri"), "wo-1");

    expect(await screen.findByText(/P-100 revA/)).toBeInTheDocument();
    expect(screen.getByText(/ACME/)).toBeInTheDocument();
    expect(screen.getByText(/C1040/)).toBeInTheDocument();
    expect(screen.getByText(/Tezgah 1/)).toBeInTheDocument();
  });
});
