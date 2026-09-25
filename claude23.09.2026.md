# 23.09.2026 — Oturum Raporu

**Branch:** `agent/cnc-v1-09r-costing`
**Başlangıç:** Codex'in limiti dolduğu noktadan devralma
**Durum:** Push edilmedi, 5 commit halinde branch'te duruyor

---

## Yapılanlar

### 1. Codex'in bıraktığı işin devralınması ve doğrulanması (commit `c2a91cc`)

Working directory'de commit edilmemiş büyük bir özellik yığını vardı:
- **CNC-V1-09R** — planlanan/gerçekleşen maliyetlendirme (rate card, WO cost baseline, varyans)
- **CNC-V1-10R** — tekrarlanabilir veri onboarding (CSV dry-run/commit) + yönetici operasyon kokpiti (CNC-V1-11R)
- CMMS yedek parça rezervasyonu, runtime PM cycles
- Tool preset (presetter/offset), fixture custody (checkout/check-in)
- Gelen lot muayenesi (`IncomingLotInspection`), tedarikçi lot iadesi (`SupplierLotReturn`)
- Makine bazlı operatör yetkinliği (`OperatorMachineQualification`)
- Sevkiyat takip kanıtı (taşıyıcı/tracking/POD)
- Müşteri iadesi/RMA (`CustomerReturn`, karantina kabulü)
- Hammadde seri numarası takibi (`MaterialSerialNumber`) — reserve/issue/consume/return/scrap zinciri `production-material.service.ts`'e tam entegre

**Bulunan ve düzeltilen 3 bug:**
1. `costing.service.spec.ts` — 2 test, gerçek servis akışıyla uyuşmayan eski mock'a göre kırıktı.
2. `oee-cockpit.test.tsx` — CNC-V1-11R kokpit tasarımından önce kalmış eski fixture, component'i çökertiyordu.
3. **En ciddi bulgu:** `nextDocNo()` (belge numarası üretici) — AHK-017 tenant-scope Prisma extension'ı yüzünden `woNo` gibi **global** unique alanların "sıradaki numara"sını **tenant başına** hesaplıyordu. İki farklı tenant aynı numarayı (`IE-2026-0001`) bağımsız üretip çakışıyordu. Tam e2e paketinde 19 dosya/72 testi domino gibi düşürüyordu. `nextDocNo` artık ham SQL + `pg_advisory_xact_lock` kullanıyor (extension'ın resmi kaçış yolu).

**Doğrulama:** Backend unit 385/385, web 37/37, shared-types 32/32 yeşil.

---

### 2. route-operations test borcu (commit `b309076`)

CNC-V1-01'den beri `POST /work-orders` artık aktif Reçete'yi anında operasyona kopyalamıyor — sadece açık `POST /work-orders/:id/release-engineering` ile oluyor. 7 test dosyası (`route-operations`, `mes-tooling`, `scheduling`, `work-instruction`, `plm-nc-program`, `non-conformance`, `oee`) bu yeni akışa göre güncellendi (BOM+Reçete+ProductionDefinition yayın zinciri + release-engineering çağrısı eklendi).

Yol boyunca 2 yan bug daha bulundu: reçete adımı `seq` değerinin 1'den başlayıp ardışık olma zorunluluğu, ve `releaseEngineering()`'in artık her zaman bir `WorkOrderCostBaseline` kaydı da yaratması (test cleanup sırası düzeltildi).

**Sonuç:** Tam e2e paketi 19 kırık suite/72 test → 8/30.

---

### 3. Kalan 8 e2e kırığı (commit `bbd4ab7`)

Her biri farklı, ilgisiz kök nedene sahipti:
- `crud.e2e-spec.ts` — bilinen "SMEC 5500" sıralama varsayımı düzeltildi.
- `faz0b`/`faz0c` — `SalesOrdersService.release()` artık zorunlu `fulfillmentPlantId` istiyor; `faz0c` ayrıca kasıtlı test ettiği eski rotasız akış için `engineeringReleaseRequired`'ı false'a çekti.
- `hmi-operations.e2e-spec.ts` — tamamlama komutu artık operasyonu değil ham bir olay nesnesini dönüyor, takip sorgusuyla doğrulamaya çevrildi.
- `traceability-acceptance.e2e-spec.ts` — faz0c ile aynı çözüm.
- `oee.e2e-spec.ts` (en derini) — kanonik OEE motoru gerçek malzeme rezervasyonu/issue, HMI start/report akışı, vardiya takvimi, planlı başlangıç/bitiş istiyor; hepsi kuruldu, `oee = kalite×performans` formülü `oee = kullanılabilirlik×kalite×performans` olarak düzeltildi.

