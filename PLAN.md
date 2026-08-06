# AHKMES — Doğrulanmış Ürün ve Teknik Yol Haritası

> **Plan durumu:** 2026-08-03 tarihinde `4fb7840` devralma teslimi üzerinde kaynak
> kod, Prisma şeması/migration'lar, Graphify sorgusu, Git geçmişi ve seçili gerçek
> PostgreSQL doğrulamaları tekrar karşılaştırıldı.
> Bu bölüm normatif, güncel plandır. Aşağıdaki tarihsel plan/günlük korunmuştur;
> ancak oradaki checkbox ve tarihsel iddialar tek başına güncel durum kanıtı değildir.

## 1. Ürün vizyonu ve sınırlar

AHKMES, önce iki Mitsubishi M80 kontrollü SMEC MCV-5500 tezgâhın bulunduğu CNC
atölyesinde güvenilir biçimde kullanılacak modüler bir üretim platformudur. Uzun
vadede KOBİ'ler ve savunma sanayii tedarikçileri için MES/MOM, MRP/MRP II ve
seçilmiş ERP yetenekleri sunabilir; kısa vadede SAP, Opcenter veya Canias'ı
taklit etmeye çalışmaz.

Ürün iki ayrı kullanım biçimini desteklemelidir: başka ERP kullanan müşteriler
için ERP-bağımsız MES ve seçilen AHKMES ticari modüllerini kullanan işletmeler
için entegre operasyon platformu. Oracle/SAP/Logo/Netsis/Dynamics ile
**entegrasyon**, bu sistemlerin veya Oracle'ın AHKMES'in uygulama veritabanı
olması anlamına gelmez.

İlk resmî veritabanı PostgreSQL'dir. MSSQL ayrı test edilmiş bir ürün varyantı
olmadan desteklenmiş sayılmaz. Cloud, private cloud, on-premise ve air-gapped
kurulumlar ayrı dağıtım/sürümleme kararları gerektirir.

### Standart durum anahtarı

| Durum | Anlamı |
|---|---|
| `VERIFIED_DONE` | Kaynakta mevcut, bu incelemede build/type-check ve uygun testlerle doğrulandı. |
| `PARTIAL` | Çalışan bir bölüm var; ürün/süreç gereksinimini eksiksiz karşılamıyor. |
| `PROTOTYPE` | İskelet, simülatör veya görsel/proof-of-concept; üretim taahhüdü değildir. |
| `NOT_STARTED` | Kaynakta bulunmuyor. |
| `BLOCKED` | Harici bilgi, cihaz, karar veya erişim olmadan güvenle ilerleyemez. |
| `NEEDS_DECISION` | İşletme/ürün sahibinin bağlayıcı tercihi gerekir. |

## 2. Mevcut sistemin doğrulanmış özeti

- **Mimari:** `pnpm` monorepo içinde modüler NestJS monoliti, React SPA ve ayrı
  edge connector paketi. `AppModule` 69 kaynak modülünü bir süreçte
  birleştirir; servisler Prisma'ya doğrudan erişir. Genel repository/port
  katmanı yoktur.
- **Uygulama:** Tek tenant için satır bazlı `tenantId` filtreleri kullanan,
  JWT/LDAP/OIDC girişli, REST + Socket.IO uygulamasıdır. Gerçek çoklu tenant
  yönetimi veya PostgreSQL RLS yoktur.
- **Veri:** Prisma 5 / PostgreSQL 16, 52 forward-only migration; MinIO doküman deposu;
  Docker Compose ile PostgreSQL + MinIO + backend + web, opsiyonel connector.
- **Doğrulama:** Bu devralmada shared DTO testleri (18), backend/web typecheck,
  backend/web production build, Prisma validate ve gerçek PostgreSQL üzerinde
  MES tooling E2E (9) geçti. Tüm monorepo/e2e paketi bu incelemede yeniden
  koşturulmadığından geçmiş sayıların tamamı yeniden doğrulanmış sayılmaz.
- **Graphify:** Mevcut graph üzerinde sorgu, `AppModule`, auth/page guard,
  product entitlement, connector ve UI route'larını çapraz bağımlılık merkezleri
  olarak doğruladı. Graph çıktısı mimari keşif aracıdır; kararlar gerçek
  kaynak/test kanıtına dayanır.

## 3. Teknoloji yığını

| Katman | Doğrulanmış teknoloji | Durum / not |
|---|---|---|
| Uygulama | Node.js, TypeScript, NestJS 10, REST, Socket.IO | `VERIFIED_DONE`; modüler monolit. |
| Arayüz | React 18, Vite 5, TanStack Query, Tailwind | `VERIFIED_DONE`; tek SPA, route/page guard var. |
| Veri | Prisma 5, PostgreSQL 16 | `VERIFIED_DONE`; PostgreSQL'e özgü migration ve triggerlar var. |
| Dosya | MinIO, signed download URL, MIME allowlist | `VERIFIED_DONE`; belge ilişkileri polimorfik. |
| Makine edge | Node/TypeScript, MachineAdapter, OPC-UA, M80 TCP, simulator | `PARTIAL`; gerçek M80 doğrulanmadı. |
| Kimlik | Local bcrypt + JWT refresh, LDAP, OIDC | `PARTIAL`; teknik akış mevcut, kurum politikaları/operasyonel hardening eksik. |
| Teslim | Docker Compose, Dockerfile, GitHub Actions | `PARTIAL`; air-gap/Kubernetes/observability paketi yok. |

## 4. Modül envanteri

| Modül | Gerçek durum | Kanıt / kaynakla doğrulanan kapsam |
|---|---|---|
| Platform Core | `PARTIAL` | `apps/backend/src/auth/auth.service.ts`, `common/guards/pages.guard.ts`, `platform-modules/*`, `approvals/*`, `audit.interceptor.ts`, `prisma/schema.prisma`: JWT/RBAC, page permission, entitlement, audit, onay ve hiyerarşi var; tenant sınırı global zorlanmıyor. |
| MES Core | `PARTIAL` | İş emri, immutable rota operasyonları, makine atama/WIP, manuel üretim, OEE ve vardiya görünümü; PUBLISHED NC ve tooling setup start-gate'i vardır. Genel dispatch, operatör yetkinliği ve kalite kapısı eksik. |
| PLM / CNC release | `PARTIAL` | `NcProgram` checksum, revizyon, Draft→Review→Approved→Published→Superseded/Archived, effectivity ve yayın kontrolü vardır. Genel controlled-document/ECO lifecycle ayrı eksiktir. |
| CNC tooling / fixture | `PARTIAL` | Tool/component/assembly/physical instance, makine uyumluluğu, requirement, rezervasyon, immutable setup snapshot ve HMI start-gate doğrulandı. Fixture bakım/kalibrasyon politikası uygulama dilimi sürüyor; presetter, offset ve DNC yok. |
| Machine Connect / AGW | `PARTIAL` | Makine anahtarı, telemetri, tag CRUD/değerleri, simulator, OPC-UA ve deneysel M80. |
| Quality | `PARTIAL` | NCR, inspection, CAPA, SPC, alarm, kalibrasyon. Kontrollü doküman/deviation/e-imza eksik. |
| Inventory / Warehouse | `PARTIAL` | Material, depo/bin, lot, serial, transfer ve sayım; immutable hareket defteri ile toplam/bakiye projeksiyonları transaction içinde tutulur. Heat/CoC/kabul ve zorunlu lot politikası vardır; karantina rafı/ölçümle bağ henüz yoktur. |
| Planning / MRP | `PARTIAL` | Tek seviyeli BOM, netleme, satın alma/üretim önerisi, manuel Gantt. |
| MRP II / Capacity | `NOT_STARTED` | Sonlu kapasite, rota süresi, alternatif kaynak, ATP/CTP yok. |
| Maintenance | `PARTIAL` | Planlı/düzeltici bakım, runtime saat ve enerji manuel/temel. |
| Integration Gateway | `PARTIAL` | `apps/backend/src/webhooks/*`, `prisma/schema.prisma` (`WebhookDeliveryEvent`): HMAC webhook, retry/DLQ/replay ve CSV export var; genel inbox, ERP adapter ve mapping yok. |
| Reporting / Analytics | `PROTOTYPE` | Dashboard, OEE ve sınırlı CSV; metrik/tracing/veri ambarı yok. |
| AI Copilot | `PROTOTYPE` | `apps/backend/src/copilot/*`, `apps/web/src/pages/copilot.tsx`: yetki-bağlı taslak/öneri var; model sağlayıcısı, kalıcı approval ve mutation tool yok. |
| ERP yardımcı modülleri | `PARTIAL` | RFQ/teklif/satış, teslimat/fatura, AR/AP, CRM, proje, servis talebi. Genel muhasebe değildir. |

## 5. Çalışan özellikler

- `VERIFIED_DONE` — Temel kartlar, teklif/RFQ, satış siparişi, iş emri,
  satın alma, malzeme tüketimi, üretim koşusu ve mamul girişi ile uçtan uca
  temel akış kaynakta ve testlerde vardır.
- `VERIFIED_DONE` — BOM temelli basit net MRP, onay talepleri ve satın alma/
  üretim önerisine dönüşüm vardır. Bu, kapasite planlama değildir.
- `VERIFIED_DONE` — Depo/bin, lot, seri no, transfer ve sayım ekran/API'leri;
  lot/seri için QR oluşturma ve temel backward/forward trace sorguları vardır.
- `VERIFIED_DONE` — NCR, muayene FAIL ve SPC limit dışı durumda NCR açılması,
  CAPA, kalibrasyon, bakım ve alarm kayıtları vardır.
- `VERIFIED_DONE` — Connector olay kimliğiyle telemetri tekrar-koruması,
  bounded bellek kuyruğu ve üstel geri çekilme vardır.
- `VERIFIED_DONE` — Local/LDAP/OIDC giriş, JWT, rol ve sayfa erişim kontrolleri
  vardır; `AuditLog` tablosunda update/delete'i engelleyen PostgreSQL triggerı
  vardır.
- `VERIFIED_DONE` — GitHub Actions backend, connector ve web type-check/test
  job'larını çalıştırır.

## 6. Kısmen çalışan özellikler

- `PARTIAL` — Audit interceptor yalnızca tanımlı rota/model eşleşmelerini
  kapsar; route map birçok yeni modülü içermediğinden tüm iş mutasyonları audit
  kapsamına girmez. Audit yazma hatası isteği başarısız kılmaz ve yalnızca
  console'a yazılır.
- `VERIFIED_DONE` — Material lotunda heat, tedarikçi lotu, CoC numarası ve
  kabul/karantina/red durumu saklanır. Kabul edilmemiş lot teslim/tüketime
  giremez; zorunlu lot politikası ve iş emri düzeyinde as-built bağ doğrulandı.
  As-inspected ölçüm bağı ve fiziksel karantina rafı henüz yoktur.
- `PARTIAL` — Aktif Recipe, iş emrine revizyonu ve adım parametreleriyle
  immutable operasyon snapshot'ı olarak kopyalanır. Operasyon makine ataması,
  sıralı başlatma ve koşulardan türetilen WIP vardır; CNC operasyonunda
  PUBLISHED NC ve tooling setup doğrulaması zorlanır. Yetkin operatör, genel
  kalite kapısı ve alternatif kaynak yoktur.
- `VERIFIED_DONE` — `InventoryMovement` immutable hareket defteri stok
  değişiminin kaynağıdır. `Material.stockQty`, `PartStock.qty` ve
  `StockBalance` transaction içi projeksiyonlardır; satın alma, tüketim/madde
  iadesi, mamul, sevkiyat, transfer ve sayım bu sınırdan geçer. Eski toplamlar
  kaybolmadan `UNASSIGNED` başlangıç bakiyesine taşınır.
- `PARTIAL` — Webhook teslimi imzalı ve SSRF'e karşı korunmuştur; subscription
  delivery event'i, retry, DLQ ve replay vardır. Ancak tüm domain mutasyonları
  için transaction-içi outbox ve harici consumer inbox dedup yoktur.
- `PARTIAL` — OEE, enerji, bakım ve çizelgeleme gerçek iş verisini kullanır;
  ancak otomatik enerji, güvenilir duruş sınıflaması ve sonlu kapasite yoktur.

## 7. İskelet/prototip özellikler

- `PROTOTYPE` — `FanucAdapter`, `MachineAdapter` sözleşmesini gösterir fakat
  gerçek FOCAS2 çağrısı yapmaz ve bağlanırken açıkça hata verir.
- `PROTOTYPE` — M80 adapter TCP/EZSocket-GIOP varsayımına ve yerel simülatöre
  karşı testlidir. Gerçek M80 Custom API variable listesi, kablo formatı ve
  güvenilir olay semantiği sahada doğrulanmamıştır.
