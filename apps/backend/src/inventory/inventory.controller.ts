import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePage } from "../common/decorators/require-page.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PagesGuard } from "../common/guards/pages.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthUser } from "../common/types";
import { InventoryService } from "./inventory.service";

@Controller("inventory")
@RequirePage("warehouses")
@UseGuards(JwtAuthGuard, RolesGuard, PagesGuard)
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get("movements")
  findMovements(
    @CurrentUser() user: AuthUser,
    @Query("itemId") itemId?: string,
    @Query("binId") binId?: string,
    @Query("sourceType") sourceType?: string,
    @Query("sourceId") sourceId?: string,
  ) {
    return this.service.findMovements(user.tenantId, { itemId, binId, sourceType, sourceId });
  }
}
