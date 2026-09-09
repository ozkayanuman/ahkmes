# Audit ve onay matrisi

Bu belge, 2026-08-01 kaynak incelemesinde doğrulanan gerçek durumu gösterir.
Sertifikasyon veya elektronik imza uyumluluğu iddiası değildir.

| İşlem | Mevcut kayıt | Bütünlük durumu | Kapanması gereken açık |
|---|---|---|---|
| Genel HTTP POST/PATCH/DELETE | `AuditInterceptor`, immutable `AuditLog` | Yanıt sonrasında ayrı yazılır; mutasyonla atomik değildir | Kritik command service transaction'ında audit/outbox yazımı |
| Lot kabul/karantina/red | `lots` / `STATUS_CHANGE` audit kaydı | Karar ve audit aynı transaction'da yazılır; CoC numarası kontrol edilir | Karar gerekçesi ve CoC belgesi policy'si |
| Quality plan ve muayene kaydı | `quality-plans` / `inspections` transaction-içi audit | QualityPlan/Inspection kaydı ve audit aynı transaction'da yazılır; plan satırı toleransı muayenede zorlanır | NCR oluşturma ve plan revizyonu için tüm as-built zincirin tek transaction sınırı |
| CAPA onaya gönderme/karar | `ApprovalRequest`, CAPA status ve transaction-içi audit | Talep+durum+audit aynı transaction'da; **karar artık `AuthService.reauthenticate()` ile yeniden kimlik doğrulama gerektirir** (transaction dışında, bağımsız DB kontrolü), kanıt (`reauthenticatedAt`/`reauthSource`) audit'in `after` alanına yazılır; bildirim commit sonrasıdır | Güvenilir bildirim/outbox (AHK-009 kapsamı) |
| MRP satın alma/üretim önerisi kararı | `ApprovalRequest`, proposal, PO/WO ve transaction-içi audit | Talep+durum+audit ile karar+PO/WO+öneri durumu+audit tek transaction'da; **karar artık reauth gerektirir**, kanıt audit'e yazılır | Idempotency, güvenilir bildirim/outbox (AHK-009 kapsamı) |
| Satın alma teslimi/tüketim/mamul girişi/transfer/sevkiyat/sayım | Transaction-içi `inventory-movements` audit + immutable stok hareketi; sayım oluşturma/post kayıtları | Hareket, bakiye projeksiyonu, hareket audit kaydı ve sayımın oluşturan/post eden aktörü aynı transaction'da | Command-level audit ve integration event atomik sınırı |
| Kullanıcı/rol/izin değişikliği | Global audit | Parola/rol verisi denetlenir; hassas alan maskeleme politikası yok | Alan bazlı maskeleme, break-glass ve erişim gözden geçirmesi |

## Elektronik onay için minimum politika

1. Onay isteği, hedef entity'nin değişmez sürüm/snapshot hash'ini saklamalıdır.
2. Karar veren kullanıcı kendi talebini onaylayamaz veya reddedemez; ayrı onaylayan kuralı uygulanır.
3. Kritik kararlar için gerekçe, yeniden kimlik doğrulama ve zaman damgası zorunlu olmalıdır.
4. Domain değişimi, karar kaydı, audit kaydı ve yayınlanacak event aynı transaction'da yazılmalıdır.
5. Bildirim/entegrasyon teslimi transaction dışına yalnızca transactional outbox üzerinden çıkmalıdır.

## Öncelikli uygulama sırası

1. ~~CAPA ve MRP onay akışlarını transaction-içi karar API'sine taşı.~~ Tamamlandı.
2. ~~Kritik stok/kalite command'leri için transaction-içi audit yazıcısı ekle.~~ Tamamlandı (lot/quality-plan/inspection/inventory-movement).
3. ~~ApprovalRequest'e policy, snapshot ve imza/re-auth kanıt alanlarını ekle.~~ Snapshot/hash zaten vardı; **AHK-006 ile CAPA ve MRP proposal kararlarına reauth zorunluluğu eklendi** (`ApprovalsService.approve/reject`'in `reauth` parametresi, `capa.service.ts`/`mrp.service.ts` çağıranları).
4. Transactional outbox ile bildirim ve Integration Gateway yayınını ayır (ayrı kritik madde, AHK-009).
5. Kalan açık: alan bazlı hassas veri maskeleme/break-glass (kullanıcı/rol audit'i), genel `AuditInterceptor`'ın istek-sonrası (non-atomic) yazım modeli — outbox işi tamamlanınca yeniden değerlendirilmeli.
