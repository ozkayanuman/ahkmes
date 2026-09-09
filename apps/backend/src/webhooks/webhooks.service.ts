import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { CreateWebhookSubscriptionDto, UpdateWebhookSubscriptionDto } from "@ahkmes/shared-types";
import { Prisma, WebhookDeliveryStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** Regex yerine gerçek sayısal IPv4 ayrıştırma — "0x7f000001" gibi alternatif
 * yazımların yanlışlıkla geçmesini önler (regex sadece nokta-ayraçlı ondalık
 * biçimi tanır, biçim dışı her şey aşağıda "özel" kabul edilir). */
function ipv4ToInt(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  let result = 0;
  for (const o of octets) {
    if (!/^\d{1,3}$/.test(o)) return null;
    const n = Number(o);
    if (n > 255) return null;
    result = (result << 8) + n;
  }
  return result >>> 0;
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // ayrıştırılamayan biçim — güvenli tarafta kal
  return (
    inCidr(n, "10.0.0.0", 8) ||
    inCidr(n, "172.16.0.0", 12) ||
    inCidr(n, "192.168.0.0", 16) ||
    inCidr(n, "127.0.0.0", 8) ||
    inCidr(n, "169.254.0.0", 16) ||
    n === 0
  );
}

/** Bir IP'nin (v4 veya v6) yerel/özel/link-local/ULA aralığında olup
 * olmadığını — hostname string'i üzerinde değil, gerçek çözülmüş adres
 * üzerinde kontrol eder (bkz. resolvesToPrivateIp — DNS rebinding koruması). */
function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIpv4(ip);
  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
  }
  return true; // tanınmayan biçim — güvenli tarafta kal
}

function assertPublicUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException("Geçersiz webhook URL'i");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestException("Webhook URL'i http(s) olmalı");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const isLiteralIp = isIPv4(hostname) || isIPv6(hostname);
  if (hostname.toLowerCase() === "localhost" || (isLiteralIp && isPrivateIp(hostname))) {
    throw new BadRequestException("Webhook URL'i yerel/özel ağ adresine işaret edemez");
  }
  // Hostname bir domain adıysa burada DNS çözülmez — asıl güvenlik sınırı her
  // teslimde deliverOne()'daki resolvesToPrivateIp() kontrolüdür (bkz. orada:
  // onay anında public olan bir domain sonradan private bir IP'ye
  // yönlendirilebilir — "DNS rebinding").
}

/** Hostname'i TEK SEFER çözüp doğrulanmış bir IP döndürür (veya güvensizse
 * null). Önceki sürüm burada true/false dönüp fetch'in DNS'i KENDİ İÇİNDE
 * ikinci kez çözmesine izin veriyordu — kontrol ile gerçek istek arasında
 * DNS rebinding için bir TOCTOU penceresi açıyordu. Artık bu fonksiyonun
 * döndürdüğü IP'ye doğrudan bağlanılıyor (bkz. deliverOne/pinnedRequest),
 * ikinci bir çözümleme hiç yapılmıyor. */
async function resolveSafeIp(hostname: string): Promise<string | null> {
  const clean = hostname.replace(/^\[|\]$/g, "");
  if (isIPv4(clean) || isIPv6(clean)) return isPrivateIp(clean) ? null : clean;
  try {
    const results = await lookup(clean, { all: true });
    if (results.length === 0 || results.some((r) => isPrivateIp(r.address))) return null;
    return results[0].address;
  } catch {
    return null; // çözülemiyorsa güvenli tarafta kal
  }
}

/** Bağlantıyı doğrudan (önceden doğrulanmış) `ip`'ye kurar — hostname sadece
 * TLS SNI/sertifika doğrulaması ve Host header'ı için kullanılır, ikinci bir
 * DNS çözümlemesi TETİKLENMEZ. Yönlendirmeler asla izlenmez (3xx = failed). */
