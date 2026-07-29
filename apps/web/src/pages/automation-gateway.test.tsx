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
    apiPost: vi.fn(),
    apiPatch: (...args: unknown[]) => apiPatch(...args),
    apiDelete: vi.fn(),
  };
});
vi.mock("../lib/socket", () => ({ useTagValues: () => undefined }));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { userId: "u1", email: "a@b.c", name: "Yönetici", role: "ADMIN", tenantId: "t1" },
    loading: false,
  }),
}));

import { AutomationGatewayPage } from "./automation-gateway";
import { ConfirmProvider } from "../components/confirm-dialog";
import { ToastProvider } from "../components/toast";

const MACHINE = { id: "m1", name: "Tezgah 1", connectorType: "MANUAL" as const, connectorConfig: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <AutomationGatewayPage />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("AutomationGatewayPage — Bağlantı Ayarları", () => {
  beforeEach(() => {
    apiGet.mockReset().mockImplementation((path: string) => {
      if (path === "/machines") return Promise.resolve([MACHINE]);
      if (path === "/machines/m1/tags") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    apiPatch.mockReset().mockResolvedValue({ ...MACHINE, connectorType: "OPC_UA" });
  });

  it("makine seçilince Bağlantı Ayarları kartı görünür, tip OPC-UA seçilince Endpoint URL alanı gelir", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("option", { name: "Tezgah 1" });
    await user.selectOptions(screen.getByLabelText("Makine"), "m1");
    expect(await screen.findByText("Bağlantı Ayarları")).toBeInTheDocument();
    expect(screen.queryByLabelText("Endpoint URL")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Bağlantı Tipi"), "OPC_UA");
    expect(screen.getByLabelText("Endpoint URL")).toBeInTheDocument();
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
  });

  it("M80 seçilince Host/Port alanları gelir ve kayıt PATCH gönderir", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("option", { name: "Tezgah 1" });
    await user.selectOptions(screen.getByLabelText("Makine"), "m1");
    await user.selectOptions(screen.getByLabelText("Bağlantı Tipi"), "M80");
    expect(screen.getByLabelText("Host")).toBeInTheDocument();
    expect(screen.getByLabelText("Port")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Host"), "192.168.1.10");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(apiPatch).toHaveBeenCalledWith(
      "/machines/m1",
      expect.objectContaining({ connectorType: "M80", connectorConfig: expect.objectContaining({ host: "192.168.1.10" }) }),
    );
  });
});
