import { Module } from "@nestjs/common";
import { GlController } from "./gl.controller";
import { GlService } from "./gl.service";

@Module({
  controllers: [GlController],
  providers: [GlService],
  exports: [GlService],
})
export class GlModule {}
