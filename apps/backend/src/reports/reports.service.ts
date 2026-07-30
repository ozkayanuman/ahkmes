import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toCsv } from "../common/csv-export";

function parseDateFilter(fromRaw?: string, toRaw?: string) {
  const from = fromRaw ? new Date(`${fromRaw}T00:00:00`) : undefined;
  const to = toRaw ? new Date(`${toRaw}T23:59:59`) : undefined;
  return {
    ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
    ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
  };
}

/** Faz J basit Custom Report: sürükle-bırak bir rapor tasarımcısı DEĞİL —
 * mevcut iki tablodan filtreli CSV dışa aktarımı (roadmap'in "Report" kısmına
 * MVP boyutunda bir yanıt; gerçek designer altyapısı kasıtlı olarak kapsam
 * dışı, bkz. roadmap notu "erken soyutlama riski"). */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async workOrdersCsv(tenantId: string, status?: string, from?: string, to?: string) {
    const rows = await this.prisma.workOrder.findMany({
      where: {
        tenantId,
        ...(status ? { status: status as never } : {}),
        ...(from || to ? { dueDate: parseDateFilter(from, to) } : {}),
      },
      include: { part: { select: { partNo: true, name: true } }, machine: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    return toCsv(
      rows.map((r) => ({
        woNo: r.woNo,
        partNo: r.part.partNo,
        partName: r.part.name,
        quantity: r.quantity,
        status: r.status,
        machine: r.machine?.name ?? "",
        dueDate: r.dueDate,
        createdAt: r.createdAt,
      })),
      [
        { key: "woNo", header: "İş Emri No" },
        { key: "partNo", header: "Parça No" },
        { key: "partName", header: "Parça Adı" },
        { key: "quantity", header: "Miktar" },
        { key: "status", header: "Durum" },
        { key: "machine", header: "Makine" },
        { key: "dueDate", header: "Termin Tarihi" },
        { key: "createdAt", header: "Oluşturulma" },
      ],
    );
  }

  async nonConformancesCsv(tenantId: string, status?: string, from?: string, to?: string) {
    const rows = await this.prisma.nonConformance.findMany({
      where: {
        tenantId,
        ...(status ? { status: status as never } : {}),
        ...(from || to ? { createdAt: parseDateFilter(from, to) } : {}),
      },
      include: {
        workOrder: { select: { woNo: true } },
        reportedBy: { select: { name: true } },
        resolvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return toCsv(
      rows.map((r) => ({
        woNo: r.workOrder.woNo,
        failureType: r.failureType,
        actionType: r.actionType,
        status: r.status,
        reportedBy: r.reportedBy.name,
        resolvedBy: r.resolvedBy?.name ?? "",
        description: r.description ?? "",
        resolutionNote: r.resolutionNote ?? "",
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt ?? "",
      })),
      [
        { key: "woNo", header: "İş Emri No" },
        { key: "failureType", header: "Hata Tipi" },
        { key: "actionType", header: "Aksiyon Tipi" },
        { key: "status", header: "Durum" },
        { key: "reportedBy", header: "Bildiren" },
        { key: "resolvedBy", header: "Çözen" },
        { key: "description", header: "Açıklama" },
        { key: "resolutionNote", header: "Çözüm Notu" },
        { key: "createdAt", header: "Oluşturulma" },
        { key: "resolvedAt", header: "Çözülme Tarihi" },
      ],
    );
  }
}
