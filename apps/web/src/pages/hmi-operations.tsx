import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Factory, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { fmtDate, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { Button, Card, Input, Label, Select } from "../components/ui";
import { useToast } from "../components/toast";

type Status = "PENDING" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "SKIPPED";
type ChecklistItem = { code: string; level: "PASS" | "BLOCKING" | "WARNING" | "INFORMATIONAL"; message: string };
type Machine = { id: string; name: string; unit?: { id: string; name: string } | null };
type Operation = {
  id: string; workOrderId: string; seq: number; name: string; status: Status; completedQty: string; scrapQty: string; startedAt?: string | null;
  machine?: Machine | null; workCenter?: { id: string; name: string } | null;
  ncProgram?: { id: string; version: number; status: string; fileName: string; checksum: string; effectivityScope?: string | null } | null;
  readiness: { requiredSetup: boolean; verificationStatus: string; verificationAt?: string | null; invalidatedReason?: string | null };
  workOrder: { id: string; woNo: string; quantity: string; priority: number; status: string; dueDate: string; plannedStartDate?: string | null; plannedEndDate?: string | null; part: { id: string; partNo: string; revision: string; name: string } };
};
type Detail = Operation & {
  setup: { operation: { toolRequirements: Array<{ id: string; isRequired: boolean; quantity: number; alternativeGroup?: string | null; toolDefinition?: { code: string; name: string } | null; toolAssembly?: { code: string; name: string; revision: string } | null }>; fixtureRequirements: Array<{ id: string; isRequired: boolean; quantity: number; alternativeGroup?: string | null; fixtureDefinition: { code: string; name: string; revision: string } }> }; verification?: { status: string; verifiedAt?: string | null; invalidatedReason?: string | null; snapshot?: { payload: unknown } | null; assignments: Array<{ id: string; physicalToolInstance?: { serialNo: string; status: string; remainingLife: number; toolDefinition: { code: string; name: string }; toolAssembly?: { code: string; revision: string } | null } | null; physicalFixtureInstance?: { serialNo: string; status: string; fixtureDefinition: { code: string; name: string; revision: string } } | null }> } | null; fixtureCompliance?: Array<{ fixtureId: string; evaluation: { blockers: string[]; warnings: string[] } }> };
  activeRun?: { id: string; startedAt: string; goodCount: number; scrapCount: number; notes?: string | null } | null;
  checklist: { items: ChecklistItem[]; blockers: string[]; warnings: string[] };
};

const statusLabel: Record<Status, string> = { PENDING: "Hazır", IN_PROGRESS: "Çalışıyor", BLOCKED: "Bloke", COMPLETED: "Tamamlandı", SKIPPED: "Atlandı" };
const badge: Record<Status, string> = { PENDING: "bg-slate-100 text-slate-700", IN_PROGRESS: "bg-blue-100 text-blue-800", BLOCKED: "bg-red-100 text-red-800", COMPLETED: "bg-green-100 text-green-800", SKIPPED: "bg-slate-100 text-slate-500" };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? String((error.body as { message?: string })?.message ?? fallback) : fallback;
}

