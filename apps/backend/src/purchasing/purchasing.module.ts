import { Module } from "@nestjs/common";
import { PurchasingController } from "./purchasing.controller";
import { PurchasingService } from "./purchasing.service";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  controllers: [PurchasingController],
  imports: [InventoryModule],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
