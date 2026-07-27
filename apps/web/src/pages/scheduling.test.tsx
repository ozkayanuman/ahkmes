import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPatch = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPatch: (...args: unknown[]) => apiPatch(...args),
  };
});
vi.mock("../lib/socket", () => ({ useInvalidateOn: () => undefined }));

import { SchedulingPage } from "./scheduling";

const WO_ROW = {
  id: "wo-1",
  woNo: "WO-2026-0001",
  status: "IN_PRODUCTION",
  dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
  plannedStartDate: null,
  plannedEndDate: null,
  machine: { id: "m1", name: "Tezgah 1" },
  part: { partNo: "P-100", name: "Mil" },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SchedulingPage />
    </QueryClientProvider>,
  );
}

describe("SchedulingPage", () => {
  beforeEach(() => {
    apiGet.mockReset().mockResolvedValue([WO_ROW]);
    apiPatch.mockReset().mockResolvedValue({ ...WO_ROW, plannedStartDate: "2026-07-28", plannedEndDate: "2026-07-30" });
  });

  it("aktif iş emrini Gantt satırında gösterir", async () => {
    renderPage();
    expect(await screen.findByText(/WO-2026-0001/)).toBeInTheDocument();
    expect(screen.getByText(/Tezgah 1/)).toBeInTheDocument();
  });

  it("satıra tıklayınca çizelgeleme modalı açılır ve kaydeder", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText(/WO-2026-0001/));

    expect(screen.getByText(/Çizelgele/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    // plannedStartDate henüz boş (wo.plannedStartDate=null), plannedEndDate varsayılan olarak dueDate'ten geliyor.
    expect(apiPatch).toHaveBeenCalledWith(
      "/work-orders/wo-1/schedule",
      expect.objectContaining({ plannedStartDate: null }),
    );
  });
});
