import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import tr from "../locales/tr.json";
import en from "../locales/en.json";

/**
 * Faz P: TR/EN i18n. Çeviri "key"leri, kodda zaten var olan Türkçe metinlerin
 * KENDİSİDİR — bu sayede t("Kaydet") gibi çağrılar hem Türkçe için (kaynak
 * dosyası olmadan bile) fallback olarak çalışır hem de en.json sadece bu
 * anahtarları İngilizce'ye eşler. Yeni bir "key isim uzayı" icat etmek yerine
 * mevcut metni doğrudan anahtar olarak kullanmak, ~60 sayfadaki yüzlerce
 * hardcoded string'i çevirirken anahtar isimlendirme yükünü ortadan kaldırır.
 */
i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
  },
  lng: localStorage.getItem("ahkmes.locale") ?? "tr",
  fallbackLng: "tr",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

export function setAppLocale(locale: string) {
  localStorage.setItem("ahkmes.locale", locale);
  i18n.changeLanguage(locale);
}

export default i18n;
