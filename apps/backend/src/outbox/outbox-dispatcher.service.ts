import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

/** AHK-009: OutboxEvent tablosundaki satırları en-az-bir-kez tüketip
 * RealtimeGateway.emitToTenant'a (socket yayını + webhook enqueue, bkz.
 * emitToTenant içindeki webhooks.dispatch) çevirir. Desen
 * WebhooksService.processPending/processOne/failDelivery ile birebir
 * aynıdır (claim+lock, üstel backoff, dead-letter) — tek fark event'in
 * "teslimi" HTTP isteği değil, senkron emitToTenant çağrısıdır; asıl
 * dış-sistem dayanıklılığı zaten WebhookDeliveryEvent kuyruğunda sağlanır,
 * buradaki dayanıklılık garantisi "domain transaction commit oldu ama
 * process emitToTenant'ı hiç çağırmadan çöktü" senaryosunu kapatmaktır. */
@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxAttempts = 8;
  private readonly lockMs = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit() {
    void this.processPending();
    this.timer = setInterval(() => void this.processPending(), 5_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processPending() {
    const now = new Date();
    await this.prisma.outboxEvent
      .updateMany({
        where: { status: "PROCESSING", lockedUntil: { lt: now } },
        data: { status: "PENDING", lockedUntil: null },
      })
      .catch(() => undefined);

    const candidates = await this.prisma.outboxEvent
      .findMany({
        where: { status: "PENDING", nextAttemptAt: { lte: now } },
        orderBy: { occurredAt: "asc" },
        take: 20,
      })
      .catch((err) => {
        this.logger.error(`Outbox kuyruğu okunamadı: ${err instanceof Error ? err.message : err}`);
        return [];
      });
    await Promise.all(candidates.map((event) => this.processOne(event.id)));
  }

  private async processOne(id: string) {
    const now = new Date();
    const claim = await this.prisma.outboxEvent.updateMany({
      where: { id, status: "PENDING", nextAttemptAt: { lte: now } },
      data: { status: "PROCESSING", lockedUntil: new Date(now.getTime() + this.lockMs) },
    });
    if (claim.count !== 1) return;

    const event = await this.prisma.outboxEvent.findUnique({ where: { id } });
    if (!event) return;

    try {
      this.realtime.emitToTenant(event.tenantId, event.eventType, event.payload);
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "DISPATCHED", attempts: event.attempts + 1, dispatchedAt: new Date(), lockedUntil: null, lastError: null },
      });
    } catch (err) {
      await this.failEvent(event.id, event.attempts, err instanceof Error ? err.message : String(err));
    }
  }

  private async failEvent(id: string, attempts: number, error: string) {
    const nextAttempts = attempts + 1;
    const deadLetter = nextAttempts >= this.maxAttempts;
    const delayMs = Math.min(1_000 * 2 ** Math.min(nextAttempts, 8), 15 * 60_000);
    await this.prisma.outboxEvent.update({
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
}
