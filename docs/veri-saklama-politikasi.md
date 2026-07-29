# AHKMES Veri Saklama Politikası (Kayıt Saklama)

**Not:** Bu doküman, gerçek bir hukuki/kalite danışmanlığının yerine geçmez; AHKMES'in mevcut teknik durumunu ve benimsenen ilkeleri özetler.

## 1. Denetim İzi (AuditLog)

- **Minimum saklama süresi:** IATF 16949 gereği, son teslimattan itibaren en az **15 yıl**.
- **Uygulanan teknik ilke:** `AuditLog` tablosu DB seviyesinde **süresiz ve koşulsuz immutable**'dır (bkz. migration `20260729212905_add_audit_log_immutability` — Postgres trigger, UPDATE/DELETE'i tüm istemciler için reddeder, INSERT serbesttir).
- **Bilinçli karar (2026-07-30):** 15 yıl dolduğunda otomatik silme/arşivleme mekanizması **şu an kurulmamıştır**. Trigger koşulsuz olduğu için hiçbir kayıt — 15 yıldan eski olsa dahi — bugün itibarıyla silinemez. Bu, "asla kaybolmayan denetim izi" ilkesini "15 yıl sonra silinebilir" esnekliğine tercih eden bilinçli bir güvenlik/uyumluluk kararıdır (depolama maliyeti düşük, veri kaybı riski sıfır).
- **İleride değerlendirilecek:** 15 yıl sonrası için gerçek bir arşivleme/purge akışı gerekirse (örn. depolama maliyeti veya KVKK "amaçla sınırlılık" ilkesi baskı yaparsa), trigger'ın ADMIN-only, tarih-sınırlı ve önce ayrı bir arşive kopyalayan bir "purge" fonksiyonuyla bypass edilmesi ayrı bir görev olarak ele alınmalı — şu an kapsam dışıdır.

## 2. Diğer İşlemsel Veriler (WorkOrder, ProductionRun, NonConformance, vb.)

- Şu an için **süresiz saklanır** — otomatik silme/arşivleme yok.
- Kalite kayıtları (NonConformance, gelecekte SPC/CAPA) için de IATF 16949 15 yıl kuralı geçerli kabul edilir; ayrı bir immutability kısıtı henüz yok (yalnızca AuditLog için uygulandı — asıl kayıtlar hâlâ düzenlenebilir/silinebilir, ancak her değişiklik AuditLog'a düşer ve o iz artık kalıcıdır).

## 3. KVKK ile İlişki

- KVKK'nın "amaçla sınırlılık ve saklama süresiyle sınırlılık" ilkesi ile IATF 16949'un "15 yıl sakla" zorunluluğu potansiyel olarak gerilim yaratabilir (kişisel veri içeren AuditLog kayıtları için). Bu gerilim, ayrı görev olan KVKK kişisel veri envanteri çalışmasında ele alınacaktır (bkz. TaskList görev #3).
