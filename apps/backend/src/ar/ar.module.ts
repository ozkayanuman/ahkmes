import { Module } from "@nestjs/common";
import { GlModule } from "../gl/gl.module";
import { ArController } from "./ar.controller";
import { ArService } from "./ar.service";

@Module({
  imports: [GlModule],
  controllers: [ArController],
  providers: [ArService],
})
export class ArModule {}
