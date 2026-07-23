import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateCustomerDto, UpdateCustomerDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, q?: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException("Müşteri bulunamadı");
    return customer;
  }

  create(tenantId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({ data: { ...dto, tenantId, email: dto.email || null } });
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(tenantId, id);
    return this.prisma.customer.update({
      where: { id },
      data: { ...dto, email: dto.email || null },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    try {
      return await this.prisma.customer.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException("Müşteriye bağlı teklifler var, silinemez");
      }
      throw e;
    }
  }
}
