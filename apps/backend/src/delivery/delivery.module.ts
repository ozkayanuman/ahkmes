import { Module } from "@nestjs/common";
import { DeliveryController } from "./delivery.controller";
import { DeliveryService } from "./delivery.service";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  controllers: [DeliveryController],
  imports: [InventoryModule],
  providers: [DeliveryService],
})
export class DeliveryModule {}
