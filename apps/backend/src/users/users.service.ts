import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { CreateUserDto, Role, UpdateUserDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { parseCsv } from "./csv";

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  authSource: true,
  createdAt: true,
  updatedAt: true,
};

const VALID_ROLES = new Set<Role>(["ADMIN", "SALES", "PLANNER", "FOREMAN", "OPERATOR"]);

function randomPassword() {
  return randomBytes(9).toString("base64url"); // 12 karakter, URL-güvenli
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId }, select: USER_SELECT });
    if (!user) throw new NotFoundException("Kullanıcı bulunamadı");
    return user;
  }

  async create(tenantId: string, dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException("Bu e-posta zaten kayıtlı");
    const { password, ...rest } = dto;
    return this.prisma.user.create({
      data: { ...rest, tenantId, passwordHash: await bcrypt.hash(password, 10) },
      select: USER_SELECT,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    await this.findOne(tenantId, id);
    const { password, ...rest } = dto;
    return this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
      select: USER_SELECT,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    // Kullanıcılar silinmez, pasife alınır (audit/ilişki bütünlüğü)
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: USER_SELECT,
    });
  }

  /** CSV toplu kullanıcı içe aktarma — beklenen kolonlar: email,name,role[,password].
   * "password" kolonu boş bırakılırsa rastgele bir şifre üretilir ve yalnızca bu
   * yanıtta bir kez döner (connector-key deseniyle aynı: bir daha gösterilmez). */
  async importCsv(tenantId: string, fileContent: string) {
    const rows = parseCsv(fileContent);
    if (rows.length === 0) return { created: [], errors: ["Dosya boş"] };

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const emailIdx = header.indexOf("email");
    const nameIdx = header.indexOf("name");
    const roleIdx = header.indexOf("role");
    const passwordIdx = header.indexOf("password");
    if (emailIdx === -1 || nameIdx === -1 || roleIdx === -1) {
      return { created: [], errors: ['Başlık satırında "email", "name", "role" kolonları olmalı'] };
    }

    const created: { email: string; name: string; password?: string }[] = [];
    const errors: string[] = [];

    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const email = cols[emailIdx]?.trim().toLowerCase();
      const name = cols[nameIdx]?.trim();
      const roleRaw = cols[roleIdx]?.trim().toUpperCase();
      const providedPassword = passwordIdx !== -1 ? cols[passwordIdx]?.trim() : undefined;

      if (!email || !name || !roleRaw) {
        errors.push(`Satır ${i + 1}: email/name/role eksik`);
        continue;
      }
      if (!VALID_ROLES.has(roleRaw as Role)) {
        errors.push(`Satır ${i + 1}: geçersiz rol "${roleRaw}"`);
        continue;
      }
      const exists = await this.prisma.user.findUnique({ where: { email } });
      if (exists) {
        errors.push(`Satır ${i + 1}: ${email} zaten kayıtlı, atlandı`);
        continue;
      }

      const password = providedPassword || randomPassword();
      await this.prisma.user.create({
        data: {
          tenantId,
          email,
          name,
          role: roleRaw as Role,
          passwordHash: await bcrypt.hash(password, 10),
          authSource: "LOCAL",
        },
      });
      created.push({ email, name, password: providedPassword ? undefined : password });
    }

    return { created, errors };
  }
}
