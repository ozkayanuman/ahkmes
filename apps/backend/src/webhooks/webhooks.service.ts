import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { CreateWebhookSubscriptionDto, UpdateWebhookSubscriptionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
];

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
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(parsed.hostname))) {
    throw new BadRequestException("Webhook URL'i yerel/özel ağ adresine işaret edemez");
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
      const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
      status = res.ok ? "success" : "failed";
    } catch {
      status = "failed";
    }

    await this.prisma.webhookSubscription
      .update({ where: { id }, data: { lastTriggeredAt: new Date(), lastStatus: status } })
      .catch(() => undefined);
  }
}
