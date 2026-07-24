import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, getTokens, setTokens } from "./api";

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe("api istemcisi — token yenileme akışı", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setTokens("eski-access", "gecerli-refresh");
  });

  it("başarılı istekte gövdeyi döner ve Authorization başlığı gönderir", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "1" }));

    await expect(api("/customers")).resolves.toEqual({ id: "1" });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer eski-access");
  });

  it("401 alınca refresh eder, yeni token'ı saklar ve isteği tekrarlar", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, null)) // ilk deneme
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: "yeni-a", refreshToken: "yeni-r" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "1" })); // tekrar

    await expect(api("/customers")).resolves.toEqual({ id: "1" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getTokens()).toEqual({ access: "yeni-a", refresh: "yeni-r" });
    // Tekrarlanan istek yenilenmiş token'ı taşımalı
    const [, retryInit] = fetchMock.mock.calls[2];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe("Bearer yeni-a");
  });

  it("refresh de başarısızsa token'ları siler ve logout olayı yayar", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, null))
      .mockResolvedValueOnce(jsonResponse(401, null)); // refresh reddedildi

    const onLogout = vi.fn();
    window.addEventListener("ahkmes:logout", onLogout);

    await expect(api("/customers")).rejects.toBeInstanceOf(ApiError);

    expect(onLogout).toHaveBeenCalled();
    expect(getTokens()).toEqual({ access: null, refresh: null });
    window.removeEventListener("ahkmes:logout", onLogout);
  });

  it("409 gibi hatalarda gövdesiyle ApiError fırlatır (durum çakışması mesajı için)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { message: "Geçersiz durum geçişi" }));

    await expect(api("/quotes/1/status")).rejects.toMatchObject({
      status: 409,
      body: { message: "Geçersiz durum geçişi" },
    });
  });
});
