import { Module } from "@nestjs/common";
import { PartsController, NcProgramsController } from "./parts.controller";
import { PartsService } from "./parts.service";
import { DocumentsModule } from "../documents/documents.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [DocumentsModule, ApprovalsModule, AuthModule],
  controllers: [PartsController, NcProgramsController],
  providers: [PartsService],
  exports: [PartsService],
})
export class PartsModule {}
