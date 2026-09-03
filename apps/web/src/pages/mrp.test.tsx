import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiPost = vi.fn();
let currentRole = "PLANNER";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPatch: (...args: unknown[]) => apiPatch(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
  };
});

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { userId: "u1", email: "planner@example.com", name: "Planlayıcı", role: currentRole, tenantId: "t1" },
    loading: false,
  }),
}));

import { ToastProvider } from "../components/toast";
import { MrpPage } from "./mrp";

const MAKE_PROPOSAL = {
  id: "proposal-make",
  proposalNo: "MRP-2026-0001",
  itemType: "PART",
  itemId: "P-100",
  policy: "MAKE",
  quantity: "12",
  receiptDate: "2026-08-20T00:00:00.000Z",
  releaseDate: "2026-08-17T00:00:00.000Z",
  status: "PROPOSED",
  calculation: {
    openingUsable: 3,
    grossRequirement: 15,
    existingSupplyBeforeDate: 0,
    safetyStock: 0,
    netRequirement: 12,
    lotRule: "LOT_FOR_LOT",
    recommendedQuantity: 12,
  },
  parameterSnapshot: { policy: "MAKE", leadTimeWorkingDays: 3, lotSizingRule: "LOT_FOR_LOT" },
  peggings: [
    {
      demandType: "SALES_ORDER_LINE",
      demandId: "SO-LINE-42",
      parentDemandType: null,
      parentDemandId: null,
      quantity: "12",
      requiredDate: "2026-08-20T00:00:00.000Z",
    },
  ],
};

const BUY_PROPOSAL = {
  ...MAKE_PROPOSAL,
  id: "proposal-buy",
  proposalNo: "MRP-2026-0002",
  itemType: "MATERIAL",
  itemId: "MAT-900",
  policy: "BUY",
  status: "FIRMED",
  receiptDate: "2026-09-15T00:00:00.000Z",
  releaseDate: "2026-09-10T00:00:00.000Z",
};

const OPEN_EXCEPTION = {
  id: "exception-open",
  type: "SHORTAGE",
  severity: "CRITICAL",
  itemType: "PART",
  itemId: "P-100",
  quantity: "12",
  requiredDate: "2026-08-20T00:00:00.000Z",
  suggestedDate: "2026-08-17T00:00:00.000Z",
  explanation: { message: "Teslim tarihi çalışma günü lead time içinde.", projectedBalance: -12 },
  acknowledgedAt: null,
};