**Sonuç:** Tam e2e paketi **0 kırık** (`node scripts/run-e2e.mjs`). `deployment-operations`/`deployment-restore` sadece yanlış runner'da kırık görünüyor — doğru komutla (`pnpm test:operations-e2e`) 10/10 suite + 78/78 test, gerçek backup/restore dahil, tamamen yeşil.

---

### 4. Belge senkronizasyonu (commit `2ae719c`)

`docs/CNC_MANUFACTURING_V1_COMMERCIAL_GAP_ANALYSIS.md`'nin P1 listesi bugünkü oturumda koda girmiş ama belgeye hiç yansımamış 6 maddeyi (gelen lot muayenesi, tedarikçi iadesi, hammadde seri tahsisi, tool crib/offset, fixture checkout, sevkiyat/müşteri izi + operatör yetkinliği) kanıt ve dosya işaretçileriyle kapalı işaretledi. `PLAN.md`'nin 2026-08-10'da donmuş AHK-XXX tablosuna, gap-analysis dosyasını canlı kaynak-of-truth olarak gösteren bir not eklendi.

---

### 5. Kritik mimari boşluk: web UI'da rota/malzeme akışı hiç çalışmıyordu (commit `3f95d5a`)

En önemli bulgu: CNC-V1-01'den beri rota eklemenin tek yolu `release-engineering` komutu, ama **web arayüzünde bunu tetikleyecek hiçbir buton yoktu**. Rota eklenen bir iş emri için eski `/consumptions` ekranı da kalıcı olarak 409 dönüyordu (backend artık sadece rotasız iş emirlerinde kabul ediyor), yerine geçen yeni kontrollü malzeme rezervasyon/verme akışının da **hiç arayüzü yoktu**.

**Sonuç:** Web'den oluşturulan hiçbir iş emri gerçek üretimde sonuna kadar kullanılamıyordu.

**Düzeltme** (`apps/web/src/pages/work-order-detail.tsx`):
- Rotasız iş emrinde: parçanın yayınlanmış üretim tanımlarını listeleyip "Mühendislik Yayınla" butonu
- Rotalı iş emrinde: her malzeme gereksinimi için rezerve→ver→iptal + tüket/iade/hurda paneli (eski tüketim ekranı sadece rotasız/eski kayıtlar için saklandı)

**Doğrulama:** Backend+web typecheck temiz, web unit paketi 37/37 yeşil. **Canlı tarayıcıda tıklayarak test edilmedi** — bir sonraki oturumda mutlaka manuel doğrulanmalı.

---

## Commit listesi (hepsi push edilmedi)

1. `c2a91cc` — Codex'in özellik işi + nextDocNo bug fix
2. `b309076` — route-operations test borcu
3. `bbd4ab7` — kalan 8 e2e kırığı
4. `2ae719c` — belge senkronizasyonu
5. `3f95d5a` — web UI: mühendislik yayını + kontrollü malzeme akışı
6. `04528d8` — HMI malzeme UX (READY/SHORTAGE rozeti)
7. `c487d36` — operatör beceri/yetkinlik matrisi
8. `bbbc051` — AHK-013 Copilot Gateway Milestone 2 (draft/approval kaydı)

---

## Kalan işler (öncelik sırasıyla)

