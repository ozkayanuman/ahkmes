import { Module } from "@nestjs/common";
import { FinishedGoodsController } from "./finished-goods.controller";
import { FinishedGoodsService } from "./finished-goods.service";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  controllers: [FinishedGoodsController],
  imports: [InventoryModule],
  providers: [FinishedGoodsService],
})
export class FinishedGoodsModule {}
