import { Module } from "@nestjs/common";
import { WarehousesController } from "./warehouses.controller";
import { WarehousesService } from "./warehouses.service";
import { BinsController } from "./bins.controller";
import { BinsService } from "./bins.service";

@Module({
  controllers: [WarehousesController, BinsController],
  providers: [WarehousesService, BinsService],
})
export class WarehousesModule {}
