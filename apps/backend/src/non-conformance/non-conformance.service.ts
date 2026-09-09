import { ConflictException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import type { CreateNonConformanceDto, ResolveNonConformanceDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { AppException } from "../common/app-exception";
import { NotificationsService } from "../notifications/notifications.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { AuthService } from "../auth/auth.service";

type DeviationDecision = "approve" | "reject";

const INCLUDE = {
  workOrder: { select: { id: true, woNo: true, status: true } },
  reportedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  inspectionLot: {
    include: {
      holds: true,
      measurements: true,
      requirement: { select: { planRevision: true, inspectionPoint: true, snapshot: true } },
    },
  },
  dispositions: true,
  reworkRequirements: true,
} as const;

@Injectable()
export class NonConformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly approvals: ApprovalsService,
    private readonly auth: AuthService,
  ) {}

  findAll(tenantId: string, workOrderId?: string, status?: string) {
    return this.prisma.nonConformance.findMany({
      where: { tenantId, ...(workOrderId ? { workOrderId } : {}), ...(status ? { status: status as never } : {}) },
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  /** Bir iş emrinde açık (OPEN) bir uygunsuzluk kaydı var mı — ProductionService bu kontrolü kullanır. */
  async hasOpenNonConformance(tenantId: string, workOrderId: string): Promise<boolean> {
    const open = await this.prisma.nonConformance.findFirst({
      where: { tenantId, workOrderId, status: "OPEN" },
    });
    return !!open;
  }

  async create(tenantId: string, reportedById: string, dto: CreateNonConformanceDto) {
    const wo = await this.prisma.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");

    const created = await this.prisma.$transaction(async (tx) => {
      const nc = await tx.nonConformance.create({
        data: { ...dto, tenantId, reportedById },
        include: INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "nonconformance", nc.id, "nonconformance.updated", { id: nc.id, workOrderId: dto.workOrderId });
      return nc;
    });
    await this.notifications.notifyRoles(tenantId, ["ADMIN", "FOREMAN"], {
      type: "NON_CONFORMANCE_CREATED",
      title: "Yeni uygunsuzluk bildirimi",
      message: `${wo.woNo}: ${dto.description ?? "Uygunsuzluk kaydı oluşturuldu"}`,
      entity: "non-conformances",
      entityId: created.id,
    });
    return created;
  }

  async resolve(tenantId: string, resolvedById: string, id: string, dto: ResolveNonConformanceDto) {
    const nc = await this.prisma.nonConformance.findFirst({ where: { id, tenantId } });
    if (!nc) throw new NotFoundException("Uygunsuzluk kaydı bulunamadı");
    if (dto.status === "RESOLVED" && !dto.resolutionNote?.trim()) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "RESOLUTION_NOTE_REQUIRED",
        "Kaydı kapatmak için çözüm açıklaması (ne yapıldığı) girilmeli",
      );
    }
    // AHK-012: uygunsuz ürünü olduğu gibi kabul etme (deviation) formal onay
    // olmadan kapatılamaz — resolve() öncesi APPROVED bir ApprovalRequest şart.
    if (dto.status === "RESOLVED" && nc.actionType === "DEVIATION") {
      const approved = await this.prisma.approvalRequest.findFirst({
        where: { tenantId, entity: "non-conformance", entityId: id, status: "APPROVED" },
      });
      if (!approved) {
        throw new ConflictException("Deviation onayı olmadan bu kayıt kapatılamaz");
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.nonConformance.update({
        where: { id },
        data: {
          status: dto.status,
          resolvedAt: dto.status === "RESOLVED" ? new Date() : null,
          resolutionNote: dto.status === "RESOLVED" ? dto.resolutionNote : null,
          resolvedById: dto.status === "RESOLVED" ? resolvedById : null,
        },
        include: INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "nonconformance", id, "nonconformance.updated", { id, workOrderId: nc.workOrderId });
      return result;
    });
    return updated;
  }

  /** AHK-012: DEVIATION actionType'lı bir NCR için formal onay talebi açar —
   * CAPA'nın submitForApproval() ile birebir aynı desen (Faz A ApprovalsService). */
  async requestDeviation(tenantId: string, userId: string, id: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const nc = await tx.nonConformance.findFirst({ where: { id, tenantId } });
      if (!nc) throw new NotFoundException("Uygunsuzluk kaydı bulunamadı");
      if (nc.actionType !== "DEVIATION") {
        throw new ConflictException("Sadece DEVIATION tipi kayıtlar için onay talep edilebilir");
      }
      if (nc.status !== "OPEN") {
        throw new ConflictException("Sadece açık (OPEN) kayıtlar için onay talep edilebilir");
      }
      await this.approvals.request(tenantId, userId, {
        entity: "non-conformance", entityId: id, requiredRoles: ["ADMIN"],
      }, tx);
      const result = await tx.nonConformance.update({
        where: { id },
        data: { status: "PENDING_DEVIATION_APPROVAL" },
        include: INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "nonconformance", id, "nonconformance.updated", { id, workOrderId: nc.workOrderId });
      return result;
    });
    return updated;
  }

  /** AHK-006 deseni: uygunsuz ürünü olduğu gibi kabul etme kritik bir karardır,
   * transaction dışında bağımsız yeniden kimlik doğrulama zorunludur. */
  async decideDeviation(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    action: DeviationDecision,
    note: string | undefined,
    password: string,
  ) {
    const reauth = await this.auth.reauthenticate(tenantId, decidedById, password);
    const result = await this.prisma.$transaction(async (tx) => {
      const nc = await tx.nonConformance.findFirst({ where: { id, tenantId } });
      if (!nc) throw new NotFoundException("Uygunsuzluk kaydı bulunamadı");
      if (nc.status !== "PENDING_DEVIATION_APPROVAL") {
        throw new ConflictException("Sadece onay bekleyen deviation talepleri karara bağlanabilir");
      }
      const approvalReq = await tx.approvalRequest.findFirst({
        where: { tenantId, entity: "non-conformance", entityId: id, status: "PENDING" }, orderBy: { createdAt: "desc" },
      });
      if (!approvalReq) throw new NotFoundException("Bekleyen onay talebi bulunamadı");
      await (action === "reject"
        ? this.approvals.reject(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth)
        : this.approvals.approve(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth));
      // Onay/red her ikisi de OPEN'a döner — red'de deviation reddedilmiştir
      // (ayrı bir yolla, ör. SCRAP olarak yeniden kaydedilmelidir), onayda
      // resolve() artık APPROVED ApprovalRequest'i bulup kapatmaya izin verir.
      const updated = await tx.nonConformance.update({
        where: { id },
        data: { status: "OPEN" },
        include: INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "nonconformance", id, "nonconformance.updated", { id, workOrderId: nc.workOrderId });
      return { updated, approvalReq, status: action === "reject" ? ("REJECTED" as const) : ("APPROVED" as const) };
    });
    await this.approvals.notifyDecision(tenantId, result.approvalReq, result.status, note);
    return result.updated;
  }
}
