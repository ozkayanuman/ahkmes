import { Module } from "@nestjs/common";
import { SalesOrdersController } from "./sales-orders.controller";
import { SalesOrdersService } from "./sales-orders.service";
import { WorkOrdersModule } from "../work-orders/work-orders.module";

@Module({
  imports: [WorkOrdersModule],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
