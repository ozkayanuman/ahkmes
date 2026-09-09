import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Label, Select } from "../components/ui";
import { apiGet } from "../lib/api";
import { fmtDate, fmtQty } from "../lib/format";

interface WorkOrderOption {
  id: string;
  woNo: string;
}
interface MaterialOption {
  id: string;
  code: string;
  name: string;
}
interface PartOption {
  id: string;
  partNo: string;
  name: string;
}

interface GenealogyData {
  workOrder: { id: string; woNo: string; status: string; quantity: string };
  part: { id: string; partNo: string; revision: string; name: string };
  customer: { id: string; name: string } | null;
  quoteNo: string | null;
  backward: {
    materialsConsumed: {
      id: string;
      itemType: "MATERIAL" | "PART";
      itemId: string;
      type: string;
      quantity: string;
      date: string;
    }[];
  };
  forward: {
    productionRuns: {
      id: string;
      goodCount: number;
      scrapCount: number;
      startedAt: string;
      endedAt: string | null;
      machine: { name: string } | null;
      operator: { name: string };
    }[];
    finishedGoodsEntries: { id: string; quantity: string; date: string }[];
  };
}

const NODE_W = 220;
const ROW_H = 78;
const COL_X = { material: 20, wo: 320, forward: 620 };
const WO_W = 240;
const WO_H = 130;

function NodeBox({
  x,
  y,
  w,
  className,
  children,
}: {
  x: number;
  y: number;
  w: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`absolute rounded-lg border px-3 py-2 text-xs shadow-sm ${className ?? "border-slate-200 bg-white"}`}
      style={{ left: x, top: y, width: w }}
    >
      {children}
    </div>
  );
}

/** Genealogy — izlenebilirlik akışını kart listesi yerine gerçek bir node-graph
 * olarak gösterir: soldan malzeme tüketimi, ortada iş emri, sağdan üretim
 * koşuları/mamul girişleri; aralarındaki SVG çizgiler akış yönünü görselleştirir. */
