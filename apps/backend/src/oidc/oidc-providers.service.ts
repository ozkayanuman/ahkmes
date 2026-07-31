import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import type { CreateOidcProviderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { encryptSecret } from "../common/crypto";
import { assertPublicUrl } from "../common/safe-request";

@Injectable()
export class OidcProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private secretKey() {
    return this.config.getOrThrow<string>("JWT_SECRET");
  }

  /** Şifre hariç, admin ekranında gösterilebilecek liste. */
  async findAll(tenantId: string) {
    const rows = await this.prisma.oidcProvider.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    return rows.map(({ clientSecretEnc: _clientSecretEnc, ...rest }) => rest);
  }

  async create(tenantId: string, dto: CreateOidcProviderDto) {
    assertPublicUrl(dto.issuer, "Issuer URL'i");
    const clientSecretEnc = encryptSecret(dto.clientSecret, this.secretKey());
    try {
      const { clientSecret: _clientSecret, ...rest } = dto;
      const created = await this.prisma.oidcProvider.create({ data: { ...rest, clientSecretEnc, tenantId } });
      const { clientSecretEnc: _enc, ...safe } = created;
      return safe;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir OIDC sağlayıcısı zaten kayıtlı");
      }
      throw e;
    }
  }

  async remove(tenantId: string, id: string) {
    const row = await this.prisma.oidcProvider.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("OIDC sağlayıcısı bulunamadı");
    return this.prisma.oidcProvider.delete({ where: { id } });
  }
}
