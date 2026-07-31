import { Body, Controller, Get, Patch, Post, UseGuards, UsePipes } from "@nestjs/common";
import { loginSchema, updateProfileSchema, type LoginDto, type UpdateProfileDto } from "@ahkmes/shared-types";
import { AuthService } from "./auth.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post("refresh")
  refresh(@Body() body: { refreshToken?: string }) {
    return this.auth.refresh(body.refreshToken ?? "");
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** Kendi dil/saat dilimi tercihini güncelleme — herhangi bir rol, ADMIN
   * gerekmez (Faz P i18n). Yeni token çifti döner (payload'da locale/timezone
   * güncellenmiş olsun diye — /auth/me'yi tekrar sorgulamaya gerek kalmadan). */
  @Patch("me")
  @UseGuards(JwtAuthGuard)
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user.userId, dto);
  }
}
