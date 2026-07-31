# i18n (TR/EN) Devir Notu — Codex için

> Bu dosya, Claude'un 2026-07-31 oturumunda başlattığı Multi-Currency +
> i18n işinin (Faz P, commit `2ff883b`) devamını Codex'e devretmek için
> yazıldı. Kalan iş bittiğinde bu dosya silinebilir/PLAN.md'ye taşınabilir.

## Ne bitti (commit `2ff883b`, push edildi)

### Multi-Currency (tamamen bitti)
- `Quote`/`SalesOrder`'da zaten var olan `currency` alanı hiçbir create
  formunda seçilemiyordu (gerçek boşluk, keşfedildi) — `quotes.tsx` ve
  `purchase-orders.tsx` create formlarına para birimi seçici eklendi.
- `PurchaseOrder`, `Invoice`, `SupplierInvoice` modellerine `currency`
  alanı eklendi (migration `20260731184043_faz_p_currency_and_locale`).
  `Invoice`/`SupplierInvoice` parent `SalesOrder`/`PurchaseOrder`'dan
  miras alır (kullanıcı seçmez — tutarsızlık riski yok).
- `ar.service.ts`/`ap.service.ts` `summary()` artık `customerId`/
  `supplierId` + `currency` ile grupluyor — önceden farklı kurlardaki
  faturalar sessizce toplanıp yanıltıcı bir tutar üretiyordu.
- `ar.tsx`/`ap.tsx` özet tablolarına "Para Birimi" kolonu + `fmtMoney`
  eklendi.

### i18n altyapısı (tamamen bitti, sayfa çevirisi HARİÇ)
- `react-i18next` + `i18next` kuruldu: `apps/web/src/lib/i18n.ts`.
- **Çeviri key deseni:** anahtar, kodda zaten var olan Türkçe metnin
  KENDİSİ (örn. `t("Kaydet")`). Yeni bir isim uzayı icat etmeye gerek
  yok — `apps/web/src/locales/tr.json` boş `{}` (Türkçe zaten fallback),
  `apps/web/src/locales/en.json` her Türkçe key'i İngilizce'ye eşler.
- `User.locale`/`User.timezone` alanları eklendi (aynı migration),
  varsayılan `"tr"`/`"Europe/Istanbul"`. JWT payload'ına eklendi
  (`common/types.ts` `JwtPayload`/`AuthUser`).
- `PATCH /auth/me` — herhangi bir kullanıcı (ADMIN gerekmez) kendi
  locale/timezone'unu değiştirebilir (`auth.controller.ts`/
  `auth.service.ts` `updateProfile()`), yeni token çifti döner.
- `apps/web/src/components/language-switcher.tsx` — sidebar'daki dil
  değiştirme butonu, hem yerel `i18n.changeLanguage()` hem
  `PATCH /auth/me` çağırır.
