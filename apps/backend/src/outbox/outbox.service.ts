import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** AHK-009: domain yazımıyla aynı transaction'da event kaydeder. `record()`
 * SADECE `Prisma.TransactionClient` alır (module-level `PrismaService` değil)
 * — böylece bir çağıranın yanlışlıkla transaction dışında, domain yazımından
 * kopuk bir event kaydetmesi derleme zamanında imkansız hale gelir. Kaydedilen
 * satırı OutboxDispatcherService (ayrı, en-az-bir-kez tüketen bir worker)
 * daha sonra RealtimeGateway.emitToTenant + webhook enqueue'a çevirir. */
@Injectable()
export class OutboxService {
  record(
    tx: Tx,
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ) {
    return tx.outboxEvent.create({
      data: { tenantId, aggregateType, aggregateId, eventType, payload },
    });
  }
}
