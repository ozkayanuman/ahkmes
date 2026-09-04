import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
vi.mock("../lib/api", async () => { const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api"); return { ApiError: actual.ApiError, apiGet: (...args: unknown[]) => apiGet(...args) }; });
import { ShiftReportPage } from "./shift-report";

describe("ShiftReportPage", () => {
  beforeEach(() => apiGet.mockReset().mockImplementation((path: string) => path === "/plants" ? Promise.resolve([{ id: "plant-1", name: "Ana Fabrika" }]) : Promise.resolve([])));
  it("does not request a report before plant selection and sends an explicit cutoff after selection", async () => {
    const user = userEvent.setup(); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ShiftReportPage /></QueryClientProvider>);
    await screen.findByRole("option", { name: "Ana Fabrika" });
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/shift-report\?/));
    await user.selectOptions(screen.getByLabelText("Tesis"), "plant-1");
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/^\/shift-report\?/)));
    const path = apiGet.mock.calls.map(([item]) => item).find((item) => item.startsWith("/shift-report?"));
    const params = new URL(path, "http://localhost").searchParams;
    expect(params.get("plantId")).toBe("plant-1"); expect(params.get("date")).not.toBeNull(); expect(params.get("asOf")).not.toBeNull();
  });
});
