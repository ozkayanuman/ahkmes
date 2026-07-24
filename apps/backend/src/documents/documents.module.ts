import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { MinioService } from "./minio.service";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, MinioService],
  exports: [MinioService],
})
export class DocumentsModule {}