- `PROTOTYPE` — OPC-UA gerçek istemci API'sini kullanır ve simülatörde testlidir;
  gerçek CNC/umati server, sertifika ve tag sözleşmesi doğrulanmış değildir.
- `PROTOTYPE` — Digital Twin fiziksel yerleşim ve makine bağlantısı
  görselleştirmesidir; gerçek zamanlı tesis modeli veya simülasyon değildir.
- `PROTOTYPE` — Raporlar CSV export ile sınırlıdır; analitik platform değildir.

## 8. Henüz geliştirilmemiş özellikler

- Çok tenant şirket/fabrika izolasyonu, tenant provisioning, RLS ve tenant
  yönetim yaşam döngüsü.
- İş merkezi kapasitesi, operatör yetkinliği, genel kalite kapısı ve dispatching.
- Çok seviyeli/alt montaj BOM, alternate material/supplier, lead-time ve
  capacity-aware MRP II.
- Tüm domain komutlarına transactionally bağlanan outbox/inbox ve entegrasyon
  idempotency sözleşmeleri.
- SAP/Logo/Netsis/Dynamics/Oracle adapterleri, canonical event modeli ve veri
  sahipliği kuralları.
- AI Copilot command gateway, taslak/onay, tool izinleri, model sağlayıcı
  seçimi ve lokal model dağıtımı.
- Edition/limit lisanslama, müşteri/kurulum paketleme ve entitlement dışındaki
  feature-flag kapsamı.
- MSSQL ürünü, Oracle uygulama veritabanı desteği, Kubernetes/air-gap bundle,
  gözlemlenebilirlik ve felaket kurtarma orkestrasyonu.

## 9. Bilinen teknik borçlar

- `AppModule`, ortak `schemas.ts` ve büyük sayfa bileşenleri (özellikle
  work-order detail) yüksek merkezlilik/çok sorumluluk gösterir; Graphify bu
  düğümleri ayırma adayı olarak işaretler.
- `PrismaService` doğrudan domain servislerine enjekte edilir; repository/port
  sınırı ve uygulama command katmanı yoktur.
- Birçok document/audit ilişkisi `entityType/entityId` ile polimorfiktir; DB
  foreign key bütünlüğü ve tek tip erişim politikası yoktur.
- CI build job'ı çalıştırmıyor; CI type-check ve test yapıyor, production build
  doğrulaması bu incelemede yerelde yapıldı.
- Lint script'i veya biçim/bağımlılık/supply-chain kontrolü tanımlı değildir.
- Dokümanlar kod gerisindedir: README Faz 0/Faz 1 anlatımında kalmış, kurulum
  rehberi connector Compose profilini eski biçimde anlatmış, entegrasyon
  rehberi webhook ve hata formatını eksik anlatmıştır.

## 10. Kritik mimari riskler

1. **Tenant izolasyonu:** Uygulama katmanında artık Prisma Client Extension +
   AsyncLocalStorage ile zorunlu (bkz. AHK-017, `VERIFIED_DONE`). Kalan artık
   risk: tam PostgreSQL RLS yok — `$queryRaw`/harici script/DB-doğrudan erişim
   uygulama katmanını atlayabilir; cloud çok-kiracılı varyant için ayrı RLS
   ADR'si gerekir. `MEDIUM` (önceki `CRITICAL`'dan düşürüldü).
2. **Legacy lokasyon doğruluğu:** eski toplamlarla uzlaştırılan `UNASSIGNED`
   bakiye fiziksel sayımla gerçek rafa taşınmalıdır. `HIGH`.
3. **Rota kapsamı:** operasyon snapshot/WIP çekirdeği vardır; ancak setup,
   takım/program, kalite kapısı ve kaynak kapasitesi olmadan gerçek CNC
   planlama/dispatch güvenilir değildir. `HIGH`.
4. **M80 saha doğrulaması yok:** simülatör başarısı gerçek tezgâh entegrimi
   anlamına gelmez. `HIGH`.
5. **Audit kapsam/başarısızlık davranışı:** immutable tablo tam audit trail
   garantisi sağlamaz. `HIGH`.
6. **Dayanıklı olaylaşma yok:** webhook/socket yan etkileri DB transaction'ı
   dışında kaybolabilir. `HIGH`.
7. **İzlenebilirlik boşlukları:** heat/sertifika/revizyon/as-built ilişkileri
   savunma sanayii denetimi için yetersizdir. `HIGH`.
8. **Deployment operasyonu:** yalnız Compose, PostgreSQL-only backup ve
   MinIO/DR/izleme eksikliği üretim toparlanmasını riske atar. `HIGH`.
9. **Entegrasyon sahipliği belirsiz:** ERP ve MES aynı stok/iş emri verisini
   yazarsa çift kayıt/çatışma oluşur. `HIGH`.
10. **Güvenlik olgunluğu:** CORS geniş, rate-limit/merkezî log/metric/SBOM/
    secret rotasyonu kanıtı yok; OIDC ve webhook network politikaları ürün
    politikasıyla tamamlanmalıdır. `HIGH`.

## 11. Güvenlik ve uyumluluk açıkları

Mevcut güçlü temel: bcrypt, JWT yenileme token hash'i, rol/sayfa guard'ları,
LDAP/OIDC sırlarının şifrelenmiş saklanması, machine key hash'i, webhook/OIDC
SSRF savunması, imzalı webhook, MIME allowlist ve immutable `AuditLog` triggerı.

Henüz `VERIFIED_DONE` değildir: IEC 62443 yaşam döngüsü/zon-konduit tasarımı,
ISO 9001/AS9100 süreç kanıtı, elektronik imza anlamı ve re-authentication,
değişiklik kontrolü, denetim kayıt bütünlüğünün uçtan uca kapsamı, retansiyon
uygulaması, key rotation, erişim denetimi, güvenlik olay izleme, zafiyet/SBOM
yönetimi. Bu standartlar hedef olarak yazılabilir; sertifikasyon iddiası yapılamaz.

## 12. Domain modelindeki eksikler

- Organization/Company/Fabrication site yapısı tenant'tan ayrı ve bağlayıcı
  değildir; Plant > Area > Workplace > Unit yalnız fiziki hiyerarşidir.
- Recipe kaynak rota tanımı ve WorkOrderOperation snapshot/status/WIP vardır;
  OperationDefinition, resource requirement, setup, takım/program ve kalite
  kapısı eksiktir.
- Material masterda grade/form ve supplier approval yoktur. Heat/CoC ve kabul
  statüsü material lotunda tutulur; CoC dosyasını karar anında zorunlu
  bağlayan kontrollü iş akışı henüz yoktur.
- Lot/serial kaydı vardır fakat seri birimi, ölçüm, NCR, rework, sevkiyat ve
  as-built doküman ilişkileri zorunlu/kapsamlı değildir.
- Doküman, NC programı, teknik resim ve recipe için controlled release,
  effective date, approval/e-sign ve iş emrine revision snapshot yoktur.
- Quality plan, ölçüm cihazı, tolerans planı, deviation/waiver ve rework route
  yoktur; calibration yalnız makine merkezlidir.

## 13. On-premise/cloud/air-gapped stratejisi

| Dağıtım | Mevcut durum | Gerekli karar / iş |
|---|---|---|
| Tek şirket on-premise | `PARTIAL` | Docker Compose, PostgreSQL/MinIO ve connector profili çalışır; reverse proxy, TLS, yedek/restore tatbikatı ve network segmentasyonu tamamlanmalı. |
| Private cloud | `NOT_STARTED` | İmaj registry, secret yönetimi, TLS/ingress, monitoring, tenant stratejisi ve yükseltme prosedürü gerekir. |
| Public cloud multi-tenant | `NOT_STARTED` | Tenant/RLS, data partitioning, lisans, SLO, izolasyon ve uyum çalışması ön koşuldur. |
| Air-gapped | `NOT_STARTED` | İmzalı offline image/package bundle, SBOM, dependency mirror, lisansın offline doğrulanması, patch/backup prosedürü gerekir. |
| Fabrika edge | `PARTIAL` | Connector ayrı süreçtir; DMZ/zone-conduit, outbound-only bağlantı, sertifika/device identity ve store-and-forward kalıcılığı yoktur. |

## 14. PostgreSQL/MSSQL/Oracle yaklaşımı

- **PostgreSQL:** Tek resmî ve doğrulanmış uygulama veritabanı. Prisma datasource
  PostgreSQL'dir; migration'lar PostgreSQL triggerı, array/JSON ve PostgreSQL
  davranışlarına dayanır.
- **MSSQL:** `NOT_STARTED`. Önce portability assessment, desteklenen Prisma
  özellik matrisi, migration alternatifleri ve tamamen ayrı CI matrix gerekir.
  "Prisma kullanılıyor" MSSQL desteği kanıtı değildir.
- **Oracle ERP:** `NOT_STARTED` entegrasyon hedefidir. Integration Gateway,
  API/file/message adapter veya müşteri kontrollü DB read model üzerinden
  konuşmalıdır; Oracle'ı AHKMES transaction veritabanı yapma kararı ayrı ve
  çok daha büyük bir ürün varyantıdır.

## 15. Integration Gateway yol haritası

1. Canonical contract: `WorkOrder`, `Operation`, `Material`, `InventoryBalance`,
   `Lot`, `QualityEvent`, `ProductionDeclaration` sahiplik ve yön matrisi.
2. Transactional outbox + inbox/idempotency + retry/dead-letter/replay.
3. Yönetilebilir connector/adapter SDK'sı: REST, CSV/SFTP ve message broker;
   webhook mevcut MVP'nin yerini değil, dış event transportunu tamamlar.
4. İlk seçilecek ERP için sadece dar pilot: master data inbound, iş emri inbound,
   üretim/kalite/stock hareketi outbound; mutabakat ve hata ekranı zorunlu.
5. Oracle için DB driver varsayımı yerine müşteri ERP'nin desteklediği API/
   message/file sözleşmesiyle adapter kararı.

## 16. AI Copilot mimarisi ve güvenlik kuralları

AI Copilot `NOT_STARTED` durumundadır. İlk sürüm doğrudan SQL, Prisma veya
connector erişimi almayacaktır. Copilot yalnız sürümlenmiş application command
tanımlarını çağırabilir: ör. `materials.proposeCreate`, `workOrders.proposeRelease`.

Her tool için şunlar zorunludur: kullanıcı/tenant bağlamı, RBAC+page izni,
schema validation, idempotency key, dry-run/taslak sonucu, fark görünümü,
etki/risk sınıflaması, gerekli ikinci onay, command/audit kaydı ve insanın
onayından sonra servis katmanı üzerinden yürütme. Kritik stok, kalite, finans,
üretim ve entegrasyon işlemleri varsayılan olarak approval ister. Model
sağlayıcısı (cloud/private/local) plug-in sınırında seçilmeli; air-gapped yerel
model için model paketi, GPU/CPU sınırı ve veri saklama politikası ayrıca tasarlanmalıdır.

## 17. Modül ve lisanslama stratejisi

Feature flag veya lisans altyapısı kaynakta yoktur. Önce modül sınırları API
yetkilerinden ayrı bir `Entitlement`/feature policy ile tanımlanmalıdır:
Platform Core, MES Core, Machine Connect, Quality, Inventory, Planning/MRP,
MRP II, Maintenance, Integration Gateway, Reporting/Analytics, AI Copilot ve
ERP eklentileri. Lisans doğrulaması uygulamanın güvenlik kararını tek başına
belirlememeli; on-premise/offline grace, audit ve destek prosedürü iş kararıdır.

## 18. Test ve kalite stratejisi

- Her domain kuralı: servis birim testi; transaction/integrity akışı: izole
  PostgreSQL e2e testi; UI kritik akışı: React test + Playwright smoke.
- Connector: protocol fixture/simülatör testine ek olarak gerçek M80 hardware
  acceptance paketi ve kayıtlı anonim telemetry replay testleri.
- CI: type-check + testin yanına production build ve Prisma migration fresh-db
  e2e doğrulaması eklendi. Lint/format, dependency/vulnerability ve container
  scan hâlâ eklenmelidir.
- Integration/AI: contract test, idempotency/retry/dead-letter ve authorization
  matrix testleri zorunlu.
- Uyum: traceability/audit retention ve restore drill kanıtı sürümlü test
  artefaktı olarak tutulmalı; test sonucu sadece plan notu olmamalıdır.

## 19. Aşamalı ürün yol haritası

