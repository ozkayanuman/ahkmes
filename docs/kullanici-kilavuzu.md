# AHKMES Kullanıcı Kılavuzu

## 1. Roller ve Yetkiler

| Rol | Yetki Kapsamı |
|---|---|
| ADMIN | Tüm modüller, kullanıcı yönetimi, tag/connector konfigürasyonu |
| PLANNER | Teklif/iş emri/satınalma planlama, kalite kaydı oluşturma |
| FOREMAN | Üretim takibi, iş emri atama, kalite kaydı oluşturma/kapatma |
| OPERATOR | Operasyon ekranı, üretim adedi girişi, kalite kaydı oluşturma |

## 2. Ana Modüller

### 2.1 İş Emri Yönetimi
Teklif → İş Emri → Üretim akışını yönetir. İş emri detay sayfasında malzeme tüketimi, mamul girişi ve **OEE (Kalite×Performans)** özeti görüntülenir.

> OEE'nin Performance bileşeni yalnızca ilgili parçada "İdeal Çevrim Süresi" (saniye) tanımlıysa hesaplanır; tanımlı değilse "Veri yok" gösterilir — sahte bir sayı üretilmez.

### 2.2 Operasyon Takibi
Operatörler bu ekrandan üretim koşusu başlatır, üretilen/hurda adedini girer. **Açık bir kalite (uygunsuzluk) kaydı varken üretim adedi girişi engellenir** — önce kaydı kapatmak gerekir.

### 2.3 Kalite (Non-Conformance)
- Yeni Kayıt: iş emri, hata tipi, açıklama ve aksiyon tipi (Genel/Hurda/Yeniden İşlem/Bloke) girilir.
- Açık kayıtlar kırmızı rozetle gösterilir; kapatmak için "Kapat" butonu kullanılır.
- Bir iş emrinde açık kayıt varken o iş emrinde üretim adedi girilemez (bkz. Operasyon Takibi).

### 2.4 Tezgahlar ve Automation Gateway
- **Tezgahlar**: makine tanımı, canlı durum rozeti (Çalışıyor/Boşta/Alarm/Bağlı değil), aktif iş emri atama, connector anahtarı üretme.
- **Automation Gateway**: bir makineye bağlı "tag"leri (adres+değer) tanımlama ve canlı izleme. OPC-UA bağlantılarda tag'ler otomatik keşfedilebilir; M80 gibi bağlantılarda elle tanımlanır.

### 2.5 Dashboard
İş emri durum dağılımı, aktif iş emirleri, bekleyen teklifler, kritik stok, son üretim koşuları özet olarak gösterilir.

## 3. Sık Sorulan Sorular

**S: Üretim adedi girişi neden "Bu iş emrinde açık bir uygunsuzluk kaydı var" diyor?**
C: İlgili iş emrinde kapatılmamış bir kalite kaydı var. Kalite ekranından kaydı inceleyip "Kapat" butonuyla çözümleyin.

**S: OEE neden "Veri yok" gösteriyor?**
C: İlgili parçada "İdeal Çevrim Süresi" alanı boş. Parça kaydını düzenleyip bu değeri (saniye cinsinden) girin.

**S: Automation Gateway'de tag değeri hiç güncellenmiyor.**
C: İlgili makine için bir connector sürecinin (OPC-UA/M80 adaptörü) çalışıyor ve doğru `MACHINE_KEY` ile backend'e bağlı olduğundan emin olun.