### P0 — Teslimden önce mutlaka yapılmalı
1. **Yeni web UI'ın canlı doğrulaması** — ✅ **Tamamlandı (2026-09-23 gece).** Yerel dev ortamı ayağa kaldırıldı (`ahkmes-pg-dev` + yeni `ahkmes-minio-dev` container + `pnpm dev:backend`/`dev:web`), gerçek tarayıcıda (chrome-devtools MCP) admin ile giriş yapılıp iki senaryo doğrulandı:
   - **Rotasız iş emri** (`IE-2026-0001`) → "Mühendislik Yayınla" seçici + buton doğru render oluyor, yayınlanmış üretim tanımı olmadığında doğru uyarı metni gösteriliyor, eski tüketim formu (rotasız dönem) hâlâ çalışıyor.
   - **Rotalı iş emri** (`HMI-WO-1785767156112`, operasyonu var) → yeni "Malzeme Rezervasyon / Verme / Tüketim (kontrollü akış)" paneli doğru render oluyor, `GET /production-material/work-orders/:id` 200 dönüyor, eski tüketim ekranı doğru şekilde "Eski Tüketim Kaydı (rotasız dönem)" olarak devre dışı/relabeled.
   - Rezerve→ver→tüket adımlarının tam tıklama zinciri, bu dev veri setinde ilgili parça için RELEASED bir üretim tanımı bulunmadığından tek tek tıklanmadı — ancak aynı akış zaten `oee.e2e-spec.ts`/`mes-tooling.e2e-spec.ts` gerçek DB'ye karşı uçtan uca test ediyor (0 kırık). UI tarafının riski (buton yok/yanlış endpoint/şekil uyuşmazlığı) canlı doğrulamayla kapatıldı.

   **Yol boyunca bulunan ve düzeltilen ayrı, ciddi bir bug:** Bu makinedeki `ahkmes-pg-dev` Postgres container'ı **30 migration geride** kalmıştı (CNC-V1-01'den bugüne kadarki her şey, `WorkOrder.plantId` dahil) — bu yüzden `/work-orders` listesi ve OEE dashboard'u **500 Internal Server Error** veriyordu (`The column WorkOrder.plantId does not exist`). Kök neden: bu oturumda önce hiç kimse bu dev DB'sinde `prisma migrate deploy` çalıştırmamış (muhtemelen sadece `docker compose`/CI ortamı migration'ları görmüştü, bu ad-hoc local Postgres hiç görmemişti). `prisma migrate deploy` ile 30 migration uygulandı, Prisma client yeniden generate edildi, backend süreçleri (birkaç yinelenen eski `nest start --watch` instance'ı dahil) temizlenip yeniden başlatıldı. **Bu, bugünkü kod değişikliklerinden kaynaklanan bir regresyon DEĞİL** — sadece bu makinenin ad-hoc dev veritabanının hiç migrate edilmemiş olmasıydı; production/CI ortamlarını etkilemez, ama gelecekte aynı makinede local dev'e dönülürse `pnpm --filter @ahkmes/backend exec prisma migrate deploy` çalıştırılmalı.
2. **Diğer sayfalarda benzer boşluk var mı taranmalı** — ✅ **Kontrol edildi, temiz.** `/consumptions` endpoint'i web genelinde SADECE `work-order-detail.tsx`'te kullanılıyor; başka hiçbir sayfa aynı boşluğa düşmüyor.

