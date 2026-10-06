import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button, Card, Input, Label, Modal, Select } from "../components/ui";
import { useToast } from "../components/toast";
import { useAuth } from "../lib/auth";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useInvalidateOn } from "../lib/socket";

type DispatchRule = "EDD" | "PRIORITY" | "FIFO" | "SPT";
interface FiniteScheduleResult {
  runId: string | null;
  committed: boolean;
  dispatchRule: DispatchRule;
  horizonStart: string;
  horizonEnd: string;
  summary: { workOrders: number; scheduledOps: number; unscheduledOps: number; lateWorkOrders: number; machines: number };
  workOrders: { workOrderId: string; woNo: string; dueDate: string; plannedStart: string | null; plannedEnd: string | null; scheduledOps: number; unscheduledOps: number; late: boolean; latenessMinutes: number }[];
  operations: { operationId: string; woNo: string; seq: number; name: string; machineName: string; minutes: number; start: string; end: string; pinned: boolean }[];
  unscheduled: { operationId: string; woNo: string; seq: number; name: string; reason: string }[];
}
interface SchedulingRunRow {
  id: string;
  dispatchRule: DispatchRule;
  horizonStart: string;
  horizonEnd: string;
  scheduledOps: number;
  unscheduledOps: number;
  lateWorkOrders: number;
  createdAt: string;
  createdBy: { name: string };
}
interface MachineQueueRow {
  machineId: string;
  machineName: string;
  operations: { operationId: string; woNo: string; partNo: string; seq: number; name: string; status: string; plannedStartAt: string; plannedEndAt: string }[];
}

