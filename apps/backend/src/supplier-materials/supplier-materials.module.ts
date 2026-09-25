import { Module } from "@nestjs/common";
import { MaterialSuppliersController, SupplierMaterialsController } from "./supplier-materials.controller";
import { SupplierMaterialsService } from "./supplier-materials.service";

@Module({
  controllers: [SupplierMaterialsController, MaterialSuppliersController],
  providers: [SupplierMaterialsService],
  exports: [SupplierMaterialsService],
})
export class SupplierMaterialsModule {}
