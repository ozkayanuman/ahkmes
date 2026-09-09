import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ConvertUomDto, CreateUomDefinitionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

type UomClient = Pick<PrismaService, "uomDefinition">;

const SYSTEM_UNITS: ReadonlyArray<{ code: string; name: string; dimension: "COUNT" | "MASS" | "LENGTH" | "AREA" | "VOLUME" | "TIME"; factorToBase: string; decimalPlaces: number }> = [
  { code: "EA", name: "Piece", dimension: "COUNT", factorToBase: "1", decimalPlaces: 0 },
  { code: "G", name: "Gram", dimension: "MASS", factorToBase: "1", decimalPlaces: 6 },
  { code: "KG", name: "Kilogram", dimension: "MASS", factorToBase: "1000", decimalPlaces: 6 },
  { code: "MM", name: "Millimetre", dimension: "LENGTH", factorToBase: "1", decimalPlaces: 6 },
  { code: "CM", name: "Centimetre", dimension: "LENGTH", factorToBase: "10", decimalPlaces: 6 },
  { code: "M", name: "Metre", dimension: "LENGTH", factorToBase: "1000", decimalPlaces: 6 },
  { code: "MM2", name: "Square millimetre", dimension: "AREA", factorToBase: "1", decimalPlaces: 6 },
  { code: "CM2", name: "Square centimetre", dimension: "AREA", factorToBase: "100", decimalPlaces: 6 },
  { code: "M2", name: "Square metre", dimension: "AREA", factorToBase: "1000000", decimalPlaces: 6 },
  { code: "ML", name: "Millilitre", dimension: "VOLUME", factorToBase: "1", decimalPlaces: 6 },
  { code: "L", name: "Litre", dimension: "VOLUME", factorToBase: "1000", decimalPlaces: 6 },
  { code: "S", name: "Second", dimension: "TIME", factorToBase: "1", decimalPlaces: 6 },
  { code: "MIN", name: "Minute", dimension: "TIME", factorToBase: "60", decimalPlaces: 6 },
  { code: "H", name: "Hour", dimension: "TIME", factorToBase: "3600", decimalPlaces: 6 },
];

function code(value: string) { return value.trim().toUpperCase(); }

@Injectable()
export class UomService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSystemUnits(tenantId: string, client: UomClient = this.prisma) {
    // A single INSERT … ON CONFLICT DO NOTHING is atomic in PostgreSQL. This
    // keeps first use idempotent even when parallel requests initialise a tenant.
    await client.uomDefinition.createMany({
      data: SYSTEM_UNITS.map((unit) => ({ tenantId, ...unit, isSystem: true })),
      skipDuplicates: true,
    });
  }

  async list(tenantId: string, client: UomClient = this.prisma) {
    await this.ensureSystemUnits(tenantId, client);
    return client.uomDefinition.findMany({ where: { tenantId }, orderBy: [{ dimension: "asc" }, { code: "asc" }] });
  }

  async create(tenantId: string, dto: CreateUomDefinitionDto) {
    const normalized = code(dto.code);
    if (new Prisma.Decimal(dto.factorToBase).lte(0)) throw new BadRequestException("UOM conversion factor must be greater than zero");
    await this.ensureSystemUnits(tenantId);
    try {
      return await this.prisma.uomDefinition.create({ data: { tenantId, ...dto, code: normalized, factorToBase: dto.factorToBase } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("This UOM code already exists for the tenant");
      throw error;
    }
  }

  async findByCode(tenantId: string, unitCode: string, client: UomClient = this.prisma) {
    await this.ensureSystemUnits(tenantId, client);
    const unit = await client.uomDefinition.findFirst({ where: { tenantId, code: code(unitCode) } });
    if (!unit) throw new NotFoundException(`UOM '${unitCode}' was not found`);
    return unit;
  }

  async assertCompatible(tenantId: string, fromCode: string, toCode: string, client: UomClient = this.prisma) {
    const [from, to] = await Promise.all([this.findByCode(tenantId, fromCode, client), this.findByCode(tenantId, toCode, client)]);
    if (from.dimension !== to.dimension) throw new BadRequestException(`Incompatible UOM dimensions: ${from.dimension} and ${to.dimension}`);
    return { from, to };
  }

  async convert(tenantId: string, dto: ConvertUomDto) {
    const { from, to } = await this.assertCompatible(tenantId, dto.fromCode, dto.toCode);
    // Prisma.Decimal (decimal.js) avoids binary floating-point quantity drift.
    const raw = new Prisma.Decimal(dto.quantity);
    const result = raw.mul(from.factorToBase).div(to.factorToBase).toDecimalPlaces(to.decimalPlaces, Prisma.Decimal.ROUND_HALF_UP);
    return { quantity: result.toFixed(to.decimalPlaces), fromCode: from.code, toCode: to.code, dimension: from.dimension, decimalPlaces: to.decimalPlaces };
  }
}
