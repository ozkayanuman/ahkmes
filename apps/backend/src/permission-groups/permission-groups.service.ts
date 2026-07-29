import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreatePermissionGroupDto, UpdatePermissionGroupDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { UserPages } from "../common/types";

const INCLUDE = {
  members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
} as const;

@Injectable()
export class PermissionGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.permissionGroup.findMany({
      where: { tenantId },
      include: INCLUDE,
      orderBy: { name: "asc" },
    });
  }

  async create(tenantId: string, dto: CreatePermissionGroupDto) {
    try {
      return await this.prisma.permissionGroup.create({
        data: { tenantId, name: dto.name, pages: dto.pages },
        include: INCLUDE,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu isimde bir rol grubu zaten var");
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdatePermissionGroupDto) {
    await this.ensure(tenantId, id);
    return this.prisma.permissionGroup.update({
      where: { id },
      data: dto,
      include: INCLUDE,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.ensure(tenantId, id);
    await this.prisma.permissionGroup.delete({ where: { id } });
  }

  async addMember(tenantId: string, groupId: string, userId: string) {
    await this.ensure(tenantId, groupId);
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException("Kullanıcı bulunamadı");
    try {
      await this.prisma.userPermissionGroup.create({ data: { userId, groupId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return; // zaten üye — sessizce başarı
      }
      throw e;
    }
    return this.prisma.permissionGroup.findFirst({ where: { id: groupId }, include: INCLUDE });
  }

  async removeMember(tenantId: string, groupId: string, userId: string) {
    await this.ensure(tenantId, groupId);
    await this.prisma.userPermissionGroup.deleteMany({ where: { groupId, userId } });
    return this.prisma.permissionGroup.findFirst({ where: { id: groupId }, include: INCLUDE });
  }

  private async ensure(tenantId: string, id: string) {
    const group = await this.prisma.permissionGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException("Rol grubu bulunamadı");
    return group;
  }

  /** JWT'ye gömülecek "pages" claim'i — kullanıcının üye olduğu tüm grupların
   * sayfalarının birleşimi. Hiçbir gruba üye değilse "*" (kısıtlamasız, geriye
   * dönük uyumluluk: mevcut kullanıcılar hiçbir gruba atanmadan devam edebilir). */
  async computeUserPages(userId: string): Promise<UserPages> {
    const memberships = await this.prisma.userPermissionGroup.findMany({
      where: { userId },
      include: { group: { select: { pages: true } } },
    });
    if (memberships.length === 0) return "*";
    const pages = new Set<string>();
    for (const m of memberships) for (const p of m.group.pages) pages.add(p);
    return Array.from(pages);
  }
}
