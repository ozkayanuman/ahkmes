import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
    apiPatch: (...args: unknown[]) => apiPatch(...args),
  };
});
vi.mock("../lib/socket", () => ({ useInvalidateOn: () => undefined }));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { userId: "u1", email: "a@b.c", name: "Yönetici", role: "ADMIN", tenantId: "t1" },
    loading: false,
  }),
}));

import { NonConformancesPage } from "./non-conformances";
import { ToastProvider } from "../components/toast";

const NC_ROW = {
  id: "nc-1",
  workOrder: { id: "wo-1", woNo: "WO-2026-0001" },
  reportedBy: { id: "u1", name: "Yönetici" },
  failureType: "Yüzey çizik",
  actionType: "SCRAP" as const,
  status: "OPEN" as const,
  createdAt: "2026-07-27T10:00:00.000Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NonConformancesPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("NonConformancesPage", () => {
  beforeEach(() => {
    apiGet.mockReset().mockImplementation((path: string) => {
      if (path === "/non-conformances") return Promise.resolve([NC_ROW]);
      if (path === "/work-orders") return Promise.resolve([{ id: "wo-1", woNo: "WO-2026-0001" }]);
      return Promise.resolve([]);
    });
    apiPost.mockReset().mockResolvedValue({ ...NC_ROW, id: "nc-2" });
    apiPatch.mockReset().mockResolvedValue({ ...NC_ROW, status: "RESOLVED" });
  });

  it("açık kayıt sayısını ve listeyi gösterir", async () => {
    renderPage();
    expect(await screen.findByText("WO-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("1 açık kayıt")).toBeInTheDocument();
    expect(screen.getByText("Açık")).toBeInTheDocument();
  });

  it("Yeni Kayıt butonu modalı açar ve gönderir", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("WO-2026-0001");

    await user.click(screen.getByRole("button", { name: /Yeni Kayıt/ }));
    expect(screen.getByText("Yeni Uygunsuzluk Kaydı")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("İş Emri"), "wo-1");
    await user.type(screen.getByLabelText("Hata Tipi"), "Boyut hatası");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/non-conformances",
        expect.objectContaining({ workOrderId: "wo-1", failureType: "Boyut hatası" }),
      ),
    );
  });

  it("Kapat butonu detaylı çözüm notu ister, boşken kapatılamaz", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("WO-2026-0001");

    await user.click(screen.getByTitle("Kapat"));
    expect(screen.getByText("WO-2026-0001 — Kaydı Kapat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kaydı Kapat/ })).toBeDisabled();

    await user.type(screen.getByLabelText("Çözüm Açıklaması (zorunlu)"), "8 adet hurdaya ayrıldı");
    await user.click(screen.getByRole("button", { name: /Kaydı Kapat/ }));

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/non-conformances/nc-1/resolve", {
        status: "RESOLVED",
        resolutionNote: "8 adet hurdaya ayrıldı",
      }),
    );
  });
});
