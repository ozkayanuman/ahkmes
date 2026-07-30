import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { lookup } from "node:dns/promises";
import type { CreateWebhookSubscriptionDto, UpdateWebhookSubscriptionDto } from "@ahkmes/shared-types";
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

async function resolvesToPrivateIp(hostname: string): Promise<boolean> {
  const clean = hostname.replace(/^\[|\]$/g, "");
  if (isIPv4(clean) || isIPv6(clean)) return isPrivateIp(clean);
  try {
    const results = await lookup(clean, { all: true });
    return results.length === 0 || results.some((r) => isPrivateIp(r.address));
  } catch {
    return true; // çözülemiyorsa güvenli tarafta kal
  }
}

/** Faz J Developer Platform: dış sistemlere olay bildirimi. RealtimeGateway'in
 * mevcut emitToTenant() çağrı noktalarının tamamı (workorder.updated,
 * nonconformance.created, alarms.updated vb. — app genelinde ~30 yer)
 * otomatik olarak webhook kaynağı olur; her servisi tek tek değiştirmek
 * gerekmez. Teslim fire-and-forget'tir — cron/kuyruk/retry yok (MVP kapsamı),
 * lastStatus sadece son deneme görünürlüğü içindir. */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  /** Fire-and-forget — çağıran (RealtimeGateway) bunu await ETMEMELİDİR, aksi
   * halde her socket olayı dış URL'in yanıt hızına bağımlı hale gelir. */
  dispatch(tenantId: string, event: string, payload: unknown) {
    void this.deliverAll(tenantId, event, payload);
  }

  private async deliverAll(tenantId: string, event: string, payload: unknown) {
    let subs;
    try {
      subs = await this.prisma.webhookSubscription.findMany({
        where: { tenantId, isActive: true, OR: [{ event }, { event: "*" }] },
      });
    } catch (err) {
      this.logger.warn(`Webhook abonelikleri okunamadı: ${err instanceof Error ? err.message : err}`);
      return;
    }

    await Promise.all(subs.map((sub) => this.deliverOne(sub.id, sub.url, sub.secret, event, tenantId, payload)));
  }

  private async deliverOne(
    id: string,
    url: string,
    secret: string | null,
    event: string,
    tenantId: string,
    payload: unknown,
  ) {
    const body = JSON.stringify({ event, tenantId, payload, timestamp: new Date().toISOString() });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) {
      headers["X-Webhook-Signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    }

    let status: "success" | "failed";
    try {
      const hostname = new URL(url).hostname;
      if (await resolvesToPrivateIp(hostname)) {
        // Kayıt anında public olan bir domain sonradan private bir IP'ye
        // yönlendirilmiş (DNS rebinding) veya create()'ten sonra manipüle
        // edilmiş olabilir — her teslimde yeniden doğrulanır.
        this.logger.warn(`Webhook ${id}: hedef artık özel/yerel bir IP'ye çözülüyor, teslim engellendi`);
        status = "failed";
      } else {
        // redirect: "manual" — bir yönlendirmeyi izlemek, hedefin private bir
        // adrese SSRF yapmasının en yaygın yoludur; 3xx burada başarısız sayılır.
        const res = await fetch(url, {
          method: "POST",
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        status = res.ok ? "success" : "failed";
      }
    } catch {
      status = "failed";
    }

    await this.prisma.webhookSubscription
      .update({ where: { id }, data: { lastTriggeredAt: new Date(), lastStatus: status } })
      .catch(() => undefined);
  }
}
