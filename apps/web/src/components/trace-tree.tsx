/** Faz K 3: lots.tsx/serial-numbers.tsx ScanModal'larının paylaştığı çok seviyeli
 * izlenebilirlik ağacı — backend'in recursive forward/backward trace çıktısını
 * (bkz. lots.service.ts/serial-numbers.service.ts traceForward/traceBackward)
 * girintili iç içe bir liste olarak gösterir. */

export interface TraceItemRef {
  itemType: "MATERIAL" | "PART";
  itemId: string;
}

export interface ForwardTraceNode {
  consumedByWorkOrders: {
    consumption: { id: string; quantity: string; date: string };
    workOrder: { id: string; woNo: string; status: string; part: { partNo: string; name: string } };
    producedLots: {
      id: string;
      quantity: string;
      date: string;
      lot: { id: string; lotNo: string } | null;
      forward: ForwardTraceNode | null;
    }[];
  }[];
  customerDeliveries?: {
    id: string;
    qty: string;
    customerReturnLines?: { customerReturn: { rmaNo: string; status: string; receivedAt: string | null } }[];
    delivery: {
      id: string;
      dlvNo: string;
      shippedDate: string;
      deliveredAt: string | null;
      carrierName: string | null;
      trackingReference: string | null;
      salesOrder: { soNo: string; customer: { id: string; name: string } };
    };
  }[];
}

export interface BackwardTraceNode {
  producedByWorkOrders: {
    entry: { id: string; quantity: string; date: string };
    workOrder: { id: string; woNo: string; status: string };
    consumedLots: (TraceItemRef & {
      id: string;
      quantity: string;
      lot: { id: string; lotNo: string } | null;
      backward: BackwardTraceNode | null;
    })[];
  }[];
}

const INDENT = 16;

export function ForwardTree({ node, depth = 0 }: { node: ForwardTraceNode; depth?: number }) {
  if (node.consumedByWorkOrders.length === 0 && (node.customerDeliveries?.length ?? 0) === 0) return null;
  return (
    <div className="space-y-2" style={{ marginLeft: depth * INDENT }}>
      {node.consumedByWorkOrders.map((c) => (
        <div key={c.consumption.id} className="rounded-md border border-slate-100 p-2">
          <div className="font-medium">
            {c.workOrder.woNo} — {c.workOrder.part.partNo} ({c.workOrder.status})
          </div>
          <div className="text-slate-500">Tüketilen: {c.consumption.quantity}</div>
          {c.producedLots.length === 0 && <div className="text-slate-400">Üretilen lot yok</div>}
          {c.producedLots.map((p) => (
            <div key={p.id} className="mt-1">
              <div className="text-slate-500">→ Üretilen lot: {p.lot?.lotNo ?? "—"}</div>
              {p.forward && <ForwardTree node={p.forward} depth={depth + 1} />}
            </div>
          ))}
        </div>
      ))}
      {(node.customerDeliveries ?? []).map((line) => (
        <div key={`delivery-${line.id}`} className="rounded-md border border-sky-100 bg-sky-50 p-2">
          <div className="font-medium">Müşteri sevkiyatı: {line.delivery.dlvNo} · {line.delivery.salesOrder.soNo}</div>
          <div className="text-slate-600">{line.delivery.salesOrder.customer.name} · sevk {line.qty}</div>
          <div className="text-slate-500">{line.delivery.deliveredAt ? "Teslim alındı" : "Yolda"}{line.delivery.carrierName ? ` · ${line.delivery.carrierName}` : ""}{line.delivery.trackingReference ? ` · ${line.delivery.trackingReference}` : ""}</div>
          {(line.customerReturnLines ?? []).map(({ customerReturn }) => <div key={customerReturn.rmaNo} className="mt-1 text-amber-700">↩ RMA {customerReturn.rmaNo} · {customerReturn.status === "RECEIVED" ? "Karantinada" : customerReturn.status === "CANCELLED" ? "İptal" : "Kabul bekliyor"}</div>)}
        </div>
      ))}
    </div>
  );
}

export function BackwardTree({
  node,
  itemLabel,
  depth = 0,
}: {
  node: BackwardTraceNode;
  itemLabel: (item: TraceItemRef) => string;
  depth?: number;
}) {
  if (node.producedByWorkOrders.length === 0) return null;
  return (
    <div className="space-y-2" style={{ marginLeft: depth * INDENT }}>
      {node.producedByWorkOrders.map((p) => (
        <div key={p.entry.id} className="rounded-md border border-slate-100 p-2">
          <div className="font-medium">
            {p.workOrder.woNo} ({p.workOrder.status})
          </div>
          <div className="text-slate-500">Üretilen: {p.entry.quantity}</div>
          {p.consumedLots.length === 0 && <div className="text-slate-400">Tüketilen kalem yok</div>}
          {p.consumedLots.map((c) => (
            <div key={c.id} className="mt-1">
              <div className="text-slate-500">
                ← Tüketilen: {itemLabel(c)}
                {c.lot ? ` (${c.lot.lotNo})` : ""}
              </div>
              {c.backward && <BackwardTree node={c.backward} itemLabel={itemLabel} depth={depth + 1} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