| Faz | Hedef | Çıkış kriteri |
|---|---|---|
| 0 | Doğrulama ve borç görünürlüğü | Bu planın backlog'u, CI build/e2e ve belge tutarlılığı tamam. |
| 1 | Kendi atölyesi için MES Essentials | Rota/operasyon, stok tek doğrusu, temel kabul/izlenebilirlik ve günlük operasyon akışı canlı. |
| 2 | Gerçek operasyon ve traceability | Revision snapshot, lot/heat/sertifika, WIP ve operasyon bazlı hareketler. |
| 3 | Quality / savunma kayıt altyapısı | Quality plan, ölçüm cihazı, NCR/CAPA/deviation/rework ve kontrollü kayıt/onay. |
| 4 | Mitsubishi M80 pilotu | İzole ağda iki SMEC üzerinde hardware acceptance, güvenli edge ve rollback. |
| 5 | ERP Integration Gateway | Outbox/inbox ve tek ERP ile sahiplik tanımlı dar pilot. |
| 6 | MRP II / capacity | Çok seviyeli plan, kaynak/rota süreleri ve kapasite senaryoları. |
| 7 | Kontrollü AI Copilot | Command gateway, taslak/onay/audit ve seçilmiş düşük risk tool'lar. |
| 8 | Multi-tenant cloud / paketleme | Tenant isolation, entitlements, cloud/on-prem/air-gap release varyantları. |
| 9 | Genişletilmiş ERP | Önce gerçek müşteri ihtiyacıyla seçilmiş finans/servis/CRM genişletmeleri. |

## 20. Öncelikli backlog ve bir sonraki geliştirme adımı

| ID | Başlık | Modül | Durum | Öncelik | Bağımlılık / risk | Kabul kriteri | Test | Boyut | Faz |
|---|---|---|---|---|---|---|---|---|---|
| AHK-001 | Plan/README/rehber tutarlılığı | Platform | `PARTIAL` | P0 | Stale belge yanlış kurulum/ürün beklentisi doğurur | README, kurulum ve entegrasyon rehberi güncel modül/connector/error/webhook durumunu açıkça belirtir | Link/komut smoke | S | 0 |
| AHK-002 | Yerel izole e2e + CI build gate | Platform | `VERIFIED_DONE` | P0 | Gerçek DB'ye test koşturulması riskli; CI build eksik | `pnpm test:e2e` host portu/kalıcı volume olmadan PostgreSQL, MinIO ve LDAP ile migration+seed+e2e çalıştırır; CI backend/web production build ve fresh-db migration e2e koşar. İzole e2e başlangıç timeout'u 20 sn olarak düzeltildi; 19 paket/126 test temiz ortamda geçti. | Yerel Docker e2e, build/type-check/lint ve test kanıtı | M | 0 |
| AHK-003 | Stok tek doğrusu ve movement ledger | Inventory | `VERIFIED_DONE` | P0 | Eski verinin fiziksel lokasyonu bilinmeyebilir | Her stok değişimi immutable hareket üretir; toplam/balance tutarlılık testi geçer. Legacy miktar `UNASSIGNED` başlangıç hareketiyle korunur. | Transaction/e2e | XL | 1 |
| AHK-004 | Rota ve WorkOrderOperation çekirdeği | MES | `VERIFIED_DONE` | P0 | Setup/kalite kapısı/kapasite sonraki işlere bırakıldı | Aktif Recipe revizyonu/adımları iş emrine immutable snapshot olarak kopyalanır; operasyon sırası, makine ataması ve koşu temelli WIP korunur. | Type-check, build, unit ve fresh-db e2e | XL | 1 |
| AHK-005 | Traceability foundation | Quality/Inventory | `VERIFIED_DONE` | P0 | Karantina rafı ve CoC dosyasının sertifika numarasıyla zorunlu eşleştirilmesi ileri iştir | Material lot heat/CoC/kabul durumu; kabul edilmemiş lot stoğa/tüketime girmez, zorunlu lot bağlantısı ve as-built trace korunur | Fresh-db E2E/replay | XL | 2 |
| AHK-006 | Audit coverage ve elektronik onay tasarımı | Platform/Quality | `VERIFIED_DONE` | P0 | ApprovalRequest oluşturma ve kararları (CAPA, MRP satın alma/üretim önerisi), CAPA/MRP'nin çağırdığı aynı transaction içinde audit yazar; bildirim commit sonrasındadır. **Kritik kararlar artık `AuthService.reauthenticate()` ile transaction dışında yeniden kimlik doğrulama gerektirir** (`ApprovalsService.approve/reject`'in `reauth` parametresi), kanıt (`reauthenticatedAt`/`reauthSource`) audit'in `after` alanına yazılır — PLM NC onayının zaten uyguladığı deseni CAPA/MRP'ye genelleştirdi. **OIDC kullanıcıları için de artık mümkün:** `OidcAuthService.reauthorizeUrl`/`handleReauthCallback` (`prompt=login` ile IdP'de zorunlu yeniden interaktif giriş) kısa ömürlü imzalı bir reauth kanıtı üretir, `AuthService.reauthenticate` bunu doğrular — önceden bu dal her zaman 401 dönüyordu. Ortak `InventoryService` sınırı, satın alma teslimi/tüketim-iade/mamul/transfer/sevkiyat/sayım hareketini kendi transaction'ında auditler. Lot kabulü ile QualityPlan/Inspection de kendi transaction'ında audit yazar. Kaynakla doğrulanmış açıklar `docs/audit-matrisi.md` içindedir. | Genel `AuditInterceptor`'ın istek-sonrası (transaction dışı) yazım modeli ve alan bazlı hassas veri maskeleme/break-glass kapsam dışı bırakıldı — güvenilir teslim outbox'ı gerektirir (AHK-009). **Keşfedilen ayrı P0 açık:** web UI'da (`capa.tsx`/`mrp.tsx`) onay/red butonları `password` alanı olmadan boş body gönderiyor — zorunlu `password` şeması yüzünden backend muhtemelen her zaman 400 dönüyor, reauth modalı (LOCAL/LDAP şifre input'u + OIDC "IdP ile yeniden doğrula" popup'ı) frontend'de hiç yok. | Unit (18+7 yeni OIDC reauth, capa/mrp/approvals/auth/oidc-auth spec'leri) + fresh PostgreSQL E2E (`test/approval-reauth.e2e-spec.ts`: yanlış şifre 401, doğru şifre + audit kanıtı, eksik şifre 400) | L | 2-3 |
| AHK-007 | M80 keşif ve hardware acceptance | Machine Connect | `PARTIAL` | P0 | Simülatörle read-only contract, event/tag, bağlantı kesilmesi ve otomatik yeniden bağlanma doğrulandı; M80 API dokümanı, IP/ağ erişimi ve bakım penceresi gerçek saha kabulü için gerekir. Prosedür `docs/m80-hardware-acceptance.md` içinde hazır | Gerçek iki tezgâhta protocol contract, read-only pilot, event doğruluk ve rollback kanıtı | Simulator + hardware acceptance | L | 4 |
| AHK-008 | Güvenli factory edge | Machine Connect | `PARTIAL` | P1 | Kalıcı event kuyruğu disk üzerinde atomic rename ile eklendi; Docker profilinde adlandırılmış volume'a bağlandı ve simülasyon testleriyle doğrulandı. Makine anahtarı bcrypt hash olarak saklanır; connector yalnızca loopback sağlık/Prometheus metric ucu açar ve Docker healthcheck ile denetlenir. Karşılıklı cihaz sertifikası, sertifika yenileme, outbound TLS zorlaması ve merkezi metric toplama eksik | Kalıcı kuyruk, device identity, outbound-only TLS ve health/metrics | Fault-injection | L | 4 |
| AHK-009 | Outbox/inbox ve DLQ | Integration Gateway | `PARTIAL` | P1 | Kalıcı webhook teslim outbox'ı, claim, retry, DLQ ve admin replay endpoint'i (mevcuttu). **Genel `OutboxEvent` modeli + `OutboxService.record(tx, ...)` (sadece `Prisma.TransactionClient` alır, transaction dışı kullanım derleme zamanında engellenir) + `OutboxDispatcherService` (claim+backoff, WebhooksService ile aynı desen) eklendi — CAPA onay/red kararı (`CapaService.decide`) kanıt akışı olarak buna göç etti: `capa.updated` artık domain yazımıyla AYNI transaction'da outbox'a yazılır, dispatcher'ı ayrı bir worker'da en-az-bir-kez tüketip `RealtimeGateway.emitToTenant`'a çevirir.** `RealtimeGateway.emitToTenant`'ı çağıran kalan ~29 yer (MRP, iş emri, non-conformance, purchasing vb.) ve `ApprovalsService.notifyDecision`→`NotificationsService.notifyUser` yolu hâlâ transaction dışı fire-and-forget'tir — backlog. Gelen mesaj inbox dedup yok. | Kalan ~29 `emitToTenant` çağrı yerinin outbox'a göçü, notification yazımının transaction-içi hale getirilmesi, consumer inbox dedup | Unit (`capa.service.spec.ts`) + fresh PostgreSQL E2E (`test/outbox-durability.e2e-spec.ts`: dispatcher durdurulunca event PENDING kalır/kaybolmaz, manuel tetiklenince DISPATCHED + emitToTenant tam 1 kez) | XL | 5 |
| AHK-010 | ERP ownership matrix + ilk adapter | Integration Gateway | `NEEDS_DECISION` | P1 | Hedef ERP ve master-data sahibi seçilmeden adapter kodlanamaz. Hedeften bağımsız sahiplik/sözleşme matrisi `docs/erp-ownership-matrix.md` içinde hazır | Seçilen ERP için mapping, mutabakat ve hata yönetimiyle dar pilot | Contract/UAT | L | 5 |
| AHK-011 | MRP II / finite capacity | Planning | `PARTIAL` | P1 | Kapasite hazırlık endpoint/ekranı makine yükünü, atanmamış ve bloke operasyonları gösterir; standart süre, vardiya, bakım takvimi ve alternatif kaynak modeli olmadığı için finite schedule üretmez | Alternatif kaynak, süre, kapasite takvimi ve senaryo sonucu | Algorithm/e2e | XL | 6 |
| AHK-012 | Quality plan/deviation/rework | Quality | `PARTIAL` | P1 | Tenant kapsamlı QualityPlan/QualityPlanCheck modeli, migration, yetkili API ve muayene ekranı eklendi. Plan satırı seçildiğinde ölçüm zorunluluğu/toleransı sunucuda zorlanır; tolerans dışı ölçüm FAIL ve NCR üretir. Kontrollü revizyon, satırları kopyalar, eski planı pasifleştirir ve geçmiş muayene bağını korur. Cihaz kalibrasyon bağı, deviation onayı, rework route ve as-built akışı henüz yok. Sınır `docs/quality-plan-roadmap.md` içinde | Kontrol planı, cihaz, deviation onayı ve rework route as-built kayda bağlıdır | Unit + e2e/UAT | XL | 3 |
| AHK-013 | AI command gateway | AI Copilot | `PROTOTYPE` | P1 | Yetkili `/copilot/drafts` API'si ve ekranı, kullanıcının sayfa yetkisine göre iş emri/üretim, stok-lot, kalite, MRP, satın alma/satış, tezgah-bakım, rota, raporlama ve entegrasyon yeteneklerini eşleştirir; malzeme kaydında tenant içi mükerrer ve eksik alan taslağı vardır. Model sağlayıcısı, kalıcı draft/approval kaydı ve mutation tool'u yok; `executionAllowed=false` zorlanır | Taslak, policy, onay ve audit olmadan hiçbir mutation tool çalışmaz | Unit/security/contract | XL | 7 |
| AHK-014 | Tenant module entitlement foundation | Platform | `VERIFIED_DONE` | P0 | `TenantModuleEntitlement` katalog varsayılanlarını korur; admin PATCH atomik değişiklik + transaction-içi audit yazar. `PagesGuard` kapalı modülün backend endpoint'ini engeller, SPA aynı API ile görsel geri bildirim verir. Eşzamanlı aynı-state isteklerde tek audit kaydı E2E ile doğrulandı. Genel tenant izolasyonu bu işin parçası değildir; AHK-017'de ayrı ele alınır. | Migration + unit/guard + fresh PostgreSQL E2E: tenantId enjeksiyonu, RBAC, kapat/aç, audit ve concurrency geçer | M | 0 |
| AHK-018 | Downtime/Andon taksonomisi | MES | `PARTIAL` | P1 | `DowntimeReason` (tenant-scoped kod/kategori kataloğu, AlarmDefinition ile aynı desen) + `DowntimeEvent` (açık/kapalı yaşam döngülü, sınıflandırılabilir duruş kaydı) eklendi. Mevcut `MachineStatusEvent(ALARM)`/`downtimeNote`/OEE Pareto akışına DOKUNULMADI (paralel, forward-only). `MachinesService.handleTelemetry`: ALARM otomatik açar (sınıflandırılmamış), CYCLE_START/PART_COMPLETE/IDLE otomatik kapatır. `POST /downtime/start` ile elle Andon çağrısı (aynı makinede ikinci açık kayıt 409), `PATCH /downtime/:id/classify` ile sonradan sınıflandırma, `PATCH /downtime/:id/end`. AHK-009 outbox'ı kullanır (`downtime.started`/`downtime.ended` domain yazımıyla aynı transaction'da). "alarms" sayfa entitlement'ı yeniden kullanıldı, yeni PageKey/katalog genişletmesi gerekmedi. | Andon panosu/HMI UI'da çağrı butonu yok (sadece API); Pareto raporu hâlâ OEE'nin serbest-metin `downtimePareto`'sundan ayrı — DowntimeEvent/DowntimeReason'ı kullanan yeni bir taksonomi-bazlı Pareto endpoint'i yazılmadı; eskalasyon (N dakika kapatılmazsa üst role bildirim) yok. | Fresh PostgreSQL E2E (`test/downtime.e2e-spec.ts`, 5/5): ALARM idempotent açılış, classify, CYCLE_START otomatik kapanış, elle start/409/end, var olmayan reasonId reddi; `test/machine-events.e2e-spec.ts` regresyonsuz (8/8) | M | 1 |
| AHK-017 | Uygulama katmanı tenant-isolation sınırı | Platform | `VERIFIED_DONE` | P0 | Tenant filtresi artık Prisma katmanında yapısal olarak zorunlu: `TenantContextInterceptor` (en dış global interceptor) her istekte `req.user`/`req.machine`'den tenantId'yi AsyncLocalStorage'a yazar; `PrismaService` (factory provider, `prisma.module.ts`) bir Prisma Client Extension (`tenant-scope.extension.ts`) ile DMMF'den türetilen TÜM `tenantId` alanlı modeller için `where`/`create`/`createMany`/`upsert`'e otomatik tenantId enjekte eder, nested (iç içe) write'ları recursive damgalar ve context'le çelişen açık bir tenantId varsa `TenantScopeViolationError` fırlatır. Context yoksa (login/refresh/machine-key gibi kimliğin henüz bilinmediği adımlar) sorgu bilerek dokunulmadan geçer. 3 adet ham `$queryRaw`/`$executeRaw` kullanımı (tooling/parts/inventory) tek tek denetlendi: ikisi salt advisory lock (veri sızdırmıyor), biri zaten elle tenantId içeriyor — değişiklik gerekmedi. | Fresh PostgreSQL E2E'de DMMF-tabanlı jenerik "tenant isolation sweep" (`test/tenant-isolation-sweep.e2e-spec.ts`) tüm tenant-scoped modeller için boş tenant'ta okuma sızıntısı olmadığını ve mismatch'li create/deleteMany'nin reddedildiğini kanıtlar; ayrıca mevcut 65 servisin tamamı bu extension altında tam e2e paketinde (158/160, kalan 2 hata AHK-017'den bağımsız önceden bilinen test-sıralama kırılganlığı) regresyonsuz çalışır. Tam PostgreSQL RLS (savunma-derinliği, `$queryRaw`/harici script erişimi için) kapsam dışı bırakıldı — Prisma'nın connection pooling modeliyle `SET LOCAL`/transaction-scoping karmaşıklığı ayrı bir ADR gerektirir, cloud varyantı kararına ertelendi. | Prisma extension unit test (9), DMMF sweep E2E, backend/web typecheck, tam izole e2e paketi | XL | 0-1 |
| CAT-001 | Merkezi capability/product katalog ve core koruması | Platform | `PARTIAL` | P0 | `product-catalog.ts` suite, canonical module, implementation durumu, dependency, route/page/permission ve legacy entitlement eşlemesini tek kaynakta tutar. Platform Core kapatılamaz; beta veya uygulanmamış legacy entitlement tenant tarafından toggle edilemez. Kapsama matrisi `docs/capability-coverage-matrix.md` içindedir. | Canonical child entitlement migration'ı (CAT-002), sayfa guard'ın child kodlara taşınması ve lisans/edition limiti gerekir. | Unit + platform entitlement E2E | L | 0 |
| CAT-002 | Canonical child entitlement migration | Platform | `VERIFIED_DONE` | P0 | Canonical child enum'u, legacy-to-child compatibility map'i ve PostgreSQL backfill migration'ı eklendi. Page guard/SPA her sayfayı child entitlement ile zorlar; Platform Core kalıcı tenant entitlement'ı değildir. | Temiz PostgreSQL migration+seed, canonical catalog/unit/guard testleri ve iki-tenant platform entitlement E2E geçer. | XL | 0 |
| PLM-001 | Kontrollü teknik doküman ve NC revizyon yayını | PLM/CNC | `VERIFIED_DONE` | P1 | `NcProgram` SHA-256, revision-history, Draft→Review→Approved→Published→Superseded/Archived, effectivity ve tek yayınlı revizyon kontrolünü taşır. RecipeStep/WorkOrderOperation yalnızca yayınlı snapshot bağlar; HMI başlangıçta tekrar doğrular. | Prisma migration/backfill, canonical `PLM_NC_PROGRAM` entitlement, RBAC/SoD, AHK-006 focused reauth/e-imza, transaction audit ve isolated PostgreSQL E2E geçer. Genel controlled-document lifecycle PLM_CHANGE_CONTROL kapsamıdır. | Unit + integration + fresh PostgreSQL E2E | XL | 1 |
| MES-TOOL-001 | CNC tooling ve fixture master data | MES/CNC | `VERIFIED_DONE` | P1 | **Canonical iş kodu:** `MES-TOOL-001`; `AHK-019` alias/dependency etiketidir, ayrı backlog değildir. Forward-only tooling migration, tenant-scoped DB reservation constraints, immutable as-built snapshot, PUBLISHED NC/start gate, idempotent life consumption, persistent action grants and HMI/setup/requirement UI tamamlandı. | Presetter/offset/DNC, predictive life ve fixture maintenance/calibration validity kapsam dışı bağımlılıklarda kalır. | Shared DTO unit + fresh PostgreSQL E2E (8/8), backend/web typecheck ve production build, Prisma validate, diff check | XL | 0 |
| MES-FIXTURE-MAINT-001 | Fixture bakım ve kalibrasyon uygunluğu | MES/EAM/QMS | `IN_PROGRESS` | P2 | Forward-only policy/event/record modeli, tenant-scoped idempotency anahtarları, action grants, bakım/kalibrasyon API’ları ve setup/start policy değerlendirmesi eklendi. CYCLE/PART_COUNT sayaçları yalnız doğrulanmış operasyon tamamlanmasında veya gerekçeli `FIXTURE_MAINT_OVERRIDE` ile değişir; bakım kanıtı policy revizyonuna bağlanır. Tooling UI policy seçimi, bakım/kalibrasyon geçmişi, evaluation, sertifika Document seçimi ve audit’li sayaç düzeltmesini sunar. Policy olmayan fixture mevcut MES-TOOL-001 davranışını korur; BLOCKING policy gerçek bakım/kalibrasyon kanıtı olmadan geçmez. | Kapanış kanıtları `RH-MES-FIXTURE-MAINT-001` release-hardening backlog’unda tutulur; bu checkpoint capability’yi `VERIFIED_DONE` yapmaz. | Seçili gerçek PostgreSQL E2E (11/11), backend/web typecheck ve production build, Prisma validate ve diff check geçer. MES-TOOL-001 için blocker değildir: mevcut güvenli status kapısı kullanılmayan fixture’ı reddeder, fakat ileri bakım doğrulamasını temsil etmez. | L | 3 |
| RH-MES-FIXTURE-MAINT-001 | Fixture bakım/kalibrasyon release hardening | MES/EAM/QMS | `NOT_STARTED` | P2 | `MES-FIXTURE-MAINT-001` çalışan checkpoint’inin kapanış kanıtıdır; ayrı entitlement veya ürün modülü değildir. | 22 maddelik gerçek PostgreSQL negatif/concurrency matrisi; ham Prisma constraint hata sızıntısı denetimi; policy/override stale-version ve SoD kapsamı; belge sertifikası UI→API→tenant-boundary E2E; tam tooling regresyonu ve güvenlik/audit kapanışı. | Policy olmayan fixture, BLOCKING/WARNING/INFORMATIONAL politika, geçersiz/FAIL kalibrasyon, bakım vadesi, cross-tenant fixture/policy/event/record/Document, bakım–rezervasyon yarışı, duplicate event, revalidation ve immutable snapshot senaryolarının tamamı gerçek PostgreSQL’de kanıtlanır. | L | Release hardening |
| MES-OPERATOR-HMI-001 | Operatör operasyon terminali | MES | `VERIFIED_DONE` | P1 | `/hmi/operations` tenant kapsamlı operasyon kuyruğu, canonical NC/setup checklist görünümü ve mevcut production/work-order start-complete komutlarını tek operatör akışında birleştirir. `HMI_READ`, `HMI_START`, `HMI_COMPLETE` persistent action grant’leri `MES_EXECUTION` sayfa entitlement’ından ayrıdır. | Bu ilk dilim yalnız yönlendirilmiş online operasyon yürütmeyi kapsar; backend gate’leri HMI’dan bağımsız canonical otorite olmaya devam eder. | Gerçek PostgreSQL HMI E2E (7/7): tenant liste/detail sınırı, doğrulanmış setup ile start+complete, blocker ve action grant reddi, machine/status filtreleri, aktif koşu olmadan tamamlama reddi, HMI_START-var-ama-HMI_READ-yok reddi, cross-tenant start/complete reddi; backend/web typecheck ve production build geçti | M | 1 |
| MES-OPERATOR-HMI-002 | Operatör terminali genişletme backlog’u | MES | `NOT_STARTED` | P2 | `MES-OPERATOR-HMI-001` | Operatör atama/dispatch, barkod/QR, offline-first kuyruk ve senkronizasyon, Andon, vardiya devri, elektronik iş talimatı editörü, beceri matrisi, OEE/telemetri ve gelişmiş dispatch algoritması ilk dilim kapsamı dışındadır. | Her alt kabiliyet için tenant/action grant, canonical command kullanımı ve gerçek PostgreSQL E2E kabul kriteri ayrı tanımlanır. | L | 2-4 |
| AHK-015 | Air-gap/DR/observability paketi | Deployment | `PARTIAL` | P2 | PostgreSQL backup scripti var; offline bundle/SBOM, MinIO restore drill, metrics/logging/alerting eksik. İşletim sınırı `docs/airgap-operasyon.md` içinde | Offline bundle/SBOM, MinIO+Postgres restore drill, metrics/logging/alerting | Drill | L | 8 |
| AHK-016 | MSSQL portability assessment | Data | `PARTIAL` | P3 | PostgreSQL-only kontratlar kaynakta envanterlendi; SQL Server provider/POC/CI yok | Karar kaydı, uyum matrisi ve POC CI; aksi halde resmî destek verilmez. Kaynak kanıtı ve POC kabul kriterleri `docs/mssql-portability-assessment.md` içindedir | Matrix/POC | L | 8 |

