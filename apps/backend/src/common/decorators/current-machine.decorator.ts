import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Machine } from "@prisma/client";

export const CurrentMachine = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Machine => {
    return ctx.switchToHttp().getRequest().machine;
  },
);
