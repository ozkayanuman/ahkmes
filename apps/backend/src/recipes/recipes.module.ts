import { Module } from "@nestjs/common";
import { RecipesController } from "./recipes.controller";
import { RecipesService } from "./recipes.service";
import { PartsModule } from "../parts/parts.module";

@Module({
  imports: [PartsModule],
  controllers: [RecipesController],
  providers: [RecipesService],
})
export class RecipesModule {}
