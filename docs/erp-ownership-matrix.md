# ERP / MES veri sahipliği sözleşmesi

Bu belge hedef ERP seçilmeden kullanılacak nötr Integration Gateway sözleşmesidir.
Bir müşteri için SAP, Canias, Logo, Netsis, Dynamics veya özel ERP adaptörü ancak
bu matrisin sorumlusu, yönü ve mutabakat kuralı onaylandıktan sonra eklenir.

| Veri / işlem | Sistem sahibi | Gateway yönü | Mutabakat / çakışma kuralı |
|---|---|---|---|
| Kullanıcı, rol, tenant ve yetki | AHKMES Platform | AHKMES → ERP (gerektiğinde) | ERP kimliği yalnızca eşleme anahtarıdır; AHKMES yetkisini değiştiremez. |
| Makine, canlı durum, çevrim, OEE | AHKMES MES | AHKMES → ERP | Edge olayı immutable eventId ile taşınır; ERP'den makine komutu kabul edilmez. |
| İş emri yürütümü, operasyon ve as-built kayıt | AHKMES MES | Çift yönlü, açık sözleşme ile | ERP plan iş emri açabilir; MES gerçekleşen statüyü döner. Aynı alan için iki yazıcı olamaz. |
| Malzeme kartı, tedarikçi, müşteri | `NEEDS_DECISION` | Seçilen sahip → diğer sistem | İlk adaptörde tek sistem master olur; eşleme tablosu dış kimlik + sürüm tutar. |
| Stok hareketi, lot, heat number, CoC | AHKMES MES/Quality (pilot) | AHKMES → ERP | Hareketler append-only ledger olarak gönderilir; ERP düzeltmesi yeni ters hareket üretir. |
| Satınalma siparişi ve fatura | `NEEDS_DECISION` | Seçilen sahip → diğer sistem | MRP önerisi AHKMES'te kalabilir; PO oluşturma sahibi müşteri entegrasyon kararında sabitlenir. |
| Kalite, NCR, CAPA, ölçüm ve kalibrasyon | AHKMES Quality | AHKMES → ERP (özet) | Denetim kaydı ve elektronik onay AHKMES'te kaynak kayıttır; ERP yalnızca referans alır. |
| Finans, muhasebe, e-fatura | Harici ERP | ERP → AHKMES (özet) | AHKMES finansal muhasebe kaynağı olmaz; yalnızca operasyonel maliyet görünümü tutar. |

## Gateway sözleşmesi

- Her giden olay, kalıcı teslim kaydı, olay türü, tenant kimliği, değişmez olay
  zarfı ve tekrar denemeye dayanıklı bir kimlik taşır.
- Her gelen mesaj `sourceSystem + externalMessageId` ile inbox dedup kontrolünden
  geçmelidir; handler yalnızca doğrulanmış application command çağırır.
- Olay şemaları sürümlenir (`eventType`, `schemaVersion`); kırıcı değişiklik yeni
  olay türü veya yeni sürümle yapılır.
- Retry, idempotency ve dead-letter teknik hata çözümüdür; iş kuralı çakışması
  otomatik yazılmaz, mutabakat iş listesine gider.
- ERP adapter'ı uygulama veritabanına doğrudan SQL yazmaz. REST/mesaj/API portu
  kullanır ve tüm mutation'lar AHKMES audit/approval politikasından geçer.

## Hedef ERP seçimi için karar kaydı

İlk adaptör uygulanmadan önce aşağıdakiler müşteri bazında kayda bağlanmalıdır:

1. Hedef ERP, sürüm, on-prem/cloud erişim modeli ve desteklenen API şekli.
2. Her master-data alanı için kesin sahip ve ilk yükleme yönü.
3. İş emri, stok ve satınalma için hata/çakışma çözüm sorumlusu.
4. Mesaj hacmi, gecikme hedefi, bakım penceresi ve air-gapped aktarım yöntemi.
5. UAT veri seti, mutabakat raporu ve geri dönüş planı.
