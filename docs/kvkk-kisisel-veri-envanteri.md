# AHKMES KVKK Kişisel Veri Envanteri

**Not:** Bu doküman gerçek bir hukuki KVKK uyum sürecinin (VERBİS kaydı, aydınlatma metni, açık rıza akışı vb.) yerine geçmez; kod tabanındaki kişisel veri içeren alanların envanterini çıkarır. Amaç, ileride yapılacak KVKK uyum çalışmasına (aydınlatma metni, silme/anonimleştirme talebi işleme, VERBİS) teknik bir başlangıç noktası vermektir.

## Kişisel veri içeren tablolar

| Tablo | Alan | Veri kategorisi | Not |
|---|---|---|---|
| `User` | `email`, `name` | Kimlik/iletişim | Çalışan/kullanıcı verisi. `passwordHash`/`refreshTokenHash` kişisel veri değil ama hassas kimlik doğrulama verisi — zaten hash'li, düz metin tutulmuyor. |
| `User` | `externalDn` | Kimlik | LDAP/AD distinguishedName — dolaylı kimlik bilgisi içerebilir (örn. `CN=Ad Soyad,OU=...`). |
| `Customer` | `contactName`, `email`, `phone`, `address` | Kimlik/iletişim | Müşteri firma yetkilisinin kişisel verisi (tüzel kişi verisi değil, iletişim kişisi). |
| `Supplier` | `contactName`, `email`, `phone`, `address` | Kimlik/iletişim | Tedarikçi firma yetkilisinin kişisel verisi. |
| `LdapConfig` | `bindPasswordEnc` | Kimlik doğrulama (şifreli) | Şirketin AD servis hesabı şifresi — kişisel veri değil ama hassas sır; JWT_SECRET türetilmiş anahtarla şifreli saklanıyor (bkz. `ldap` modülü). |
| `AuditLog` | `before`/`after` (JSON, serbest form) | Değişken | Yukarıdaki tablolardaki kişisel veri alanlarının değişiklik geçmişini içerebilir — **immutable** (bkz. [veri-saklama-politikasi.md](./veri-saklama-politikasi.md)), bu yüzden silme/düzeltme talebi bu tabloda teknik olarak uygulanamaz; bu durum KVKK "silme hakkı" ile potansiyel gerilim yaratır (aşağıya bakınız). |
| `Document` | dosya içeriği (serbest form) | Değişken | Yüklenen STEP/PDF/talimat dosyaları kişisel veri içerebilir (örn. imzalı bir doküman) — içerik denetlenmez, sorumluluk yükleyen kullanıcıdadır. |

## Kişisel veri İÇERMEYEN ana tablolar (netlik için)

`Part`, `Material`, `Machine`, `WorkOrder`, `ProductionRun`, `PurchaseOrder`, `NonConformance`, `PermissionGroup` — bunlar üretim/işletme verisi taşır, doğrudan kişisel veri alanı içermez (yalnızca `userId` FK ile `User`'a referans verirler).

## Bilinen gerilim: "Silme hakkı" vs AuditLog immutability

`AuditLog.before`/`after` alanları, silinen/değiştirilen bir `Customer.email` gibi kişisel veriyi JSON içinde kalıcı olarak taşıyabilir. AuditLog artık DB seviyesinde immutable olduğu için (bkz. saklama politikası dokümanı), bir kişinin KVKK md.7 "silme/yok etme" talebini AuditLog üzerinde teknik olarak karşılamak mümkün değildir. Bu, IATF 16949 (15 yıl sakla) ile KVKK (silme hakkı) arasındaki bilinen bir gerilimdir; gerçek bir üretim dağıtımı öncesi hukuki danışmanlıkla ele alınmalıdır (olası çözüm: AuditLog'da kişisel veri alanlarını serbest JSON yerine referans/hash ile tutmak — bu, ayrı bir mimari karar ve kapsam dışıdır).

## Sonraki adımlar (kapsam dışı, ileride ayrı görev)

- Aydınlatma metni / açık rıza akışı (Customer/Supplier iletişim kişisi için).
- VERBİS kaydı gerekip gerekmediğinin değerlendirilmesi (veri sorumlusu ölçütlerine göre).
- Silme/anonimleştirme talebi işleme prosedürü (AuditLog gerilimi çözülene kadar kısmi).
