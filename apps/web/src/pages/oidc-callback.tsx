import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setTokens } from "../lib/api";

/** Backend'in /auth/oidc/:id/callback'i (normal giriş) VE /auth/oidc/:id/reauth/callback'i
 * (CAPA/MRP gibi kritik kararlar için yeniden kimlik doğrulama) buraya URL fragment (#) ile
 * token taşıyarak yönlendirir — fragment sunucuya hiç gitmez. Reauth akışı bir popup
 * penceresinde açılır (bkz. reauth-modal.tsx): `reauthToken`/`error` varsa ve bu sayfa bir
 * popup'sa (window.opener dolu), token'ı postMessage ile açan pencereye taşıyıp kendini
 * kapatır — normal login akışı (accessToken/refreshToken, tam sayfa navigasyon) değişmeden
 * kalır. */
export function OidcCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");
    const reauthToken = params.get("reauthToken");
    const errorMsg = params.get("error");

    if (window.opener && (reauthToken || errorMsg)) {
      window.opener.postMessage(
        { type: "ahkmes:oidc-reauth", reauthToken: reauthToken ?? undefined, error: errorMsg ?? undefined },
        window.location.origin,
      );
      window.close();
      return;
    }

    if (errorMsg) {
      setError(errorMsg);
      return;
    }
    if (!accessToken || !refreshToken) {
      setError("Giriş bilgileri alınamadı");
      return;
    }
    setTokens(accessToken, refreshToken);
    window.location.href = "/";
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      {error ? (
        <div className="text-center">
          <p className="text-red-600">{error}</p>
          <button className="mt-4 text-sm text-blue-600 underline" onClick={() => navigate("/login")}>
            Giriş sayfasına dön
          </button>
        </div>
      ) : (
        <p className="text-slate-500">Giriş yapılıyor…</p>
      )}
    </div>
  );
}
