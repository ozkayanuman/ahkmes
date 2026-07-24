import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
    apiPatch: (...args: unknown[]) => apiPatch(...args),
    apiDelete: (...args: unknown[]) => apiDelete(...args),
  };
});
vi.mock("../lib/socket", () => ({ useInvalidateOn: () => undefined }));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { userId: "u1", email: "a@b.c", name: "Yönetici", role: "ADMIN", tenantId: "t1" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "po-1" }),
  useNavigate: () => vi.fn(),
}));

import { PurchaseOrderDetailPage } from "./purchase-order-detail";

// 40 sipariş edilmiş, 15'i teslim alınmış → kalan 25
const PARTIALLY_RECEIVED_PO = {
  id: "po-1",
  poNo: "SAT-2026-0007",
  status: "ORDERED",
  orderDate: "2026-07-01T00:00:00.000Z",
  expectedDate: null,
  notes: null,
  supplier: { id: "s1", name: "Çelik Ticaret" },
  lines: [
    {
      id: "line-1",
      quantity: "40",
      unitPrice: "45",
      receivedQty: "15",
      material: { id: "m1", code: "C1040", name: "Çubuk", unit: "kg", stockQty: "115" },
    },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PurchaseOrderDetailPage />
    </QueryClientProvider>,
  );
}

describe("Satınalma detay — teslim alma", () => {
  beforeEach(() => {
    apiGet.mockReset().mockResolvedValue(PARTIALLY_RECEIVED_PO);
    apiPost.mockReset().mockResolvedValue({ ...PARTIALLY_RECEIVED_PO, status: "RECEIVED" });
  });

  it("kalan miktarı sipariş eksi teslim alınan olarak gösterir", async () => {
    renderPage();

    expect(await screen.findByText("SAT-2026-0007")).toBeInTheDocument();
    expect(screen.getByText("Sipariş Verildi")).toBeInTheDocument();

    const row = screen.getByText(/C1040/).closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((c) => c.textContent);
    // sütunlar: Malzeme, Sipariş, B.Fiyat, Teslim Alınan, Kalan, Stok, [input]
    expect(cells[1]).toContain("40");
    expect(cells[3]).toBe("15");
    expect(cells[4]).toBe("25");
  });

  it("miktar girilmeden Teslim Al butonu pasiftir", async () => {
    renderPage();
    await screen.findByText("SAT-2026-0007");

    expect(screen.getByRole("button", { name: /Teslim Al/ })).toBeDisabled();
  });

  it("girilen miktarı satır bazlı gövdeyle gönderir", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("SAT-2026-0007");

    await user.type(screen.getByPlaceholderText("0"), "10");

    const button = screen.getByRole("button", { name: /Teslim Al/ });
    expect(button).toBeEnabled();
    await user.click(button);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/purchase-orders/po-1/receive", {
        lines: [{ lineId: "line-1", receivedQty: 10 }],
      }),
    );
  });

  it("teslim alınmış siparişte teslim alma arayüzü gösterilmez", async () => {
    apiGet.mockResolvedValue({ ...PARTIALLY_RECEIVED_PO, status: "RECEIVED" });
    renderPage();

    expect(await screen.findByText("Teslim Alındı")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Teslim Al$/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("0")).not.toBeInTheDocument();
  });
});