### PLM-001 sonrası platform açıkları

- **AHK-006:** `apps/backend/src/auth/auth.service.ts#reauthenticate` local ve
  LDAP reauth'ını PLM kritik komutlarında ve artık `ApprovalsService` üzerinden
  CAPA/MRP proposal kararlarında da uygular (`VERIFIED_DONE`). **OIDC için
  provider-side `prompt=login` kanıtı eklendi:** `OidcAuthService.reauthorizeUrl`
  (JWT korumalı `POST /auth/oidc/:id/reauth/authorize`, IdP'nin mevcut SSO
  oturumunu yok sayıp yeniden interaktif girişe zorlar) + `handleReauthCallback`
  (`GET /auth/oidc/:id/reauth/callback`, public — kimlik imzalı `state`'ten
  gelir, id_token'daki email zaten oturum açmış kullanıcıyla eşleşmezse
  reddedilir/hesap değiştirme engellenir) kısa ömürlü (2dk) imzalı bir reauth
  kanıtı üretir; `AuthService.reauthenticate` artık `authSource==="OIDC"` için
  bunu doğrular (önceden bu dal her zaman 401 dönüyordu — OIDC kullanıcıları
  CAPA/MRP gibi hiçbir kritik kararı ASLA onaylayamıyordu). CAPA/MRP DTO'ları
  değişmedi: mevcut `password` alanına OIDC için bu kanıt token'ı yazılır.
  **Keşfedilen ayrı bir açık (bu işin kapsamı dışında, backlog):** web UI'da
  CAPA/MRP onay/red butonları (`apps/web/src/pages/capa.tsx`, `mrp.tsx`)
  şu an `password` alanı hiç göndermeden boş body ile PATCH atıyor —
  `decideCapaSchema`/`mrpProposalDecisionSchema` `password` zorunlu kıldığı
  için bu istek authSource'tan bağımsız olarak backend'den her zaman 400
  dönüyor olmalı; hiçbir kullanıcı (LOCAL/LDAP/OIDC) şu an web UI üzerinden
  bir CAPA/MRP kararını onaylayamıyor gibi görünüyor. Reauth modalı (şifre
  input'u LOCAL/LDAP için, OIDC için "IdP ile yeniden doğrula" popup akışı)
  frontend'de hiç yok — ayrı bir P0 backlog maddesi olmalı.
- **AHK-017:** `PartsService.assertNcProgramUsable`,
  `RecipesService.create/update` ve `WorkOrdersService.createWithRoute` tenant
  predicate kullanır. Zorunlu Prisma tenant context/RLS bu PLM sınırının
  dışındadır ve AHK-017'de izlenmeye devam eder.

### Önerilen ilk geliştirme işi

**MES-OPERATOR-HMI-001 — Operatör dispatch ve yönlendirilmiş operasyon terminali**
`VERIFIED_DONE` durumundadır. İlk çalışan dikey dilim `/hmi/operations` route’u,
tenant kapsamlı operasyon kuyruğu/detayı, canonical NC ve tooling/fixture checklist’i,
ayrı persistent action grant’leri ve mevcut production/work-order start-complete
komutlarını getirir. Mevcut `MES_EXECUTION`, PLM yayınlı NC sınırı ve
MES-TOOL-001 setup checklist’ini tek operatör akışında birleştiren ayrı bir HMI
route’u sağlar: kullanıcının atanmış/açık operasyonlarını gösterir, doğru
makine/operasyon seçimini yapar, yayınlı NC ve tooling/fixture doğrulama
durumunu görünür kılar ve mevcut backend start/complete komutlarını
değiştirmeden kullanır. İlk dilim; tenant+action-grant tabanlı permission, HMI
ekranı, 7 gerçek PostgreSQL E2E senaryosu (tenant sınırı, canonical start/
complete, blocking setup+action grant reddi, machine/status filtresi, aktif
koşu olmadan tamamlama reddi, eksik HMI_READ reddi, cross-tenant mutation
reddi) ve backend/web typecheck+production build ile sınırlıdır. Barkod/
offline, elektronik talimat editörü, Andon ve vardiya teslimi
`MES-OPERATOR-HMI-002` backlog’undadır. Fixture bakım hardening’i
`RH-MES-FIXTURE-MAINT-001` altında ayrı izlenir; bu dikey dilimin blocker’ı
değildir.

> Aşağıdaki AHK-005/AHK-002 notları tarihsel tamamlanma kanıtıdır; aktif ilk
> geliştirme önerisi değildir.

**AHK-005 — Traceability foundation** `VERIFIED_DONE` durumundadır.
Material ve Part için lot zorunluluğu tanımlanabilir; material lotunda heat,
tedarikçi lotu, CoC numarası ve kabul kararı saklanır. Sertifika zorunlu
malzeme sertifikasız kabul edilemez; yalnızca kabul edilmiş material lotu satın
alma teslimine ve tüketime girebilir. Mamul girişi lot-zorunlu partlarda lot
ister; iki yönlü as-built trace lot → iş emri → mamul lot ve ters yönüyle temiz
veritabanı E2E'de doğrulandı. Lot ekranı kabul/karantina/red, sertifika alanı
ve lot belgelerini sunar. Sıradaki iş AHK-006 ile audit kapsamı ve elektronik
onay tasarımını güçlendirmektir.

**AHK-002 — Yerel izole e2e + CI build gate** `VERIFIED_DONE` durumundadır.
`pnpm test:e2e`, geçici ağdaki PostgreSQL, MinIO ve LDAP
üzerinde migration, seed ve e2e paketini çalıştırır; tamamlandığında volume'ları
da siler. CI backend ve web production build'lerini de doğrular. Konteynerde
OEE trend paketinin başlangıç maliyeti için Jest e2e timeout'u 20 sn'ye
çıkarıldı; 2026-08-01'de temiz ortamda migration+seed sonrası 19 paket ve 126
test geçti. Sonraki iş AHK-003 (stok tek doğrusu) olmalıdır;
AHK-004 (rota/operasyon çekirdeği) onunla birlikte ürünün gerçek MES omurgasını
kurar.

AHK-002 kabul kriterleri:

1. **Doğrulandı:** Mevcut CI'ın disposable PostgreSQL, MinIO ve LDAP e2e akışı korunur; aynı
   izole akış yerelde tek komutla çalışır ve test verisi hiçbir kalıcı
   geliştirme/üretim veritabanına yazılmaz.
2. **Doğrulandı:** CI, shared-types/backend/web production build'lerini ve Prisma migration'ı
   sıfır veritabanında doğrular.
3. **Doğrulandı:** Başarısız test artefaktı/logu görünür; komutlar README/rehberde doğru ve
   tekrarlanabilir biçimde yazılır.
4. **Doğrulandı:** Lint yoksa ya tanımlanır ya da bu eksiklik bilinçli karar olarak belgelenir.
   Bu monorepo'da henüz lint komutu tanımlı değildir; boş/yanıltıcı bir lint
   kapısı eklenmedi. AHK-001/sonraki platform işi olarak ESLint+Prettier ve CI
   kapısı seçilmelidir.
5. **Açık kabul kriteri:** Mevcut 196 birim testin yeşil kalması ve e2e sonucunun CI'da kanıtlanması
   zorunludur. İzole koşumda OEE trend başlangıç timeout'u gözlendi ve 20 sn
   sınırla düzeltildi; bu ortamın süreç sınırı tam paketin son çıkış kodunu
   toplamayı engellediği için CI veya sınırı olmayan yerel koşum kanıtı gerekir.

---

<details>
<summary>Ek A — korunmuş tarihsel Faz 0 / uygulama günlüğü (normatif değildir)</summary>

# CNC MES — Faz 0 Uygulama Planı (PLAN.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Hedef:** Makine bağlantısı OLMADAN, tamamen web arayüzünden manuel veri girişiyle Teklif → Üretim Emri → Malzeme Tedariği → Malzeme Tüketimi → Ürün (Mamul) Oluşumu akışını uçtan uca takip eden MES/hafif-ERP sistemi.

**Mimari:** pnpm workspaces monorepo. NestJS (TypeScript) backend + PostgreSQL (Prisma ORM) + REST API + WebSocket (Socket.IO). React + Vite + Tailwind + shadcn/ui ofis paneli. Docker Compose ile tek komut ayağa kalkış. Machine Connector Faz 1'de ayrı paket olarak eklenecek — çekirdek bundan bağımsız tasarlanır.

**Teknoloji Yığını:** NestJS 10, Prisma 5, PostgreSQL 16, Socket.IO, React 18, Vite 5, TypeScript 5, Tailwind CSS, shadcn/ui, pnpm workspaces, Docker Compose, JWT (access + refresh), Zod (shared-types doğrulama).

## Global Kısıtlar (her görev için geçerli)

- Her ana tabloda `tenant_id` kolonu var; sabit tek tenant değeriyle çalışır. RLS, tenant yönetim ekranı YOK (Faz 3).
- `ProductionRun.source` alanı `MANUAL | MACHINE` enum'ı — Faz 0'da her zaman `MANUAL`. Veri modeli ve servis katmanı kaynak ayrımını şimdiden tanır.
- Machine tablosu sadece referans (iş emrine tezgah atama için); hiçbir bağlantı/telemetri kodu yazılmaz.
- Secrets `.env` dosyalarında; repoya asla girmez (`.env.example` şablonları commit edilir).
- Tüm yazma işlemleri AuditLog'a düşer (kim, neyi, ne zaman, öncesi/sonrası).
- Roller: `ADMIN, SALES, PLANNER, FOREMAN, OPERATOR` — endpoint'ler rol bazlı korunur (RBAC guard).
- Monorepo: `apps/backend`, `apps/web`, `packages/shared-types`. `apps/connector-fanuc` ŞİMDİ OLUŞTURULMAZ; yapı buna izin verecek şekilde bırakılır.
- Her fazın sonunda `docker compose up` ile çalışan, elle test edilebilir bir sistem olmalı.
- UI dili Türkçe (tek dil, i18n altyapısı yok — YAGNI).

---

## 1. Klasör Yapısı

```
cnc-mes/
├── PLAN.md
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml            # postgres + backend + web
├── .env.example
├── .gitignore
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts           # tenant, admin kullanıcı, 2 tezgah (SMEC MCV-5500)
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/           # guards (JwtAuthGuard, RolesGuard), decorators, filters,
│   │   │   │                     # TenantContext, AuditInterceptor
│   │   │   ├── auth/             # login, refresh, JWT strategy
│   │   │   ├── users/
│   │   │   ├── customers/
│   │   │   ├── parts/            # Part + NcProgram (sadece kayıt/versiyon, yükleme yok)
│   │   │   ├── suppliers/
│   │   │   ├── materials/        # Material + stok görünümü
│   │   │   ├── quotes/           # Quote/QuoteLine + onay + iş emrine dönüşüm
│   │   │   ├── work-orders/      # WorkOrder + durum makinesi
│   │   │   ├── purchasing/       # PurchaseOrder/Line + teslim al → stok artışı
│   │   │   ├── consumption/      # MaterialConsumption (rezervasyon + tüketim, stok düşümü)
│   │   │   ├── production/       # ProductionRun (başlat/durdur/tamamla, adet girişi)
│   │   │   ├── finished-goods/   # FinishedGoodsEntry → mamul stok girişi
│   │   │   ├── machines/         # sadece CRUD (referans tablo)
│   │   │   ├── dashboard/        # özet endpoint'leri
│   │   │   └── realtime/         # Socket.IO gateway (workorder.updated, stock.updated, ...)
│   │   └── test/                 # e2e (supertest) + birim testleri (jest)
│   ├── web/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── api/              # typed fetch client + socket client
│   │   │   ├── components/       # shadcn/ui bileşenleri + ortak tablo/form bileşenleri
│   │   │   ├── pages/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── customers/
│   │   │   │   ├── parts/
│   │   │   │   ├── suppliers/
│   │   │   │   ├── materials/
│   │   │   │   ├── quotes/
│   │   │   │   ├── work-orders/
│   │   │   │   ├── purchasing/
│   │   │   │   ├── production/   # operasyon takibi (responsive — ileride HMI/kiosk temeli)
│   │   │   │   └── login/
│   │   │   └── lib/              # auth store, route guard, yardımcılar
│   │   └── index.html
│   └── (connector-fanuc)         # FAZ 1 — şimdi yok, sadece yer ayrıldı
└── packages/
    └── shared-types/
        └── src/                  # Zod şemaları + DTO tipleri + enum'lar (backend & web ortak)
```

## 2. Veritabanı Şeması (Prisma / PostgreSQL)

Tüm tablolarda: `id` (uuid), `tenantId`, `createdAt`, `updatedAt`. İlişkiler açıklamada.

**Enum'lar:**
- `Role`: ADMIN | SALES | PLANNER | FOREMAN | OPERATOR
- `QuoteStatus`: DRAFT | SENT | APPROVED | REJECTED
- `WorkOrderStatus`: PLANNED | WAITING_MATERIAL | IN_PRODUCTION | COMPLETED | CANCELLED
- `PurchaseOrderStatus`: ORDERED | IN_TRANSIT | RECEIVED | CANCELLED
- `MaterialType`: RAW | CONSUMABLE
- `ConsumptionType`: RESERVED | CONSUMED
- `RunSource`: MANUAL | MACHINE   ← Faz 0'da hep MANUAL
- `AuditAction`: CREATE | UPDATE | DELETE | STATUS_CHANGE

**Varlıklar:**

| Varlık | Alanlar (kimlik/zaman alanları hariç) | İlişkiler |
|---|---|---|
| Tenant | name | seed ile tek kayıt |
| User | email (unique), passwordHash, name, role: Role, isActive | → AuditLog, ProductionRun.operator |
| Customer | name, contactName?, email?, phone?, address?, taxNo?, notes? | ← Quote |
| Part | partNo, revision, name, description?, drawingFileRef?, stepFileRef? — unique(tenantId, partNo, revision) | ← QuoteLine, WorkOrder, NcProgram, FinishedGoodsEntry |
| NcProgram | partId, version (int, artan), fileName, fileRef, notes?, createdById — Faz 0'da sadece kayıt | → Part |
| Quote | quoteNo (auto: TKF-2026-0001), customerId, status: QuoteStatus, currency (default TRY), validUntil?, notes?, createdById | → Customer, ← QuoteLine |
| QuoteLine | quoteId, partId, quantity, unitPrice (Decimal), dueDate | → Quote, Part; ← WorkOrder (dönüşümde) |
| Machine | name, model (SMEC MCV-5500), controller? (Fanuc 0i-MF / 0iTF Plus — teyit edilecek), isActive — SADECE REFERANS | ← WorkOrder, ProductionRun |
| WorkOrder | woNo (auto: IE-2026-0001), quoteLineId?, partId, quantity, dueDate, priority (int), status: WorkOrderStatus, machineId?, notes? | → QuoteLine?, Part, Machine?; ← MaterialConsumption, ProductionRun, FinishedGoodsEntry |
| Supplier | name, contactName?, email?, phone?, address?, taxNo?, notes? | ← PurchaseOrder |
| Material | code (unique/tenant), name, type: MaterialType, unit (adet/kg/m...), stockQty (Decimal), minStock? | ← PurchaseOrderLine, MaterialConsumption |
| PurchaseOrder | poNo (auto: SAT-2026-0001), supplierId, status: PurchaseOrderStatus, orderDate, expectedDate?, notes?, createdById | → Supplier; ← PurchaseOrderLine |
| PurchaseOrderLine | purchaseOrderId, materialId, quantity, unitPrice (Decimal), receivedQty (default 0) | → PurchaseOrder, Material |
| MaterialConsumption | workOrderId, materialId, type: ConsumptionType, quantity (Decimal), date, createdById | → WorkOrder, Material |
| ProductionRun | workOrderId, machineId?, operatorId, startedAt, endedAt?, goodCount (default 0), scrapCount (default 0), downtimeNote?, **source: RunSource (default MANUAL)**, notes? | → WorkOrder, Machine?, User |
| FinishedGoodsEntry | workOrderId, partId, quantity, date, createdById | → WorkOrder, Part |
| PartStock | partId (unique), qty (Decimal) — mamul stok özeti; FinishedGoodsEntry girişleriyle artar | → Part |
| AuditLog | userId, entity, entityId, action: AuditAction, before? (Json), after? (Json) | → User |

**Kritik iş kuralları (servis katmanında, transaction içinde):**
1. Teklif onayı (`APPROVED`) → her QuoteLine için otomatik WorkOrder taslağı oluşturma seçeneği (kullanıcı onaylı, status: PLANNED).
2. PO satırı "teslim alındı" → `receivedQty` artar; tüm satırlar tamamsa PO `RECEIVED`; her teslimatta `Material.stockQty += quantity` (aynı transaction).
3. MaterialConsumption `CONSUMED` kaydı → `Material.stockQty -= quantity`; stok eksiye düşerse hata (409). `RESERVED` stok düşmez, sadece "ayrılmış" gösterilir.
4. ProductionRun start → WorkOrder `IN_PRODUCTION`; complete → adet girişi zorunlu. FinishedGoodsEntry → `PartStock.qty += quantity`; WorkOrder toplam üretilen ≥ quantity ise `COMPLETED` önerilir (kullanıcı onaylar).
5. Her mutasyon AuditLog'a yazılır (interceptor); WebSocket'e `entity.updated` olayı yayınlanır.

**WebSocket olayları:** `quote.updated`, `workorder.updated`, `stock.updated`, `productionrun.updated` — dashboard ve liste ekranları dinler.

---

## 3. Faz 0a — İskelet, Auth, Temel CRUD

**Sonunda:** `docker compose up` → login olunur; User/Customer/Part/Supplier/Material/Machine CRUD ekranları çalışır.

- [x] **0a.1 Monorepo iskeleti:** root `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.env.example`; `git init` + ilk commit.
- [x] **0a.2 `packages/shared-types`:** enum'lar + Zod şemaları (tüm varlık DTO'ları) + tsup build. Test: tip/şema birim testleri (vitest).
- [x] **0a.3 Backend iskeleti:** NestJS app, config modülü (.env), health endpoint. Test: `GET /health` e2e.
- [x] **0a.4 Prisma şeması + ilk migration:** Bölüm 2'deki TÜM varlıklar (Faz 0b/0c tabloları dahil — tek migration, sonra ekleme yok). `seed.ts`: tenant, admin (env'den şifre), 2 makine.
- [x] **0a.5 Auth:** `POST /auth/login`, `POST /auth/refresh`, JWT strategy, `RolesGuard` + `@Roles()` decorator, `TenantContext` (sabit tenant enjeksiyonu). Test: login başarılı/başarısız, rol reddi e2e.
- [x] **0a.6 AuditInterceptor:** tüm mutasyonlarda before/after yakalama. Test: bir CRUD işleminde AuditLog kaydı doğrulanır.
- [x] **0a.7 Temel CRUD API'leri:** users, customers, parts (+nc-programs alt kaynağı), suppliers, materials, machines — her biri: controller + service + Zod doğrulama + rol koruması + e2e test (create/list/update/delete).
- [x] **0a.8 Web iskeleti:** Vite + Tailwind + shadcn/ui kurulumu, login sayfası, auth store (token yenileme), korumalı layout (sidebar navigasyon).
- [x] **0a.9 CRUD ekranları:** her temel varlık için liste (tablo, arama) + form (dialog) sayfası; typed API client.
- [x] **0a.10 Docker Compose:** postgres + backend (migration otomatik) + web (nginx). Doğrulama: temiz makinede `docker compose up` → login → müşteri oluştur.
- [x] **0a.11 Commit + tag `faz-0a`.**

