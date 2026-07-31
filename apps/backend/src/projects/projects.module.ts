import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectTasksController } from "./project-tasks.controller";
import { ProjectsService } from "./projects.service";

@Module({
  controllers: [ProjectsController, ProjectTasksController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
