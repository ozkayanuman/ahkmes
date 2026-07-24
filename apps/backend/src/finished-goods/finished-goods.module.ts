import { Module } from "@nestjs/common";
import { FinishedGoodsController } from "./finished-goods.controller";
import { FinishedGoodsService } from "./finished-goods.service";

@Module({
  controllers: [FinishedGoodsController],
  providers: [FinishedGoodsService],
})
export class FinishedGoodsModule {}