## 4. Faz 0b — Teklif, İş Emri, Satınalma

**Sonunda:** Teklif oluştur → onayla → iş emrine dönüştür; PO oluştur → teslim al → hammadde stoğu artar.

- [x] **0b.1 Quote API:** CRUD + satırlar, `quoteNo` otomatik numaralandırma, durum geçişleri (DRAFT→SENT→APPROVED/REJECTED; geçersiz geçiş 409). Test: durum makinesi e2e.
- [x] **0b.2 Teklif→İş Emri dönüşümü:** `POST /quotes/:id/convert` — APPROVED teklifin seçilen satırlarından WorkOrder'lar (transaction). Test: dönüşüm + mükerrer dönüşüm engeli.
- [x] **0b.3 WorkOrder API:** CRUD + durum geçişleri + tezgah atama + öncelik. Test: geçiş kuralları e2e.
- [x] **0b.4 Purchasing API:** PO + satır CRUD, `POST /purchase-orders/:id/receive` (satır bazlı miktar) → stok artışı aynı transaction'da. Test: teslim al → `Material.stockQty` artışı doğrulanır; fazla teslim reddi.
- [x] **0b.5 Realtime gateway:** Socket.IO + JWT el sıkışma; servisler olay yayınlar. Test: birim test (event emit).
- [x] **0b.6 Web — Teklif ekranları:** liste + detay (satır ekleme, durum aksiyonları, "İş emrine dönüştür" akışı).
- [x] **0b.7 Web — İş Emri ekranları:** liste (durum/öncelik filtresi) + detay (tezgah atama, durum aksiyonları).
- [x] **0b.8 Web — Satınalma ekranları:** PO liste + detay (teslim alma formu); Materials sayfasında canlı stok.
- [x] **0b.9 Commit + tag `faz-0b`.**

