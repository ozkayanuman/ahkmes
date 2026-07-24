import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class MachineKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const machineId: string | undefined = req.params?.id;
    const key: string | undefined = req.headers["x-machine-key"];
    if (!machineId || !key) throw new UnauthorizedException("Makine anahtarı gerekli");

    const machine = await this.prisma.machine.findUnique({ where: { id: machineId } });
    if (!machine?.connectorKeyHash || !(await bcrypt.compare(key, machine.connectorKeyHash))) {
      throw new UnauthorizedException("Geçersiz makine anahtarı");
    }

    req.machine = machine;
    return true;
  }
}
