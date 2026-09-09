import { Module } from "@nestjs/common";
import { ConsumptionController } from "./consumption.controller";
import { ConsumptionService } from "./consumption.service";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  controllers: [ConsumptionController],
  imports: [InventoryModule],
  providers: [ConsumptionService],
})
export class ConsumptionModule {}
