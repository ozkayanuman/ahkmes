import { Module } from "@nestjs/common";
import { PartsController, NcProgramsController } from "./parts.controller";
import { PartsService } from "./parts.service";
import { DocumentsModule } from "../documents/documents.module";

@Module({
  imports: [DocumentsModule],
  controllers: [PartsController, NcProgramsController],
  providers: [PartsService],
})
export class PartsModule {}
