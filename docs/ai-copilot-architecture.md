# Kontrollü AI Copilot sözleşmesi

## Uygulanan ilk dilim

`POST /copilot/drafts` JWT ve `copilot` sayfa yetkisi ister. Sağlayıcı gerektirmeyen
deterministic parser, malzeme tanımlama niyetindeki kodları çıkarır, yalnızca çağıranın
tenant'ında mükerrer kontrolü yapar ve eksik `type`/`unit` alanlarıyla taslak döndürür.
Endpoint kalıcı kayıt veya mutasyon yapmaz; `executionAllowed=false` zorunludur.

Deterministic capability catalog; iş emri/üretim, malzeme-parça, stok/depo,
lot/CoC, kalite/NCR/CAPA, MRP, satın alma, satış/teklif, makine/bakım,
rota, raporlama ve entegrasyon akışlarını kapsar. Katalogdan dönen her öneri,
kullanıcının sayfa yetkisiyle filtrelenir ve ilgili ekran, risk seviyesi ve
toplanması gereken sonraki bilgiyi verir. Yeni modül eklendiğinde capability
kataloğuna açıkça eklenmelidir; modelin serbestçe var olmayan işlem uydurmasına
izin verilmez.

Copilot doğrudan SQL, Prisma veya dış ERP bağlantısı kullanmaz. Model yalnızca
niyet/alan çıkarır; uygulama command registry doğrulama, tenant, rol, lisans,
idempotency, audit ve gerekiyorsa approval kontrolünü uygular.

Akış: `prompt → taslak command → eksik alanlar → kullanıcı onayı → application
service/API → transaction-içi audit → sonuç`. Stok, kalite, finans, iş emri
serbest bırakma ve üretim kararları varsayılan olarak onay gerektirir. Cloud
model, private model ve air-gapped yerel model aynı command sözleşmesini kullanır.

İlk güvenli kapsam salt-okunur öneriler ve taslak oluşturmadır; mutasyon tool'u
ancak command gateway, imza/re-auth policy ve transaction-içi audit tamamlanınca açılır.