const ACKNOWLEDGED_EXCEPTION = {
  ...OPEN_EXCEPTION,
  id: "exception-acknowledged",
  type: "RESCHEDULE_IN",
  severity: "WARNING",
  itemType: "MATERIAL",
  itemId: "MAT-900",
  requiredDate: "2026-09-15T00:00:00.000Z",
  explanation: { message: "Planlı giriş öne alınabilir." },
  acknowledgedAt: "2026-08-17T10:00:00.000Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MrpPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("MrpPage — CNC-V1-03R workbenches", () => {
  beforeEach(() => {
    currentRole = "PLANNER";
    apiGet.mockReset().mockImplementation((path: string) => {
      if (path === "/plants") return Promise.resolve([{ id: "plant-1", name: "Ana Fabrika" }]);
      if (path.startsWith("/mrp/proposals")) return Promise.resolve([MAKE_PROPOSAL, BUY_PROPOSAL]);
      if (path.startsWith("/mrp/exceptions")) return Promise.resolve([OPEN_EXCEPTION, ACKNOWLEDGED_EXCEPTION]);
      if (path.startsWith("/mrp/runs")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    apiPatch.mockReset().mockResolvedValue({});
    apiPost.mockReset().mockResolvedValue({});
  });

  it("planner ve istisna workbench zorunlu filtreleriyle kuyrukları daraltır", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("MRP-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("MRP-2026-0002")).toBeInTheDocument();
    expect(screen.getByText("Teslim tarihi çalışma günü lead time içinde.")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Planlayıcı Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "İstisna Workbench" })).toBeInTheDocument();
    expect(screen.getByLabelText("Politika")).toBeInTheDocument();
    expect(screen.getByLabelText("Kalem ara")).toBeInTheDocument();
    expect(screen.getByLabelText("Öneri durumu")).toBeInTheDocument();
    expect(screen.getByLabelText("Başlangıç tarihi")).toBeInTheDocument();
    expect(screen.getByLabelText("Bitiş tarihi")).toBeInTheDocument();
    expect(screen.getByLabelText("İstisna türü")).toBeInTheDocument();
    expect(screen.getByLabelText("Önem")).toBeInTheDocument();
    expect(screen.getByLabelText("Onay durumu")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Politika"), "BUY");
    expect(screen.queryByText("MRP-2026-0001")).not.toBeInTheDocument();
    expect(screen.getByText("MRP-2026-0002")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Kalem ara"));
    await user.type(screen.getByLabelText("Kalem ara"), "P-100");
    expect(screen.queryByText("MRP-2026-0002")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("İstisna türü"), "SHORTAGE");
    expect(screen.getByText("Teslim tarihi çalışma günü lead time içinde.")).toBeInTheDocument();
    expect(screen.queryByText("Planlı giriş öne alınabilir.")).not.toBeInTheDocument();
  });

  it("öneri ayrıntısında saklanan hesap, parametre ve pegging kanıtını gösterir", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "MRP-2026-0001 ayrıntısını aç" }));

    expect(screen.getByRole("heading", { name: /MRP-2026-0001 — Hesap Açıklaması/ })).toBeInTheDocument();
    expect(screen.getByText("Açılış kullanılabilir stok")).toBeInTheDocument();
    expect(screen.getByText("Net ihtiyaç")).toBeInTheDocument();
    expect(screen.getByText("Parametre snapshotı")).toBeInTheDocument();
    expect(screen.getByText("3 çalışma günü")).toBeInTheDocument();
    expect(screen.getByText("SALES_ORDER_LINE / SO-LINE-42")).toBeInTheDocument();
  });

  it("durum, tarih, önem ve onay filtrelerini gerçek satırlara uygular", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("MRP-2026-0001");

    await user.selectOptions(screen.getByLabelText("Öneri durumu"), "FIRMED");
    expect(screen.queryByText("MRP-2026-0001")).not.toBeInTheDocument();
    expect(screen.getByText("MRP-2026-0002")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Öneri durumu"), "");
    await user.type(screen.getByLabelText("Başlangıç tarihi"), "2026-09-01");
    expect(screen.queryByText("MRP-2026-0001")).not.toBeInTheDocument();
    expect(screen.getByText("MRP-2026-0002")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Başlangıç tarihi"));
    await user.selectOptions(screen.getByLabelText("Önem"), "WARNING");
    expect(screen.queryByText("Teslim tarihi çalışma günü lead time içinde.")).not.toBeInTheDocument();
    expect(screen.getByText("Planlı giriş öne alınabilir.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Önem"), "");
    await user.selectOptions(screen.getByLabelText("Onay durumu"), "OPEN");
    expect(screen.getByText("Teslim tarihi çalışma günü lead time içinde.")).toBeInTheDocument();
    expect(screen.queryByText("Planlı giriş öne alınabilir.")).not.toBeInTheDocument();
  });

  it("firm ve unfirm geçişlerini yalnız uygun durumlarda canonical endpointlere gönderir", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("MRP-2026-0001");

    const makeRow = screen.getByText("MRP-2026-0001").closest("tr");
    const buyRow = screen.getByText("MRP-2026-0002").closest("tr");
    expect(makeRow).not.toBeNull();
    expect(buyRow).not.toBeNull();

    await user.click(within(makeRow!).getByRole("button", { name: "Firmle" }));
    expect(apiPatch).toHaveBeenCalledWith("/mrp/proposals/proposal-make/firm", {});

    await user.click(within(buyRow!).getByRole("button", { name: "Firmi kaldır" }));
    expect(apiPatch).toHaveBeenCalledWith("/mrp/proposals/proposal-buy/unfirm", {});
  });

  it("dönüşümü açık downstream sınırıyla onaylatır ve politika endpointini çağırır", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("MRP-2026-0002");

    const buyRow = screen.getByText("MRP-2026-0002").closest("tr");
    await user.click(within(buyRow!).getByRole("button", { name: "Dönüştür" }));

    expect(apiPost).not.toHaveBeenCalledWith("/mrp/proposals/proposal-buy/convert-buy", {});
    expect(screen.getByText("BUY önerisi satınalma talebine dönüştürülecek; satınalma siparişi oluşturulmayacak.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Satınalma Talebine Dönüştür" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/mrp/proposals/proposal-buy/convert-buy", {}));
  });

  it("MAKE dönüşümünü canonical planlı iş emri sınırına gönderir", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/plants") return Promise.resolve([{ id: "plant-1", name: "Ana Fabrika" }]);
      if (path.startsWith("/mrp/proposals")) return Promise.resolve([{ ...MAKE_PROPOSAL, status: "FIRMED" }]);
      if (path.startsWith("/mrp/exceptions") || path.startsWith("/mrp/runs")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    renderPage();
    const proposal = await screen.findByText("MRP-2026-0001");

    await user.click(within(proposal.closest("tr")!).getByRole("button", { name: "Dönüştür" }));
    expect(screen.getByText("MAKE önerisi planlı iş emrine dönüştürülecek; mevcut mühendislik release sınırı korunacak.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Planlı İş Emrine Dönüştür" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/mrp/proposals/proposal-make/convert-make", {}));
  });

  it("açık istisnayı onaylar ve onaylanmış kaydı tekrar aksiyona açmaz", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Teslim tarihi çalışma günü lead time içinde.");

    const openRow = screen.getByText("Teslim tarihi çalışma günü lead time içinde.").closest("tr");
    const acknowledgedRow = screen.getByText("Planlı giriş öne alınabilir.").closest("tr");
    await user.click(within(openRow!).getByRole("button", { name: "Onayla" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/mrp/exceptions/exception-open/acknowledge", {}));
    expect(within(acknowledgedRow!).getByText("Onaylandı")).toBeInTheDocument();
    expect(within(acknowledgedRow!).queryByRole("button", { name: "Onayla" })).not.toBeInTheDocument();
  });

  it("salt-okuyucu rol için mutasyon aksiyonları render etmez", async () => {
    currentRole = "OPERATOR";
    renderPage();
    await screen.findByText("MRP-2026-0001");

    expect(screen.queryByRole("button", { name: "Tam MRP Çalıştır" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Firmle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dönüştür" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Onayla" })).not.toBeInTheDocument();
  });
});
