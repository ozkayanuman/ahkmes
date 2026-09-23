import { BadRequestException, Controller, Get, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { OnboardingImportService } from "./onboarding-import.service";

@Controller("onboarding-import")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class OnboardingImportController {
  constructor(private readonly service: OnboardingImportService) {}

  @Get("templates") templates() { return this.service.templates(); }
  @Get("batches") list(@CurrentUser() user: AuthUser) { return this.service.list(user.tenantId); }
  @Get("batches/:id") findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.service.findOne(user.tenantId, id); }
  @Get("batches/:id/errors.csv")
  async errorCsv(@CurrentUser() user: AuthUser, @Param("id") id: string, @Res() res: Response) {
    const csv = await this.service.errorCsv(user.tenantId, id);
    res
      .set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="onboarding-hatalari.csv"' })
      .send(csv);
  }

  @Post(":template/dry-run")
  @UseInterceptors(FileInterceptor("file"))
  dryRun(@CurrentUser() user: AuthUser, @Param("template") template: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("CSV dosyası gerekli");
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException("CSV dosyası en fazla 5 MB olabilir");
    return this.service.dryRun(user.tenantId, user.userId, template, file.buffer.toString("utf-8"));
  }

  @Post("batches/:id/commit")
  commit(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.service.commit(user.tenantId, user.userId, id); }
}