## 5. Faz 0c — Tüketim, Operasyon Takibi, Mamul, Dashboard

**Sonunda:** Spec'teki uçtan uca akış tamamen çalışır ve dashboard'dan izlenir.

- [x] **0c.1 Consumption API:** iş emrine rezervasyon/tüketim kaydı; tüketimde stok düşümü + yetersiz stok hatası (transaction). Test: stok düşümü + eksi stok reddi e2e.
- [x] **0c.2 ProductionRun API:** `POST /work-orders/:id/runs` (başlat), `PATCH /runs/:id` (adet/duruş girişi), `POST /runs/:id/complete` — `source: MANUAL` sabit; WorkOrder durum senkronu. Test: başlat→tamamla akışı e2e.
- [x] **0c.3 FinishedGoods API:** iş emrine bağlı mamul girişi → `PartStock` artışı; iş emri tamamlama önerisi. Test: mamul stok artışı e2e.
- [x] **0c.4 Dashboard API:** aktif iş emirleri (durum bazlı sayım + liste), bekleyen teklifler, kritik stok (minStock altı), son üretim kayıtları.
- [x] **0c.5 Web — Operasyon Takibi:** iş emri seç → başlat/adet gir/duruş notu/tamamla; büyük dokunmatik dostu butonlar (ileriki HMI temeli), responsive.
- [x] **0c.6 Web — Tüketim & Mamul ekranları:** iş emri detayında malzeme rezervasyon/tüketim bölümü + mamul giriş bölümü.
- [x] **0c.7 Web — Dashboard:** özet kartlar + aktif iş emirleri tablosu + kritik stok listesi; WebSocket ile canlı güncelleme.
- [x] **0c.8 Uçtan uca duman testi (e2e):** teklif→onay→iş emri→PO→teslim→tüketim→üretim→mamul girişi tek senaryoda; README'ye kurulum/kullanım bölümü.
- [x] **0c.9 Commit + tag `faz-0c`.**

---

## 6. Faz 1 — Dosya Deposu + Machine Connector (kullanıcı onayıyla, Faz 0 dışı)

**Sonunda:** STEP/talimat dosyaları yüklenip indirilebilir; protokol-bağımsız bir Machine Connector mimarisi (Kepware/OPC-UA benzeri) gerçek bir OPC-UA client-server el sıkışmasıyla uçtan uca doğrulanmış durumda, `ProductionRun(source=MACHINE)` otomatik oluşuyor.

