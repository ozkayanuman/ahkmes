import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiPost = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPatch: (...args: unknown[]) => apiPatch(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
  };
});
vi.mock("../lib/socket", () => ({ useInvalidateOn: () => undefined }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { userId: "u1", email: "p@test.local", name: "Planlamacı", role: "PLANNER", tenantId: "t1" }, loading: false }) }));

import { SchedulingPage } from "./scheduling";
import { ToastProvider } from "../components/toast";

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

const FINITE_RESULT = {
  runId: null,
  committed: false,
  dispatchRule: "EDD",
  horizonStart: "2026-10-12T00:00:00.000Z",
  horizonEnd: "2026-10-26T00:00:00.000Z",
  summary: { workOrders: 2, scheduledOps: 2, unscheduledOps: 1, lateWorkOrders: 1, machines: 1 },
  workOrders: [
    { workOrderId: "wo-1", woNo: "WO-2026-0001", dueDate: "2026-10-15T00:00:00.000Z", plannedStart: "2026-10-12T05:00:00.000Z", plannedEnd: "2026-10-12T07:00:00.000Z", scheduledOps: 1, unscheduledOps: 0, late: false, latenessMinutes: 0 },
    { workOrderId: "wo-2", woNo: "WO-2026-0002", dueDate: "2026-10-12T00:00:00.000Z", plannedStart: "2026-10-12T07:00:00.000Z", plannedEnd: "2026-10-13T02:00:00.000Z", scheduledOps: 1, unscheduledOps: 1, late: true, latenessMinutes: 26 * 60 },
  ],
  operations: [],
  unscheduled: [{ operationId: "op-9", woNo: "WO-2026-0002", seq: 2, name: "Finiş", reason: "NO_MACHINE_CAPACITY" }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SchedulingPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("SchedulingPage", () => {
  beforeEach(() => {
    apiGet.mockReset().mockImplementation((url: string) =>
      Promise.resolve(url.startsWith("/scheduling/") || url.startsWith("/plants") ? [] : [WO_ROW]),
    );
    apiPatch.mockReset().mockResolvedValue({ ...WO_ROW, plannedStartDate: "2026-07-28", plannedEndDate: "2026-07-30" });
    apiPost.mockReset().mockResolvedValue(FINITE_RESULT);
  });

  it("sonlu kapasite simülasyonu çalıştırır, sonucu ve planlanamama nedenini gösterir; simülasyon hiçbir sorguyu geçersiz kılmaz", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/WO-2026-0001/);

    await user.click(screen.getByRole("button", { name: "Simüle et" }));

    expect(apiPost).toHaveBeenCalledWith("/scheduling/runs", expect.objectContaining({ dispatchRule: "EDD", commit: false, horizonDays: 14 }));
    expect(await screen.findByText("Simülasyon")).toBeInTheDocument();
    expect(screen.getByText("ZAMANINDA")).toBeInTheDocument();
    expect(screen.getByText(/GEÇ \+26 sa/)).toBeInTheDocument();
    expect(screen.getByText(/Makinede kapasite tanımı yok/)).toBeInTheDocument();
  });

  it("Uygula butonu commit:true ile çağırır ve başarı bildirimi gösterir", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ ...FINITE_RESULT, runId: "run-1", committed: true });
    renderPage();
    await screen.findByText(/WO-2026-0001/);

    await user.click(screen.getByRole("button", { name: "Uygula" }));

    expect(apiPost).toHaveBeenCalledWith("/scheduling/runs", expect.objectContaining({ commit: true }));
    expect(await screen.findByText("Uygulandı")).toBeInTheDocument();
    expect(await screen.findByText(/Çizelge uygulandı: 2 operasyon planlandı/)).toBeInTheDocument();
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

    expect(screen.getByText(/WO-2026-0001 — Çizelgele/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    // plannedStartDate henüz boş (wo.plannedStartDate=null), plannedEndDate varsayılan olarak dueDate'ten geliyor.
    expect(apiPatch).toHaveBeenCalledWith(
      "/work-orders/wo-1/schedule",
      expect.objectContaining({ plannedStartDate: null }),
    );
  });
});
