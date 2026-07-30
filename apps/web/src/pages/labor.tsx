import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { useState } from "react";
import { apiGet } from "../lib/api";
import { Card, Input } from "../components/ui";

interface OperatorLabor {
  operatorId: string;
  operatorName: string;
  department: string | null;
  hours: number;
  goodCount: number;
  scrapCount: number;
  laborCost: number;
  laborCostPartial: boolean;
}

interface LaborSummary {
  from: string;
  to: string;
  operators: OperatorLabor[];
  totalHours: number;
  totalLaborCost: number;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Faz H Labor Tracking — operatör bazında toplam çalışma süresi ve işçilik
 * maliyeti. Yeni bir zaman-çizelgesi kaydı tutmaz, mevcut ProductionRun
 * (operatorId + startedAt/endedAt) verisini operatöre göre gruplayıp gösterir. */
export function LaborPage() {
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(todayIso());

  const query = useQuery({
    queryKey: ["/labor/summary", from, to],
    queryFn: () => apiGet<LaborSummary>(`/labor/summary?from=${from}&to=${to}`),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Clock className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold">İşçilik Takibi</h1>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[180px]" />
          <span className="text-slate-400">—</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[180px]" />
        </div>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Rapor alınamadı.</p>}

      {query.data && (
        <>
          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <Card>
              <div className="text-xs uppercase text-slate-500">Toplam Saat</div>
              <div className="mt-1 text-xl font-bold">{query.data.totalHours.toFixed(1)}</div>
            </Card>
            <Card>
              <div className="text-xs uppercase text-slate-500">Toplam İşçilik Maliyeti</div>
              <div className="mt-1 text-xl font-bold">{query.data.totalLaborCost.toFixed(2)}</div>
            </Card>
          </div>

          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-2">Operatör</th>
                  <th className="py-2">Departman</th>
                  <th className="py-2 text-right">Saat</th>
                  <th className="py-2 text-right">Sağlam / Hurda</th>
                  <th className="py-2 text-right">İşçilik Maliyeti</th>
                </tr>
              </thead>
              <tbody>
                {query.data.operators.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400">
                      Bu aralıkta üretim kaydı yok.
                    </td>
                  </tr>
                )}
                {query.data.operators.map((o) => (
                  <tr key={o.operatorId} className="border-b border-slate-50">
                    <td className="py-2">{o.operatorName}</td>
                    <td className="py-2 text-slate-500">{o.department ?? "—"}</td>
                    <td className="py-2 text-right font-medium">{o.hours.toFixed(1)}</td>
                    <td className="py-2 text-right">
                      {o.goodCount} / <span className="text-red-600">{o.scrapCount}</span>
                    </td>
                    <td className="py-2 text-right font-medium" title={o.laborCostPartial ? "hourlyRate eksik, kısmi" : undefined}>
                      {o.laborCost.toFixed(2)}
                      {o.laborCostPartial ? " *" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
