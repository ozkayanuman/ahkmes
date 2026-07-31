import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setTokens } from "../lib/api";

/** Backend'in /auth/oidc/:id/callback'i buraya URL fragment (#) ile token
 * taşıyarak yönlendirir — fragment sunucuya hiç gitmez (bkz. backend
 * OidcAuthController yorumu), sadece burada tarayıcıda okunur. */
export function OidcCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");
    const errorMsg = params.get("error");

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
