import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { PurchasingService } from "../purchasing/purchasing.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { AuthService } from "../auth/auth.service";
import { nextDocNo } from "../common/numbering";
import { ProductionCalendarService } from "../production-calendar/production-calendar.service";
import { UomService } from "../uom/uom.service";
import { MrpRunSynchronization } from "./mrp-run-synchronization";

const PP_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  lines: {
    include: { material: { select: { id: true, code: true, name: true, unit: true, stockQty: true } } },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

const PRP_INCLUDE = {
  part: { select: { id: true, partNo: true, name: true } },
} as const;

type Decision = "approve" | "reject";

/**
 * MRP netleme motoru (Faz B): açık WorkOrder talebi + Material.minStock
 * reorder-point'i demand kaynağı olarak alır, aktif BomHeader üzerinden
 * tek seviye patlatma yapar, mevcut stok + açık PO + zaten üretilmiş
 * DRAFT/PENDING_APPROVAL öneriler'e karşı netler. Netleme formülü:
 * Net = (Gross İhtiyaç + Safety Stock) − Eldeki Stok − Açık Sipariş − Zaten Önerilmiş.
 *
 * Materyaller Supplier'a bağlı olmadığından (mevcut şemada Material↔Supplier
 * ilişkisi yok) tüm shortfall'lar tek bir "tedarikçisiz" PurchaseProposal'da
 * toplanır — onay anında gerçek tedarikçi seçilir (bkz. decidePurchaseProposal).
 */
@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
    private readonly purchasing: PurchasingService,
    private readonly workOrders: WorkOrdersService,
    private readonly auth: AuthService,
    private readonly outbox: OutboxService,
    private readonly calendar?: ProductionCalendarService,
    private readonly uom?: UomService,
    private readonly synchronization?: MrpRunSynchronization,
  ) {}

  /** MRP II için kapasite girdilerinin gerçek durumunu gösterir. Mevcut modelde
   * operasyon süreleri ve vardiya takvimi olmadığı için finite schedule üretmez;
   * bunun yerine hangi makine/operasyon verisinin eksik olduğunu görünür kılar. */
  async capacityReadiness(tenantId: string) {
    const [machines, operations] = await Promise.all([
      this.prisma.machine.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.workOrderOperation.findMany({
        where: {
          tenantId,
          status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
          workOrder: { status: { in: ["PLANNED", "WAITING_MATERIAL", "IN_PRODUCTION"] } },
        },
        select: {
          id: true,
          name: true,
          seq: true,
          status: true,
          machineId: true,
          workOrder: { select: { id: true, woNo: true, dueDate: true, priority: true } },
        },
        orderBy: [{ workOrder: { dueDate: "asc" } }, { seq: "asc" }],
      }),
    ]);

    const byMachine = new Map<string, { operationCount: number; blockedCount: number; workOrderIds: Set<string>; earliestDueDate: Date | null }>();
    const unassignedOperations: { id: string; name: string; seq: number; status: string; workOrder: { id: string; woNo: string; dueDate: Date; priority: number } }[] = [];
    for (const operation of operations) {
      if (!operation.machineId) {
        unassignedOperations.push(operation);
        continue;
      }
      const current = byMachine.get(operation.machineId) ?? {
        operationCount: 0,
        blockedCount: 0,
        workOrderIds: new Set<string>(),
        earliestDueDate: null,
      };
      current.operationCount += 1;
      current.blockedCount += operation.status === "BLOCKED" ? 1 : 0;
      current.workOrderIds.add(operation.workOrder.id);
      if (!current.earliestDueDate || operation.workOrder.dueDate < current.earliestDueDate) {
        current.earliestDueDate = operation.workOrder.dueDate;
      }
      byMachine.set(operation.machineId, current);
    }

    return {
      readyForFiniteScheduling: false,
      reason: "Operasyon standart süreleri ve makine vardiya/kapasite takvimi tanımlı değil.",
      summary: {
        activeMachineCount: machines.length,
        activeOperationCount: operations.length,
        assignedOperationCount: operations.length - unassignedOperations.length,
        unassignedOperationCount: unassignedOperations.length,
        blockedOperationCount: operations.filter((operation) => operation.status === "BLOCKED").length,
      },
      machines: machines.map((machine) => {
        const load = byMachine.get(machine.id);
        return {
          ...machine,
          operationCount: load?.operationCount ?? 0,
          workOrderCount: load?.workOrderIds.size ?? 0,
          blockedOperationCount: load?.blockedCount ?? 0,
          earliestDueDate: load?.earliestDueDate ?? null,
        };
      }),
      unassignedOperations: unassignedOperations.slice(0, 50),
      missingInputs: [
        "Her operasyon için setup ve çevrim/standart süre",
        "Makine vardiya, tatil ve bakım takvimi",
        "Alternatif makine/operasyon yetkinlik kuralları",
      ],
    };
  }

  async run(tenantId: string, _userId: string) {
    const [openWorkOrders, materials, partStocks, activeReservations] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: { tenantId, status: "PLANNED" },
        select: { id: true, partId: true, quantity: true, dueDate: true },
      }),
      this.prisma.material.findMany({ where: { tenantId } }),
      this.prisma.partStock.findMany({ where: { tenantId } }),
      this.prisma.productionMaterialReservation?.findMany({ where: { tenantId, status: { in: ["OPEN", "PARTIALLY_ALLOCATED", "ALLOCATED", "PARTIALLY_ISSUED", "ISSUED"] } }, include: { requirement: { select: { itemType: true, itemId: true } } } }) ?? Promise.resolve([]),
    ]);

    const demandByPart = new Map<string, { qty: number; dueDate: Date }>();
    for (const wo of openWorkOrders) {
      const qty = Number(wo.quantity);
      const existing = demandByPart.get(wo.partId);
      if (existing) {
        existing.qty += qty;
        if (wo.dueDate < existing.dueDate) existing.dueDate = wo.dueDate;
      } else {
        demandByPart.set(wo.partId, { qty, dueDate: wo.dueDate });
      }
    }

    const partIds = [...demandByPart.keys()];
    const partStockByPart = new Map(partStocks.map((p) => [p.partId, Number(p.qty)]));

    // Faz K (çok seviyeli BOM): BOM grafiğini keşfet, her parçanın en derin
    // (low-level code / LLC) göründüğü seviyeyi bul — bir parça, kendisine
    // referans veren TÜM üst montajlar işlenmeden (ki bunlar her zaman daha
    // düşük LLC'dedir, DAG olduğu için) işlenmez. Böylece aynı alt montaj
    // birden fazla üst parçadan (diamond) talep ediliyorsa çifte sayım olmaz.
    // Döngüler BOM kayıt anında reddedildiği için (bkz. BomService) burada
    // sadece savunma amaçlı bir derinlik sınırı var.
    const MAX_BOM_DEPTH = 10;
    const bomByPart = new Map<string, Awaited<ReturnType<typeof this.prisma.bomHeader.findFirst>> & { lines: { itemType: string; itemId: string; qtyPer: unknown; scrapPct: unknown }[] } | null>();
    const llcByPart = new Map<string, number>();
    for (const id of partIds) llcByPart.set(id, 0);

    let frontier = new Set(partIds);
    for (let depth = 0; depth < MAX_BOM_DEPTH && frontier.size > 0; depth++) {
      const toFetch = [...frontier].filter((id) => !bomByPart.has(id));
      if (toFetch.length) {
        const boms = await this.prisma.bomHeader.findMany({
          // CNC-V1-01: planning must not explode an engineering draft. Legacy
          // rows are intentionally excluded until explicitly released.
          where: { tenantId, partId: { in: toFetch }, status: "RELEASED" },
          include: { lines: true },
        });
        const found = new Set(boms.map((b) => b.partId));
        for (const b of boms) bomByPart.set(b.partId, b as never);
        for (const id of toFetch) if (!found.has(id)) bomByPart.set(id, null);
      }
      const next = new Set<string>();
      for (const partId of frontier) {
        const bom = bomByPart.get(partId);
        if (!bom) continue;
        for (const line of bom.lines) {
          if (line.itemType !== "PART") continue;
          const childDepth = depth + 1;
          if ((llcByPart.get(line.itemId) ?? -1) < childDepth) llcByPart.set(line.itemId, childDepth);
          next.add(line.itemId);
        }
      }
      frontier = next;
    }

    const unresolvedPartIds = partIds.filter((id) => !bomByPart.get(id));

    // Alt montaj (LLC>0) parçalarının zaten önerilmiş üretim miktarı — netleme için.
    const subPartIds = [...llcByPart.entries()].filter(([, llc]) => llc > 0).map(([id]) => id);
    const activeSubProposals = subPartIds.length
      ? await this.prisma.productionProposal.findMany({
          where: { tenantId, partId: { in: subPartIds }, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
          select: { partId: true, qty: true },
        })
      : [];
    const proposedBySub = new Map<string, number>();
    for (const p of activeSubProposals) {
      proposedBySub.set(p.partId, (proposedBySub.get(p.partId) ?? 0) + Number(p.qty));
    }

    const peggedQty = new Map<string, { qty: number; neededByDate: Date | null }>();
    for (const [partId, d] of demandByPart) peggedQty.set(partId, { qty: d.qty, neededByDate: d.dueDate });

    const grossByMaterial = new Map<string, { qty: number; neededByDate: Date | null }>();
    const subAssemblyShortfalls: { partId: string; qty: number; dueDate: Date }[] = [];
    const maxLlc = Math.max(0, ...llcByPart.values());

    for (let llc = 0; llc <= maxLlc; llc++) {
      const partsAtLevel = [...llcByPart.entries()].filter(([, l]) => l === llc).map(([id]) => id);
      for (const partId of partsAtLevel) {
        const pegged = peggedQty.get(partId);
        if (!pegged) continue;

        // Seviye 0 (doğrudan WorkOrder talebi): iş emri zaten planlanmış/taahhüt
        // edilmiş olduğundan malzeme ihtiyacı brüt miktar üzerinden hesaplanır
        // (üst parçanın kendi stoğuna bakılmaz — bu ayrı bir karar, aşağıdaki
        // mevcut productionShortfalls kontrolü). Seviye 1+ (alt montaj): sadece
        // kendi stoğu/zaten-önerilmiş üretimini karşılamayan NET eksik miktar
        // aşağı patlatılır ve yeni bir üretim önerisi olarak kaydedilir.
        let qtyToExplode = pegged.qty;
        if (llc > 0) {
          const onHand = partStockByPart.get(partId) ?? 0;
          const alreadyProposed = proposedBySub.get(partId) ?? 0;
          const shortfall = pegged.qty - onHand - alreadyProposed;
          if (shortfall <= 1e-9) continue;
          qtyToExplode = shortfall;
          subAssemblyShortfalls.push({ partId, qty: shortfall, dueDate: pegged.neededByDate ?? new Date() });
        }

        const bom = bomByPart.get(partId);
        if (!bom) continue;

        for (const line of bom.lines) {
          const scrapFactor = 1 + (line.scrapPct ? Number(line.scrapPct) / 100 : 0);
          const need = qtyToExplode * Number(line.qtyPer) * scrapFactor;
          if (line.itemType === "MATERIAL") {
            const existing = grossByMaterial.get(line.itemId);
            if (existing) {
              existing.qty += need;
              if (!existing.neededByDate || (pegged.neededByDate && pegged.neededByDate < existing.neededByDate)) {
                existing.neededByDate = pegged.neededByDate;
              }
            } else {
              grossByMaterial.set(line.itemId, { qty: need, neededByDate: pegged.neededByDate });
            }
          } else {
            const existing = peggedQty.get(line.itemId);
            if (existing) {
              existing.qty += need;
              if (pegged.neededByDate && (!existing.neededByDate || pegged.neededByDate < existing.neededByDate)) {
                existing.neededByDate = pegged.neededByDate;
              }
            } else {
              peggedQty.set(line.itemId, { qty: need, neededByDate: pegged.neededByDate });
            }
          }
        }
      }
    }

    for (const m of materials) {
      if (m.minStock == null) continue;
      const safety = Number(m.minStock);
      const existing = grossByMaterial.get(m.id);
      if (existing) {
        existing.qty += safety;
      } else {
        grossByMaterial.set(m.id, { qty: safety, neededByDate: null });
      }
    }

    const materialIds = [...grossByMaterial.keys()];
    const [openPoLines, activeProposalLines] = await Promise.all([
      materialIds.length
        ? this.prisma.purchaseOrderLine.findMany({
            where: {
              tenantId,
              materialId: { in: materialIds },
              purchaseOrder: { status: { in: ["ORDERED", "IN_TRANSIT"] } },
            },
            select: { materialId: true, quantity: true, receivedQty: true },
          })
        : Promise.resolve([]),
      materialIds.length
        ? this.prisma.purchaseProposalLine.findMany({
            where: {
              tenantId,
              materialId: { in: materialIds },
              purchaseProposal: { status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
            },
            select: { materialId: true, qty: true },
          })
        : Promise.resolve([]),
    ]);

    const openPoByMaterial = new Map<string, number>();
    for (const l of openPoLines) {
      const outstanding = Number(l.quantity) - Number(l.receivedQty);
      openPoByMaterial.set(l.materialId, (openPoByMaterial.get(l.materialId) ?? 0) + Math.max(0, outstanding));
    }
    const proposedByMaterial = new Map<string, number>();
    for (const l of activeProposalLines) {
      proposedByMaterial.set(l.materialId, (proposedByMaterial.get(l.materialId) ?? 0) + Number(l.qty));
    }

    const reservedByMaterial = new Map<string, number>();
    for (const reservation of activeReservations) {
      if (reservation.requirement.itemType !== "MATERIAL") continue;
      const availableReservation = Number(reservation.quantity) - Number(reservation.issuedQty);
      reservedByMaterial.set(reservation.requirement.itemId, (reservedByMaterial.get(reservation.requirement.itemId) ?? 0) + Math.max(0, availableReservation));
    }
    const materialById = new Map(materials.map((m) => [m.id, m]));
    const shortfallLines: { materialId: string; qty: number; neededByDate: Date | null }[] = [];
    for (const [materialId, gross] of grossByMaterial) {
      const material = materialById.get(materialId);
      if (!material) continue;
      const onHand = Number(material.stockQty) - (reservedByMaterial.get(materialId) ?? 0);
      const onOrder = openPoByMaterial.get(materialId) ?? 0;
      const alreadyProposed = proposedByMaterial.get(materialId) ?? 0;
      const shortfall = gross.qty - onHand - onOrder - alreadyProposed;
      if (shortfall > 1e-9) {
        shortfallLines.push({ materialId, qty: shortfall, neededByDate: gross.neededByDate });
      }
    }

    const activeProdProposals = partIds.length
      ? await this.prisma.productionProposal.findMany({
          where: { tenantId, partId: { in: partIds }, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
          select: { partId: true, qty: true },
        })
      : [];
    const proposedProdByPart = new Map<string, number>();
    for (const p of activeProdProposals) {
      proposedProdByPart.set(p.partId, (proposedProdByPart.get(p.partId) ?? 0) + Number(p.qty));
    }

    const productionShortfalls: { partId: string; qty: number; dueDate: Date }[] = [];
    for (const [partId, demand] of demandByPart) {
      const onHand = partStockByPart.get(partId) ?? 0;
      const alreadyProposed = proposedProdByPart.get(partId) ?? 0;
      const shortfall = demand.qty - onHand - alreadyProposed;
      if (shortfall > 1e-9) {
        productionShortfalls.push({ partId, qty: shortfall, dueDate: demand.dueDate });
      }
    }
    // Faz K: alt montaj (LLC>0) shortfall'ları da aynı üretim önerisi mekanizmasını
    // kullanır — onaylanınca aynı şekilde bir WorkOrder'a dönüşür (bkz.
    // decideProductionProposal), üst/alt parça arasında model düzeyinde fark yok.
    const allProductionShortfalls = [...productionShortfalls, ...subAssemblyShortfalls];

    if (shortfallLines.length === 0 && allProductionShortfalls.length === 0) {
      return { purchaseProposal: null, productionProposals: [], unresolvedPartIds };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let purchaseProposal = null as Awaited<ReturnType<typeof tx.purchaseProposal.create>> | null;
      if (shortfallLines.length > 0) {
        const ppNo = await nextDocNo(tx, "purchaseProposal", "ppNo", "PPR");
        purchaseProposal = await tx.purchaseProposal.create({
          data: {
            tenantId,
            ppNo,
            supplierId: null,
            lines: {
              create: shortfallLines.map((l) => ({
                tenantId,
                materialId: l.materialId,
                qty: l.qty,
                neededByDate: l.neededByDate,
              })),
            },
          },
        });
      }

      const productionProposals = [];
      for (const s of allProductionShortfalls) {
        const prNo = await nextDocNo(tx, "productionProposal", "prNo", "PRP");
        productionProposals.push(
          await tx.productionProposal.create({
            data: { tenantId, prNo, partId: s.partId, qty: s.qty, dueDate: s.dueDate },
          }),
        );
      }

      await this.outbox.record(tx, tenantId, "mrp", purchaseProposal?.id ?? tenantId, "mrp.proposal.created", {
        purchaseProposalId: purchaseProposal?.id,
        productionProposalCount: productionProposals.length,
      });

      return { purchaseProposal, productionProposals };
    });

    await this.notifications.notifyRoles(tenantId, ["PLANNER"], {
      type: "MRP_PROPOSAL_CREATED",
      title: "Yeni MRP önerisi oluşturuldu",
      message: `MRP çalıştırması ${result.purchaseProposal ? 1 : 0} satınalma önerisi ve ${result.productionProposals.length} üretim önerisi üretti`,
      entity: "mrp-run",
    });

    return { ...result, unresolvedPartIds };
  }

  listPurchaseProposals(tenantId: string, status?: string) {
    return this.prisma.purchaseProposal.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      include: PP_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  listProductionProposals(tenantId: string, status?: string) {
    return this.prisma.productionProposal.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      include: PRP_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findPurchaseProposal(tenantId: string, id: string) {
    const p = await this.prisma.purchaseProposal.findFirst({ where: { id, tenantId }, include: PP_INCLUDE });
    if (!p) throw new NotFoundException("Satınalma önerisi bulunamadı");
    return p;
  }

  async findProductionProposal(tenantId: string, id: string) {
    const p = await this.prisma.productionProposal.findFirst({ where: { id, tenantId }, include: PRP_INCLUDE });
    if (!p) throw new NotFoundException("Üretim önerisi bulunamadı");
    return p;
  }

  async submitPurchaseProposal(tenantId: string, userId: string, id: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.purchaseProposal.findFirst({ where: { id, tenantId } });
      if (!proposal) throw new NotFoundException("Satınalma önerisi bulunamadı");
      if (proposal.status !== "DRAFT") throw new ConflictException("Sadece taslak öneriler onaya gönderilebilir");
      await this.approvals.request(tenantId, userId, {
        entity: "purchase-proposal", entityId: id, requiredRoles: ["PLANNER"],
      }, tx);
      const result = await tx.purchaseProposal.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      await this.outbox.record(tx, tenantId, "purchaseproposal", id, "purchaseproposal.updated", { id, status: result.status });
      return result;
    });
    return updated;
  }

  async submitProductionProposal(tenantId: string, userId: string, id: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.productionProposal.findFirst({ where: { id, tenantId } });
      if (!proposal) throw new NotFoundException("Üretim önerisi bulunamadı");
      if (proposal.status !== "DRAFT") throw new ConflictException("Sadece taslak öneriler onaya gönderilebilir");
      await this.approvals.request(tenantId, userId, {
        entity: "production-proposal", entityId: id, requiredRoles: ["PLANNER"],
      }, tx);
      const result = await tx.productionProposal.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      await this.outbox.record(tx, tenantId, "productionproposal", id, "productionproposal.updated", { id, status: result.status });
      return result;
    });
    return updated;
  }

  private async findPendingApproval(tenantId: string, entity: string, entityId: string) {
    const req = await this.prisma.approvalRequest.findFirst({
      where: { tenantId, entity, entityId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (!req) throw new NotFoundException("Bekleyen onay talebi bulunamadı — önce öneri onaya gönderilmeli");
    return req;
  }

  async decidePurchaseProposal(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    action: Decision,
    note: string | undefined,
    supplierId: string | undefined,
    password: string,
  ) {
    // AHK-006: satın alma önerisi kararı (siparişe dönüşür) kritik — bağımsız reauth.
    const reauth = await this.auth.reauthenticate(tenantId, decidedById, password);
    const result = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.purchaseProposal.findFirst({ where: { id, tenantId }, include: { lines: true } });
      if (!proposal) throw new NotFoundException("Satınalma önerisi bulunamadı");
      if (proposal.status !== "PENDING_APPROVAL") throw new ConflictException("Sadece onay bekleyen öneriler karara bağlanabilir");
      const approvalReq = await tx.approvalRequest.findFirst({ where: { tenantId, entity: "purchase-proposal", entityId: id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
      if (!approvalReq) throw new NotFoundException("Bekleyen onay talebi bulunamadı");
      if (action === "reject") {
        await this.approvals.reject(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth);
        const updated = await tx.purchaseProposal.update({ where: { id }, data: { status: "REJECTED" } });
        await this.outbox.record(tx, tenantId, "purchaseproposal", id, "purchaseproposal.updated", { id, status: updated.status });
        return { updated, approvalReq, status: "REJECTED" as const };
      }
      const chosenSupplierId = supplierId ?? proposal.supplierId;
      if (!chosenSupplierId) throw new ConflictException("Satınalma önerisini onaylamak için tedarikçi seçilmeli");
      const po = await this.purchasing.createInTransaction(tx, tenantId, decidedById, {
        supplierId: chosenSupplierId, currency: "TRY", orderDate: new Date(), notes: `MRP önerisinden (${proposal.ppNo}) otomatik oluşturuldu`,
        lines: proposal.lines.map((l) => ({ materialId: l.materialId, quantity: Number(l.qty), unitPrice: 0 })),
      });
      await this.approvals.approve(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth);
      const updated = await tx.purchaseProposal.update({ where: { id }, data: { status: "CONVERTED", convertedToId: po.id, supplierId: chosenSupplierId } });
      await this.outbox.record(tx, tenantId, "purchaseproposal", id, "purchaseproposal.updated", { id, status: updated.status });
      return { updated, approvalReq, status: "APPROVED" as const };
    });
    await this.approvals.notifyDecision(tenantId, result.approvalReq, result.status, note);
    return result.updated;
  }

  async decideProductionProposal(
    tenantId: string,
    id: string,
    decidedById: string,
    decidedRole: Role,
    action: Decision,
    note: string | undefined,
    password: string,
  ) {
    // AHK-006: üretim önerisi kararı (iş emrine dönüşür) kritik — bağımsız reauth.
    const reauth = await this.auth.reauthenticate(tenantId, decidedById, password);
    const result = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.productionProposal.findFirst({ where: { id, tenantId } });
      if (!proposal) throw new NotFoundException("Üretim önerisi bulunamadı");
      if (proposal.status !== "PENDING_APPROVAL") throw new ConflictException("Sadece onay bekleyen öneriler karara bağlanabilir");
      const approvalReq = await tx.approvalRequest.findFirst({ where: { tenantId, entity: "production-proposal", entityId: id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
      if (!approvalReq) throw new NotFoundException("Bekleyen onay talebi bulunamadı");
      if (action === "reject") {
        await this.approvals.reject(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth);
        const updated = await tx.productionProposal.update({ where: { id }, data: { status: "REJECTED" } });
        await this.outbox.record(tx, tenantId, "productionproposal", id, "productionproposal.updated", { id, status: updated.status });
        return { updated, approvalReq, status: "REJECTED" as const };
      }
      const wo = await this.workOrders.createInTransaction(tx, tenantId, { partId: proposal.partId, quantity: Number(proposal.qty), dueDate: proposal.dueDate, priority: 5 });
      await this.approvals.approve(tenantId, approvalReq.id, decidedById, decidedRole, note, tx, false, reauth);
      const updated = await tx.productionProposal.update({ where: { id }, data: { status: "CONVERTED", convertedToId: wo.id } });
      await this.outbox.record(tx, tenantId, "productionproposal", id, "productionproposal.updated", { id, status: updated.status });
      return { updated, approvalReq, status: "APPROVED" as const };
    });
    await this.approvals.notifyDecision(tenantId, result.approvalReq, result.status, note);
    return result.updated;
  }

  // CNC-V1-03R -------------------------------------------------------------
  // These methods deliberately live in the existing MrpService. The former
  // `run()` remains available for historical proposals while all new planning
  // state flows through this single canonical orchestration boundary.

  async upsertPlanningParameter(tenantId: string, userId: string, input: any) {
    await this.assertPlant(tenantId, input.plantId);
    await this.assertPlanningItem(tenantId, input.itemType, input.itemId);
    return this.prisma.$transaction(async (tx) => {
      const where = { tenantId_plantId_itemType_itemId: { tenantId, plantId: input.plantId, itemType: input.itemType, itemId: input.itemId } };
      const before = await (tx as any).mrpPlanningParameter.findUnique({ where });
      const updated = await (tx as any).mrpPlanningParameter.upsert({ where, create: { tenantId, ...input }, update: { ...input } });
      await (tx as any).auditLog.create({ data: { tenantId, userId, entity: "mrp-planning-parameter", entityId: updated.id, action: before ? "UPDATE" : "CREATE", before, after: updated } });
      return updated;
    });
  }

  async createIndependentDemand(tenantId: string, userId: string, input: any) {
    await this.assertPlant(tenantId, input.plantId);
    await this.assertPlanningItem(tenantId, input.itemType, input.itemId);
    return (this.prisma as any).mrpIndependentDemand.create({ data: { tenantId, createdById: userId, ...input } });
  }

  listDailyRuns(tenantId: string, plantId?: string) {
    return (this.prisma as any).mrpRun.findMany({ where: { tenantId, ...(plantId ? { plantId } : {}) }, orderBy: { startedAt: "desc" }, take: 50 });
  }

  listDailyBuckets(tenantId: string, filters: { plantId?: string; runId?: string; itemType?: string; itemId?: string } = {}) {
    return (this.prisma as any).mrpBucket.findMany({
      where: { tenantId, ...(filters.plantId ? { plantId: filters.plantId } : {}), ...(filters.runId ? { runId: filters.runId } : {}), ...(filters.itemType ? { itemType: filters.itemType } : {}), ...(filters.itemId ? { itemId: filters.itemId } : {}) },
      orderBy: [{ bucketDate: "asc" }, { itemType: "asc" }, { itemId: "asc" }],
    });
  }

  listDailyProposals(tenantId: string, filters: { plantId?: string; status?: string; policy?: string } = {}) {
    return (this.prisma as any).mrpProposal.findMany({
      where: { tenantId, ...(filters.plantId ? { plantId: filters.plantId } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.policy ? { policy: filters.policy } : {}) },
      include: { peggings: true, run: { select: { planningDate: true, horizonEnd: true, status: true } } },
      orderBy: [{ receiptDate: "asc" }, { createdAt: "asc" }],
    });
  }

  async findDailyProposal(tenantId: string, id: string) {
    const proposal = await (this.prisma as any).mrpProposal.findFirst({ where: { tenantId, id }, include: { peggings: true, run: true } });
    if (!proposal) throw new NotFoundException("MRP proposal was not found");
    return proposal;
  }

  async listExceptions(tenantId: string, filters: { plantId?: string; severity?: string; type?: string; status?: string } = {}) {
    const latestRun = filters.plantId ? await (this.prisma as any).mrpRun.findFirst({ where: { tenantId, plantId: filters.plantId, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { id: true } }) : null;
    return (this.prisma as any).mrpException.findMany({
      where: { tenantId, ...(filters.plantId ? { plantId: filters.plantId } : {}), ...(latestRun ? { runId: latestRun.id } : {}), ...(filters.severity ? { severity: filters.severity } : {}), ...(filters.type ? { type: filters.type } : {}), ...(filters.status === "ACKNOWLEDGED" ? { acknowledgedAt: { not: null } } : filters.status === "OPEN" ? { acknowledgedAt: null } : {}) },
      orderBy: [{ severity: "asc" }, { requiredDate: "asc" }, { createdAt: "asc" }],
    });
  }

  async acknowledgeException(tenantId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await (tx as any).$queryRaw`SELECT "id" FROM "MrpException" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const exception = await (tx as any).mrpException.findFirst({ where: { id, tenantId } });
      if (!exception) throw new NotFoundException("MRP exception was not found");
      if (exception.acknowledgedAt) return exception;
      const updated = await (tx as any).mrpException.update({ where: { id }, data: { acknowledgedAt: new Date(), acknowledgedById: userId } });
      await (tx as any).auditLog.create({ data: { tenantId, userId, entity: "mrp-exception", entityId: id, action: "STATUS_CHANGE", before: { acknowledgedAt: null }, after: { acknowledgedAt: updated.acknowledgedAt } } });
      return updated;
    });
  }

  /** Deterministic FULL daily regeneration. No row is published as a planner
   * result until the whole calculation has completed inside the transaction. */
  async runDaily(tenantId: string, userId: string, input: { plantId: string; planningDate: Date; horizonEnd: Date }) {
    if (!this.calendar) throw new ConflictException("Canonical production calendar service is unavailable");
    if (!this.uom) throw new ConflictException("Canonical UOM service is unavailable");
    await this.assertPlant(tenantId, input.plantId);
    const planningDate = mrpDate(input.planningDate);
    const horizonEnd = mrpDate(input.horizonEnd);
    if (horizonEnd < planningDate) throw new ConflictException("MRP horizon end cannot precede planning date");

    const run = await this.prisma.$transaction(async (tx) => {
      const created = await (tx as any).mrpRun.create({ data: { tenantId, plantId: input.plantId, planningDate, horizonEnd, initiatedById: userId, status: "RUNNING" } });
      await (tx as any).auditLog.create({ data: { tenantId, userId, entity: "mrp-run", entityId: created.id, action: "CREATE", after: { plantId: input.plantId, planningDate, horizonEnd, status: "RUNNING" } } });
      return created;
    });
    let inputSnapshotAt: Date | undefined;
    try {
      const completed = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const snapshot = await tx.$queryRaw<Array<{ acquiredAt: Date }>>`SELECT transaction_timestamp() AS "acquiredAt" FROM "MrpRun" WHERE "id" = ${run.id}`;
      inputSnapshotAt = snapshot[0]!.acquiredAt;
      await db.mrpRun.update({ where: { id: run.id }, data: { inputSnapshotAt, inputSnapshotStrategy: "POSTGRESQL_REPEATABLE_READ", inputSnapshotVersion: 1 } });
      await this.synchronization?.reached("SNAPSHOT_ESTABLISHED", run.id);
      const workingDateCache = new Map<string, Promise<Date>>();
      const offsetWorkingDate = (date: Date, workingDays: number) => {
        const key = `${mrpDateKey(date)}:${workingDays}`;
        const cached = workingDateCache.get(key);
        if (cached) return cached;
        const pending = this.calendar!.offsetWorkingDays(tenantId, input.plantId, date, workingDays, tx);
        workingDateCache.set(key, pending);
        return pending;
      };
      const [parameters, independentDemand, salesDemand, workOrders, balances, reservations, openPurchaseOrders, firmProposals, requisitions] = await Promise.all([
        db.mrpPlanningParameter.findMany({ where: { tenantId, plantId: input.plantId, planningEnabled: true } }),
        db.mrpIndependentDemand.findMany({ where: { tenantId, plantId: input.plantId, isActive: true, requiredDate: { gte: planningDate, lte: horizonEnd } } }),
        db.salesOrderLine.findMany({ where: { tenantId, fulfillmentPlantId: input.plantId, dueDate: { gte: planningDate, lte: horizonEnd }, salesOrder: { status: "OPEN" }, workOrders: { none: {} } } }),
        db.workOrder.findMany({ where: { tenantId, plantId: input.plantId, status: { in: ["PLANNED", "RELEASED", "WAITING_MATERIAL", "IN_PRODUCTION"] } }, include: { finishedEntries: { select: { quantity: true } }, materialRequirements: true } }),
        db.stockBalance.findMany({ where: { tenantId, bin: { warehouse: { plantId: input.plantId } } }, include: { lot: true } }),
        db.productionMaterialReservation.findMany({ where: { tenantId, status: { in: ["OPEN", "PARTIALLY_ALLOCATED", "ALLOCATED", "PARTIALLY_ISSUED", "ISSUED"] }, requirement: { workOrder: { plantId: input.plantId } } }, include: { bin: { include: { warehouse: true } }, lot: true, requirement: { include: { workOrder: { select: { id: true, dueDate: true } } } } } }),
        db.purchaseOrder.findMany({ where: { tenantId, plantId: input.plantId, status: { in: ["ORDERED", "IN_TRANSIT"] }, expectedDate: { not: null } }, include: { lines: true } }),
        db.mrpProposal.findMany({ where: { tenantId, plantId: input.plantId, status: "FIRMED" } }),
        db.purchaseRequisition.findMany({ where: { tenantId, plantId: input.plantId, status: { in: ["DRAFT", "OPEN"] } }, include: { lines: true } }),
      ]);

      const activeHolds = await db.qualityHold.findMany({ where: { tenantId, status: "ACTIVE", lotId: { not: null } }, select: { lotId: true } });
      const heldLotIds = new Set(activeHolds.map((hold: any) => hold.lotId));
      const parameterByItem = new Map<string, any>(parameters.map((p: any) => [mrpItemKey(p.itemType, p.itemId), p]));
      const uomByCode = new Map((await this.uom!.list(tenantId, tx)).map((unit) => [unit.code.toUpperCase(), unit]));
      const parameterHorizonEnd = (itemType: string, itemId: string) => {
        const days = parameterByItem.get(mrpItemKey(itemType, itemId))?.planningHorizonDays;
        return days == null ? horizonEnd : new Date(Math.min(horizonEnd.getTime(), planningDate.getTime() + Number(days) * 86_400_000));
      };

      type Demand = { itemType: "MATERIAL" | "PART"; itemId: string; quantity: number; date: Date; sourceType: string; sourceId: string; parentType?: string; parentId?: string; level: number; committed?: boolean };
      type Supply = { itemType: "MATERIAL" | "PART"; itemId: string; quantity: number; date: Date; sourceType: string; sourceId: string; fixed: boolean; rescheduled?: number };
      const demands: Demand[] = [];
      const supplies: Supply[] = [];
      const addDemand = (itemType: "MATERIAL" | "PART", itemId: string, quantity: number, date: Date, sourceType: string, sourceId: string, parentType?: string, parentId?: string, level = 0, committed = false) => {
        if (quantity > 1e-9 && date <= horizonEnd) demands.push({ itemType, itemId, quantity, date: mrpDate(date), sourceType, sourceId, parentType, parentId, level, committed });
      };
      for (const d of independentDemand) addDemand(d.itemType, d.itemId, Number(d.quantity), d.requiredDate, "INDEPENDENT_DEMAND", d.id);
      for (const line of salesDemand) {
        const remaining = Math.max(0, Number(line.quantity) - Number(line.shippedQty));
        addDemand("PART", line.partId, remaining, line.dueDate, "SALES_ORDER_LINE", line.id);
      }
      for (const wo of workOrders) {
        const outputRemaining = Math.max(0, Number(wo.quantity) - wo.finishedEntries.reduce((sum: number, entry: any) => sum + Number(entry.quantity), 0));
        if (outputRemaining) supplies.push({ itemType: "PART", itemId: wo.partId, quantity: outputRemaining, date: mrpDate(wo.dueDate), sourceType: "WORK_ORDER", sourceId: wo.id, fixed: true });
        if (wo.materialRequirements.length) {
          for (const requirement of wo.materialRequirements) {
            const remaining = Math.max(0, Number(requirement.requiredQty) - Number(requirement.issuedQty) + Number(requirement.returnedQty));
            addDemand(requirement.itemType, requirement.itemId, remaining, wo.plannedStartDate ?? wo.dueDate, "DEPENDENT_BOM", requirement.id, "WORK_ORDER", wo.id, 1, true);
          }
        } else if (outputRemaining) {
          // A planned/unreleased WO has no immutable requirement snapshot yet;
          // it remains a committed parent demand and is exploded only through
          // the plant's released ProductionDefinition below.
          addDemand("PART", wo.partId, outputRemaining, wo.plannedStartDate ?? wo.dueDate, "WORK_ORDER", wo.id, undefined, undefined, 0, true);
        }
      }
      for (const po of openPurchaseOrders) for (const line of po.lines) {
        const remaining = Math.max(0, Number(line.quantity) - Number(line.receivedQty));
        if (remaining) supplies.push({ itemType: "MATERIAL", itemId: line.materialId, quantity: remaining, date: mrpDate(po.expectedDate), sourceType: "PURCHASE_ORDER", sourceId: po.id, fixed: true });
      }
      for (const p of firmProposals) supplies.push({ itemType: p.itemType, itemId: p.itemId, quantity: Number(p.quantity), date: mrpDate(p.receiptDate), sourceType: "FIRM_PROPOSAL", sourceId: p.id, fixed: true });
      for (const req of requisitions) for (const line of req.lines) supplies.push({ itemType: line.itemType, itemId: line.itemId, quantity: Number(line.quantity), date: mrpDate(line.neededByDate), sourceType: "PURCHASE_REQUISITION", sourceId: req.id, fixed: true });

      const reservedByItem = new Map<string, number>();
      const reservationCoverageByDemand = new Map<string, number>();
      for (const reservation of reservations) {
        if (reservation.bin.warehouse.plantId !== input.plantId) continue;
        if (reservation.lot && (reservation.lot.acceptanceStatus !== "ACCEPTED" || heldLotIds.has(reservation.lotId))) continue;
        const quantity = Math.max(0, Number(reservation.quantity) - Number(reservation.issuedQty));
        const itemKey = mrpItemKey(reservation.requirement.itemType, reservation.requirement.itemId);
        reservedByItem.set(itemKey, (reservedByItem.get(itemKey) ?? 0) + quantity);
        reservationCoverageByDemand.set(reservation.requirementId, (reservationCoverageByDemand.get(reservation.requirementId) ?? 0) + quantity);
      }
      const openingByItem = new Map<string, number>();
      for (const balance of balances) {
        if (balance.lot && (balance.lot.acceptanceStatus !== "ACCEPTED" || heldLotIds.has(balance.lotId))) continue;
        const key = mrpItemKey(balance.itemType, balance.itemId);
        openingByItem.set(key, (openingByItem.get(key) ?? 0) + Number(balance.qty));
      }
      for (const [key, reserved] of reservedByItem) openingByItem.set(key, (openingByItem.get(key) ?? 0) - reserved);

      // Deterministic low-level explosion: each pass creates child demand one
      // level lower; released engineering only and a bounded guard protect the
      // run even if legacy data bypassed BomService's cycle validation.
      let frontier = demands.filter((d) => d.itemType === "PART" && d.date <= parameterHorizonEnd(d.itemType, d.itemId));
      const visited = new Set<string>();
      const explosionProjected = new Map<string, number>();
      for (let depth = 0; depth < 20 && frontier.length; depth++) {
        const ids = [...new Set(frontier.map((d) => d.itemId))];
        const definitions = await db.productionDefinition.findMany({ where: { tenantId, plantId: input.plantId, partId: { in: ids }, status: "RELEASED" }, include: { bomHeader: { include: { lines: true } } } });
        const bomByPart = new Map<string, any>(definitions.map((definition: any) => [definition.partId, definition.bomHeader]));
        const bomLines = definitions.flatMap((definition: any) => definition.bomHeader.lines);
        const materialIds = [...new Set(bomLines.filter((line: any) => line.itemType === "MATERIAL").map((line: any) => line.itemId))] as string[];
        const partIds = [...new Set(bomLines.filter((line: any) => line.itemType === "PART").map((line: any) => line.itemId))] as string[];
        const [componentMaterials, componentParts] = await Promise.all([
          materialIds.length ? db.material.findMany({ where: { tenantId, id: { in: materialIds } }, select: { id: true, unit: true } }) : [],
          partIds.length ? db.part.findMany({ where: { tenantId, id: { in: partIds } }, select: { id: true, unit: true } }) : [],
        ]);
        const canonicalUnitByItem = new Map<string, string>([
          ...componentMaterials.map((item: any) => [mrpItemKey("MATERIAL", item.id), item.unit] as [string, string]),
          ...componentParts.map((item: any) => [mrpItemKey("PART", item.id), item.unit] as [string, string]),
        ]);
        const next: Demand[] = [];
        for (const parent of frontier) {
          const bom = bomByPart.get(parent.itemId);
          if (!bom) continue;
          const cycleKey = `${parent.sourceType}:${parent.sourceId}:${parent.itemId}:${depth}`;
          if (visited.has(cycleKey)) continue;
          visited.add(cycleKey);
          let explodeQuantity = parent.quantity;
          let componentDate = parent.date;
          if (!parent.committed) {
            const key = mrpItemKey(parent.itemType, parent.itemId);
            let available = explosionProjected.has(key) ? explosionProjected.get(key)! : (openingByItem.get(key) ?? 0) + supplies.filter((item) => mrpItemKey(item.itemType, item.itemId) === key && item.date <= parent.date).reduce((sum, item) => sum + item.quantity, 0);
            available -= parent.quantity;
            const param = parameterByItem.get(key);
            const shortage = Math.max(0, Number(param?.safetyStock ?? 0) - available);
            explodeQuantity = shortage > 1e-9 && param?.policy === "MAKE" ? mrpLotSize(shortage, param) : 0;
            available += explodeQuantity;
            explosionProjected.set(key, available);
            if (explodeQuantity > 1e-9 && param) componentDate = await offsetWorkingDate(parent.date, -Number(param.leadTimeWorkingDays));
          }
          if (explodeQuantity <= 1e-9) continue;
          for (const line of bom.lines) {
            const canonicalUnit = canonicalUnitByItem.get(mrpItemKey(line.itemType, line.itemId));
            const sourceUnit = String(line.unit ?? canonicalUnit).toUpperCase();
            const fromUom = uomByCode.get(sourceUnit);
            const toUom = canonicalUnit ? uomByCode.get(canonicalUnit.toUpperCase()) : undefined;
            if (!canonicalUnit || !fromUom || !toUom || fromUom.dimension !== toUom.dimension) throw new ConflictException(`BOM component UOM cannot be converted for item ${line.itemId}`);
            const canonicalQtyPer = new Prisma.Decimal(line.qtyPer).mul(fromUom.factorToBase).div(toUom.factorToBase);
            const required = new Prisma.Decimal(explodeQuantity).mul(canonicalQtyPer).mul(new Prisma.Decimal(1).add(new Prisma.Decimal(line.scrapPct ?? 0).div(100))).toNumber();
            const child: Demand = { itemType: line.itemType as "MATERIAL" | "PART", itemId: line.itemId, quantity: required, date: componentDate, sourceType: "DEPENDENT_BOM", sourceId: `${bom.id}:${line.id}:${parent.sourceId}`, parentType: parent.sourceType, parentId: parent.sourceId, level: parent.level + 1 };
            if (child.date <= parameterHorizonEnd(child.itemType, child.itemId)) {
              demands.push(child);
              if (child.itemType === "PART") next.push(child);
            }
          }
        }
        frontier = next;
      }

      const allItemKeys = new Set([...openingByItem.keys(), ...parameterByItem.keys(), ...demands.map((d) => mrpItemKey(d.itemType, d.itemId)), ...supplies.map((s) => mrpItemKey(s.itemType, s.itemId))]);
      const calculated: any[] = [];
      const exceptions: any[] = [];
      for (const key of [...allItemKeys].sort()) {
        const [itemType, itemId] = key.split(":") as ["MATERIAL" | "PART", string];
        const param = parameterByItem.get(key);
        const itemHorizonEnd = parameterHorizonEnd(itemType, itemId);
        const itemDemands = demands.filter((d) => mrpItemKey(d.itemType, d.itemId) === key && d.date <= itemHorizonEnd).sort((a, b) => a.date.getTime() - b.date.getTime() || a.sourceId.localeCompare(b.sourceId));
        const itemSupplies = supplies.filter((s) => mrpItemKey(s.itemType, s.itemId) === key).sort((a, b) => a.date.getTime() - b.date.getTime() || a.sourceId.localeCompare(b.sourceId));
        let projected = openingByItem.get(key) ?? 0;
        let supplyCursor = 0;
        if (param && itemDemands.length === 0 && projected < Number(param.safetyStock)) {
          itemDemands.push({ itemType, itemId, quantity: 0, date: planningDate, sourceType: "SAFETY_STOCK", sourceId: param.id, level: 0 });
        }
        for (const demand of itemDemands) {
          // Receipts remain available from their effective date onward, not
          // only in a demand bucket with the exact same timestamp.
          while (supplyCursor < itemSupplies.length && itemSupplies[supplyCursor]!.date <= demand.date) {
            projected += itemSupplies[supplyCursor]!.quantity - (itemSupplies[supplyCursor]!.rescheduled ?? 0);
            supplyCursor += 1;
          }
          const demandReservationCoverage = reservationCoverageByDemand.get(demand.sourceId) ?? 0;
          projected += demandReservationCoverage;
          projected -= demand.quantity;
          const safety = param ? Number(param.safetyStock) : 0;
          let net = safety - projected;
          if (net <= 1e-9) continue;
          if (!param || param.policy === "MAKE_OR_BUY") {
            exceptions.push({ itemType, itemId, type: "MISSING_POLICY", severity: "CRITICAL", quantity: net, requiredDate: demand.date, sourceDemandType: demand.sourceType, sourceDemandId: demand.sourceId, projectedBalance: projected, explanation: { message: "No explicit plant/item MRP policy exists; no automatic MAKE/BUY recommendation was created.", grossRequirement: demand.quantity, openingUsable: openingByItem.get(key) ?? 0 } });
            continue;
          }
          const toleranceMs = Number(param.rescheduleToleranceDays ?? 0) * 86_400_000;
          for (let index = supplyCursor; index < itemSupplies.length && net > 1e-9; index++) {
            const lateSupply = itemSupplies[index]!;
            if (lateSupply.date.getTime() <= demand.date.getTime() + toleranceMs) continue;
            const available = lateSupply.quantity - (lateSupply.rescheduled ?? 0);
            if (available <= 1e-9) continue;
            const moved = Math.min(net, available);
            lateSupply.rescheduled = (lateSupply.rescheduled ?? 0) + moved;
            projected += moved;
            net -= moved;
            exceptions.push({ itemType, itemId, type: "RESCHEDULE_IN", severity: "WARNING", quantity: moved, requiredDate: demand.date, suggestedDate: demand.date, sourceDemandType: demand.sourceType, sourceDemandId: demand.sourceId, supplyType: lateSupply.sourceType, supplyId: lateSupply.sourceId, projectedBalance: projected, explanation: { currentReceiptDate: lateSupply.date, suggestedReceiptDate: demand.date, toleranceDays: param.rescheduleToleranceDays, message: "Existing supply should be brought in; no duplicate proposal was created for this covered quantity." } });
          }
          if (net <= 1e-9) continue;
          const proposedQty = mrpLotSize(net, param);
          const releaseDate = await offsetWorkingDate(demand.date, -Number(param.leadTimeWorkingDays));
          const calculation = { openingUsable: openingByItem.get(key) ?? 0, grossRequirement: demand.quantity, existingSupplyBeforeDate: itemSupplies.filter((s) => s.date <= demand.date).reduce((sum, s) => sum + s.quantity, 0), reservationCoverage: demandReservationCoverage, safetyStock: safety, netRequirement: net, lotRule: param.lotSizingRule, recommendedQuantity: proposedQty, projectedBalanceBeforeProposal: projected, requiredReceipt: demand.date.toISOString(), leadTimeWorkingDays: param.leadTimeWorkingDays, recommendedRelease: releaseDate.toISOString() };
          calculated.push({ itemType, itemId, policy: param.policy, quantity: proposedQty, receiptDate: demand.date, releaseDate, sourceDemandType: demand.sourceType, sourceDemandId: demand.sourceId, parentType: demand.parentType, parentId: demand.parentId, calculation, parameterSnapshot: param });
          projected += proposedQty;
          if (releaseDate < planningDate) exceptions.push({ itemType, itemId, type: "SHORTAGE", severity: "CRITICAL", quantity: net, requiredDate: demand.date, suggestedDate: releaseDate, sourceDemandType: demand.sourceType, sourceDemandId: demand.sourceId, projectedBalance: projected - proposedQty, explanation: { ...calculation, message: "Required receipt is inside lead time; planner action is required." } });
          if (proposedQty + 1e-9 < net) exceptions.push({ itemType, itemId, type: "QUANTITY_SHORTAGE", severity: "CRITICAL", quantity: net - proposedQty, requiredDate: demand.date, sourceDemandType: demand.sourceType, sourceDemandId: demand.sourceId, projectedBalance: projected, explanation: { maximumQuantity: param.maximumQuantity, uncoveredQuantity: net - proposedQty, message: "Maximum proposal quantity leaves part of the requirement uncovered." } });
        }

        const fixedSupply = itemSupplies.filter((s) => s.fixed && s.quantity - (s.rescheduled ?? 0) > 1e-9);
        const totalDemand = itemDemands.reduce((sum, item) => sum + item.quantity, 0);
        const totalSupply = fixedSupply.reduce((sum, item) => sum + item.quantity - (item.rescheduled ?? 0), 0);
        const proposedSupply = calculated.filter((item) => mrpItemKey(item.itemType, item.itemId) === key).reduce((sum, item) => sum + item.quantity, 0);
        const excess = Math.max(0, (openingByItem.get(key) ?? 0) + totalSupply + proposedSupply - totalDemand - (param ? Number(param.safetyStock) : 0));
        const lastDemandDate = itemDemands.length ? itemDemands[itemDemands.length - 1]!.date : null;
        const earlySupply = lastDemandDate ? fixedSupply.find((item) => item.date.getTime() + Number(param?.rescheduleToleranceDays ?? 0) * 86_400_000 < lastDemandDate.getTime()) : undefined;
        if (earlySupply && totalDemand > 1e-9) {
          exceptions.push({ itemType, itemId, type: "RESCHEDULE_OUT", severity: "INFO", quantity: Math.min(earlySupply.quantity, totalDemand), requiredDate: lastDemandDate, suggestedDate: lastDemandDate, supplyType: earlySupply.sourceType, supplyId: earlySupply.sourceId, projectedBalance: excess, explanation: { currentReceiptDate: earlySupply.date, suggestedReceiptDate: lastDemandDate, toleranceDays: param?.rescheduleToleranceDays ?? 0, message: "Firm supply is materially earlier than the demand it covers." } });
        }
        if (excess > 1e-9 && fixedSupply.length) {
          const candidate = fixedSupply[fixedSupply.length - 1]!;
          const cancel = !lastDemandDate || candidate.date > lastDemandDate;
          exceptions.push({ itemType, itemId, type: cancel ? "CANCEL" : "QUANTITY_EXCESS", severity: cancel ? "WARNING" : "INFO", quantity: Math.min(excess, candidate.quantity), requiredDate: lastDemandDate, supplyType: candidate.sourceType, supplyId: candidate.sourceId, projectedBalance: excess, explanation: { excessQuantity: excess, currentReceiptDate: candidate.date, message: cancel ? "Future supply is no longer required; cancellation is a planner decision." : "Existing firm supply exceeds the current requirement and was not changed." } });
        }
      }

      const bucketSnapshots: any[] = [];
      for (const key of [...allItemKeys].sort()) {
        const [itemType, itemId] = key.split(":") as ["MATERIAL" | "PART", string];
        const itemDemands = demands.filter((item) => mrpItemKey(item.itemType, item.itemId) === key);
        const itemSupplies = supplies.filter((item) => mrpItemKey(item.itemType, item.itemId) === key);
        const itemProposals = calculated.filter((item) => mrpItemKey(item.itemType, item.itemId) === key);
        const param = parameterByItem.get(key);
        const dates = new Set<string>([mrpDateKey(planningDate), ...itemDemands.map((item) => mrpDateKey(item.date)), ...itemSupplies.map((item) => mrpDateKey(item.date)), ...itemProposals.map((item) => mrpDateKey(item.receiptDate))]);
        let projected = openingByItem.get(key) ?? 0;
        for (const dateKey of [...dates].sort()) {
          const datedSupply = itemSupplies.filter((item) => mrpDateKey(item.date) === dateKey);
          const datedDemand = itemDemands.filter((item) => mrpDateKey(item.date) === dateKey);
          const datedProposals = itemProposals.filter((item) => mrpDateKey(item.receiptDate) === dateKey);
          const scheduledReceipts = datedSupply.filter((item) => !["FIRM_PROPOSAL", "RESERVATION_COVERAGE"].includes(item.sourceType)).reduce((sum, item) => sum + item.quantity - (item.rescheduled ?? 0), 0);
          const firmPlannedSupply = datedSupply.filter((item) => item.sourceType === "FIRM_PROPOSAL").reduce((sum, item) => sum + item.quantity - (item.rescheduled ?? 0), 0);
          const reservationCoverage = datedDemand.reduce((sum, item) => sum + (reservationCoverageByDemand.get(item.sourceId) ?? 0), 0);
          const grossRequirements = datedDemand.reduce((sum, item) => sum + item.quantity, 0);
          const proposedSupply = datedProposals.reduce((sum, item) => sum + item.quantity, 0);
          projected += scheduledReceipts + firmPlannedSupply + reservationCoverage + proposedSupply - grossRequirements;
          const safetyStock = param ? Number(param.safetyStock) : 0;
          bucketSnapshots.push({ tenantId, plantId: input.plantId, runId: run.id, itemType, itemId, bucketDate: new Date(`${dateKey}T00:00:00.000Z`), openingAvailable: openingByItem.get(key) ?? 0, scheduledReceipts, firmPlannedSupply, reservationCoverage, grossRequirements, safetyStock, proposedSupply, projectedAvailable: projected, projectedAboveSafety: projected - safetyStock, explanation: { equation: "opening + scheduled + firm + reservation + proposed - gross", demandSources: datedDemand.map((item) => ({ type: item.sourceType, id: item.sourceId, quantity: item.quantity })), supplySources: datedSupply.map((item) => ({ type: item.sourceType, id: item.sourceId, quantity: item.quantity, rescheduled: item.rescheduled ?? 0 })) } });
        }
      }

        await db.mrpProposal.updateMany({ where: { tenantId, plantId: input.plantId, status: "PROPOSED" }, data: { status: "SUPERSEDED" } });
        const proposalRows: any[] = [];
        const peggingRows: any[] = [];
        if (calculated.length) {
          const allocated = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('"MrpProposalNumberSeq"') AS "value" FROM generate_series(1, ${calculated.length})`;
          const proposalYear = planningDate.getUTCFullYear();
          for (const [index, candidate] of calculated.entries()) {
            const proposalId = randomUUID();
            proposalRows.push({ id: proposalId, tenantId, plantId: input.plantId, runId: run.id, proposalNo: `MRP-${proposalYear}-${String(allocated[index]!.value).padStart(4, "0")}`, itemType: candidate.itemType, itemId: candidate.itemId, policy: candidate.policy, quantity: candidate.quantity, receiptDate: candidate.receiptDate, releaseDate: candidate.releaseDate, sourceDemandType: candidate.sourceDemandType, sourceDemandId: candidate.sourceDemandId, calculation: candidate.calculation, parameterSnapshot: candidate.parameterSnapshot });
            peggingRows.push({ tenantId, proposalId, demandType: candidate.sourceDemandType, demandId: candidate.sourceDemandId, parentDemandType: candidate.parentType, parentDemandId: candidate.parentId, quantity: candidate.quantity, requiredDate: candidate.receiptDate, context: candidate.calculation });
          }
          await db.mrpProposal.createMany({ data: proposalRows });
          await db.mrpPegging.createMany({ data: peggingRows });
        }
        if (exceptions.length) await db.mrpException.createMany({ data: exceptions.map((item) => ({ tenantId, plantId: input.plantId, runId: run.id, ...item })) });
        if (bucketSnapshots.length) await db.mrpBucket.createMany({ data: bucketSnapshots });
        await this.synchronization?.reached("PUBLICATION_STAGED", run.id);
        const summary = { proposalCount: proposalRows.length, exceptionCount: exceptions.length, demandCount: demands.length, supplyCount: supplies.length, equation: "Projected Available(t) = opening usable + dated supply + reservation coverage - gross requirements - safety stock threshold" };
        const updated = await db.mrpRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), parameters, summary } });
        await db.auditLog.create({ data: { tenantId, userId, entity: "mrp-run", entityId: run.id, action: "STATUS_CHANGE", before: { status: "RUNNING" }, after: { status: "COMPLETED", summary } } });
        return { ...updated, proposals: calculated.length, exceptions: exceptions.length };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 60_000 });
      return completed;
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Unknown MRP failure";
      await this.prisma.$transaction(async (tx) => {
        await (tx as any).mrpRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), failure, ...(inputSnapshotAt ? { inputSnapshotAt, inputSnapshotStrategy: "POSTGRESQL_REPEATABLE_READ", inputSnapshotVersion: 1 } : {}) } });
        await (tx as any).auditLog.create({ data: { tenantId, userId, entity: "mrp-run", entityId: run.id, action: "STATUS_CHANGE", before: { status: "RUNNING" }, after: { status: "FAILED", failure } } });
      });
      throw error;
    }
  }

  async firmDailyProposal(tenantId: string, userId: string, id: string, firm: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await (tx as any).$queryRaw`SELECT "id" FROM "MrpProposal" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const proposal = await (tx as any).mrpProposal.findFirst({ where: { id, tenantId } });
      if (!proposal) throw new NotFoundException("MRP proposal was not found");
      if (["CONVERTED", "CANCELLED", "SUPERSEDED"].includes(proposal.status)) throw new ConflictException("This proposal can no longer be firmed or unfirmed");
      const updated = await (tx as any).mrpProposal.update({ where: { id }, data: firm ? { status: "FIRMED", firmedAt: new Date(), firmedById: userId } : { status: "PROPOSED", firmedAt: null, firmedById: null } });
      await (tx as any).auditLog.create({ data: { tenantId, userId, entity: "mrp-proposal", entityId: id, action: "STATUS_CHANGE", before: { status: proposal.status }, after: { status: updated.status, firm } } });
      return updated;
    });
  }

  async convertDailyProposal(tenantId: string, userId: string, id: string, allowedPolicy: "MAKE" | "BUY") {
    return this.prisma.$transaction(async (tx) => {
      await (tx as any).$queryRaw`SELECT "id" FROM "MrpProposal" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const proposal = await (tx as any).mrpProposal.findFirst({ where: { id, tenantId } });
      if (!proposal) throw new NotFoundException("MRP proposal was not found");
      if (proposal.status === "CONVERTED") return proposal;
      if (proposal.status !== "FIRMED") throw new ConflictException("Only a firmed MRP proposal can be converted");
      if (proposal.policy !== allowedPolicy) throw new ConflictException("MRP proposal policy does not match this conversion authorization");
      let converted: { id: string; type: string };
      if (proposal.policy === "MAKE") {
        if (proposal.itemType !== "PART") throw new ConflictException("A MAKE proposal must reference a manufactured Part");
        const definition = await (tx as any).productionDefinition.findFirst({ where: { tenantId, plantId: proposal.plantId, partId: proposal.itemId, status: "RELEASED" } });
        if (!definition) throw new ConflictException("MAKE conversion requires a released production definition for the proposal plant/item");
        const existing = await (tx as any).workOrder.findFirst({ where: { tenantId, mrpProposalId: proposal.id } });
        let wo = existing;
        if (!wo) {
          const created = await this.workOrders.createInTransaction(tx, tenantId, { partId: proposal.itemId, plantId: proposal.plantId, quantity: Number(proposal.quantity), dueDate: proposal.receiptDate, priority: 5, notes: `MRP proposal ${proposal.id}` });
          wo = await (tx as any).workOrder.update({ where: { id: created.id }, data: { mrpProposalId: proposal.id } });
        }
        converted = { id: wo.id, type: "WORK_ORDER" };
      } else {
        const existing = await (tx as any).purchaseRequisition.findFirst({ where: { tenantId, mrpProposalId: proposal.id } });
        const requisition = existing ?? await (tx as any).purchaseRequisition.create({ data: { tenantId, plantId: proposal.plantId, prqNo: await nextDocNo(tx, "purchaseRequisition", "prqNo", "PRQ"), mrpProposalId: proposal.id, requiredDate: proposal.receiptDate, requestedById: userId, notes: `MRP proposal ${proposal.proposalNo}`, lines: { create: { itemType: proposal.itemType, itemId: proposal.itemId, quantity: proposal.quantity, neededByDate: proposal.receiptDate } } } });
        converted = { id: requisition.id, type: "PURCHASE_REQUISITION" };
      }
      const updated = await (tx as any).mrpProposal.update({ where: { id }, data: { status: "CONVERTED", convertedAt: new Date(), convertedToType: converted.type, convertedToId: converted.id } });
      await (tx as any).auditLog.create({ data: { tenantId, userId, entity: "mrp-proposal", entityId: id, action: "STATUS_CHANGE", before: { status: proposal.status }, after: { status: "CONVERTED", ...converted } } });
      return updated;
    });
  }

  private async assertPlant(tenantId: string, plantId: string) {
    const plant = await this.prisma.plant.findFirst({ where: { tenantId, id: plantId } });
    if (!plant) throw new NotFoundException("Plant was not found");
    return plant;
  }

  private async assertPlanningItem(tenantId: string, itemType: "MATERIAL" | "PART", itemId: string) {
    const item = itemType === "MATERIAL" ? await this.prisma.material.findFirst({ where: { tenantId, id: itemId } }) : await this.prisma.part.findFirst({ where: { tenantId, id: itemId } });
    if (!item) throw new NotFoundException("Planning item was not found");
    return item;
  }
}

function mrpDate(value: Date) { return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`); }
function mrpDateKey(value: Date) { return value.toISOString().slice(0, 10); }
function mrpItemKey(itemType: string, itemId: string) { return `${itemType}:${itemId}`; }
export function mrpLotSize(netRequirement: number, parameter: any) {
  let quantity = netRequirement;
  if (parameter.lotSizingRule === "FIXED_LOT_SIZE" && Number(parameter.fixedLotSize) > 0) quantity = Math.ceil(quantity / Number(parameter.fixedLotSize)) * Number(parameter.fixedLotSize);
  if (Number(parameter.minimumQuantity) > quantity) quantity = Number(parameter.minimumQuantity);
  if ((parameter.lotSizingRule === "ORDER_MULTIPLE" || Number(parameter.orderMultiple) > 0) && Number(parameter.orderMultiple) > 0) quantity = Math.ceil(quantity / Number(parameter.orderMultiple)) * Number(parameter.orderMultiple);
  if (Number(parameter.maximumQuantity) > 0 && quantity > Number(parameter.maximumQuantity)) quantity = Number(parameter.maximumQuantity);
  return Math.round((quantity + Number.EPSILON) * 1_000_000) / 1_000_000;
}
