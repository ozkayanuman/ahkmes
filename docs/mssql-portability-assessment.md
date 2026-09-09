# MSSQL taşınabilirlik değerlendirmesi

Durum: **PostgreSQL resmî uygulama veritabanıdır. Microsoft SQL Server desteklenmez.**
Bu belge 2026-08-02'de kaynak koddan çıkarılmış envanterdir; Oracle ERP ile
entegrasyon, Oracle veya MSSQL'in AHKMES uygulama veritabanı olmasıyla aynı konu
değildir.

## Doğrulanmış engeller

| Alan | Kaynak kanıtı | MSSQL etkisi | Gerekli çalışma |
|---|---|---|---|
| Prisma datasource | `apps/backend/prisma/schema.prisma` | `provider = "postgresql"`; ayrı client, migration ve CI matrisi gerekir | Ayrı SQL Server schema/migration stratejisi ve driver POC |
| Sayısal alanlar | Prisma şemasındaki çok sayıda `@db.Decimal(p,s)` | Tip eşlemesi ve hassasiyet sınırları MSSQL üzerinde ayrıca doğrulanmalı | Kritik stok/finans/ölçüm değerleri için kontrat testi |
| JSON alanları | İlk migration ve webhook outbox migration'ındaki `JSONB` | SQL Server `JSONB` veri türü sunmaz | JSON veri sahipliği, indeksleme ve sorgu kontratının yeniden tasarımı |
| Stok atomik upsert'i | `apps/backend/src/inventory/inventory.service.ts` | PostgreSQL cast (`::StockItemType`), `IS NOT DISTINCT FROM`, expression conflict target, `EXCLUDED` ve `RETURNING` kullanır | SQL Server `MERGE`/kilitleme veya saklı yordam alternatifi; eşzamanlı negatif stok testleri |
| SQL migration'ları | `apps/backend/prisma/migrations/**/migration.sql` | `ON CONFLICT`, expression unique index ve PostgreSQL DDL'si taşınamaz | Her migration için MSSQL eşleniği; fresh migrate/rollback CI |
| Test ortamı | Docker Compose/E2E PostgreSQL odaklı | MSSQL için hiçbir clean-db veya concurrency kanıtı yok | İzole MSSQL container/CI job ve aynı E2E senaryoları |

## Karar ve yol haritası

1. PostgreSQL ilk ve tek resmî uygulama veritabanı olarak kalır.
2. Oracle/SAP/Canias/Logo gibi sistemler için önce Integration Gateway sözleşmesi
   ve seçilen adapter uygulanır; bu çalışma database portability içermez.
3. MSSQL ticari gereksinime dönüşürse önce dar bir POC açılır: yalnız auth,
   master data ve immutable inventory ledger. Stok eşzamanlılık ve outbox
   kontratları geçmeden destek beyan edilmez.
4. POC başarılı olursa Prisma/migration stratejisi, provider-özgü repository
   portu ve PostgreSQL+MSSQL CI matrisi ürünleştirilir.

## Kabul kriterleri (gelecek iş)

- Aynı migration seti boş PostgreSQL ve boş SQL Server ortamında uygulanır.
- Tenant izolasyonu, lot/seri, stok hareketi, negatif stok engeli ve audit E2E
  senaryoları iki sağlayıcıda da geçer.
- SQL Server'a özel kod yalnız inventory concurrency portunda kalır; domain
  servisleri sağlayıcı ayrıntısı bilmez.
- Yedekleme/geri yükleme ve performans sınırları müşteri yüküyle belgelenir.
