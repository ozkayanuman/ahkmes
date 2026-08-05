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

    // Makine henüz kimliklendirilmediği için burada tenant context yok — tenant-scope
    // extension'ı bu sorguyu (JWT login akışıyla aynı gerekçeyle) dokunmadan geçirir.
    const machine = await this.prisma.machine.findUnique({ where: { id: machineId } });
    if (!machine?.connectorKeyHash || !(await bcrypt.compare(key, machine.connectorKeyHash))) {
      throw new UnauthorizedException("Geçersiz makine anahtarı");
    }

    // TenantContextInterceptor (guard'lardan SONRA çalışır) req.machine.tenantId'yi okuyup
    // ALS context'i kuracak — bkz. common/interceptors/tenant-context.interceptor.ts.
    req.machine = machine;
    return true;
  }
}