const RULE_LABELS: Record<DispatchRule, string> = {
  EDD: "EDD — en erken termin önce",
  PRIORITY: "Öncelik (düşük sayı daha acil)",
  FIFO: "FIFO — oluşturulma sırası",
  SPT: "SPT — en kısa toplam süre önce",
};
const REASON_LABELS: Record<string, string> = {
  NO_OPERATIONS: "Yayınlanmış operasyon yok (mühendislik yayını gerekli)",
  NO_MACHINE: "Operasyona makine atanmamış",
  NO_STANDARD_MINUTES: "Standart süre (standardMinutes) yok",
  NO_MACHINE_CAPACITY: "Makinede kapasite tanımı yok (takvim veya günlük kapasite)",
  PREDECESSOR_UNSCHEDULED: "Önceki operasyon planlanamadı",
  HORIZON_EXCEEDED: "Planlama ufkuna sığmadı",
};
const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function FiniteSchedulingPanel({ canRun }: { canRun: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [plantId, setPlantId] = useState("");
  const [horizonStart, setHorizonStart] = useState(new Date().toISOString().slice(0, 10));
  const [horizonDays, setHorizonDays] = useState("14");
  const [rule, setRule] = useState<DispatchRule>("EDD");
  const [result, setResult] = useState<FiniteScheduleResult | null>(null);

  const plants = useQuery({ queryKey: ["/plants"], queryFn: () => apiGet<{ id: string; name: string }[]>("/plants") });
  const runs = useQuery({ queryKey: ["/scheduling/runs"], queryFn: () => apiGet<SchedulingRunRow[]>("/scheduling/runs") });

  const queueFrom = useMemo(() => new Date(`${horizonStart}T00:00:00`), [horizonStart]);
  const queueTo = useMemo(() => new Date(queueFrom.getTime() + Math.max(1, Number(horizonDays) || 1) * 86_400_000), [queueFrom, horizonDays]);
  const queue = useQuery({
    queryKey: ["/scheduling/machine-queue", queueFrom.toISOString(), queueTo.toISOString(), plantId],
    queryFn: () => apiGet<MachineQueueRow[]>(`/scheduling/machine-queue?from=${queueFrom.toISOString()}&to=${queueTo.toISOString()}${plantId ? `&plantId=${plantId}` : ""}`),
  });

  const run = useMutation({
    mutationFn: (commit: boolean) =>
      apiPost<FiniteScheduleResult>("/scheduling/runs", {
        plantId: plantId || undefined,
        horizonStart: queueFrom.toISOString(),
        horizonDays: Math.max(1, Math.min(90, Number(horizonDays) || 1)),
        dispatchRule: rule,
        commit,
      }),
    onSuccess: (data) => {
      setResult(data);
      if (data.committed) {
        toast(`Çizelge uygulandı: ${data.summary.scheduledOps} operasyon planlandı`, "success");
        qc.invalidateQueries({ queryKey: ["/scheduling/runs"] });
        qc.invalidateQueries({ queryKey: ["/scheduling/machine-queue"] });
        qc.invalidateQueries({ queryKey: ["/scheduling/capacity"] });
        qc.invalidateQueries({ queryKey: ["/scheduling/bottlenecks"] });
        qc.invalidateQueries({ queryKey: ["/work-orders"] });
      }
    },
    onError: () => toast("Çizelgeleme çalıştırılamadı", "error"),
  });

  const queueSpanMs = queueTo.getTime() - queueFrom.getTime();

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Sonlu Kapasite Çizelgeleme (MRP II)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Operasyonlar, tesis vardiya takvimine göre makinelere sıralı ve çakışmasız yerleştirilir; önce simüle edin, sonra uygulayın.
        Uygulanan çizelge operasyon bazında planlanan başlangıç/bitiş yazar ve kapasite yükünü günceller.
      </p>
      <div className="grid gap-3 md:grid-cols-5">
        <div>
          <Label htmlFor="fs-plant">Tesis</Label>
          <Select id="fs-plant" value={plantId} onChange={(e) => setPlantId(e.target.value)}>
            <option value="">Tümü</option>
            {(plants.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="fs-start">Ufuk başlangıcı</Label>
          <Input id="fs-start" type="date" value={horizonStart} onChange={(e) => setHorizonStart(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="fs-days">Gün</Label>
          <Input id="fs-days" type="number" min={1} max={90} value={horizonDays} onChange={(e) => setHorizonDays(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="fs-rule">Sevk kuralı</Label>
          <Select id="fs-rule" value={rule} onChange={(e) => setRule(e.target.value as DispatchRule)}>
            {(Object.keys(RULE_LABELS) as DispatchRule[]).map((r) => (
              <option key={r} value={r}>{RULE_LABELS[r]}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button variant="outline" disabled={!canRun || run.isPending} onClick={() => run.mutate(false)}>
            Simüle et
          </Button>
          <Button disabled={!canRun || run.isPending} onClick={() => run.mutate(true)}>
            Uygula
          </Button>
        </div>
      </div>
      {!canRun && <p className="mt-2 text-xs text-slate-400">Çizelgeleme çalıştırmak için ADMIN veya PLANNER rolü gerekir.</p>}

      {result && (
        <div className="mt-4 space-y-3" data-testid="finite-result">
          <div className="grid gap-2 text-xs sm:grid-cols-5">
            <div className="rounded bg-slate-50 p-2"><div className="text-slate-400">Mod</div><div className="font-medium">{result.committed ? "Uygulandı" : "Simülasyon"}</div></div>
            <div className="rounded bg-slate-50 p-2"><div className="text-slate-400">İş emri</div><div className="font-medium">{result.summary.workOrders}</div></div>
            <div className="rounded bg-slate-50 p-2"><div className="text-slate-400">Planlanan op.</div><div className="font-medium text-emerald-700">{result.summary.scheduledOps}</div></div>
            <div className="rounded bg-slate-50 p-2"><div className="text-slate-400">Planlanamayan op.</div><div className="font-medium text-amber-700">{result.summary.unscheduledOps}</div></div>
            <div className="rounded bg-slate-50 p-2"><div className="text-slate-400">Geç iş emri</div><div className="font-medium text-red-700">{result.summary.lateWorkOrders}</div></div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="pb-1 font-normal">İş emri</th>
                <th className="pb-1 font-normal">Termin</th>
                <th className="pb-1 font-normal">Planlanan başlangıç</th>
                <th className="pb-1 font-normal">Planlanan bitiş</th>
                <th className="pb-1 font-normal">Op. (plan/—)</th>
                <th className="pb-1 font-normal">Durum</th>
              </tr>
            </thead>
            <tbody>
              {result.workOrders.map((w) => (
                <tr key={w.workOrderId} className="border-t border-slate-100">
                  <td className="py-1 font-medium text-slate-700">{w.woNo}</td>
                  <td className="py-1">{fmtDateTime(w.dueDate)}</td>
                  <td className="py-1">{fmtDateTime(w.plannedStart)}</td>
                  <td className="py-1">{fmtDateTime(w.plannedEnd)}</td>
                  <td className="py-1">{w.scheduledOps}/{w.unscheduledOps}</td>
                  <td className="py-1">
                    {w.late ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">GEÇ +{Math.round(w.latenessMinutes / 60)} sa</span>
                    ) : w.unscheduledOps > 0 ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">EKSİK</span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">ZAMANINDA</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.unscheduled.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-amber-700">Planlanamayanlar ve nedenleri</h3>
              <ul className="space-y-0.5 text-xs text-slate-600">
                {result.unscheduled.map((u, i) => (
                  <li key={`${u.operationId}-${i}`}>
                    <span className="font-medium">{u.woNo}</span>
                    {u.seq > 0 && <span> · op {u.seq} {u.name}</span>}: {REASON_LABELS[u.reason] ?? u.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(queue.data ?? []).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-xs font-semibold text-slate-700">Makine kuyruğu (uygulanmış çizelge)</h3>
          <div className="space-y-1">
            {(queue.data ?? []).map((row) => (
              <div key={row.machineId} className="flex items-center gap-2 text-xs">
                <div className="w-32 shrink-0 truncate text-slate-600">{row.machineName}</div>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100">
                  {row.operations.map((op) => {
                    const s = Math.max(0, (new Date(op.plannedStartAt).getTime() - queueFrom.getTime()) / queueSpanMs);
                    const e = Math.min(1, (new Date(op.plannedEndAt).getTime() - queueFrom.getTime()) / queueSpanMs);
                    if (e <= 0 || s >= 1) return null;
                    return (
                      <div
                        key={op.operationId}
                        className={`absolute top-0 h-full ${op.status === "PENDING" ? "bg-sky-500" : "bg-blue-700"} opacity-90`}
                        style={{ left: `${s * 100}%`, width: `${Math.max(0.5, (e - s) * 100)}%` }}
                        title={`${op.woNo} · op ${op.seq} ${op.name} (${op.partNo}): ${fmtDateTime(op.plannedStartAt)} → ${fmtDateTime(op.plannedEndAt)}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(runs.data ?? []).length > 0 && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-slate-500">Son koşular ({runs.data!.length})</summary>
          <table className="mt-1 w-full">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="pb-1 font-normal">Tarih</th>
                <th className="pb-1 font-normal">Kural</th>
                <th className="pb-1 font-normal">Ufuk</th>
                <th className="pb-1 font-normal">Planlanan / —</th>
                <th className="pb-1 font-normal">Geç</th>
                <th className="pb-1 font-normal">Kullanıcı</th>
              </tr>
            </thead>
            <tbody>
              {runs.data!.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1">{fmtDateTime(r.createdAt)}</td>
                  <td className="py-1">{r.dispatchRule}</td>
                  <td className="py-1">{fmtDateTime(r.horizonStart)} → {fmtDateTime(r.horizonEnd)}</td>
                  <td className="py-1">{r.scheduledOps} / {r.unscheduledOps}</td>
                  <td className="py-1">{r.lateWorkOrders}</td>
                  <td className="py-1">{r.createdBy?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Card>
  );
}

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
interface BottleneckRow {
  machineId: string;
  machineName: string;
  overloadedDays: number;
  totalLoadMinutes: number;
  totalCapacityMinutes: number;
  totalOverloadMinutes: number;
  utilization: number | null;
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
  const { user } = useAuth();
  const canRunFinite = user?.role === "ADMIN" || user?.role === "PLANNER";
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
  const bottlenecks = useQuery({
    queryKey: ["/scheduling/bottlenecks", today.toISOString(), windowEnd.toISOString()],
    queryFn: () => apiGet<BottleneckRow[]>(`/scheduling/bottlenecks?from=${today.toISOString()}&to=${windowEnd.toISOString()}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Scheduling — Gantt ve Sonlu Kapasite</h1>
      <p className="text-sm text-slate-500">
        İş emri Gantt'ı manuel çizelgelenebilir; sonlu kapasite paneli ise operasyonları vardiya takvimine göre
        makinelere otomatik yerleştirir. Planlanmamış iş emirleri için termin tarihi (dueDate) kullanılır.
      </p>

      <FiniteSchedulingPanel canRun={canRunFinite} />

      {(bottlenecks.data ?? []).length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Darboğazlar <span className="font-normal text-slate-400">(pencere boyunca en çok ve en sık aşan makineler, azalan sırayla)</span>
          </h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="pb-1 font-normal">Makine</th>
                <th className="pb-1 font-normal">Aşan gün</th>
                <th className="pb-1 font-normal">Toplam yük</th>
                <th className="pb-1 font-normal">Toplam kapasite</th>
                <th className="pb-1 font-normal">Toplam aşım</th>
                <th className="pb-1 font-normal">Kullanım</th>
              </tr>
            </thead>
            <tbody>
              {(bottlenecks.data ?? []).map((row) => (
                <tr key={row.machineId} className="border-t border-slate-100">
                  <td className="py-1 font-medium text-slate-700">{row.machineName}</td>
                  <td className="py-1">{row.overloadedDays}</td>
                  <td className="py-1">{row.totalLoadMinutes.toFixed(0)} dk</td>
                  <td className="py-1">{row.totalCapacityMinutes.toFixed(0)} dk</td>
                  <td className="py-1 font-medium text-red-600">+{row.totalOverloadMinutes.toFixed(0)} dk</td>
                  <td className="py-1">{row.utilization != null ? `%${(row.utilization * 100).toFixed(0)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

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
