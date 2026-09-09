import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ApiError: actual.ApiError, apiGet: (...args: unknown[]) => apiGet(...args), apiPost: (...args: unknown[]) => apiPost(...args), apiPatch: (...args: unknown[]) => apiPatch(...args) };
});
vi.mock("../lib/socket", () => ({ useInvalidateOn: () => undefined }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { userId: "u1", email: "cmms@test.local", name: "Bakım Sorumlusu", role: "FOREMAN", tenantId: "t1" }, loading: false }) }));

import { ToastProvider } from "../components/toast";
import { MaintenanceOrdersPage } from "./maintenance-orders";

const asset = { id: "machine-1", assetCode: "CNC-001", name: "Torna 1", model: "QT-200", manufacturer: "Mazak", serialNumber: "MZ-42", criticality: "HIGH", maintenanceState: "BREAKDOWN", productionAllowed: false, plant: { id: "plant-1", name: "Ana Fabrika" }, workCenter: { id: "wc-1", name: "Talaşlı İmalat" } };
const request = { id: "request-1", requestNo: "MR-0001", machine: asset, problem: "Eksen sesi", description: "X ekseninde ses", priority: "HIGH", status: "OPEN", reportedAt: "2026-08-17T08:00:00.000Z", reporter: { id: "op-1", name: "Operatör A" } };
const breakdown = { id: "breakdown-1", breakdownNo: "BR-0001", machine: asset, description: "Spindle durdu", priority: "CRITICAL", severity: "PRODUCTION_STOP", status: "OPEN", failureStartedAt: "2026-08-17T09:00:00.000Z", maintenanceOrderId: null };
const order = { id: "mo-1", bakNo: "BAK-0001", machine: asset, type: "CORRECTIVE", priority: "CRITICAL", status: "IN_PROGRESS", description: "Spindle arızasını gider", actualStart: "2026-08-17T09:20:00.000Z", assignments: [{ id: "a-1", isPrimary: true, user: { id: "tech-1", name: "Teknisyen A" } }] };
const pmDue = { id: "plan-1", name: "Aylık yağlama", machine: { id: asset.id, name: asset.name }, nextDueAt: "2026-08-16T00:00:00.000Z", dueState: "OVERDUE", priority: "MEDIUM" };
const downtime = { id: "dt-1", machine: { id: asset.id, name: asset.name }, startedAt: "2026-08-17T09:00:00.000Z", endedAt: null, planned: false, reasonCategory: "UNPLANNED_BREAKDOWN", source: "CMMS_BREAKDOWN" };
const workbench = { metrics: { openRequestCount: 1, activeBreakdownCount: 1, openOrderCount: 1, pmDueCount: 1, pmOverdueCount: 1, machinesOutOfServiceCount: 1, activeDowntimeCount: 1 }, requests: [request], breakdowns: [breakdown], orders: [order], pmDue: [pmDue], assetsOutOfService: [asset], activeDowntime: [downtime] };
const detail = { ...order, breakdown, tasks: [{ id: "task-1", sequence: 1, description: "Koruyucuyu kilitle", required: true, completedAt: null }], laborEntries: [{ id: "labor-1", workDate: "2026-08-17", durationMinutes: 45, notes: "Teşhis", technician: { id: "tech-1", name: "Teknisyen A" } }], spareLines: [{ id: "spare-1", itemName: "Spindle rulmanı", plannedQuantity: "1", issuedQuantity: "1", returnedQuantity: "0", transactions: [] }], downtimeEvents: [downtime] };
const actions = ["CMMS_READ", "CMMS_REQUEST_CREATE", "CMMS_BREAKDOWN_DECLARE", "CMMS_WO_PLAN", "CMMS_WO_EXECUTE", "CMMS_ASSIGN_TECHNICIAN", "CMMS_SPARE_ISSUE", "CMMS_PM_ADMIN", "CMMS_RETURN_TO_SERVICE"];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><MaintenanceOrdersPage /></ToastProvider></QueryClientProvider>);
}

