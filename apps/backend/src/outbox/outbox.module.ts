import { Global, Module } from "@nestjs/common";
import { OutboxService } from "./outbox.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";

/// @Global: WebhooksModule ile aynı gerekçe — OutboxService'in her domain
/// servisinden (CAPA, MRP, iş emri vb.) DI ile çözülebilmesi gerekir.
@Global()
@Module({
  providers: [OutboxService, OutboxDispatcherService],
  exports: [OutboxService],
})
export class OutboxModule {}
