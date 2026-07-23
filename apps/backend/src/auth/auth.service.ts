import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type { LoginDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { JwtPayload } from "../common/types";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("E-posta veya şifre hatalı");
    }
    return this.issueTokens(user.id, user.email, user.name, user.role, user.tenantId);
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException("Geçersiz yenileme token'ı");
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (
      !user ||
      !user.isActive ||
      !user.refreshTokenHash ||
      !(await bcrypt.compare(refreshToken, user.refreshTokenHash))
    ) {
      throw new UnauthorizedException("Geçersiz yenileme token'ı");
    }
    return this.issueTokens(user.id, user.email, user.name, user.role, user.tenantId);
  }

  private async issueTokens(
    sub: string,
    email: string,
    name: string,
    role: string,
    tenantId: string,
  ) {
    const payload = { sub, email, name, role, tenantId };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get("JWT_ACCESS_TTL") ?? "15m",
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      expiresIn: this.config.get("JWT_REFRESH_TTL") ?? "7d",
    });
    await this.prisma.user.update({
      where: { id: sub },
      data: { refreshTokenHash: await bcrypt.hash(refreshToken, 10) },
    });
    return { accessToken, refreshToken };
  }
}
