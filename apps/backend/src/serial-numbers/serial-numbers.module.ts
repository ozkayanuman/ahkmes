import { Module } from "@nestjs/common";
import { SerialNumbersController } from "./serial-numbers.controller";
import { SerialNumbersService } from "./serial-numbers.service";

@Module({
  controllers: [SerialNumbersController],
  providers: [SerialNumbersService],
})
export class SerialNumbersModule {}
