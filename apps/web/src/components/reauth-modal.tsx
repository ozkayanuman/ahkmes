import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, Modal } from "./ui";
import { useAuth } from "../lib/auth";
import { apiPost } from "../lib/api";

interface ReauthModalProps {
  open: boolean;
  onClose: () => void;
  /** LOCAL/LDAP kullanıcılar için düz şifre, OIDC kullanıcılar için IdP'den
   * dönen kısa ömürlü imzalı reauth kanıtı — ikisi de backend'de aynı
   * `password` DTO alanına gider (bkz. AuthService.reauthenticate). */
  onConfirm: (password: string) => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
}

/** CAPA/MRP gibi kritik onay/red kararları öncesi elektronik imza için
 * paylaşılan reauth modalı. Kullanıcının authSource'una göre LOCAL/LDAP için
 * şifre input'u, OIDC için IdP popup akışı gösterir (bkz. PLAN.md AHK-006
 * frontend keşfi — backend zaten her iki kanıt türünü de kabul ediyor). */
export function ReauthModal({ open, onClose, onConfirm, busy, error }: ReauthModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [oidcError, setOidcError] = useState<string | null>(null);
  const [oidcBusy, setOidcBusy] = useState(false);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setOidcError(null);
      setOidcBusy(false);
    }
  }, [open]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; reauthToken?: string; error?: string } | undefined;
      if (!data || data.type !== "ahkmes:oidc-reauth") return;
      setOidcBusy(false);
      if (data.error) {
        setOidcError(data.error);
        return;
      }
      if (data.reauthToken) {
        void onConfirm(data.reauthToken);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onConfirm]);

  if (!open || !user) return null;

  const isOidc = user.authSource === "OIDC";

  async function startOidcReauth() {
    if (!user?.oidcProviderId) {
      setOidcError(t("Bu kullanıcı hiçbir OIDC sağlayıcısına bağlı değil"));
      return;
    }
    setOidcError(null);
    setOidcBusy(true);
    // Popup engelleyicilerin bloklamaması için pencere click handler'ı içinde
    // senkron açılıyor (about:blank); gerçek IdP URL'i async apiPost sonrası
    // gelince pencereye yazılıyor (bkz. login.tsx'teki tam-sayfa yönlendirme
    // deseninin aksine — burada oturum kaybetmeden geri dönmemiz gerekiyor).
    const popup = window.open("about:blank", "ahkmes-oidc-reauth", "width=480,height=640");
    popupRef.current = popup;
    try {
      const { url } = await apiPost<{ url: string }>(`/auth/oidc/${user.oidcProviderId}/reauth/authorize`, {});
      if (popup) popup.location.href = url;
      else window.location.href = url;
    } catch {
      setOidcBusy(false);
      setOidcError(t("Yeniden kimlik doğrulama başlatılamadı"));
      popup?.close();
    }
  }

  function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    void onConfirm(password);
  }

  return (
    <Modal open={open} title={t("Kimliğinizi doğrulayın")} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          {t("Bu kritik karar için elektronik imza (kimlik doğrulama) gerekiyor.")}
        </p>
        {isOidc ? (
          <div className="space-y-2">
            <Button type="button" className="w-full" disabled={oidcBusy || busy} onClick={startOidcReauth}>
              {oidcBusy || busy ? t("Bekleniyor…") : t("IdP ile yeniden doğrula")}
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={onClose}>
              {t("Vazgeç")}
            </Button>
            {oidcError && <p className="text-sm text-red-600">{oidcError}</p>}
          </div>
        ) : (
          <form onSubmit={onPasswordSubmit} className="space-y-4">
            <div>
              <Label htmlFor="reauth-password">{t("Şifre")}</Label>
              <Input
                id="reauth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("Vazgeç")}
              </Button>
              <Button type="submit" disabled={busy || !password}>
                {busy ? t("Doğrulanıyor…") : t("Onayla")}
              </Button>
            </div>
          </form>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