describe("MaintenanceOrdersPage — CNC-V1-07R workbench", () => {
  beforeEach(() => {
    apiGet.mockReset().mockImplementation((path: string) => {
      if (path === "/action-permissions/me") return Promise.resolve(actions);
      if (path === "/maintenance-orders/workbench") return Promise.resolve(workbench);
      if (path === "/maintenance-orders/assets") return Promise.resolve([asset]);
      if (path === "/maintenance-orders/plans/due") return Promise.resolve([pmDue]);
      if (path === "/maintenance-orders/downtime-facts") return Promise.resolve([downtime]);
      if (path === "/maintenance-orders/mo-1") return Promise.resolve(detail);
      if (path === "/maintenance-orders/assets/machine-1") return Promise.resolve({ ...asset, activeBreakdown: breakdown, openMaintenanceOrders: [order] });
      if (path === "/maintenance-orders/assets/machine-1/history") return Promise.resolve({ requests: [request], breakdowns: [breakdown], orders: [order], downtime: [downtime], returnToService: [] });
      return Promise.resolve([]);
    });
    apiPost.mockReset().mockResolvedValue({}); apiPatch.mockReset().mockResolvedValue({});
  });

  it("shows required KPIs, queues and filters without /machines", async () => {
    const user = userEvent.setup(); renderPage();
    expect(await screen.findByRole("heading", { name: "CMMS Bakım Workbench" })).toBeInTheDocument();
    for (const text of ["Açık talepler", "Aktif arızalar", "Servis dışı makineler", "Aktif duruş", "PM zamanı gelen", "Gecikmiş PM"]) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    for (const label of ["Tesis", "Makine", "Durum", "Öncelik", "Teknisyen", "Bakım tipi", "Başlangıç tarihi", "Bitiş tarihi"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    for (const tab of ["Varlıklar", "Talepler", "Arızalar", "Bakım iş emirleri", "PM zamanı gelen", "Aktif duruşlar"]) expect(screen.getByRole("button", { name: new RegExp(tab) })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Varlıklar/ }));
    expect(screen.getByText("CNC-001")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/maintenance-orders/assets");
    expect(apiGet).not.toHaveBeenCalledWith("/machines");
  });

  it("uses canonical request, breakdown conversion and WO detail actions", async () => {
    const user = userEvent.setup(); renderPage(); await screen.findByText("CMMS Bakım Workbench");
    await user.click(await screen.findByRole("button", { name: "Bakım talebi bildir" }));
    await user.selectOptions(screen.getByLabelText("Varlık / makine"), "machine-1");
    await user.type(screen.getByLabelText("Problem"), "Hidrolik basınç düşük");
    await user.selectOptions(screen.getByLabelText("Talep önceliği"), "HIGH");
    await user.click(screen.getByRole("button", { name: "Talebi kaydet" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/maintenance-orders/requests", expect.objectContaining({ machineId: "machine-1", problem: "Hidrolik basınç düşük", priority: "HIGH" })));
    await user.click(screen.getByRole("button", { name: /Arızalar/ }));
    await user.click(within(screen.getByText("BR-0001").closest("tr")!).getByRole("button", { name: "İş emrine dönüştür" }));
    expect(apiPost).toHaveBeenCalledWith("/maintenance-orders/breakdowns/breakdown-1/convert", {});
    await user.click(screen.getByRole("button", { name: /Bakım iş emirleri/ }));
    await user.click(screen.getByRole("button", { name: "BAK-0001 ayrıntısını aç" }));
    expect(await screen.findByText(/Koruyucuyu kilitle/)).toBeInTheDocument();
    expect(screen.getByText(/Teşhis/)).toBeInTheDocument(); expect(screen.getByText("Spindle rulmanı")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Görevi tamamla: Koruyucuyu kilitle" }));
    expect(apiPatch).toHaveBeenCalledWith("/maintenance-orders/mo-1/tasks/task-1/complete", {});
  });

  it("gates mutations by action grants and keeps return-to-service explicit", async () => {
    const user = userEvent.setup(); renderPage(); await screen.findByText("CMMS Bakım Workbench");
    await user.click(screen.getByRole("button", { name: /Varlıklar/ })); await user.click(await screen.findByRole("button", { name: "CNC-001 bakım ayrıntısını aç" }));
    expect(await screen.findByText("Üretim izni: BLOKE")).toBeInTheDocument();
    expect(screen.getByText("Controller READY durumu bakım blokajını kaldırmaz.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Üretime geri al" }));
    await user.type(screen.getByLabelText("Servise dönüş notu"), "Emniyet kontrolleri tamamlandı"); await user.click(screen.getByRole("button", { name: "Servise dönüşü onayla" }));
    expect(apiPost).toHaveBeenCalledWith("/maintenance-orders/assets/machine-1/return-to-service", expect.objectContaining({ notes: "Emniyet kontrolleri tamamlandı" }));
    apiGet.mockImplementation((path: string) => path === "/action-permissions/me" ? Promise.resolve(["CMMS_READ"]) : path === "/maintenance-orders/workbench" ? Promise.resolve(workbench) : path === "/maintenance-orders/assets" ? Promise.resolve([asset]) : Promise.resolve([]));
  });
});
