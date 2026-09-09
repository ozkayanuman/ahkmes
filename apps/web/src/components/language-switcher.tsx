import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiPatch } from "../lib/api";
import { setAppLocale } from "../lib/i18n";
import { useAuth } from "../lib/auth";

/** Dil değişimi hem yerel i18n durumunu (anında UI güncellensin) hem de
 * User.locale'i (PATCH /auth/me, kalıcı tercih + yeni token) günceller —
 * sonraki girişte tercih hatırlanır. */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const { applyTokens } = useAuth();

  async function toggle() {
    const next = i18n.language === "en" ? "tr" : "en";
    setAppLocale(next);
    try {
      const tokens = await apiPatch<{ accessToken: string; refreshToken: string }>("/auth/me", { locale: next });
      await applyTokens(tokens.accessToken, tokens.refreshToken);
    } catch {
      // Sunucuya kaydedilemese bile yerel dil değişimi (i18n.changeLanguage)
      // zaten uygulanmıştır — kullanıcı deneyimi kesintiye uğramaz, sadece
      // tercih bir sonraki girişte hatırlanmayabilir.
    }
  }

  return (
    <button
      onClick={toggle}
      title={i18n.language === "en" ? t("Türkçe'ye geç") : t("İngilizce'ye geç")}
      className="mb-1 flex w-full items-center justify-center rounded-md py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"
    >
      <Languages className="h-4 w-4 shrink-0" />
      <span className="sr-only">{i18n.language === "en" ? "EN" : "TR"}</span>
    </button>
  );
}