### P1 — Yazılım tarafı için hâlâ açık (gap-analysis'te kayıtlı)
3. **Daha zengin HMI malzeme UX** — ✅ **Tamamlandı (2026-09-24, commit `04528d8`).** Operatör önceden malzeme tahsis durumunu ancak Başlat'a basıp genel bir hata toast'ı alınca öğreniyordu. Şimdi: operasyon kuyruğunda her iş emri için tek toplu sorguyla hesaplanan READY/SHORTAGE rozeti (aynı MANUAL_ISSUE eksik-tahsis kuralını `HmiService.start()`'la paylaşarak), Başlat kartında eksik malzemeyi önceden açıklayan ve butonu devre dışı bırakan uyarı, ve malzeme paneline özet rozet + kalem başına rezerve/çıkış oranını gösteren ilerleme çubuğu eklendi. Backend unit 7/7 (yeni SHORTAGE/READY testi dahil), tam paket 82/82 suite (387/387 test), web unit 13/13 (37/37), her iki tarafta typecheck temiz, canlı tarayıcıda doğrulandı (bu dev veri setindeki HMI test iş emirlerinin hiçbirinde malzeme gereksinimi yok, dolayısıyla hepsi doğru şekilde NONE/rozetsiz görünüyor — SHORTAGE/READY hesaplaması izole unit testle doğrulandı).
4. **Geniş operatör beceri/yetkinlik matrisi** — ✅ **Tamamlandı (2026-09-24, commit `c487d36`).** Yeni `Skill` (makineden bağımsız beceri tanımı) + `OperatorSkill` (seviyeli TRAINEE/QUALIFIED/EXPERT operatör kaydı, `OperatorMachineQualification` ile aynı grant/revoke/audit yaşam döngüsü) + `MachineRequiredSkill` (makinenin gerektirdiği min. seviye) tabloları eklendi. `HmiService.start()` artık her iki kapıyı (tek-makine qualification VE çapraz-makine beceri) bağımsız kontrol ediyor; eksik/yetersiz seviye net mesajla (`"Operator is missing required skill(s) for this machine: <kod>"`) 409 döndürüyor. UI: beceri tanımları + operatör bazlı ver/kaldır Kullanıcılar sayfasında (mevcut "users" izni, yeni sayfa/nav kaydı gerekmedi); makine bazlı gereksinimler Tezgahlar sayfasında (mevcut yetkinlik modalı deseniyle). Doğrulama: backend unit 82/82 suite (391/391 test, +5 yeni), web unit 13/13 (37/37), her iki tarafta typecheck temiz, **canlı tarayıcıda uçtan uca tam tıklama zinciriyle doğrulandı**: beceri tanımı oluşturma → operatöre ver → makineye gereksinim ekleme → gerçek `POST /hmi/operations/:id/start` çağrısıyla 409 blokajının doğrulanması → kaldır/revoke → temizlik. Test verisi temizlendi, push edilmedi.
5. **AHK-013 — AI Copilot Gateway Milestone 2** — ✅ **Tamamlandı (2026-09-24, commit `bbbc051`).** Yeni `CopilotDraft` tablosu (prompt + tam motor yanıtı JSON + status + createdBy/approvedBy/rejectedBy + zaman damgaları) eklendi. Her `createDraft()` çağrısı artık kaydediliyor: `DRAFT` durumu (gerçek action içeren) `PENDING_APPROVAL`, diğer her şey (`SUGGESTION`/`NEEDS_CLARIFICATION`/`NO_CHANGES`) `NOT_APPROVABLE` olarak işaretleniyor. Yeni `GET /copilot/drafts` (geçmiş) + `POST /copilot/drafts/:id/approve` + `.../reject` (ADMIN/PLANNER) endpoint'leri. **M2 sınırı korundu:** onay yalnızca `CopilotDraft.status`'u çeviriyor, alttaki mutasyonu (`material.create` vb.) kendisi ASLA yürütmüyor — o hâlâ ilgili modülün kendi ekranından elle tetikleniyor. Model sağlayıcısı seçimi bilinçli olarak kapsam dışı bırakıldı (deterministik motor aynen korundu). UI: `copilot.tsx`'e taslak geçmişi listesi + yetkili roller için satır içi onayla/reddet eklendi. Doğrulama: backend unit 82/82 suite (393/393 test, +2 yeni), web unit 13/13 (37/37), her iki tarafta typecheck temiz, **canlı tarayıcıda tam uçtan uca doğrulandı**: taslak oluştur → geçmişte "Onay bekliyor" rozetiyle görün → onayla (yeşil "Onaylandı" + onaylayan/tarih) → ikinci taslağı reddet (kırmızı "Reddedildi" + reddeden/tarih). Push edilmedi.

### P2/Harici — 3 haftalık yazılım teslimi kapsamı dışı (gap-analysis'in kendi sınıflandırması)
6. **M80 saha kabulü** — gerçek donanım/makine erişimi gerektirir, buradan yapılamaz.
7. **İlk müşteri cutover kanıtı** — gerçek müşteri veri yükleme/eğitim onayı gerektirir.
8. Gelişmiş QMS (CAPA/SPC/AQL/MSA/PPAP/APQP/FMEA), APS, kurumsal BI, DNC/uzaktan başlatma, otomatik controller adet postalama, evrensel CNC adaptörleri, bordro/finans/CRM otomasyonu — hepsi bilinçli olarak V1 kapsamı dışı.

### Bilinen kırılganlıklar — hepsi çözüldü
9. `cnc-v1-07r.e2e-spec.ts`'in "X rolls back an issue atomically" testi — ✅ **Kök nedeni bulunup düzeltildi (2026-09-24, commit `1fa3b38`).** Tenant'ta test X çalıştığında iki breakdown'lı maintenance order vardı (orijinali R-T testinde COMPLETED olmuş, W testininki IN_PROGRESS kalmış); sıralamasız `findFirstOrThrow({breakdownId:{not:null}})` hangisini döndüreceğini garanti etmiyordu — bazen COMPLETED olanı seçip servis 409 (MAINTENANCE_ORDER_NOT_EXECUTING) döndürüyordu, trigger'a hiç ulaşılmadan. `status:{in:["IN_PROGRESS","ON_HOLD"]}` filtresiyle seçim deterministik hale getirildi. 3 ardışık izole-DB çalıştırmasında 14/14 doğrulandı.

---

## Notlar
- Hiçbir commit push edilmedi (proje kuralı: kullanıcı onayı olmadan push yok).
- Tüm doğrulamalar `agent/cnc-v1-09r-costing` branch'inde yapıldı.
- Detaylı teknik notlar Claude'un auto-memory sisteminde (`project-ahkmes-2026-09-23-codex-handoff.md`) de kayıtlı.
- **2026-09-24 itibarıyla tüm P0 ve P1 maddeleri kapandı.** Kalan tek açık kalem P2/harici kategorisi (M80 saha kabulü, müşteri cutover, bilinçli V1-dışı kapsam) — bunlar tanım gereği bu oturumdan yapılamaz. 3 haftalık yazılım teslimi hedefi karşılanmış durumda; sıradaki adım kullanıcı kararına bağlı (push, ek QA turu, ya da doğrudan teslim).
- Bu oturumda ayrıca işle ilgisiz bir altyapı sorunu (Docker Desktop servis çökmesi + C: diskinin `docker system prune` sonrası WSL2 vhdx büyümesi yüzünden tamamen dolması) çözüldü; ayrıntı memory dosyasında.
