import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check() {
    return this.health.live();
  }

  @Get("live")
  live() {
    return this.health.live();
  }

  @Get("ready")
  async ready() {
    const result = await this.health.readiness();
    if (result.status !== "ok") throw new ServiceUnavailableException(result);
    return result;
  }

  @Get("info")
  info() {
    return this.health.info();
  }
}
