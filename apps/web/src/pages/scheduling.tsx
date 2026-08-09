import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button, Card, Input, Label, Modal } from "../components/ui";
import { useToast } from "../components/toast";
import { apiGet, apiPatch } from "../lib/api";
import { useInvalidateOn } from "../lib/socket";

interface WorkOrderRow {
  id: string;
  woNo: string;
  status: string;
  dueDate: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  machine: { id: string; name: string } | null;
  part: { partNo: string; name: string };
}
interface CapacityRow {
  machineId: string;
  machineName: string;
  date: string;
  loadMinutes: number;
  capacityMinutes: number;
  overloaded: boolean;
}

const DAYS_VISIBLE = 14;
const STATUS_COLOR: Record<string, string> = {
  PLANNED: "bg-slate-400",
  WAITING_MATERIAL: "bg-amber-400",
  IN_PRODUCTION: "bg-blue-500",
  COMPLETED: "bg-emerald-500",
  CANCELLED: "bg-red-400",
};

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / (24 * 3600 * 1000));
}

function ScheduleModal({ wo, onClose }: { wo: WorkOrderRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [start, setStart] = useState(wo.plannedStartDate?.slice(0, 10) ?? "");
  const [end, setEnd] = useState(wo.plannedEndDate?.slice(0, 10) ?? wo.dueDate.slice(0, 10));

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/work-orders/${wo.id}/schedule`, {
        plannedStartDate: start || null,
        plannedEndDate: end || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/work-orders"] });
      onClose();
    },
    onError: () => toast("Çizelge kaydedilemedi", "error"),
  });

  return (
    <Modal open title={`${wo.woNo} — Çizelgele`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="start">Planlanan Başlangıç</Label>
          <Input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="end">Planlanan Bitiş</Label>
          <Input id="end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SchedulingPage() {
  const [editing, setEditing] = useState<WorkOrderRow | null>(null);
  useInvalidateOn(["workorder.updated"], ["/work-orders"]);

  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderRow[]>("/work-orders"),
  });

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const scheduled = (workOrders.data ?? []).filter(
    (wo) => wo.status !== "CANCELLED" && wo.status !== "COMPLETED",
  );

  const dayLabels = Array.from({ length: DAYS_VISIBLE }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
  });

  const windowEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + DAYS_VISIBLE - 1);
    return d;
  }, [today]);
  const capacity = useQuery({
    queryKey: ["/scheduling/capacity", today.toISOString(), windowEnd.toISOString()],
    queryFn: () => apiGet<CapacityRow[]>(`/scheduling/capacity?from=${today.toISOString()}&to=${windowEnd.toISOString()}`),
  });
  const capacityByMachine = useMemo(() => {
    const map = new Map<string, { machineName: string; rows: CapacityRow[] }>();
    for (const row of capacity.data ?? []) {
      const entry = map.get(row.machineId) ?? { machineName: row.machineName, rows: [] };
      entry.rows.push(row);
      map.set(row.machineId, entry);
    }
    return map;
  }, [capacity.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Scheduling — Basit Gantt</h1>
      <p className="text-sm text-slate-500">
        Otomatik kapasite planlama algoritması değil — manuel çizelgeleme. Planlanmamış iş emirleri için
        termin tarihi (dueDate) kullanılır.
      </p>

      {capacityByMachine.size > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Günlük Kapasite Yükü <span className="font-normal text-slate-400">(standart süre, gün genelinde eşit dağıtılır — gerçek sıralı çizelgeleme değil)</span>
          </h2>
          <div className="space-y-2">
            {Array.from(capacityByMachine.entries()).map(([machineId, { machineName, rows }]) => (
              <div key={machineId} className="flex items-center gap-2 text-xs">
                <div className="w-32 shrink-0 truncate text-slate-600">{machineName}</div>
                <div className="flex flex-1 gap-1">
                  {rows.map((row) => {
                    const pct = row.capacityMinutes > 0 ? Math.min(100, (row.loadMinutes / row.capacityMinutes) * 100) : 0;
                    return (
                      <div
                        key={row.date}
                        className="h-4 flex-1 overflow-hidden rounded bg-slate-100"
                        title={`${row.date}: ${row.loadMinutes.toFixed(0)}/${row.capacityMinutes.toFixed(0)} dk`}
                      >
                        <div className={`h-full ${row.overloaded ? "bg-red-500" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <div className="mb-2 grid text-xs text-slate-400" style={{ gridTemplateColumns: `160px repeat(${DAYS_VISIBLE}, 1fr)` }}>
          <div />
          {dayLabels.map((label, i) => (
            <div key={i} className="text-center">
              {label}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {scheduled.map((wo) => {
            const start = wo.plannedStartDate ? new Date(wo.plannedStartDate) : new Date(wo.dueDate);
            const end = wo.plannedEndDate ? new Date(wo.plannedEndDate) : new Date(wo.dueDate);
            const startOffset = Math.max(0, daysBetween(today, start));
            const endOffset = Math.min(DAYS_VISIBLE, daysBetween(today, end) + 1);
            const span = Math.max(1, endOffset - startOffset);
            const visible = startOffset < DAYS_VISIBLE && endOffset > 0;

            return (
              <div
                key={wo.id}
                className="grid items-center"
                style={{ gridTemplateColumns: `160px repeat(${DAYS_VISIBLE}, 1fr)` }}
              >
                <button
                  className="truncate pr-2 text-left text-xs hover:underline"
                  title={`${wo.part.partNo} — ${wo.part.name}`}
                  onClick={() => setEditing(wo)}
                >
                  {wo.woNo} <span className="text-slate-400">({wo.machine?.name ?? "atanmadı"})</span>
                </button>
                {visible ? (
                  <div
                    className={`h-5 rounded ${STATUS_COLOR[wo.status] ?? "bg-slate-400"} cursor-pointer opacity-90 hover:opacity-100`}
                    style={{ gridColumn: `${startOffset + 2} / span ${span}` }}
                    title={`${wo.woNo}: ${start.toLocaleDateString("tr-TR")} → ${end.toLocaleDateString("tr-TR")}`}
                    onClick={() => setEditing(wo)}
                  />
                ) : (
                  <div />
                )}
              </div>
            );
          })}
          {scheduled.length === 0 && <div className="py-6 text-center text-sm text-slate-400">Aktif iş emri yok.</div>}
        </div>
      </Card>

      {editing && <ScheduleModal wo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
