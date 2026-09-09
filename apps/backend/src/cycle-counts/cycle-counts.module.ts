import { Module } from "@nestjs/common";
import { CycleCountsController } from "./cycle-counts.controller";
import { CycleCountsService } from "./cycle-counts.service";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  controllers: [CycleCountsController],
  imports: [InventoryModule],
  providers: [CycleCountsService],
})
export class CycleCountsModule {}
