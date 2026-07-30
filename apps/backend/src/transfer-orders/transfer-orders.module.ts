import { Module } from "@nestjs/common";
import { TransferOrdersController } from "./transfer-orders.controller";
import { TransferOrdersService } from "./transfer-orders.service";

@Module({
  controllers: [TransferOrdersController],
  providers: [TransferOrdersService],
})
export class TransferOrdersModule {}
