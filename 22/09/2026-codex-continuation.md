# 2026-09-25 — Claude Devam Kaydı

Claude'un `claude23.09.2026.md` aktarımı incelendi. Oradaki P0/P1 dilimleri
tamamlanmıştı; çalışma ağacında tamamlanmamış somut iş tedarikçi–malzeme kaynak
ilişkisiydi.

Bu oturumda tamamlananlar:

- `SupplierMaterial` API'si, tenant/kaynak doğrulaması ve ADMIN/PLANNER yazma
  yetkisiyle tedarikçi–malzeme eşleştirmesi sağlar.
- Bir malzeme için birden fazla tercihli kaynak oluşmasını engelleyen PostgreSQL
  partial unique index eklendi. Kaynak güncelleme/silme işlemleri denetim
  kaydına yazılır; istekte olmayan opsiyonel alanlar artık mevcut değeri silmez.
- MRP, bir satınalma önerisindeki bütün eksik malzemelerin ortak tercihli
  tedarikçisi varsa bunu öneriye önceden bağlar. Kaynaklar ayrışıyorsa otomatik
  seçim yapmaz; karar onayda kullanıcıya kalır.
- Tedarikçiler ekranına malzeme kaynakları paneli eklendi: ekleme/güncelleme,
  termin, birim maliyet, tercihli kaynak ve kaldırma akışı kullanılabilir.

Doğrulama:

- Hedef backend testleri: 14/14 geçti (`SupplierMaterialsService`, `MrpService`).
- Backend ve web `typecheck`, shared-types `build` geçti.
- `git diff --check` yalnız önceden beklenen CRLF uyarılarını verdi.
- Prisma `validate/generate` schema-engine ikilisi indirilemediği için bu
  makinede ağ çıkışı reddedildi; Docker/PostgreSQL entegrasyonu kullanıcı
  talimatına uygun olarak çalıştırılmadı.
- `graphify update .` Windows erişim hatasıyla tamamlanamadı.

Hiçbir commit veya push yapılmadı.

## 2026-09-25 devamı

- MRP talep tahmini eklendi. Plan bazında tamamlanmış satış siparişi satırlarını
  son 1-24 ay için basit hareketli ortalamayla önizler; kullanıcı öneriyi tek tek
  bağımsız talebe dönüştürmeden MRP verisini değiştirmez.
- CAPA kapatma kapısı derinleştirildi. Onaylanmış CAPA, açıklayıcı etkinlik kanıtı
  ve doğrulayan kullanıcı/zaman kaydı olmadan kapatılamaz. Doğrulama ve denetim
  izi aynı transaction içinde yazılır.
- Seri numarası ve lot QR etiket/yazdırma ile tarayıcıdan arama zinciri yeniden
  doğrulandı. Seri trace 7/7, lot kabul/iade/müşteri izi 6/6 hedef test geçti.
- CAPA hedef testi 8/8, backend ve web typecheck geçti. Prisma validate bu
  makinede eksik schema-engine indirmek için ağ erişimine ihtiyaç duyduğundan
  çalıştırılamadı; Docker/PostgreSQL başlatılmadı.
- CAPA etkinlik doğrulaması ayrıca koşullu güncellemeyle yarış koşuluna karşı
  korundu: ikinci paralel doğrulama kaydın kanıtını değiştiremez.
- Tam backend test paketi bu oturum aracında paralel child-process izni ve
  çıktı aktarımı sorunları nedeniyle kesin özet üretemedi; hedef CAPA, MRP,
  tedarikçi-malzeme, seri ve lot testleri geçti. Web Vitest süreci de bu
  makinede test başlatıcısında ilerlemeden kaldı; yalnızca bu oturumun başlattığı
  süreç durduruldu. Web typecheck geçti.
- graphify update, Windows erişim hatası nedeniyle graph çıktısını yenileyemedi.
