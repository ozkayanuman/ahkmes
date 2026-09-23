import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Yıl bazlı sıralı belge numarası üretir (örn. TKF-2026-0001).
 * Transaction içinde çağrılmalı — aynı tx içindeki önceki insert'leri görür,
 * yarış durumunda unique constraint devreye girer.
 */
export async function nextDocNo(
  tx: Tx,
  model:
    | "quote"
    | "workOrder"
    | "purchaseOrder"
    | "purchaseProposal"
    | "productionProposal"
    | "rFQ"
    | "salesOrder"
    | "delivery"
    | "invoice"
    | "transferOrder"
    | "cycleCount"
    | "inspection"
    | "capa"
    | "calibration"
    | "maintenanceOrder"
    | "supplierInvoice"
    | "supplierPayment"
    | "customerPayment"
    | "mrpProposal"
    | "purchaseRequisition"
    | "customerReturn",
  field:
    | "quoteNo"
    | "woNo"
    | "poNo"
    | "ppNo"
    | "prNo"
    | "rfqNo"
    | "soNo"
    | "dlvNo"
    | "invNo"
    | "toNo"
    | "ccNo"
    | "insNo"
    | "dofNo"
    | "kalNo"
    | "bakNo"
    | "sinNo"
    | "spNo"
    | "cpNo"
    | "proposalNo"
    | "prqNo"
    | "rmaNo",
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const pfx = `${prefix}-${year}-`;
  // Serialises concurrent callers computing the "next" number for the same
  // model/field so two transactions never read the same max before either
  // commits (this function itself does no row locking or unique retry).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`nextDocNo:${model}:${field}`}))`;
  // Raw SQL, not the Prisma model client: the document-number sequence
  // (`@unique` on this field) is global across tenants, but the tenant-scope
  // extension (AHK-017) would silently inject the caller's tenantId into a
  // model-client findFirst here, scoping "last" per tenant while the DB
  // constraint stays global — two tenants would both compute "0001" and
  // collide. Raw queries are documented as outside that extension's scope.
  const table = model.charAt(0).toUpperCase() + model.slice(1);
  const rows = await tx.$queryRawUnsafe<{ value: string }[]>(
    `SELECT "${field}" AS value FROM "${table}" WHERE "${field}" LIKE $1 ORDER BY "${field}" DESC LIMIT 1`,
    `${pfx}%`,
  );
  const last = rows[0]?.value;
  const lastSeq = last ? Number.parseInt(last.slice(pfx.length), 10) : 0;
  return `${pfx}${String(lastSeq + 1).padStart(4, "0")}`;
}
