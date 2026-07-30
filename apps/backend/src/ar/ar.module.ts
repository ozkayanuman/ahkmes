import { Module } from "@nestjs/common";
import { ArController } from "./ar.controller";
import { ArService } from "./ar.service";

@Module({
  controllers: [ArController],
  providers: [ArService],
})
export class ArModule {}
