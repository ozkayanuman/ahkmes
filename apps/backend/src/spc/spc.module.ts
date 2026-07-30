import { Module } from "@nestjs/common";
import { SpcController } from "./spc.controller";
import { SpcService } from "./spc.service";
import { NonConformanceModule } from "../non-conformance/non-conformance.module";

@Module({
  imports: [NonConformanceModule],
  controllers: [SpcController],
  providers: [SpcService],
})
export class SpcModule {}
