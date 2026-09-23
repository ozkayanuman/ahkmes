import { Module } from "@nestjs/common";
import { MachineRequiredSkillsController, SkillsController } from "./skills.controller";
import { SkillsService } from "./skills.service";

@Module({
  controllers: [SkillsController, MachineRequiredSkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
