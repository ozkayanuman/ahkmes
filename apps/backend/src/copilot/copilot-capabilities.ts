export interface CopilotCapability {
  id: string;
  page: string;
  title: string;
  route: string;
  keywords: string[];
  recommendation: string;
  nextStep: string;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/** The system's explicit, reviewable knowledge boundary for the deterministic copilot. */
export const COPILOT_CAPABILITIES: CopilotCapability[] = [
  { id: "work-order.create", page: "work-orders", title: "İş emri oluşturma", route: "/work-orders", keywords: ["iş emri", "üretim emri", "work order"], recommendation: "Parça, miktar, hedef tarih ve rota uygunluğunu kontrol ederek iş emri taslağı hazırlayın.", nextStep: "Parça ve miktarı belirtin.", risk: "HIGH" },
  { id: "production.record", page: "production", title: "Üretim kaydı", route: "/production", keywords: ["üretim", "operasyon başlat", "parça üret", "run"], recommendation: "Aktif iş emri, operasyon sırası, makine ve operatör uygunluğunu doğrulayın.", nextStep: "İş emri ve operasyonu belirtin.", risk: "HIGH" },
  { id: "material.create", page: "materials", title: "Malzeme tanımlama", route: "/materials", keywords: ["malzeme", "çelik", "alüminyum", "material"], recommendation: "Kod mükerrerliğini kontrol edip tip, birim ve lot/sertifika politikasını tamamlayın.", nextStep: "Malzeme kodu, tipi ve birimini belirtin.", risk: "LOW" },
  { id: "part.create", page: "parts", title: "Parça tanımlama", route: "/parts", keywords: ["parça tanımla", "ürün tanımla", "part"], recommendation: "Parça numarası, adı, birim ve izlenebilirlik politikasını doğrulayın.", nextStep: "Parça numarası ve adını belirtin.", risk: "LOW" },
  { id: "inventory.review", page: "warehouses", title: "Stok ve depo işlemleri", route: "/warehouses", keywords: ["stok", "depo", "raf", "envanter"], recommendation: "Hareket defteri, bin bakiyesi ve lot kabul durumunu kontrol edin.", nextStep: "Malzeme/parça ve depo konumunu belirtin.", risk: "MEDIUM" },
  { id: "lot.trace", page: "lots", title: "Lot kabul ve izlenebilirlik", route: "/lots", keywords: ["lot", "heat", "coc", "sertifika", "izlenebilirlik"], recommendation: "Lotun kabul durumu, heat/CoC bilgisi ve ileri-geri soy ağacını inceleyin.", nextStep: "Lot numarasını belirtin.", risk: "HIGH" },
  { id: "quality.inspect", page: "inspections", title: "Muayene ve kalite planı", route: "/inspections", keywords: ["muayene", "kontrol", "tolerans", "kalite planı", "ölçüm"], recommendation: "Aktif kalite planı satırını, ölçüm zorunluluğunu ve toleransı seçin.", nextStep: "İş emri ve kontrol noktasını belirtin.", risk: "HIGH" },
  { id: "quality.ncr", page: "non-conformances", title: "Uygunsuzluk kaydı", route: "/non-conformances", keywords: ["uygunsuzluk", "ncr", "hata", "red"], recommendation: "Uygunsuzluk türü, iş emri, lot ve ilk aksiyonu taslakta bağlayın.", nextStep: "İş emri ve bulguyu belirtin.", risk: "HIGH" },
  { id: "quality.capa", page: "capa", title: "CAPA", route: "/capa", keywords: ["capa", "düzeltici faaliyet", "kök neden"], recommendation: "Kaynak uygunsuzluk, kök neden ve aksiyon planını taslakta toplayın.", nextStep: "Kaynak NCR ve başlığı belirtin.", risk: "HIGH" },
  { id: "planning.mrp", page: "mrp", title: "MRP planlama", route: "/mrp", keywords: ["mrp", "ihtiyaç plan", "satın alma öneri", "planlama"], recommendation: "Talep, mevcut stok ve onay bekleyen önerileri kontrol edin.", nextStep: "Planlama ufkunu veya ilgili parçayı belirtin.", risk: "HIGH" },
  { id: "purchase.order", page: "purchase-orders", title: "Satın alma", route: "/purchase-orders", keywords: ["satın alma", "sipariş ver", "po", "tedarik"], recommendation: "Tedarikçi, malzeme, miktar, lot kabul ve fiyat bilgisini doğrulayın.", nextStep: "Tedarikçi ve malzeme satırlarını belirtin.", risk: "HIGH" },
  { id: "sales.order", page: "sales-orders", title: "Satış siparişi", route: "/sales-orders", keywords: ["satış siparişi", "müşteri siparişi", "teslimat"], recommendation: "Müşteri, satırlar, teslim tarihi ve stok/üretim durumunu kontrol edin.", nextStep: "Müşteri ve sipariş satırlarını belirtin.", risk: "HIGH" },
  { id: "quote.create", page: "quotes", title: "Teklif", route: "/quotes", keywords: ["teklif", "fiyat teklifi", "quotation"], recommendation: "Müşteri, fiyat, termin ve revizyonu taslakta hazırlayın.", nextStep: "Müşteri ve teklif satırlarını belirtin.", risk: "MEDIUM" },
  { id: "machine.monitor", page: "machines", title: "Tezgah izleme", route: "/machines", keywords: ["makine", "tezgah", "cnc", "smec", "m80"], recommendation: "Makine durumu, bağlantı tipi ve ilgili alarmları kontrol edin.", nextStep: "Makineyi veya alarmı belirtin.", risk: "MEDIUM" },
  { id: "maintenance.order", page: "maintenance-orders", title: "Bakım emri", route: "/maintenance-orders", keywords: ["bakım", "kalibrasyon", "arıza", "preventif"], recommendation: "Makine, bakım türü, tarih ve üretim etkisini değerlendirin.", nextStep: "Makine ve bakım türünü belirtin.", risk: "HIGH" },
  { id: "recipe.route", page: "recipes", title: "Rota ve reçete", route: "/recipes", keywords: ["rota", "reçete", "operasyon sırası", "nc program"], recommendation: "Revizyon, operasyon sırası ve makine atamalarını gözden geçirin.", nextStep: "Parça ve rota revizyonunu belirtin.", risk: "HIGH" },
  { id: "reports.review", page: "reports", title: "Raporlama", route: "/reports", keywords: ["rapor", "oee", "verim", "performans"], recommendation: "Rapor dönemi, tesis/makine ve ölçümleri seçin.", nextStep: "Rapor türü ve tarih aralığını belirtin.", risk: "LOW" },
  { id: "integration.gateway", page: "webhooks", title: "Entegrasyon ve webhook", route: "/webhooks", keywords: ["entegrasyon", "webhook", "erp", "sap", "logo", "netsis"], recommendation: "Veri sahipliği, event sözleşmesi ve teslim hata politikasını doğrulayın.", nextStep: "Hedef sistemi ve veri yönünü belirtin.", risk: "HIGH" },
];
