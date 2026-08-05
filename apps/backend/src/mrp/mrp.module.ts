import { Module } from "@nestjs/common";
import { BomController } from "./bom.controller";
import { BomService } from "./bom.service";
import { MrpController } from "./mrp.controller";
import { MrpService } from "./mrp.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { WorkOrdersModule } from "../work-orders/work-orders.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [NotificationsModule, ApprovalsModule, PurchasingModule, WorkOrdersModule, AuthModule],
  controllers: [BomController, MrpController],
  providers: [BomService, MrpService],
})
export class MrpModule {}
