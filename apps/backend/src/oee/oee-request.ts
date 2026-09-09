import { BadRequestException } from "@nestjs/common";
import type { OeeCalculationRequest } from "./oee-calculation.service";

export type OeeCalculationContext = Omit<OeeCalculationRequest, "tenantId">;

function requiredDate(value: string | undefined, name: string): Date {
  const date = value ? new Date(value) : undefined;
  if (!date || Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${name} zorunlu ve geçerli bir ISO-8601 tarih olmalıdır`);
  }
  return date;
}

export function parseOeeCalculationContext(
  plantId: string | undefined,
  from: string | undefined,
  to: string | undefined,
  asOf: string | undefined,
): OeeCalculationContext {
  if (!plantId?.trim()) throw new BadRequestException("plantId zorunludur");
  const context = {
    plantId,
    from: requiredDate(from, "from"),
    to: requiredDate(to, "to"),
    asOf: requiredDate(asOf, "asOf"),
  };
  if (context.to <= context.from) throw new BadRequestException("to, from değerinden sonra olmalıdır");
  return context;
}