function pinnedRequest(
  targetUrl: string,
  ip: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ ok: boolean }> {
  const parsed = new URL(targetUrl);
  const isHttps = parsed.protocol === "https:";
  const requester = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = requester(
      {
        hostname: ip,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: { ...headers, Host: parsed.host },
        // TLS sertifika doğrulaması + SNI orijinal hostname'e karşı yapılır —
        // sadece bağlantının fiziksel adresi pinlenir, kimlik doğrulaması gevşemez.
        ...(isHttps ? { servername: parsed.hostname } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        const code = res.statusCode ?? 0;
        resolve({ ok: code >= 200 && code < 300 });
      },
    );
    req.on("timeout", () => req.destroy(new Error("webhook isteği zaman aşımına uğradı")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Faz J Developer Platform: dış sistemlere olay bildirimi. RealtimeGateway'in
 * mevcut emitToTenant() çağrı noktalarının tamamı (workorder.updated,
 * nonconformance.created, alarms.updated vb. — app genelinde ~30 yer)
 * otomatik olarak webhook kaynağı olur; her servisi tek tek değiştirmek
 * gerekmez. Teslim fire-and-forget'tir — cron/kuyruk/retry yok (MVP kapsamı),
 * lastStatus sadece son deneme görünürlüğü içindir. */
@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private deliveryTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxAttempts = 8;
  private readonly lockMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.processPending();
    this.deliveryTimer = setInterval(() => void this.processPending(), 5_000);
    this.deliveryTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.deliveryTimer = null;
  }

  findAll(tenantId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  create(tenantId: string, userId: string, dto: CreateWebhookSubscriptionDto) {
    assertPublicUrl(dto.url);
    return this.prisma.webhookSubscription.create({
      data: { ...dto, tenantId, createdById: userId },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateWebhookSubscriptionDto) {
    const existing = await this.prisma.webhookSubscription.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException("Webhook aboneliği bulunamadı");
    if (dto.url) assertPublicUrl(dto.url);
    return this.prisma.webhookSubscription.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.webhookSubscription.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException("Webhook aboneliği bulunamadı");
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { id };
  }

  findDeliveries(tenantId: string, status?: WebhookDeliveryStatus) {
    return this.prisma.webhookDeliveryEvent.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { occurredAt: "desc" },
      take: 100,
    });
  }

  async replayDelivery(tenantId: string, id: string) {
    const delivery = await this.prisma.webhookDeliveryEvent.findFirst({ where: { id, tenantId } });
    if (!delivery) throw new NotFoundException("Webhook teslim kaydı bulunamadı");
    if (delivery.status !== "DEAD_LETTER") {
      throw new BadRequestException("Yalnızca dead-letter teslim kayıtları tekrar oynatılabilir");
    }
    return this.prisma.webhookDeliveryEvent.update({
      where: { id },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lockedUntil: null, lastError: null },
    });
  }

  /** Fire-and-forget — çağıran (RealtimeGateway) bunu await ETMEMELİDİR, aksi
   * halde her socket olayı dış URL'in yanıt hızına bağımlı hale gelir. */
  dispatch(tenantId: string, event: string, payload: unknown, eventId: string = randomUUID()) {
    void this.enqueueDeliveries(tenantId, event, payload, eventId);
  }

  private async enqueueDeliveries(tenantId: string, event: string, payload: unknown, eventId: string) {
    let subs;
    try {
      subs = await this.prisma.webhookSubscription.findMany({
        where: { tenantId, isActive: true, OR: [{ event }, { event: "*" }] },
      });
    } catch (err) {
      this.logger.warn(`Webhook abonelikleri okunamadı: ${err instanceof Error ? err.message : err}`);
      return;
    }

    if (subs.length === 0) return;
    const envelope = { eventId, event, tenantId, payload, timestamp: new Date().toISOString() };
    await this.prisma.webhookDeliveryEvent
      .createMany({
        data: subs.map((sub) => ({
          tenantId,
          subscriptionId: sub.id,
          eventId,
          event,
          payload: envelope as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      })
      .catch((err) => this.logger.error(`Webhook teslim kaydı oluşturulamadı: ${err instanceof Error ? err.message : err}`));
  }

  /** Birden çok backend instance'ı aynı olayı göndermesin diye kısa süreli bir
   * DB claim alınır; kapanan worker'ın kilidi süre bitiminde yeniden denenir. */
  async processPending() {
    const now = new Date();
    await this.prisma.webhookDeliveryEvent.updateMany({
      where: { status: "PROCESSING", lockedUntil: { lt: now } },
      data: { status: "PENDING", lockedUntil: null },
    }).catch(() => undefined);

    const candidates = await this.prisma.webhookDeliveryEvent.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { occurredAt: "asc" },
      take: 20,
    }).catch((err) => {
      this.logger.error(`Webhook kuyruğu okunamadı: ${err instanceof Error ? err.message : err}`);
      return [];
    });
    await Promise.all(candidates.map((delivery) => this.processOne(delivery.id)));
  }

  private async processOne(id: string) {
    const now = new Date();
    const claim = await this.prisma.webhookDeliveryEvent.updateMany({
      where: { id, status: "PENDING", nextAttemptAt: { lte: now } },
      data: { status: "PROCESSING", lockedUntil: new Date(now.getTime() + this.lockMs) },
    });
    if (claim.count !== 1) return;

    const delivery = await this.prisma.webhookDeliveryEvent.findUnique({ where: { id } });
    if (!delivery) return;
    const subscription = await this.prisma.webhookSubscription.findFirst({
      where: { id: delivery.subscriptionId, tenantId: delivery.tenantId, isActive: true },
      select: { id: true, url: true, secret: true },
    });
    if (!subscription) {
      await this.failDelivery(delivery.id, delivery.attempts, "Abonelik bulunamadı veya etkin değil", true);
      return;
    }

    const delivered = await this.deliverOne(subscription.id, subscription.url, subscription.secret, delivery.payload);
    if (delivered) {
      await this.prisma.webhookDeliveryEvent.update({
        where: { id: delivery.id },
        data: { status: "DELIVERED", attempts: delivery.attempts + 1, deliveredAt: new Date(), lockedUntil: null, lastError: null },
      });
    } else {
      await this.failDelivery(delivery.id, delivery.attempts, "Teslim başarısız", false);
    }
  }

  private async failDelivery(id: string, attempts: number, error: string, permanent: boolean) {
    const nextAttempts = attempts + 1;
    const deadLetter = permanent || nextAttempts >= this.maxAttempts;
    const delayMs = Math.min(1_000 * 2 ** Math.min(nextAttempts, 8), 15 * 60_000);
    await this.prisma.webhookDeliveryEvent.update({
      where: { id },
      data: {
        status: deadLetter ? "DEAD_LETTER" : "PENDING",
        attempts: nextAttempts,
        lockedUntil: null,
        lastError: error.slice(0, 1_000),
        nextAttemptAt: new Date(Date.now() + delayMs),
      },
    });
  }

  private async deliverOne(
    id: string,
    url: string,
    secret: string | null,
    payload: Prisma.JsonValue,
  ) {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) {
      headers["X-Webhook-Signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    }

    let status: "success" | "failed";
    try {
      const hostname = new URL(url).hostname;
      const safeIp = await resolveSafeIp(hostname);
      if (!safeIp) {
        // Kayıt anında public olan bir domain sonradan private bir IP'ye
        // yönlendirilmiş (DNS rebinding) veya create()'ten sonra manipüle
        // edilmiş olabilir — her teslimde yeniden doğrulanır.
        this.logger.warn(`Webhook ${id}: hedef artık özel/yerel bir IP'ye çözülüyor, teslim engellendi`);
        status = "failed";
      } else {
        // Bağlantı yukarıda doğrulanan IP'ye PINLENIR — global fetch/undici'nin
        // isteği gönderirken hostname'i KENDİSİ yeniden çözmesine izin
        // verilmez, aksi halde kontrol ile istek arasında ikinci bir DNS
        // çözümlemesi (TOCTOU) SSRF'e yeniden açık kapı bırakırdı. Yönlendirme
        // hiç izlenmez (3xx = failed) — pinnedRequest yönlendirme takip etmez.
        const res = await pinnedRequest(url, safeIp, headers, body, 5000);
        status = res.ok ? "success" : "failed";
      }
    } catch {
      status = "failed";
    }

    await this.prisma.webhookSubscription
      .update({ where: { id }, data: { lastTriggeredAt: new Date(), lastStatus: status } })
      .catch(() => undefined);
    return status === "success";
  }
}