export function HmiOperationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [machineId, setMachineId] = useState("");
  const [status, setStatus] = useState<"" | Status>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const actions = useQuery({ queryKey: ["/hmi/actions"], queryFn: () => apiGet<string[]>("/hmi/actions") });
  const canRead = actions.data?.includes("HMI_READ") === true;
  const canStart = actions.data?.includes("HMI_START") === true;
  const canComplete = actions.data?.includes("HMI_COMPLETE") === true;
  const queue = useQuery({
    queryKey: ["/hmi/operations", machineId, status],
    queryFn: () => apiGet<Operation[]>(`/hmi/operations?${new URLSearchParams({ ...(machineId ? { machineId } : {}), ...(status ? { status } : {}) })}`),
    enabled: canRead,
  });
  const detail = useQuery({ queryKey: ["/hmi/operations", selectedId], queryFn: () => apiGet<Detail>(`/hmi/operations/${selectedId}`), enabled: canRead && !!selectedId });
  useInvalidateOn(["productionrun.updated", "workorder.updated"], ["/hmi/operations"]);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["/hmi/operations"] }); queryClient.invalidateQueries({ queryKey: ["/hmi/actions"] }); };
  const start = useMutation({ mutationFn: (id: string) => apiPost(`/hmi/operations/${id}/start`, {}), onSuccess: () => { toast("Operasyon başlatıldı.", "success"); refresh(); }, onError: (error) => toast(errorMessage(error, "Operasyon başlatılamadı."), "error") });
  const complete = useMutation({ mutationFn: ({ id, goodCount, scrapCount, notes }: { id: string; goodCount: number; scrapCount: number; notes?: string }) => apiPost(`/hmi/operations/${id}/complete`, { goodCount, scrapCount, ...(notes ? { notes } : {}) }), onSuccess: () => { toast("Operasyon tamamlandı.", "success"); refresh(); }, onError: (error) => toast(errorMessage(error, "Operasyon tamamlanamadı."), "error") });
  const machines = useMemo(() => Array.from(new Map((queue.data ?? []).filter((item) => item.machine).map((item) => [item.machine!.id, item.machine!])).values()), [queue.data]);

  if (actions.isLoading) return <div className="flex min-h-64 items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Yetkiler yükleniyor…</div>;
  if (actions.isError || !canRead) return <Card className="border-red-200"><h1 className="text-xl font-semibold text-red-800">Operatör terminaline erişim yok</h1><p className="mt-2 text-sm text-red-700">HMI_READ action grant'i ve MES execution erişimi gerekir. Bu ekranda veri gösterilmedi.</p></Card>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Operatör Terminali</h1><p className="text-sm text-slate-500">Açık operasyon kuyruğu, yayınlı NC ve doğrulanmış setup kontrolü.</p></div><Button variant="outline" onClick={refresh}><RefreshCw className="h-4 w-4" /> Yenile</Button></div>
    <Card><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="hmi-machine">Makine</Label><Select id="hmi-machine" value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">Tüm makineler</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</Select></div><div><Label htmlFor="hmi-status">Durum</Label><Select id="hmi-status" value={status} onChange={(event) => setStatus(event.target.value as "" | Status)}><option value="">Tüm açık durumlar</option><option value="PENDING">Hazır</option><option value="IN_PROGRESS">Çalışıyor</option><option value="BLOCKED">Bloke</option></Select></div></div></Card>
    <div className="grid gap-4 xl:grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.6fr)]">
      <Card className="p-0"><div className="border-b px-4 py-3 font-semibold">Operasyon kuyruğu</div>{queue.isLoading ? <div className="p-5 text-sm text-slate-500">Yükleniyor…</div> : queue.isError ? <div className="p-5 text-sm text-red-700">Kuyruk yüklenemedi.</div> : (queue.data ?? []).length === 0 ? <div className="p-5 text-sm text-slate-500">Bu filtrede açık operasyon yok.</div> : <div className="max-h-[68vh] overflow-auto">{(queue.data ?? []).map((operation) => <button type="button" key={operation.id} onClick={() => setSelectedId(operation.id)} className={`w-full border-b p-4 text-left hover:bg-slate-50 ${selectedId === operation.id ? "bg-brand-50 ring-1 ring-inset ring-brand-300" : ""}`}><div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{operation.workOrder.woNo} · {operation.seq}. {operation.name}</div><div className="mt-1 text-sm text-slate-600">{operation.workOrder.part.partNo} · {operation.workOrder.part.name}</div></div><span className={`rounded px-2 py-1 text-xs font-semibold ${badge[operation.status]}`}>{statusLabel[operation.status]}</span></div><div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-500"><span>Öncelik {operation.workOrder.priority}</span><span>{operation.machine?.name ?? "Makine atanmadı"}</span><span>Plan: {fmtQty(operation.workOrder.quantity)}</span><span>Termin: {fmtDate(operation.workOrder.dueDate)}</span></div>{operation.readiness.requiredSetup && <div className={`mt-2 text-xs font-medium ${operation.readiness.verificationStatus === "VERIFIED" ? "text-green-700" : "text-red-700"}`}>Setup: {operation.readiness.verificationStatus}</div>}</button>)}</div>}</Card>
      <OperationDetail detail={detail.data} loading={detail.isLoading} error={detail.isError} canStart={canStart} canComplete={canComplete} startPending={start.isPending} completePending={complete.isPending} onStart={() => detail.data && start.mutate(detail.data.id)} onComplete={(payload) => detail.data && complete.mutate({ id: detail.data.id, ...payload })} />
    </div>
  </div>;
}

function OperationDetail({ detail, loading, error, canStart, canComplete, startPending, completePending, onStart, onComplete }: { detail?: Detail; loading: boolean; error: boolean; canStart: boolean; canComplete: boolean; startPending: boolean; completePending: boolean; onStart: () => void; onComplete: (payload: { goodCount: number; scrapCount: number; notes?: string }) => void }) {
  const [goodCount, setGoodCount] = useState("0"); const [scrapCount, setScrapCount] = useState("0"); const [notes, setNotes] = useState("");
  useEffect(() => {
    setGoodCount(String(detail?.activeRun?.goodCount ?? 0));
    setScrapCount(String(detail?.activeRun?.scrapCount ?? 0));
    setNotes(detail?.activeRun?.notes ?? "");
  }, [detail?.activeRun?.id]);
  if (!detail) return <Card className="flex min-h-80 items-center justify-center text-slate-500">{loading ? "Operasyon yükleniyor…" : error ? "Operasyon detayı yüklenemedi." : "Kuyruktan bir operasyon seçin."}</Card>;
  const blockers = detail.checklist.blockers;
  const startDisabled = !canStart || detail.status !== "PENDING" || blockers.length > 0 || !!detail.activeRun;
  const completeDisabled = !canComplete || detail.status !== "IN_PROGRESS";
  return <div className="space-y-4"><Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{detail.workOrder.woNo} · {detail.seq}. {detail.name}</h2><p className="mt-1 text-sm text-slate-600">{detail.workOrder.part.partNo} rev. {detail.workOrder.part.revision} · {detail.workOrder.part.name} · plan {fmtQty(detail.workOrder.quantity)}</p></div><span className={`rounded px-3 py-1 text-sm font-semibold ${badge[detail.status]}`}>{statusLabel[detail.status]}</span></div><div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><span className="text-slate-500">Makine</span><div className="font-medium">{detail.machine?.name ?? "Atanmadı"}</div></div><div><span className="text-slate-500">Çalışma birimi</span><div className="font-medium">{detail.workCenter?.name ?? "Tanımlı değil"}</div></div><div><span className="text-slate-500">Termin</span><div className="font-medium">{fmtDate(detail.workOrder.dueDate)}</div></div></div></Card>
    <Card><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-brand-700" /> Uyum checklist'i</h3><div className="mt-3 space-y-2">{detail.checklist.items.map((item, index) => <div key={`${item.code}-${index}`} className={`rounded border p-3 text-sm ${item.level === "BLOCKING" ? "border-red-200 bg-red-50 text-red-800" : item.level === "WARNING" ? "border-amber-200 bg-amber-50 text-amber-900" : item.level === "PASS" ? "border-green-200 bg-green-50 text-green-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}><b>{item.level === "BLOCKING" ? "ENGEL" : item.level === "WARNING" ? "UYARI" : item.level === "PASS" ? "GEÇTİ" : "BİLGİ"}</b> · {item.message}</div>)}</div>{detail.ncProgram && <div className="mt-4 rounded bg-slate-50 p-3 text-sm"><b>NC Programı:</b> {detail.ncProgram.fileName} · rev. {detail.ncProgram.version} · <code>{detail.ncProgram.checksum.slice(0, 16)}…</code></div>}</Card>
    <Card><h3 className="font-semibold">Takım ve fikstür gereksinimleri</h3><div className="mt-3 grid gap-3 lg:grid-cols-2"><RequirementList title="Takımlar" items={detail.setup.operation.toolRequirements.map((item) => ({ id: item.id, required: item.isRequired, quantity: item.quantity, alternativeGroup: item.alternativeGroup, name: item.toolAssembly ? `${item.toolAssembly.code} · ${item.toolAssembly.name} rev. ${item.toolAssembly.revision}` : item.toolDefinition ? `${item.toolDefinition.code} · ${item.toolDefinition.name}` : "Tanımsız takım" }))} /><RequirementList title="Fikstürler" items={detail.setup.operation.fixtureRequirements.map((item) => ({ id: item.id, required: item.isRequired, quantity: item.quantity, alternativeGroup: item.alternativeGroup, name: `${item.fixtureDefinition.code} · ${item.fixtureDefinition.name} rev. ${item.fixtureDefinition.revision}` }))} /></div><div className="mt-3 text-sm">Setup durumu: <b>{detail.setup.verification?.status ?? "DOĞRULANMADI"}</b>{detail.setup.verification?.verifiedAt ? ` · ${fmtDate(detail.setup.verification.verifiedAt)}` : ""}{detail.setup.verification?.invalidatedReason ? <span className="text-red-700"> · {detail.setup.verification.invalidatedReason}</span> : ""}</div></Card>
    <Card><h3 className="font-semibold">Seçilen fiziksel kaynaklar</h3><SelectedResources assignments={detail.setup.verification?.assignments ?? []} /><SnapshotSummary snapshot={detail.setup.verification?.snapshot?.payload} /></Card>
    {detail.status === "PENDING" && <Card><h3 className="font-semibold">Operasyonu başlat</h3>{blockers.length > 0 && <p className="mt-2 flex gap-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" />{blockers.join(" ")}</p>}{!canStart && <p className="mt-2 text-sm text-red-700">HMI_START action grant'i yok.</p>}<Button className="mt-4 h-12 px-7" disabled={startDisabled || startPending} onClick={onStart}><Play className="h-5 w-5" /> Başlat</Button></Card>}
    {detail.status === "IN_PROGRESS" && <Card><h3 className="font-semibold">Operasyonu tamamla</h3><p className="mt-1 text-sm text-slate-500">Aktif koşu varsa adetler önce canonical production completion akışına yazılır, ardından operasyon kapatılır.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label htmlFor="hmi-good">Sağlam adet</Label><Input id="hmi-good" type="number" min="0" step="1" value={goodCount} onChange={(event) => setGoodCount(event.target.value)} /></div><div><Label htmlFor="hmi-scrap">Hurda adet</Label><Input id="hmi-scrap" type="number" min="0" step="1" value={scrapCount} onChange={(event) => setScrapCount(event.target.value)} /></div></div><div className="mt-3"><Label htmlFor="hmi-notes">Not</Label><Input id="hmi-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>{!canComplete && <p className="mt-2 text-sm text-red-700">HMI_COMPLETE action grant'i yok.</p>}<Button className="mt-4 h-12 px-7" disabled={completeDisabled || completePending} onClick={() => onComplete({ goodCount: Number(goodCount), scrapCount: Number(scrapCount), ...(notes ? { notes } : {}) })}><CheckCircle2 className="h-5 w-5" /> Tamamla</Button></Card>}
    {detail.activeRun && <Card className="border-blue-200 bg-blue-50"><div className="flex items-center gap-2 font-medium text-blue-900"><Factory className="h-5 w-5" /> Aktif koşu</div><div className="mt-2 text-sm text-blue-800">Başlangıç: {fmtDate(detail.activeRun.startedAt)} · Sağlam: {detail.activeRun.goodCount} · Hurda: {detail.activeRun.scrapCount}</div></Card>}
  </div>;
}

function SelectedResources({ assignments }: { assignments: NonNullable<Detail["setup"]["verification"]>["assignments"] }) {
  if (!assignments.length) return <p className="mt-2 text-sm text-slate-500">Henüz fiziksel takım veya fikstür seçilmedi.</p>;
  return <div className="mt-3 grid gap-2 md:grid-cols-2">{assignments.map((assignment) => assignment.physicalToolInstance ? <div key={assignment.id} className="rounded border border-slate-200 p-3 text-sm"><b>Takım · {assignment.physicalToolInstance.serialNo}</b><div>{assignment.physicalToolInstance.toolDefinition.code} · {assignment.physicalToolInstance.toolDefinition.name}</div><div className="mt-1 text-slate-600">Durum: {assignment.physicalToolInstance.status} · Kalan ömür: {assignment.physicalToolInstance.remainingLife}{assignment.physicalToolInstance.toolAssembly ? ` · Assembly ${assignment.physicalToolInstance.toolAssembly.code} rev. ${assignment.physicalToolInstance.toolAssembly.revision}` : ""}</div></div> : assignment.physicalFixtureInstance ? <div key={assignment.id} className="rounded border border-slate-200 p-3 text-sm"><b>Fikstür · {assignment.physicalFixtureInstance.serialNo}</b><div>{assignment.physicalFixtureInstance.fixtureDefinition.code} · {assignment.physicalFixtureInstance.fixtureDefinition.name} rev. {assignment.physicalFixtureInstance.fixtureDefinition.revision}</div><div className="mt-1 text-slate-600">Durum: {assignment.physicalFixtureInstance.status}</div></div> : null)}</div>;
}

function SnapshotSummary({ snapshot }: { snapshot: unknown }) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const data = snapshot as { verifiedAt?: string; machine?: { id?: string }; ncProgram?: { revision?: string; checksum?: string } | null };
  return <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><b>Değişmez setup snapshot</b><div className="mt-1">{data.verifiedAt ? `Doğrulama: ${fmtDate(data.verifiedAt)} · ` : ""}{data.machine?.id ? "Makine ve kaynak seçimleri doğrulama anındaki kayıtla saklanır." : "Snapshot kaydı mevcut."}{data.ncProgram ? ` NC rev. ${data.ncProgram.revision} · ${data.ncProgram.checksum?.slice(0, 12)}…` : ""}</div></div>;
}

function RequirementList({ title, items }: { title: string; items: Array<{ id: string; name: string; required: boolean; quantity: number; alternativeGroup?: string | null }> }) {
  return <div><h4 className="text-sm font-medium text-slate-700">{title}</h4>{items.length === 0 ? <p className="mt-2 text-sm text-slate-500">Zorunlu gereksinim yok.</p> : <ul className="mt-2 space-y-2">{items.map((item) => <li key={item.id} className="rounded border p-2 text-sm"><b>{item.name}</b><div className="text-slate-500">{item.required ? "Zorunlu" : "Opsiyonel"} · min. {item.quantity}{item.alternativeGroup ? ` · alternatif ${item.alternativeGroup}` : ""}</div></li>)}</ul>}</div>;
}