export function GenealogyPage() {
  const [workOrderId, setWorkOrderId] = useState("");

  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
  });
  const materialOptions = useQuery({
    queryKey: ["/materials"],
    queryFn: () => apiGet<MaterialOption[]>("/materials"),
  });
  const partOptions = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
  });

  const genealogy = useQuery({
    queryKey: ["/work-orders", workOrderId, "genealogy"],
    queryFn: () => apiGet<GenealogyData>(`/work-orders/${workOrderId}/genealogy`),
    enabled: !!workOrderId,
  });

  const g = genealogy.data;
  const materialById = new Map((materialOptions.data ?? []).map((m) => [m.id, m]));
  const partById = new Map((partOptions.data ?? []).map((p) => [p.id, p]));
  function itemLabel(c: { itemType: "MATERIAL" | "PART"; itemId: string }) {
    if (c.itemType === "MATERIAL") {
      const m = materialById.get(c.itemId);
      return m ? `${m.code} — ${m.name}` : c.itemId;
    }
    const p = partById.get(c.itemId);
    return p ? `${p.partNo} — ${p.name}` : c.itemId;
  }

  const materials = g?.backward.materialsConsumed ?? [];
  const runs = g?.forward.productionRuns ?? [];
  const finishedGoods = g?.forward.finishedGoodsEntries ?? [];
  const forwardCount = runs.length + finishedGoods.length;

  const height = Math.max(materials.length, forwardCount, 1) * ROW_H + 40;
  const woY = height / 2 - WO_H / 2;
  const woCenterY = woY + WO_H / 2;

  function materialY(i: number) {
    return (height - materials.length * ROW_H) / 2 + i * ROW_H + 8;
  }
  function forwardY(i: number) {
    return (height - forwardCount * ROW_H) / 2 + i * ROW_H + 8;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Genealogy — İzlenebilirlik</h1>
      <p className="text-sm text-slate-500">
        İş emri granülaritesinde geriye (tüketilen malzeme) ve ileriye (üretim/mamul) izlenebilirlik akış şeması.
        Seri numarası/MTU bazlı takip bu sürümde yok.
      </p>

      <div className="max-w-xs">
        <Label htmlFor="wo">İş Emri</Label>
        <Select id="wo" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
          <option value="">Seçiniz</option>
          {(workOrders.data ?? []).map((wo) => (
            <option key={wo.id} value={wo.id}>
              {wo.woNo}
            </option>
          ))}
        </Select>
      </div>

      {g && (
        <div
          className="relative overflow-x-auto rounded-lg border border-slate-200 bg-slate-50"
          style={{ height: Math.max(height, 220) }}
        >
          <svg className="pointer-events-none absolute left-0 top-0" width={COL_X.forward + NODE_W + 20} height={height}>
            {materials.map((_, i) => (
              <line
                key={i}
                x1={COL_X.material + NODE_W}
                y1={materialY(i) + 24}
                x2={COL_X.wo}
                y2={woCenterY}
                stroke="#94a3b8"
                strokeWidth={1.5}
              />
            ))}
            {Array.from({ length: forwardCount }).map((_, i) => (
              <line
                key={i}
                x1={COL_X.wo + WO_W}
                y1={woCenterY}
                x2={COL_X.forward}
                y2={forwardY(i) + 24}
                stroke="#94a3b8"
                strokeWidth={1.5}
              />
            ))}
          </svg>

          {materials.length === 0 && (
            <NodeBox x={COL_X.material} y={height / 2 - 20} w={NODE_W} className="border-dashed border-slate-300 bg-white text-slate-400">
              Tüketilen malzeme yok
            </NodeBox>
          )}
          {materials.map((c, i) => (
            <NodeBox key={c.id} x={COL_X.material} y={materialY(i)} w={NODE_W} className="border-amber-200 bg-amber-50">
              <div className="font-semibold text-slate-700">{itemLabel(c)}</div>
              <div className="mt-0.5 text-slate-400">
                {fmtQty(c.quantity)} · {c.type === "CONSUMED" ? "tüketildi" : "rezerve"}
              </div>
            </NodeBox>
          ))}

          <NodeBox x={COL_X.wo} y={woY} w={WO_W} className="border-brand-300 bg-brand-50">
            <div className="text-[10px] uppercase tracking-wide text-brand-600">İş Emri</div>
            <div className="text-sm font-bold text-slate-800">{g.workOrder.woNo}</div>
            <div className="mt-1 text-slate-600">
              {g.part.partNo} rev{g.part.revision} — {g.part.name}
            </div>
            <div className="mt-1 text-slate-400">
              {g.customer ? `Müşteri: ${g.customer.name}${g.quoteNo ? ` (${g.quoteNo})` : ""}` : "Teklife bağlı değil"}
            </div>
          </NodeBox>

          {forwardCount === 0 && (
            <NodeBox x={COL_X.forward} y={height / 2 - 20} w={NODE_W} className="border-dashed border-slate-300 bg-white text-slate-400">
              Üretim/mamul kaydı yok
            </NodeBox>
          )}
          {runs.map((r, i) => (
            <NodeBox key={r.id} x={COL_X.forward} y={forwardY(i)} w={NODE_W} className="border-blue-200 bg-blue-50">
              <div className="font-semibold text-slate-700">{r.machine?.name ?? "Manuel"}</div>
              <div className="text-slate-500">{r.operator.name}</div>
              <div className="mt-0.5 text-slate-400">
                İyi: {r.goodCount} · Hurda: {r.scrapCount} · {fmtDate(r.startedAt)}
                {r.endedAt ? ` → ${fmtDate(r.endedAt)}` : " (devam ediyor)"}
              </div>
            </NodeBox>
          ))}
          {finishedGoods.map((f, i) => (
            <NodeBox
              key={f.id}
              x={COL_X.forward}
              y={forwardY(runs.length + i)}
              w={NODE_W}
              className="border-green-200 bg-green-50"
            >
              <div className="font-semibold text-slate-700">Mamul Girişi</div>
              <div className="mt-0.5 text-slate-400">
                {fmtDate(f.date)} · {fmtQty(f.quantity)}
              </div>
            </NodeBox>
          ))}
        </div>
      )}
    </div>
  );
}
