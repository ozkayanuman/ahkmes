import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, Label, Select } from "../components/ui";
import { apiGet } from "../lib/api";
import { fmtDate, fmtQty } from "../lib/format";

interface WorkOrderOption {
  id: string;
  woNo: string;
}

interface GenealogyData {
  workOrder: { id: string; woNo: string; status: string; quantity: string };
  part: { id: string; partNo: string; revision: string; name: string };
  customer: { id: string; name: string } | null;
  quoteNo: string | null;
  backward: {
    materialsConsumed: {
      id: string;
      type: string;
      quantity: string;
      date: string;
      material: { code: string; name: string };
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

export function GenealogyPage() {
  const [workOrderId, setWorkOrderId] = useState("");

  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
  });

  const genealogy = useQuery({
    queryKey: ["/work-orders", workOrderId, "genealogy"],
    queryFn: () => apiGet<GenealogyData>(`/work-orders/${workOrderId}/genealogy`),
    enabled: !!workOrderId,
  });

  const g = genealogy.data;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Genealogy — İzlenebilirlik</h1>
      <p className="text-sm text-slate-500">
        İş emri granülaritesinde geriye (tüketilen malzeme) ve ileriye (üretim/mamul) izlenebilirlik. Seri
        numarası/MTU bazlı takip bu sürümde yok.
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
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <div className="text-xs uppercase text-slate-500">İş Emri / Parça</div>
            <div className="mt-1 font-medium">{g.workOrder.woNo}</div>
            <div className="text-sm text-slate-500">
              {g.part.partNo} rev{g.part.revision} — {g.part.name}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {g.customer ? `Müşteri: ${g.customer.name}${g.quoteNo ? ` (${g.quoteNo})` : ""}` : "Teklife bağlı değil"}
            </div>
          </Card>

          <Card>
            <div className="mb-2 text-xs uppercase text-slate-500">← Geriye: Tüketilen Malzeme</div>
            {g.backward.materialsConsumed.length === 0 && (
              <div className="text-sm text-slate-400">Kayıt yok</div>
            )}
            <ul className="space-y-1 text-sm">
              {g.backward.materialsConsumed.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span>
                    {c.material.code} — {c.material.name}
                  </span>
                  <span className="text-slate-500">
                    {fmtQty(c.quantity)} ({c.type === "CONSUMED" ? "tüketildi" : "rezerve"})
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="mb-2 text-xs uppercase text-slate-500">İleriye: Üretim / Mamul →</div>
            {g.forward.productionRuns.map((r) => (
              <div key={r.id} className="mb-2 border-b border-slate-100 pb-2 text-sm last:border-0">
                <div>
                  {r.machine?.name ?? "Manuel"} — {r.operator.name}
                </div>
                <div className="text-xs text-slate-500">
                  İyi: {r.goodCount} · Hurda: {r.scrapCount} · {fmtDate(r.startedAt)}
                  {r.endedAt ? ` → ${fmtDate(r.endedAt)}` : " (devam ediyor)"}
                </div>
              </div>
            ))}
            {g.forward.finishedGoodsEntries.length > 0 && (
              <div className="mt-2">
                <div className="text-xs uppercase text-slate-500">Mamul Girişleri</div>
                {g.forward.finishedGoodsEntries.map((f) => (
                  <div key={f.id} className="flex justify-between text-sm">
                    <span>{fmtDate(f.date)}</span>
                    <span>{fmtQty(f.quantity)}</span>
                  </div>
                ))}
              </div>
            )}
            {g.forward.productionRuns.length === 0 && g.forward.finishedGoodsEntries.length === 0 && (
              <div className="text-sm text-slate-400">Kayıt yok</div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
