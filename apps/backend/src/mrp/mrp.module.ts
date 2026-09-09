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
import { UomModule } from "../uom/uom.module";
import { ProductionCalendarModule } from "../production-calendar/production-calendar.module";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";
import { MrpRunSynchronization } from "./mrp-run-synchronization";

@Module({
  imports: [NotificationsModule, ApprovalsModule, PurchasingModule, WorkOrdersModule, AuthModule, UomModule, ProductionCalendarModule, ActionPermissionsModule],
  controllers: [BomController, MrpController],
  providers: [BomService, MrpRunSynchronization, MrpService],
  exports: [MrpRunSynchronization],
})
export class MrpModule {}