- [x] **1.1 Dosya deposu (MinIO):** `Document`/`DocumentType` modeli, MinIO entegrasyonu (upload/list/signed-URL/silme), mime allowlist + zorunlu `attachment` indirme (stored XSS önlemi), rol korumalı upload/delete, web UI (parça + iş emri detayı).
- [x] **1.2 Machine Connector — veri modeli:** `Machine.activeWorkOrderId`/`connectorKeyHash`/`lastEventAt`/`lastStatus`, "Makine Bağlantısı" sistem kullanıcısı (seed).
- [x] **1.3 Backend — telemetri alımı:** `X-Machine-Key` korumalı `POST /machines/:id/telemetry` (JWT'siz, `MachineKeyGuard`), `PATCH /machines/:id/active-work-order`, `POST /machines/:id/connector-key`. CYCLE_START→ProductionRun(source=MACHINE) açılışı, PART_COMPLETE→goodCount, ALARM→downtimeNote.
- [x] **1.4 `apps/connector` paketi:** protokol-bağımsız `MachineAdapter` arayüzü, `SimulatorAdapter` (donanımsız test), retry-kuyruklu `Connector` (backend'e HTTP POST, 409 kalıcı hata olarak düşürülür).
- [x] **1.5 OPC-UA referans adapter:** `OpcuaAdapter` (node-opcua client, node ID'ler config'den — marka bağımsız), kendi açık kaynak OPC-UA sim sunucumuz (`apps/connector/src/sim-server`), gerçek client-server el sıkışmasıyla entegrasyon testi.
- [x] **1.6 Web — canlı tezgah paneli:** durum rozeti (Çalışıyor/Boşta/Alarm/Bağlı değil), aktif iş emri atama, connector-key üretme.
- [x] **1.7 Testler:** 70 backend e2e + 8 connector (vitest) + 3 backend birim + 14 web — hepsi yeşil.
- [ ] **1.8 Gerçek marka-özel adapter (Fanuc FOCAS2 / MTConnect / Siemens):** SMEC MCV-5500'ün kontrolcü/protokolü netleşmeden yazılamaz — beklemede. **Araştırma notu (2026-07-27):** MTConnect ücretsiz/açık bir standart (MTConnect Institute, royalty-free); Mitsubishi M80 için MTConnect üzerinden Execution State/Part Count/Spindle Data/çoğu alarm alınabiliyor (Axis Data, Tool ID, System alarmları, Custom Points hariç — bir MES sağlayıcısının karşılaştırma tablosuna göre). Türkiye'de Smartes Teknoloji'nin (`smartes.com.tr`, `mtconnectadapter.com`) MTConnect Adapter ürünü M70/M700/M80/M800'ü açıkça destekliyor — yani M80 + MTConnect kombinasyonu teknik olarak mümkün ve ticari olarak sunuluyor. Adapter'ın çekim mekanizması (native mi, PLC/ağ üzerinden mi) ve fiyatlandırma netleşmedi.

**Araştırma notu 2 (2026-07-27) — Mitsubishi'nin resmi çözümü:** Mitsubishi Electric'in kendi ürünü **"NC Machine Tool Connector"** (resmi kılavuz IB-1501634-D) M800/M80/E80/C80 serisini (M80 dahil, ayrıca M700/M70) açıkça destekliyor. Mimarisi: harici bir Windows PC'ye kurulan bu yazılım, CNC'ye Mitsubishi'nin **"Custom API library"** ile bağlanıyor (düşük seviye veri erişimi — muhtemelen daha önce bulunan TCP 683 portu üzerinden), topladığı veriyi **OPC UA server** olarak dışa veriyor (ayrıca PLC cihaz verisi, başka üreticilerin MTConnect/OPC UA kaynaklarını da toplayabiliyor; PostgreSQL'e loglama ve MQTT/Mosquitto ile yayınlama opsiyonel). Kullanılabilecek gerçek CNC veri noktalarının tam listesi ayrı bir referans dokümanda: **"Custom API Variables List" (BNP-C3072-152)** — kendi adaptörümüzü (AHKConnect) yazmak istersek asıl ihtiyacımız olan teknik kaynak bu doküman (ve muhtemelen Custom API kütüphanesinin kendisi), Mitsubishi Electric/yerel distribütörden talep edilmesi gerekiyor. Lisans/fiyat bilgisi kılavuzda yer almıyor (tipik olarak satın alınan bir endüstriyel yazılım).

**Araştırma notu 3 (2026-07-27) — Zero-cost yol, seçilen yaklaşım:** Açık kaynak, **MIT lisanslı** bir C kütüphanesi bulundu: [`wqliceman/mitsubishi_cnc_m70_ezsocket_net`](https://github.com/wqliceman/mitsubishi_cnc_m70_ezsocket_net) — Mitsubishi'nin **EZSocket protokolünü** (Socket → GIOP → Custom API) TCP port 683 üzerinden doğrudan uyguluyor, hiçbir Mitsubishi yazılımı/lisansı gerektirmiyor. Hazır fonksiyonlar: `m70_cnc_read_status`, `m70_cnc_read_axis_position`, `m70_cnc_read_spindle_speed`, `m70_cnc_read_feed_speed`, `m70_cnc_read_main_program_name_ex`, `m70_cnc_read_program_block`, `m70_cnc_read_alarm`/`read_is_alarm`, `m70_cnc_read_cycle_time` — bize lazım olan CYCLE_START/PART_COMPLETE/ALARM eşdeğerlerinin hepsi mevcut. **Çekince:** Kütüphane `EZNC_SYS_MELDAS700M` sabitiyle M70 için yazılmış; M800/M80 için ayrı bir sabit repo'da görünmüyor — M700 ve M800/M80 aynı Custom API nesli olduğu için protokolün aynı/uyumlu olması muhtemel ama gerçek M80'de doğrulanmadı.

**Seçilen plan — "AHKConnect" (M80'e özel, açık kaynak tabanlı):**
1. **Simülatör yaklaşımı (önce bu):** `apps/connector/src/sim-server`'daki OPC-UA sim sunucusuna benzer şekilde, port 683'te EZSocket/GIOP protokolünü konuşan minimal bir sahte TCP sunucusu yazılacak (kütüphanenin `m70_giop.c` kaynağı incelenerek istek/yanıt byte formatı çözülecek), sabit/canlı test verisi (program durumu, part count, alarm) dönecek. Bu sayede gerçek tezgaha veya bayi cevabına bağlı kalmadan `M80Adapter`'ı geliştirip test edebiliriz.
2. `apps/connector`'a yeni bir `M80Adapter` eklenecek (mevcut `MachineAdapter` arayüzüne uyumlu) — EZSocket kütüphanesini bir C shim/küçük servis olarak sarıp Node connector'ın buna IPC/HTTP ile bağlanması şeklinde.
3. Simülatörle çalışır hale gelince gerçek M80'de (`EZNC_SYS_MELDAS700M` sabitiyle) deneme yapılacak; başarısız olursa Wireshark ile gerçek trafik yakalanıp fark analiz edilecek — yine zero-cost.
- [x] **1.16 EZSocket/GIOP protokol simülatörü:** `apps/connector/src/adapters/m80-protocol.ts` (paylaşılan GIOP frame encode/decode — `mochaGetData` komutu, section/subSection/systemNo/axisNo/dataType alanları, `DEFAULT_ITEM_ADDRESSES` placeholder adresler) + `apps/connector/src/sim-server/m80-sim-server.ts` (port 683, `net.createServer`, OPC-UA sim ile aynı çevrim mantığı).
- [x] **1.17 `M80Adapter` (AHKConnect):** `apps/connector/src/adapters/m80.adapter.ts` — ham TCP socket üzerinden polling (500ms varsayılan), `OpcuaAdapter` ile birebir aynı edge-detection deseni (CYCLE_START/CYCLE_END/PART_COMPLETE/ALARM/IDLE). `config.ts`'e `ADAPTER=m80` + `M80_HOST`/`M80_PORT`/`M80_POLL_INTERVAL_MS` env'leri, `main.ts`'e adaptör dalı eklendi. `package.json`'a `sim-server:m80` script'i eklendi.
- [x] **1.18 Simülatörle uçtan uca test:** `test/m80-adapter.spec.ts` (2 test — cycle/alarm/part-count MachineEvent üretimi, disconnect sonrası event durması) — 10/10 connector testi yeşil, typecheck temiz. **Kalan:** gerçek M80'de doğrulama (henüz yapılmadı) — `m80-protocol.ts`'teki kablo formatı bir varsayım/rekonstrüksiyon, gerçek cihazda değişebilir.
- [x] **1.9 `apps/connector`'ın Docker Compose'a opsiyonel servis olarak eklenmesi.** `apps/connector/Dockerfile` eklendi (pnpm workspace filter ile bağımlılık kurulumu, `tsx` ile derlemesiz çalıştırma). `docker-compose.yml`'e `connector` servisi `profiles: ["connector"]` ile eklendi — varsayılan `docker compose up`'ta başlamaz, `docker compose --profile connector up` ile açılır. `CONNECTOR_MACHINE_ID`/`CONNECTOR_MACHINE_KEY` vb. env'ler `:-` (boş varsayılan) ile tanımlı — `:?` (zorunlu) kullanılsaydı connector profili aktif olmasa bile `docker compose config`/`up` tüm servisleri interpolate ederken hata verip varsayılan çalıştırmayı kırıyordu (doğrulandı, düzeltildi). Gerçek zorunluluk kontrolü zaten connector'ın kendi `config.ts#loadConfig`'inde runtime'da yapılıyor. `.env.example`'a `CONNECTOR_*` değişkenleri eklendi. `docker compose config --quiet` hem profilsiz hem `--profile connector` ile doğrulandı; `docker compose --profile connector build connector` image'ı başarıyla derledi.

Tasarım dokümanı: `docs/superpowers/specs/2026-07-24-machine-connector-design.md`.

### 6.1 Siemens Opcenter X incelemesinden çıkan backlog (2026-07-27)

Desktop\Opcenter X klasöründeki Siemens Opcenter X dokümanları (Integration Guide, User Manual, Security Concept, Development/Configuration Guide) incelendi; AHKMES ölçeğine uygun, uygulanabilir fikirler:

- [ ] **1.10 Telemetri idempotency key:** `POST /machines/:id/telemetry`'e tekrar-koruması (`uniqueRequestId` benzeri) eklenmesi — connector retry kuyruğu network hatasında aynı olayı iki kez gönderirse `goodCount` çift artabilir (Opcenter'daki `UniqueRequestID` deseninden esinlenildi).
- [x] **1.11 Non-Conformance modülü (MVP):** Work Order Operation'a bağlı NC kaydı (Problem On: Ürün/Malzeme/İş İstasyonu, Failure Type, açıklama, foto), açık NC varsa operasyonun throughput girişini otomatik bloklayan kural; aksiyon tipi alanı (Scrap/Rework/Blocking/Generic) — ayrı bir Action Management modülüne gerek yok, mevcut goodCount/scrapCount mantığına entegre edilebilir. **Not:** v0.9 bölümünde (§8) zaten tamamlanmıştı, bu checkbox güncellenmemişti.
- [x] **1.10 Telemetri idempotency key:** `MachineEventDedup` modeli (migration `20260728010000_add_machine_event_dedup`, unique `[machineId, eventId]`). Connector (`core/connector.ts`) her olaya `enqueue()` sırasında `randomUUID()` ile `eventId` atar, retry'lerde aynı kalır. Backend `handleTelemetry()` işlemden önce dedup kaydı oluşturmayı dener; P2002 (unique ihlali) alırsa `{ok:true, duplicate:true}` döner ve olayı tekrar işlemez. `eventId` opsiyonel — eski connector sürümleriyle geriye uyumlu.
- [x] **1.12 Operatör ekranı context bar:** Target/Queuing/Pending/Produced sayaçlarının operasyon sayfasının üstünde sabit gösterge olarak gösterilmesi. `apps/web/src/pages/production.tsx` — `ContextBar` bileşeni: Sırada Bekleyen (startable iş emri sayısı), Hedef (aktif koşuların toplam hedef adedi), Üretilen (toplam goodCount), Kalan (hedef-üretilen, 0'ın altına inmez).
- [x] **1.13 Structured error response + hata kodları:** `common/app-exception.ts` (`AppException`, HttpException + errorCode taşır) + `common/filters/http-exception.filter.ts` (global filtre, tüm HttpException'ları `{errorCode, message, statusCode}` biçimine çevirir; `AppException` kendi kodunu taşır, diğerleri HTTP durumundan türetilmiş genel kod alır — NOT_FOUND/CONFLICT/BAD_REQUEST vb.), `main.ts`'e `app.useGlobalFilters()` ile kaydedildi. İsimli kodlar eklendi: telemetri handler'da `NO_ACTIVE_WORK_ORDER`/`WORK_ORDER_NOT_FOUND`/`WORK_ORDER_CLOSED`, üretim adedi girişinde `NON_CONFORMANCE_OPEN`.
- [x] **1.14 Connector retry — exponential backoff:** `apps/connector/src/core/connector.ts`'deki `drain()` metodunda zaten üstel geri çekilme var (`delay = Math.min(delay * 2, maxRetryDelayMs)`) — kontrol edildi (2026-07-28), ek iş gerekmedi.
- [x] **1.15 (ileri faz) Basit NC dashboard + genealogy:** Açık NC sayısı gibi özet widget'lar, MTU/parça bazlı backward/forward izlenebilirlik sorgusu. Genealogy backward/forward sorgusu önceki oturumda `work-orders.service.ts`'e eklenmişti (bu oturumda sadece doğrulandı). Dashboard NC widget'ı bu oturumda eklendi: `dashboard.service.ts#summary()`'e `openNonConformanceCount` (`prisma.nonConformance.count({status:"OPEN"})`), `dashboard.tsx`'e durum kartlarının yanına tıklanabilir "Açık Uygunsuzluk" kartı (`/non-conformances`'a link) + `nonconformance.updated` socket event'i canlı güncelleme listesine eklendi.

Bilinçli alınmayanlar: model-driven Configurator/no-code metamodel, NATS tabanlı RIC mimarisi, çoklu-tenant mimarisi — AHKMES tek-fabrika/tek-tenant ölçeğinde gereksiz karmaşıklık.

- [x] **CI workflow (GitHub Actions) doğrulaması (2026-07-28):** Önceki oturumlardan beri hiç yeşile geçmemişti — `gh run list`/`gh run view --log-failed` ile 5 kök neden bulunup düzeltildi: (1) `pnpm/action-setup@v4`'teki `version: 9`, `package.json`'daki `packageManager: pnpm@9.15.9` ile çakışıp her koşuyu 30-40s'de anında düşürüyordu — parametre kaldırıldı; (2) backend job'unda MinIO servisi hiç yoktu (`services:` bloğu custom komut desteklemediği için `docker run` ile ayrı adım eklendi); (3) `prisma generate` adımı eksikti, Prisma Client regenerate edilmiyordu; (4) `pnpm --filter X prisma migrate deploy`/`db seed` sözdizimi pnpm tarafından "prisma" adlı bir script çalıştırma isteği sanılıyordu (`exec` eksikti), migration/seed sessizce hiç uygulanmıyordu; (5) `SEED_ADMIN_PASSWORD` env değişkeni job'da tanımlı değildi. Ayrıca bu süreçte `apps/connector/src/adapters/opcua.adapter.ts`'de gerçek bir race condition bulundu (ALARM event'i AlarmMessage subscription'ı güncellenmeden ateşlenebiliyordu) ve düzeltildi. Sonuç: `master` branch'te 3 job (backend/connector/web) art arda 2 kez yeşil.
- [x] **Operatör ekranı HMI/kiosk yeniden tasarımı (2026-07-28):** `apps/web/src/pages/production.tsx` baştan yazıldı. İş emirleri artık durumuna göre renklenen kartlar halinde (başlamadı=gri, devam ediyor=mavi + canlı ilerleme çubuğu, duraklatıldı=turuncu, bitti=yeşil — "Bitmiş İşler" bölümünde ayrı gösteriliyor); karta tıklanınca operasyon detayına girilir (Belgeler/STEP-WI butonu → `DocumentsPanel` modalı, parça bazlı), CNC'den gelen goodCount ile anlık ilerleme çubuğu, Kaydet/Hurda +1/Duraklat/Parçalı Tamamla/Tamamla aksiyonları. Backend: `POST /runs/:id/complete`'e opsiyonel `completeWorkOrder: boolean` eklendi (Tamamla iş emrini de COMPLETED'a çeker, Parçalı Tamamla/Duraklat sadece koşuyu bitirir — WO IN_PRODUCTION'da kalır, bu da "duraklatıldı" görsel durumunu oluşturur; şemada ayrı bir PAUSED durumu yok, bilinçli tercih — bkz. üstteki "Parçalı Tamamla" mantığıyla tutarlı). Doğrulama: backend/web typecheck + testler yeşil (backend e2e 92/92), Playwright ile gerçek tarayıcıda grid/detay/Bitmiş İşler/Belgeler modalı görsel olarak doğrulandı.

### 6.2 Automation Gateway (AGW) — PLC/CNC tag konfigürasyonu ve canlı izleme (2026-07-27)

Kullanıcı isteği: web ekranında Siemens Opcenter X'in Interoperability katmanına benzer, PLC/CNC bağlantısını configure edip tag'leri (adres+değer) canlı izleyebileceğimiz bir "Automation Gateway" ekranı. Onaylanan plan 4 fazlı: (1) veri modeli+CRUD, (2) tag değeri telemetrisi, (3) connector `readTags()`, (4) web ekranı. Sabit 5 event tipli (CYCLE_START/PART_COMPLETE/ALARM/CYCLE_END/IDLE) iş takibi modeli korunuyor, tag katmanı onun **yanına** ekleniyor.

- [x] **AGW Faz 1 — Veri modeli + backend CRUD:** Prisma `MachineTag` modeli (`id, tenantId, machineId, name, address, dataType, lastValue, lastValueAt`, migration `20260727143959_add_machine_tag`), `MachineTagDataTypeSchema` enum (NUMBER/STRING/BOOLEAN), `createMachineTagSchema`/`updateMachineTagSchema` (shared-types). Backend: `GET/POST/PATCH/DELETE /machines/:id/tags(/:tagId)` (ADMIN rolü write için, okuma herkese açık — mevcut desenle tutarlı), tenant+machine izolasyonu, aynı isimde tag'e 409. Test: `test/machine-tags.e2e-spec.ts` (6 test) — hepsi yeşil.
- [x] **AGW Faz 2 — Tag değeri telemetrisi:** `POST /machines/:id/tag-values` (yeni, mevcut `/telemetry`'ye dokunmadan, `MachineKeyGuard` ile korunur), `handleTagValues` (tanımsız tag adı sessizce atlanır), `realtime.emitToTenant(tenantId, "tag.value.updated", {machineId, values})`. Test: `test/machine-tag-values.e2e-spec.ts` (4 test) — yeşil.
- [x] **AGW Faz 3 — Connector `readTags()`:** `MachineAdapter`'a opsiyonel `readTags?(): Promise<TagReading[]>` (geriye uyumlu — `SimulatorAdapter` etkilenmedi). `OpcuaAdapter`: gerçek node-opcua `browse()` ile ObjectsFolder'dan iki seviye gezip Variable node'larını keşfeder. `M80Adapter`: `parseM80Address("section:subSection[:char]")` ile config'de elle tanımlı tag listesini okur (keşif yok). `Connector`'a `tagPollIntervalMs` — adapter destekliyorsa periyodik `readTags()` → `/tag-values` POST (kayıp toleranslı, retry yok). `config.ts`'e `M80_TAGS` (JSON) ve `TAG_POLL_INTERVAL_MS` env'leri. Test: connector paketi 12/12 yeşil (`opcua-adapter.spec.ts` +1, `m80-adapter.spec.ts` +1).
- [x] **AGW Faz 4 — Web ekranı:** `apps/web/src/pages/automation-gateway.tsx` — makine seçici, tag CRUD tablosu (ekle/düzenle/sil, ADMIN rolü), canlı değer sütunu. `useTagValues` hook'u (`lib/socket.ts`) `tag.value.updated` event'ini dinleyip react-query cache'i **refetch yapmadan** doğrudan günceller (mevcut `useInvalidateOn` invalidate-refetch deseninden bilinçli sapma). Nav'a "Automation Gateway" linki, route `/automation-gateway` eklendi. Web test suite 14/14 yeşil.

Kapsam dışı (bu fazda bilinçli): tag yazma (write), tag geçmişi/historian, eşik tabanlı bildirimler, M80 için otomatik tag keşfi.

**Not (2026-07-27):** Backend'in TÜM e2e suite'i (`faz0c.e2e-spec.ts`, tüketim/mamul/dashboard) bu oturumda bazı testlerde başarısız oldu (recentRuns/totalProduced sayı uyuşmazlığı, 409 yerine 400) — incelendi, bu modüle bu oturumda hiç dokunulmadı (`git status` ile doğrulandı); sebebi muhtemelen bu oturumda tekrar tekrar çalıştırılan e2e testlerinin paylaşılan dev DB'yi (aynı seed tenant/admin) veriyle doldurması (limit'li "recent" listelerinden eski kayıtların düşmesi gibi) — AGW'ye özel değil, ortam/test-izolasyon kırılganlığı. AGW'nin kendi test suite'leri (backend 10, connector 2 yeni, web 14) hepsi yeşil.

## 8. Satışa Hazır MES Yol Haritası — v0.9 ve v1.0 (2026-07-27, tamamlandı)

Kullanıcı isteği: AHKMES'i Siemens Opcenter X / Smartes SmartFactory ile rekabet edebilir, satışa hazır bir MES'e dönüştürmek. Önce bir rekabet analizi + fazlı yol haritası sunuldu (gerçekçi çerçeve: tam Opcenter X paritesi bu ölçekte hedeflenmedi), sonra kullanıcı onayıyla v0.9 ve v1.0'ın tüm fazları soru sorulmadan uygulandı.

### v0.9 — Sağlamlaştırma (tamamlandı)
- [x] **Non-Conformance (kalite) modülü:** `NonConformance` modeli (workOrderId/productionRunId/failureType/actionType SCRAP-REWORK-BLOCKING-GENERIC/status OPEN-RESOLVED), `POST/GET /non-conformances`, `PATCH /non-conformances/:id/resolve`. **Blocking kuralı:** `ProductionService.update()`'de açık NC varken `goodCount` girişi 409 ile engellenir (diğer alanlar serbest). Web: `/non-conformances` sayfası. Test: 6/6 e2e yeşil.
- [x] **OEE hesaplama:** `GET /work-orders/:id/oee` — Quality her zaman gerçek veriden (goodCount/scrapCount), Performance yalnızca `Part.idealCycleTimeSec` girilmişse hesaplanır, **Availability bilinçli olarak null** (sistemde süre bazlı duruş takibi yok — sahte sayı üretilmedi). Web: iş emri detayında OEE kartı. Test: 4/4 e2e yeşil.
- [x] **Dokümantasyon iskeleti:** `docs/kurulum-kilavuzu.md`, `docs/kullanici-kilavuzu.md`, `docs/entegrasyon-kilavuzu.md`.
- [x] **Güvenlik özet dokümanı:** `docs/guvenlik-ozet.md` — Opcenter Security Concept'e benzer ama AHKMES'in gerçek durumunu yansıtan, IEC 62443/ISO 27001 sertifikasyonu iddia etmeyen dürüst bir doküman.
- [x] **Yedekleme:** `scripts/backup.sh` (pg_dump + gzip + retention), `scripts/restore.sh`, `docs/yedekleme.md`.

### v1.0 — İlk Satış Adayı (tamamlandı)
- [x] **Genealogy görselleştirme:** `GET /work-orders/:id/genealogy` — iş emri granülaritesinde backward (tüketilen malzeme) / forward (üretim koşuları, mamul girişi, müşteri/teklif) izlenebilirlik. **Bilinçli kapsam sınırı:** MTU/seri numarası bazlı takip yok (veri modelinde yok). Web: `/genealogy` sayfası.
- [x] **Basit Scheduling/Gantt:** `WorkOrder.plannedStartDate/plannedEndDate` (migration `add_work_order_schedule`), `PATCH /work-orders/:id/schedule`. Web: `/scheduling` — CSS-grid tabanlı 14 günlük Gantt görünümü, tıklayınca tarih düzenleme modalı. Otomatik kapasite planlama algoritması değil, manuel çizelgeleme.
- [x] **Automation Gateway — dinamik protokol seçici:** `Machine.connectorType` (MANUAL/OPC_UA/M80, migration `add_machine_connector_type`) + `connectorConfig` (Json). Web: Automation Gateway sayfasında "Bağlantı Ayarları" kartı — tip seçilince ilgili alanlar (OPC-UA: endpoint URL; M80: host/port) dinamik gösterilir. Kullanıcı geri bildirimi doğrultusunda ("hangi paneli seçersek seçelim arka planda o panelin bağlantı şekli olacak") tasarlandı.
- [x] **İkinci marka connector iskeleti (Fanuc FOCAS2):** `apps/connector/src/adapters/fanuc.adapter.ts` — `MachineAdapter` arayüzüne uyan, ama gerçek FOCAS2 native kütüphanesi (lisanslı, FFI gerektiren) entegre edilmediği için `connect()` açıkça "iskelet" hatası fırlatıyor. Çoklu-marka mimarisinin genişletilebilir olduğunu kanıtlıyor; M80'in aksine (açık kaynak reverse-engineering mevcut) Fanuc için ücretsiz bir eşdeğer yok.
- [x] **CI/CD pipeline:** `.github/workflows/ci.yml` — backend (Postgres service container + migrate + seed + typecheck + e2e), connector (typecheck+test), web (typecheck+test) olmak üzere 3 paralel job.

### Bilinçli ertelenen/yapılmayan (gerçekçi olmayan veya iş kararı gerektiren)
- Çoklu-tenant/SaaS mimarisi, IEC 62443/ISO 27001 sertifikasyonu, SLA/destek süreci, fiyatlandırma/lisanslama modeli, mobil/tablet operatör arayüzü, gerçek zamanlı otomatik APS algoritması, MTU/seri numarası bazlı genealogy — bunlar kod görevi değil, iş/pazarlama kararları veya çok daha büyük ayrı projeler.
- Fanuc FOCAS2 gerçek entegrasyonu — resmi lisans + native kütüphane gerektiriyor, iskelet ötesine geçmedi.

### Eksik giderme turu (2026-07-28) — kullanıcının "eksik kalan bir şey var mı" sorusuna verilen cevaplar
- [x] **Connector ↔ backend config bağlantısı:** `apps/connector/src/backend-config.ts` — `ADAPTER` env değişkeni verilmediyse connector, `GET /machines/:id/connector-config` (yeni, machine-key korumalı) ile web'de configure edilen `connectorType`/`connectorConfig`'i çekip kullanıyor. Env değişkenleri hâlâ öncelikli. 3 yeni test.
- [x] **Docker imajları güncellendi:** `docker compose build backend web` + `docker compose up -d` — yeni imajlar bugünkü tüm kodu içeriyor, compose Postgres'e (5434) migration'lar container açılışında otomatik uygulandı (mevcut `prisma migrate deploy` entrypoint'i sayesinde). `GET /non-conformances` compose backend'e (localhost:3000) karşı 200 döndü, doğrulandı.
- [x] **Tarayıcı QA:** `ecc:e2e-runner` agent'ı ile 4 yeni sayfa (Kalite, Genealogy, Scheduling, Automation Gateway bağlantı ayarları) + hamburger menü gerçek tarayıcıda (localhost:8080) test edildi — konsol hatası yok, tüm elemanlar bekleneni gösteriyor. Scheduling'de aktif iş emri olmadığı için tıklama-modal akışı canlı test edilemedi (veri kaynaklı, kod hatası değil).
- [x] **Yeni web sayfaları için testler:** `non-conformances.test.tsx` (3), `genealogy.test.tsx` (1), `scheduling.test.tsx` (2), `automation-gateway.test.tsx` (2) — toplam 8 yeni test, web suite 22/22 yeşil.
- [x] **Yedekleme scriptleri gerçekten çalıştırıldı:** `PG_DOCKER_CONTAINER` fallback eklendi (lokal `pg_dump`/`psql` yoksa docker exec üzerinden çalışıyor — bu ortamda gerekliydi). `backup.sh` dev Postgres'ten gerçek bir dump aldı (72K), `restore.sh` bu dump'ı geçici bir test veritabanına (`ahkmes_restore_test`) geri yükledi, `NonConformance`/`MachineTag` tablolarının doğru geldiği doğrulandı, test veritabanı temizlendi.

**Doğrulama:** connector 15/15, web 22/22, backend ilgili e2e'ler 24/24 (`--runInBand`) — hepsi yeşil.

**Doğrulama:** Tüm yeni/değişen alanlar için typecheck (backend/connector/web) temiz. e2e testleri `--runInBand` ile çalıştırıldığında (paralel worker'lar paylaşılan dev DB'de yarış durumuna yol açıyor, bu ortamsal bir kısıtlama) non-conformance/oee/machine-tags/machine-events dahil 24/24 yeşil.

## 7. Kapsam Dışı (bilinçli — Faz 2+)

Tezgah canlı izleme (geçmiş/grafik), OEE, kalite modülü, vardiya yönetimi, çizelgeleme takvimi, RLS/multi-tenant yönetim ekranları, sevkiyat.

</details>
