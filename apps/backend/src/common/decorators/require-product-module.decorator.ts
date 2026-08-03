import { SetMetadata } from "@nestjs/common";
import type { ProductModule } from "@prisma/client";

export const PRODUCT_MODULES_KEY = "product-modules";

/** Adds a canonical commercial entitlement to a command without inventing a UI page. */
export const RequireProductModule = (...modules: ProductModule[]) => SetMetadata(PRODUCT_MODULES_KEY, modules);
