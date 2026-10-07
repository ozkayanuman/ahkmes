import { Module } from "@nestjs/common";
import { GlModule } from "../gl/gl.module";
import { ApController } from "./ap.controller";
import { ApService } from "./ap.service";

@Module({
  imports: [GlModule],
  controllers: [ApController],
  providers: [ApService],
})
export class ApModule {}
