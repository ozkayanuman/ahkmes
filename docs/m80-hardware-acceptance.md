# SMEC MCV-5500 / Mitsubishi M80 saha kabulü

Bu prosedür iki tezgâhta **yalnızca okuma** yapan ilk bağlantı için hazırlanmıştır.
Gerçek cihaz trafiği doğrulanmadan M80 adapter'ındaki varsayımsal adresler üretim
verisi kaynağı kabul edilmez; hiçbir yazma komutu veya CNC programı transferi yoktur.

## Gerekli saha girdileri

- Her tezgâh için IP adresi, erişim portu ve ağ segmenti.
- M80 Custom API/EZSocket lisansı ve ilgili değişken listesi sürümü.
- Bakım penceresi, tezgâh sorumlusu ve geri dönüş sorumlusu.
- Edge cihazının yalnızca tezgâh VLAN'ına erişebildiğinin doğrulanması.

## Pilot sırası

1. Edge cihazında M80 connector'ı yalnızca pilot tezgâh için başlatılır.
2. TCP erişimi ve protokol el sıkışması kaydedilir; başarısızsa bağlantı kesilir.
3. Custom API dokümanındaki salt-okunur üç değer (durum, sayaç, alarm) tek tek
   okunur ve ekranla karşılaştırılır.
4. En az 10 gerçek çevrim boyunca event sırası, parça sayacı ve alarm mesajı
   operatör kaydıyla karşılaştırılır.
5. Ayrışma halinde connector durdurulur, paket/alan eşlemesi yalnızca
   `m80-protocol.ts` içinde düzeltilir ve pilot yeniden başlatılır.

## Kabul kriterleri

- Connector hiçbir write/NC-transfer çağrısı yapmaz.
- Bağlantı kesildiğinde tezgâh çalışmaya devam eder ve connector yeniden
  bağlanana kadar yeni üretim olayı göndermez.
- Sayaç, en az 10 çevrimde operatör/ekran değeriyle birebir eşleşir.
- Durum ve alarm eşlemesi belgelenir; ham trafik örneği gizli bilgi içermeden
  test kanıtına eklenir.
- Connector kapatılarak geri dönüş 60 saniye içinde doğrulanır.
