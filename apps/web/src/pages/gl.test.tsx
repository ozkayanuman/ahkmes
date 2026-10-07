import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ApiError: actual.ApiError,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
    apiDelete: (...args: unknown[]) => apiDelete(...args),
  };
});
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { userId: "u1", email: "a@test.local", name: "Admin", role: "ADMIN", tenantId: "t1" }, loading: false }) }));

import { GlPage } from "./gl";
import { ToastProvider } from "../components/toast";

const ACCOUNTS = [
  { id: "a120", code: "120", name: "Alıcılar", type: "ASSET", isActive: true, postingAllowed: true, parent: null, _count: { lines: 2 } },
  { id: "a600", code: "600", name: "Yurtiçi Satışlar", type: "REVENUE", isActive: true, postingAllowed: true, parent: null, _count: { lines: 2 } },
];
const ENTRY = {
  id: "je1", jeNo: "YEV-2026-0001", entryDate: "2026-10-07T00:00:00.000Z", description: "Manuel satış", status: "DRAFT", sourceType: "MANUAL",
  lines: [
    { id: "l1", lineNo: 1, debit: "100", credit: "0", description: null, account: { id: "a120", code: "120", name: "Alıcılar" } },
    { id: "l2", lineNo: 2, debit: "0", credit: "100", description: null, account: { id: "a600", code: "600", name: "Yurtiçi Satışlar" } },
  ],
  createdBy: { name: "Admin" }, postedBy: null, reversalOf: null, reversal: null,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <GlPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("GlPage", () => {
  beforeEach(() => {
    apiGet.mockReset().mockImplementation((url: string) => {
      if (url.startsWith("/gl/accounts")) return Promise.resolve(ACCOUNTS);
      if (url.startsWith("/gl/entries")) return Promise.resolve([ENTRY]);
      if (url.startsWith("/gl/posting-accounts")) return Promise.resolve([{ key: "AR_RECEIVABLE", account: { id: "a120", code: "120", name: "Alıcılar" } }]);
      if (url.startsWith("/gl/trial-balance")) return Promise.resolve({ rows: [{ accountId: "a120", code: "120", name: "Alıcılar", type: "ASSET", openingBalance: 0, periodDebit: 100, periodCredit: 0, closingBalance: 100 }], totals: { openingBalance: 0, periodDebit: 100, periodCredit: 100, closingBalance: 0 } });
      return Promise.resolve([]);
    });
    apiPost.mockReset().mockResolvedValue({ ...ENTRY, status: "POSTED", postedBy: { name: "Admin" } });
    apiDelete.mockReset().mockResolvedValue({});
  });

  it("yevmiye listesini gösterir, satıra tıklayınca detay açılır ve taslak kaydedilebilir", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("YEV-2026-0001")).toBeInTheDocument();
    expect(screen.getAllByText("Taslak").length).toBeGreaterThan(0);

    await user.click(screen.getByText("YEV-2026-0001"));
    expect(await screen.findByText(/120 Alıcılar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Kaydet (post)" }));

    expect(apiPost).toHaveBeenCalledWith("/gl/entries/je1/post", {});
    expect(await screen.findByText(/YEV-2026-0001 kaydedildi/)).toBeInTheDocument();
  });

  it("yeni yevmiye formu dengesizken butonu kilitler, dengeliyken taslağı gönderir", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("YEV-2026-0001");
    await user.click(screen.getByRole("button", { name: /Yeni yevmiye/ }));

    await user.type(screen.getByLabelText("Açıklama"), "Test kaydı");
    await user.selectOptions(screen.getByLabelText("Satır 1 hesap"), "a120");
    await user.type(screen.getByLabelText("Satır 1 borç"), "250");
    await user.selectOptions(screen.getByLabelText("Satır 2 hesap"), "a600");
    expect(screen.getByRole("button", { name: "Taslak oluştur" })).toBeDisabled();
    expect(screen.getByText(/dengeli değil/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Satır 2 alacak"), "250");
    expect(screen.getByText(/— dengeli$/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Taslak oluştur" }));

    expect(apiPost).toHaveBeenCalledWith("/gl/entries", expect.objectContaining({
      description: "Test kaydı",
      lines: [
        { accountId: "a120", debit: 250, credit: 0 },
        { accountId: "a600", debit: 0, credit: 250 },
      ],
    }));
  });

  it("mizan sekmesi satırları ve toplamları gösterir; senkron sonucu bildirim olarak özetlenir", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({ posted: [{ docNo: "FAT-1", jeNo: "YEV-2" }], reversed: [], skipped: [{ docNo: "FAT-2", reason: "MAPPING_MISSING" }] });
    renderPage();
    await screen.findByText("YEV-2026-0001");

    await user.click(screen.getByRole("button", { name: "Alt defterleri senkronla" }));
    expect(apiPost).toHaveBeenCalledWith("/gl/sync", {});
    expect(await screen.findByText(/1 kayıt, 0 ters kayıt, 1 atlandı \(hesap eşlemesi eksik\)/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mizan" }));
    expect(await screen.findByText("Toplam")).toBeInTheDocument();
    expect(screen.getAllByText("Alıcılar").length).toBeGreaterThan(0);
  });
});
