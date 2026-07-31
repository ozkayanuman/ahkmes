import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import type { CreateOidcProviderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { encryptSecret } from "../common/crypto";
import { assertPublicUrl, safeFetch } from "../common/safe-request";

interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

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

  /**
   * Discovery belgesi SADECE burada, sağlayıcı oluşturulurken çekilir —
   * OidcAuthService artık her girişte tekrar çekmiyor (bkz. schema.prisma
   * OidcProvider yorumu: host-eşleştirme yerine oluşturma-anında sabitleme).
   * Uç noktaların https olması dışında bir kısıtlama yok — gerçek IdP'ler
   * (Google gibi) endpoint'lerini issuer'dan farklı host'larda barındırabilir.
   */
  private async discovery(issuer: string): Promise<DiscoveryDoc> {
    const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await safeFetch(url, { method: "GET" }, "OIDC discovery belgesi");
    if (res.status !== 200) throw new BadRequestException("OIDC discovery belgesi alınamadı");
    let doc: DiscoveryDoc;
    try {
      doc = JSON.parse(res.body) as DiscoveryDoc;
    } catch {
      throw new BadRequestException("OIDC discovery belgesi geçersiz JSON");
    }
    for (const [label, endpoint] of [
      ["authorization_endpoint", doc.authorization_endpoint],
      ["token_endpoint", doc.token_endpoint],
      ["jwks_uri", doc.jwks_uri],
    ] as const) {
      if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
        throw new BadRequestException(`Discovery belgesindeki ${label} https olmalı`);
      }
    }
    return doc;
  }

  async create(tenantId: string, dto: CreateOidcProviderDto) {
    assertPublicUrl(dto.issuer, "Issuer URL'i");
    if (!dto.issuer.startsWith("https://")) {
      throw new BadRequestException("Issuer URL'i https olmalı");
    }
    const doc = await this.discovery(dto.issuer);
    const clientSecretEnc = encryptSecret(dto.clientSecret, this.secretKey());
    try {
      const { clientSecret: _clientSecret, ...rest } = dto;
      const created = await this.prisma.oidcProvider.create({
        data: {
          ...rest,
          clientSecretEnc,
          tenantId,
          authorizationEndpoint: doc.authorization_endpoint,
          tokenEndpoint: doc.token_endpoint,
          jwksUri: doc.jwks_uri,
        },
      });
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
