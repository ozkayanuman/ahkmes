import { Module } from "@nestjs/common";
import { MaintenanceOrdersController } from "./maintenance-orders.controller";
import { MaintenanceOrdersService } from "./maintenance-orders.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { InventoryModule } from "../inventory/inventory.module";
import { ActionPermissionsModule } from "../action-permissions/action-permissions.module";

@Module({
  imports: [NotificationsModule, InventoryModule, ActionPermissionsModule],
  controllers: [MaintenanceOrdersController],
  providers: [MaintenanceOrdersService],
  exports: [MaintenanceOrdersService],
})
export class MaintenanceOrdersModule {}
