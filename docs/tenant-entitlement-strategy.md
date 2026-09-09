# Tenant ve modül entitlement stratejisi

Mevcut API'ler tenantId ile filtrelenir; bu ürün lisanslaması veya veritabanı
RLS'si değildir. Ticari modül açma/kapama için tenant başına modül anahtarı,
geçerlilik süresi, kapasite limiti ve denetlenebilir lisans değişiklik kaydı
gereklidir.

Entitlement kontrolü route/UI gizleme değil, application command sınırı olmalıdır.
İlk ürün varyantı PostgreSQL shared-schema + zorunlu tenant filtreleriyle başlar;
cloud sürümünde negatif tenant-isolation E2E testleri, ardından RLS değerlendirmesi
zorunludur. On-premise tek-tenant kurulumda da tenant context kaldırılmaz.
