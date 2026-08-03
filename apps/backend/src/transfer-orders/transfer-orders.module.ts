import { Module } from "@nestjs/common";
import { TransferOrdersController } from "./transfer-orders.controller";
import { TransferOrdersService } from "./transfer-orders.service";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  controllers: [TransferOrdersController],
  imports: [InventoryModule],
  providers: [TransferOrdersService],
})
export class TransferOrdersModule {}
