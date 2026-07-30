import { Global, Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

/// @Global: RealtimeGateway (kendisi @Global) her emitToTenant() çağrısında
/// WebhooksService.dispatch() tetikler — bu modülün her yerden DI ile
/// çözülebilmesi gerekir (bkz. realtime.module.ts).
@Global()
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
