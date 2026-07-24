import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  uploadDocumentMetaSchema,
  type DocumentEntityType,
} from "@ahkmes/shared-types";
import { DocumentsService } from "./documents.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("documents")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("entityType") entityType: DocumentEntityType,
    @Query("entityId") entityId: string,
  ) {
    return this.service.list(user.tenantId, entityType, entityId);
  }

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: Record<string, string>,
  ) {
    if (!file) throw new BadRequestException("Dosya gerekli");
    const meta = uploadDocumentMetaSchema.parse(query);
    return this.service.upload(user.tenantId, user.userId, {
      ...meta,
      fileName: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
  }

  @Get(":id/url")
  getUrl(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.getSignedUrl(user.tenantId, id);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