- `apps/web/src/lib/auth.tsx` — `AuthProvider` artık kullanıcı
  yüklendiğinde/login olduğunda `i18n` dilini `user.locale`'e senkronlar
  (`applyUserLocale` helper'ı).

### Tam çevrilen sayfalar (referans/örnek olarak kullanılabilir)
- `apps/web/src/components/layout.tsx` — sidebar nav (her sayfada
  görünür), `NAV_GROUPS`'taki `group.label`/`item.label` değerleri
  `t()` ile sarılı (nav-groups.ts'in kendisi DEĞİŞTİRİLMEDİ — Türkçe
  metin zaten anahtar olarak kullanılıyor).
- `apps/web/src/pages/login.tsx` — tam çevrildi.

## Ne HENÜZ bitmedi — asıl kalan iş

`apps/web/src/pages/` altında **53 sayfa** var, bunlardan sadece
`login.tsx` tam çevrildi. `quotes.tsx`/`purchase-orders.tsx`'e sadece
currency seçici eklendi, metinleri ÇEVRİLMEDİ. Aşağıdaki listedeki
HEPSİ (login.tsx hariç) `useTranslation()` import edip her kullanıcıya
görünen string'i `t("...")` ile sarmalı, yeni ortaya çıkan Türkçe
metinleri `apps/web/src/locales/en.json`'a İngilizce karşılığıyla
eklemeli:

```
alarms.tsx, andon.tsx, ap.tsx, ar.tsx, audit-log.tsx,
automation-gateway.tsx, calibrations.tsx, capa.tsx, customers.tsx,
cycle-counts.tsx, dashboard.tsx, digital-twin.tsx, energy.tsx,
genealogy.tsx, hierarchy.tsx, inspections.tsx, labor.tsx, launchpad.tsx,
leads.tsx, lots.tsx, machines.tsx, maintenance-orders.tsx, materials.tsx,
mrp.tsx, non-conformances.tsx, oidc-callback.tsx, parts.tsx,
permission-groups.tsx, production.tsx, project-detail.tsx, projects.tsx,
purchase-order-detail.tsx, purchase-orders.tsx, quote-detail.tsx,
quotes.tsx, recipes.tsx, reports.tsx, rfq.tsx, sales-order-detail.tsx,
sales-orders.tsx, scheduling.tsx, serial-numbers.tsx, service-tickets.tsx,
shift-report.tsx, spc.tsx, suppliers.tsx, transfer-orders.tsx, users.tsx,
warehouses.tsx, webhooks.tsx, work-order-detail.tsx, work-orders.tsx
```

Ayrıca `apps/web/src/components/` altındaki **paylaşılan bileşenler**
de (özellikle `crud-page.tsx` — birçok sayfanın liste/form UI'sini
üretiyor, `"Yeni"`, `"Sil"`, `"Düzenle"`, `"Ara…"`, `"Kayıt yok"` gibi
sabit metinler içeriyor) çevrilmeli; bunu çevirmek muhtemelen en yüksek
kaldıraçlı adım çünkü CrudPage kullanan onlarca sayfayı aynı anda
etkiler. `components/status.tsx` (StatusBadge etiketleri) ve
`components/ui.tsx` da kontrol edilmeli.

## Nasıl devam edilir (desen)

1. Dosyayı aç, `useTranslation` import et: `import { useTranslation } from "react-i18next";`
2. Component içinde `const { t } = useTranslation();`
3. JSX'teki her Türkçe literal string'i `{t("Aynı Türkçe Metin")}` ile
   sar (attribute'larda `title={t("...")}` gibi). **Metni değiştirme**
   — anahtar birebir mevcut Türkçe metin olmalı.
4. Interpolasyon gereken yerlerde (örn. `${name} ile giriş yap`)
   i18next `{{degisken}}` sözdizimini kullan — `login.tsx`'teki
   `t("{{name}} ile giriş yap", { name: p.name })` örneğine bak.
5. Her yeni anahtarı `apps/web/src/locales/en.json`'a İngilizce
   karşılığıyla ekle (`tr.json`'a dokunmaya gerek yok, boş kalabilir).
6. Bir grup sayfa bitince: `npx tsc --noEmit` (web) + `npx vitest run`
   çalıştır, sonra commit'le (tek dev commit yerine birkaç sayfalık
   partiler halinde commit atmak daha güvenli — bu oturumda da öyle
   yapıldı).
7. Docker'da gerçek smoke test: `docker compose up -d --build web`
   sonrası tarayıcıda sidebar'daki dil butonuna basıp sayfaların
   İngilizce'ye geçtiğini doğrula.

## Referans commit'ler
- `2ff883b` — bu devrin dayandığı altyapı commit'i (i18n kurulumu + 2 örnek sayfa)
- `df1091e`, `82eea2f` — SSO/OIDC (ilgisiz ama aynı oturumda, JWT payload'ı OIDC login akışını da etkiliyor — `oidc-auth.service.ts` `issueTokens()` çağrısı locale/timezone parametresi bekliyor, unutma)
