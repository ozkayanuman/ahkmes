import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Yıl bazlı sıralı belge numarası üretir (örn. TKF-2026-0001).
 * Transaction içinde çağrılmalı — aynı tx içindeki önceki insert'leri görür,
 * yarış durumunda unique constraint devreye girer.
 */
export async function nextDocNo(
  tx: Tx,
  model: "quote" | "workOrder" | "purchaseOrder" | "purchaseProposal" | "productionProposal",
  field: "quoteNo" | "woNo" | "poNo" | "ppNo" | "prNo",
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const pfx = `${prefix}-${year}-`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const last = await (tx as any)[model].findFirst({
    where: { [field]: { startsWith: pfx } },
    orderBy: { [field]: "desc" },
    select: { [field]: true },
  });
  const lastSeq = last ? Number.parseInt(String(last[field]).slice(pfx.length), 10) : 0;
  return `${pfx}${String(lastSeq + 1).padStart(4, "0")}`;
}
