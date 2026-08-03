# Air-gapped kurulum ve felaket kurtarma

Air-gapped pakette container image'ları, pnpm bağımlılıkları, migration'lar,
SBOM/checksum manifesti ve imzalı sürüm notu çevrimdışı taşınmalıdır. İnternete
erişim gerektiren telemetry, AI sağlayıcısı ve webhook'lar varsayılan kapalıdır.

`scripts/backup.sh` PostgreSQL logical backup alır. Üretim kabulü ayrıca şunları
kanıtlamalıdır: şifreli yedek hedefi, MinIO belge yedeği, restore drill, migration
rollback sınırı, anahtar/secret rotasyonu ve erişim günlüğü. Restore, boş bir
izole ortamda uygulama + PostgreSQL + belge deposu birlikte doğrulanmadan başarılı
sayılmaz.
