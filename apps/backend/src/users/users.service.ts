import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type { CreateUserDto, UpdateUserDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

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
}
