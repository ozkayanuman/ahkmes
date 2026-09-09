import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreatePlantProductionCalendarDto, CreateProductionShiftDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { writeTransactionalAudit } from "../common/transactional-audit";

type LocalParts = { date: string; weekday: number; minute: number };
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let value = formatterCache.get(timeZone);
  if (!value) { value = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); formatterCache.set(timeZone, value); }
  return value;
}
function localParts(at: Date, timezone: string): LocalParts {
  try {
    const entries = Object.fromEntries(formatter(timezone).formatToParts(at).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
    const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return { date: `${entries.year}-${entries.month}-${entries.day}`, weekday: weekdayMap[entries.weekday]!, minute: Number(entries.hour) * 60 + Number(entries.minute) };
  } catch { throw new BadRequestException(`Invalid IANA timezone '${timezone}'`); }
}
function dateAtUtc(date: string) { return new Date(`${date}T00:00:00.000Z`); }
function dayBefore(date: string) { const result = dateAtUtc(date); result.setUTCDate(result.getUTCDate() - 1); return result.toISOString().slice(0, 10); }
function dayAfter(date: string) { const result = dateAtUtc(date); result.setUTCDate(result.getUTCDate() + 1); return result.toISOString().slice(0, 10); }
function minuteAtUtc(date: string, minute: number, timezone: string) {
  const base = dateAtUtc(date).getTime() + minute * 60_000;
  for (let delta = -16 * 60; delta <= 16 * 60; delta++) {
    const candidate = new Date(base + delta * 60_000);
    const local = localParts(candidate, timezone);
    if (local.date === date && local.minute === minute) return candidate;
  }
  return null;
}

type CalendarReadClient = Pick<PrismaService, "plant" | "plantProductionCalendar" | "productionShift">;

@Injectable()
export class ProductionCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, plantId: string) {
    await this.assertPlant(tenantId, plantId);
    return this.prisma.plantProductionCalendar.findMany({ where: { tenantId, plantId }, include: { exceptions: { orderBy: { date: "asc" } }, shifts: { include: { breaks: { orderBy: { startMinute: "asc" } } }, orderBy: { code: "asc" } }, }, orderBy: { name: "asc" } });
  }

  async createCalendar(tenantId: string, userId: string, dto: CreatePlantProductionCalendarDto) {
    await this.assertPlant(tenantId, dto.plantId);
    localParts(new Date(), dto.timezone);
    if (dto.effectiveFrom && dto.effectiveTo && dto.effectiveFrom > dto.effectiveTo) throw new BadRequestException("Calendar effective range is invalid");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const weeklyWorkingDays = [...new Set(dto.weeklyWorkingDays)].sort() as Prisma.InputJsonValue;
        const calendar = await tx.plantProductionCalendar.create({ data: { tenantId, plantId: dto.plantId, name: dto.name, timezone: dto.timezone, weeklyWorkingDays, effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo, exceptions: { create: dto.exceptions.map((item: { date: Date; isWorking: boolean; name?: string }) => ({ tenantId, date: item.date, isWorking: item.isWorking, name: item.name })) } }, include: { exceptions: true } });
        await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-calendar", entityId: calendar.id, action: "CREATE", after: calendar });
        return calendar;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ConflictException("A calendar with this name already exists for the plant");
      throw error;
    }
  }

  async createShift(tenantId: string, userId: string, dto: CreateProductionShiftDto) {
    const plant = await this.assertPlant(tenantId, dto.plantId);
    if (dto.effectiveFrom && dto.effectiveTo && dto.effectiveFrom > dto.effectiveTo) throw new BadRequestException("Shift effective range is invalid");
    this.assertBreaksInsideShift(dto.startMinute, dto.endMinute, dto.breaks);
    if (dto.calendarId) {
      const calendar = await this.prisma.plantProductionCalendar.findFirst({ where: { id: dto.calendarId, tenantId, plantId: dto.plantId } });
      if (!calendar) throw new NotFoundException("Production calendar was not found for this plant");
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { breaks, ...shiftInput } = dto;
        const shift = await tx.productionShift.create({
          data: {
            tenantId,
            ...shiftInput,
            breaks: { create: breaks.map((item) => ({ tenantId, ...item })) },
          },
          include: { breaks: { orderBy: { startMinute: "asc" } } },
        });
        await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-shift", entityId: shift.id, action: "CREATE", after: { ...shift, plantTimezone: plant.timezone } });
        return shift;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ConflictException("A shift with this code already exists for the plant");
      throw error;
    }
  }

  /** Canonical, plant-local calendar/shift answer for MES, MRP and future OEE. */
  async resolve(tenantId: string, plantId: string, at: Date) {
    const plant = await this.assertPlant(tenantId, plantId);
    const local = localParts(at, plant.timezone);
    const calendars = await this.prisma.plantProductionCalendar.findMany({ where: { tenantId, plantId, isActive: true, AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] }, { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] }] }, include: { exceptions: true }, orderBy: { createdAt: "desc" } });
    const calendar = calendars[0] ?? null;
    const shifts = await this.prisma.productionShift.findMany({ where: { tenantId, plantId, isActive: true, AND: [{ OR: [{ calendarId: null }, ...(calendar ? [{ calendarId: calendar.id }] : [])] }, { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] }, { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] }] }, include: { breaks: { orderBy: { startMinute: "asc" } } }, orderBy: { code: "asc" } });
    const working = calendar ? this.isWorkingDate(calendar, local.date, local.weekday) : false;
    let shift: typeof shifts[number] | null = null;
    let productionDate = local.date;
    for (const item of shifts) {
      const crossesMidnight = item.endMinute <= item.startMinute;
      const belongsToday = local.minute >= item.startMinute && (crossesMidnight || local.minute < item.endMinute);
      const belongsPreviousDay = crossesMidnight && local.minute < item.endMinute;
      if (belongsToday || belongsPreviousDay) { shift = item; if (belongsPreviousDay) productionDate = dayBefore(local.date); break; }
    }
    // An overnight segment after midnight inherits the prior production date's working rule.
    const productionWeekday = shift && productionDate !== local.date ? ((local.weekday + 5) % 7) + 1 : local.weekday;
    const productionWorking = calendar ? this.isWorkingDate(calendar, productionDate, productionWeekday) : false;
    return { plantId, timezone: plant.timezone, timestamp: at.toISOString(), localDate: local.date, productionDate, isWorkingTime: Boolean(shift && productionWorking), calendar: calendar ? { id: calendar.id, name: calendar.name } : null, shift: shift ? { id: shift.id, code: shift.code, name: shift.name, startMinute: shift.startMinute, endMinute: shift.endMinute, crossesMidnight: shift.endMinute <= shift.startMinute } : null };
  }

  async shiftWindowsForProductionDate(
    tenantId: string,
    plantId: string,
    productionDate: string,
    client: CalendarReadClient = this.prisma,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate) || Number.isNaN(dateAtUtc(productionDate).getTime())) {
      throw new BadRequestException("Production date must be YYYY-MM-DD");
    }
    const at = dateAtUtc(productionDate);
    const plant = await this.assertPlant(tenantId, plantId, client);
    const calendar = await client.plantProductionCalendar.findFirst({
      where: {
        tenantId,
        plantId,
        isActive: true,
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
        ],
      },
      include: { exceptions: true },
      orderBy: { createdAt: "desc" },
    });
    if (!calendar) return [];
    const weekday = ((at.getUTCDay() + 6) % 7) + 1;
    if (!this.isWorkingDate(calendar, productionDate, weekday)) return [];
    const shifts = await client.productionShift.findMany({
      where: {
        tenantId,
        plantId,
        isActive: true,
        AND: [
          { OR: [{ calendarId: null }, { calendarId: calendar.id }] },
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
        ],
      },
      include: { breaks: { orderBy: { startMinute: "asc" } } },
      orderBy: { code: "asc" },
    });
    return shifts.map((shift) => {
      const crossesMidnight = shift.endMinute <= shift.startMinute;
      const endDate = crossesMidnight ? dayAfter(productionDate) : productionDate;
      const shiftDuration = this.minuteOffset(shift.startMinute, shift.endMinute, crossesMidnight);
      return {
        ...shift,
        calendar: { id: calendar.id, name: calendar.name },
        timezone: plant.timezone,
        productionDate,
        start: minuteAtUtc(productionDate, shift.startMinute, plant.timezone),
        end: minuteAtUtc(endDate, shift.endMinute, plant.timezone),
        crossesMidnight,
        breaks: shift.breaks.map((item) => {
          const startOffset = this.minuteOffset(shift.startMinute, item.startMinute, crossesMidnight);
          const endOffset = this.minuteOffset(shift.startMinute, item.endMinute, crossesMidnight);
          const valid = startOffset >= 0 && endOffset > startOffset && endOffset <= shiftDuration;
          const breakStartDate = crossesMidnight && item.startMinute < shift.startMinute ? endDate : productionDate;
          const breakEndDate = crossesMidnight && item.endMinute < shift.startMinute ? endDate : productionDate;
          return {
            ...item,
            start: valid ? minuteAtUtc(breakStartDate, item.startMinute, plant.timezone) : null,
            end: valid ? minuteAtUtc(breakEndDate, item.endMinute, plant.timezone) : null,
            isValidWithinShift: valid,
          };
        }),
      };
    });
  }

  /** Compatibility adapter. Canonical conversion lives in shiftWindowsForProductionDate. */
  shiftsForProductionDate(tenantId: string, plantId: string, productionDate: string) {
    return this.shiftWindowsForProductionDate(tenantId, plantId, productionDate);
  }

  /**
   * Canonical MRP/MES working-day date offset. Date arithmetic lives here so
   * planning never silently falls back to server-calendar subtraction.
   * `workingDays=0` returns the same plant-local production date.
   */
  async offsetWorkingDays(tenantId: string, plantId: string, date: Date, workingDays: number, client: Pick<PrismaService, "plant" | "plantProductionCalendar"> = this.prisma) {
    if (!Number.isInteger(workingDays)) throw new BadRequestException("Working-day offset must be an integer");
    const plant = await client.plant.findFirst({ where: { id: plantId, tenantId } });
    if (!plant) throw new NotFoundException("Plant was not found");
    localParts(new Date(), plant.timezone);
    const calendar = await client.plantProductionCalendar.findFirst({
      where: { tenantId, plantId, isActive: true }, include: { exceptions: true }, orderBy: { createdAt: "desc" },
    });
    if (!calendar) throw new ConflictException("A released plant production calendar is required for MRP lead-time planning");
    let localDate = localParts(date, plant.timezone).date;
    let remaining = Math.abs(workingDays);
    const direction = workingDays < 0 ? -1 : 1;
    while (remaining > 0) {
      const cursor = dateAtUtc(localDate);
      cursor.setUTCDate(cursor.getUTCDate() + direction);
      localDate = cursor.toISOString().slice(0, 10);
      const weekday = ((cursor.getUTCDay() + 6) % 7) + 1;
      if (this.isWorkingDate(calendar, localDate, weekday)) remaining -= 1;
    }
    const at = minuteAtUtc(localDate, 12 * 60, plant.timezone);
    if (!at) throw new BadRequestException("Could not resolve plant-local working date");
    return at;
  }

  private isWorkingDate(calendar: { weeklyWorkingDays: unknown; exceptions: { date: Date; isWorking: boolean }[] }, date: string, weekday: number) {
    const exception = calendar.exceptions.find((item) => item.date.toISOString().slice(0, 10) === date);
    if (exception) return exception.isWorking;
    return Array.isArray(calendar.weeklyWorkingDays) && calendar.weeklyWorkingDays.includes(weekday);
  }

  private minuteOffset(shiftStartMinute: number, minute: number, crossesMidnight: boolean) {
    if (!crossesMidnight) return minute - shiftStartMinute;
    return minute >= shiftStartMinute ? minute - shiftStartMinute : 1440 - shiftStartMinute + minute;
  }

  private assertBreaksInsideShift(
    shiftStartMinute: number,
    shiftEndMinute: number,
    breaks: CreateProductionShiftDto["breaks"],
  ) {
    const crossesMidnight = shiftEndMinute <= shiftStartMinute;
    const shiftDuration = this.minuteOffset(shiftStartMinute, shiftEndMinute, crossesMidnight);
    const normalized = breaks.map((item) => ({
      item,
      start: this.minuteOffset(shiftStartMinute, item.startMinute, crossesMidnight),
      end: this.minuteOffset(shiftStartMinute, item.endMinute, crossesMidnight),
    })).sort((left, right) => left.start - right.start);
    for (let index = 0; index < normalized.length; index += 1) {
      const current = normalized[index]!;
      if (current.start < 0 || current.end <= current.start || current.end > shiftDuration) {
        throw new BadRequestException(`Break '${current.item.name}' must be inside the shift window`);
      }
      if (index > 0 && current.start < normalized[index - 1]!.end) {
        throw new BadRequestException(`Break '${current.item.name}' overlaps another shift break`);
      }
    }
  }

  private async assertPlant(tenantId: string, plantId: string, client: Pick<PrismaService, "plant"> = this.prisma) {
    const plant = await client.plant.findFirst({ where: { id: plantId, tenantId } });
    if (!plant) throw new NotFoundException("Plant was not found");
    localParts(new Date(), plant.timezone);
    return plant;
  }
}
