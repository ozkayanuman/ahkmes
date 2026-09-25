import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { upsertSupplierMaterialSchema, type UpsertSupplierMaterialDto } from "@ahkmes/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SupplierMaterialsService } from "./supplier-materials.service";

@Controller("suppliers/:supplierId/materials")
@RequirePage("suppliers")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class SupplierMaterialsController {
  constructor(private readonly service: SupplierMaterialsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param("supplierId") supplierId: string) {
    return this.service.listForSupplier(user.tenantId, supplierId);
  }

  @Post()
  @Roles("ADMIN", "PLANNER")
  upsert(
    @CurrentUser() user: AuthUser,
    @Param("supplierId") supplierId: string,
    @Body(new ZodValidationPipe(upsertSupplierMaterialSchema)) dto: UpsertSupplierMaterialDto,
  ) {
    return this.service.upsert(user.tenantId, user.userId, supplierId, dto);
  }

  @Delete(":id")
  @Roles("ADMIN", "PLANNER")
  remove(@CurrentUser() user: AuthUser, @Param("supplierId") supplierId: string, @Param("id") id: string) {
    return this.service.remove(user.tenantId, user.userId, supplierId, id);
  }
}

@Controller("materials/:materialId/suppliers")
@RequirePage("materials")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class MaterialSuppliersController {
  constructor(private readonly service: SupplierMaterialsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param("materialId") materialId: string) {
    return this.service.listForMaterial(user.tenantId, materialId);
  }
}
