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
  if (node.consumedByWorkOrders.length === 0) return null;
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
