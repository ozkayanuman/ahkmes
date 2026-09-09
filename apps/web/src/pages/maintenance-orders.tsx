import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardList, History, Plus, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { Button, Card, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

type Tab = "assets" | "requests" | "breakdowns" | "orders" | "pm" | "downtime";
type Entity = Record<string, any>;
type Asset = Entity & { id: string; assetCode?: string; name: string; maintenanceState?: string; productionAllowed?: boolean; plant?: Entity; workCenter?: Entity };
type Workbench = { metrics?: Entity; requests?: Entity[]; breakdowns?: Entity[]; orders?: Entity[]; pmDue?: Entity[]; assetsOutOfService?: Asset[]; activeDowntime?: Entity[] };

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const ACTION = {
  request: "CMMS_REQUEST_CREATE", breakdown: "CMMS_BREAKDOWN_DECLARE", plan: "CMMS_WO_PLAN",
  execute: "CMMS_WO_EXECUTE", assign: "CMMS_ASSIGN_TECHNICIAN", spare: "CMMS_SPARE_ISSUE",
  pm: "CMMS_PM_ADMIN", rts: "CMMS_RETURN_TO_SERVICE",
} as const;
const value = (v: unknown) => (v == null ? "—" : String(v));
const key = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function MaintenanceOrdersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("orders");
  const [requestOpen, setRequestOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string>();
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [rtsOpen, setRtsOpen] = useState(false);
  const [form, setForm] = useState<Entity>({ priority: "MEDIUM" });
  const [filters, setFilters] = useState<Entity>({ plant: "", machine: "", status: "", priority: "", technician: "", type: "", from: "", to: "" });

  useInvalidateOn(["maintenanceorder.updated", "cmms.updated", "downtime.updated"], ["/maintenance-orders/workbench"]);
  const permissions = useQuery({ queryKey: ["/action-permissions/me"], queryFn: () => apiGet<string[]>("/action-permissions/me") });
  const workbench = useQuery({ queryKey: ["/maintenance-orders/workbench"], queryFn: () => apiGet<Workbench>("/maintenance-orders/workbench") });
  const assets = useQuery({ queryKey: ["/maintenance-orders/assets"], queryFn: () => apiGet<Asset[]>("/maintenance-orders/assets") });
  const due = useQuery({ queryKey: ["/maintenance-orders/plans/due"], queryFn: () => apiGet<Entity[]>("/maintenance-orders/plans/due") });
  const downtime = useQuery({ queryKey: ["/maintenance-orders/downtime-facts"], queryFn: () => apiGet<Entity[]>("/maintenance-orders/downtime-facts") });
  const orderDetail = useQuery({ queryKey: ["/maintenance-orders", selectedOrderId], queryFn: () => apiGet<Entity>(`/maintenance-orders/${selectedOrderId}`), enabled: !!selectedOrderId });
  const assetDetail = useQuery({ queryKey: ["/maintenance-orders/assets", selectedAssetId], queryFn: () => apiGet<Entity>(`/maintenance-orders/assets/${selectedAssetId}`), enabled: !!selectedAssetId });
  const assetHistory = useQuery({ queryKey: ["/maintenance-orders/assets", selectedAssetId, "history"], queryFn: () => apiGet<Entity>(`/maintenance-orders/assets/${selectedAssetId}/history`), enabled: !!selectedAssetId });
  const grants = useMemo(() => new Set(permissions.data ?? []), [permissions.data]);
  const can = (action: string) => grants.has(action);

  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["/maintenance-orders/workbench"] }),
    qc.invalidateQueries({ queryKey: ["/maintenance-orders/assets"] }),
    qc.invalidateQueries({ queryKey: ["/maintenance-orders/plans/due"] }),
    qc.invalidateQueries({ queryKey: ["/maintenance-orders/downtime-facts"] }),
  ]);
  const error = (fallback: string) => (e: unknown) => toast(e instanceof ApiError ? ((e.body as Entity | null)?.message ?? fallback) : fallback, "error");
  const command = useMutation({
    mutationFn: ({ method, path, body }: { method?: "PATCH"; path: string; body?: Entity }) => method === "PATCH" ? apiPatch(path, body ?? {}) : apiPost(path, body ?? {}),
    onSuccess: async () => { await invalidate(); if (selectedOrderId) await qc.invalidateQueries({ queryKey: ["/maintenance-orders", selectedOrderId] }); if (selectedAssetId) await qc.invalidateQueries({ queryKey: ["/maintenance-orders/assets", selectedAssetId] }); toast("Bakım kaydı güncellendi", "success"); },
    onError: error("Bakım işlemi tamamlanamadı"),
  });

  const wb = workbench.data ?? {};
  const rows = { requests: wb.requests ?? [], breakdowns: wb.breakdowns ?? [], orders: wb.orders ?? [], pm: due.data ?? wb.pmDue ?? [], downtime: downtime.data ?? wb.activeDowntime ?? [] };
  const all = [...rows.requests, ...rows.breakdowns, ...rows.orders, ...rows.pm, ...rows.downtime];
  const option = (name: string) => [...new Set(all.map((r) => value(r[name] ?? r.machine?.[name] ?? r.assignments?.[0]?.user?.name)).filter((x) => x !== "—"))];
  const filtered = (items: Entity[]) => items.filter((r) => {
    const plant = r.plant?.id ?? r.machine?.plant?.id; const machine = r.machine?.id ?? r.id;
    const tech = r.assignments?.map((a: Entity) => a.user?.name).join(" ") ?? r.technician?.name ?? "";
    const when = r.dueAt ?? r.nextDueAt ?? r.startedAt ?? r.reportedAt ?? r.plannedStart;
    return (!filters.plant || plant === filters.plant) && (!filters.machine || machine === filters.machine)
      && (!filters.status || r.status === filters.status) && (!filters.priority || r.priority === filters.priority)
      && (!filters.technician || tech.includes(filters.technician)) && (!filters.type || r.type === filters.type)
      && (!filters.from || !when || when >= filters.from) && (!filters.to || !when || when.slice(0, 10) <= filters.to);
  });
  const metric = wb.metrics ?? {};
  const kpis = [
    ["Açık talepler", metric.openRequestCount ?? rows.requests.length], ["Aktif arızalar", metric.activeBreakdownCount ?? rows.breakdowns.length],
    ["Servis dışı makineler", metric.machinesOutOfServiceCount ?? wb.assetsOutOfService?.length ?? 0], ["Aktif duruş", metric.activeDowntimeCount ?? rows.downtime.length],
    ["PM zamanı gelen", metric.pmDueCount ?? rows.pm.filter((x) => x.dueState !== "OVERDUE").length], ["Gecikmiş PM", metric.pmOverdueCount ?? rows.pm.filter((x) => x.dueState === "OVERDUE").length],
  ];

  const submit = (path: string, body: Entity, close: () => void) => command.mutate({ path, body }, { onSuccess: () => { close(); setForm({ priority: "MEDIUM" }); } });
  const tabs: [Tab, string][] = [["assets", "Varlıklar"], ["requests", "Talepler"], ["breakdowns", "Arızalar"], ["orders", "Bakım iş emirleri"], ["pm", "PM zamanı gelen"], ["downtime", "Aktif duruşlar"]];

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold">CMMS Bakım Workbench</h1><p className="mt-1 text-sm text-slate-600">Bakım iş durumu controller telemetrisinden bağımsızdır; yalnızca yetkili servise dönüş üretim blokajını kaldırır.</p></div>
      <div className="flex flex-wrap gap-2">
        {can(ACTION.request) && <Button onClick={() => setRequestOpen(true)}><Plus className="h-4 w-4" />Bakım talebi bildir</Button>}
        {can(ACTION.breakdown) && <Button variant="danger" onClick={() => setBreakdownOpen(true)}><AlertTriangle className="h-4 w-4" />Arıza bildir</Button>}
        {can(ACTION.pm) && <Button variant="outline" onClick={() => command.mutate({ path: "/maintenance-orders/plans/generate", body: { asOf: new Date().toISOString() } })}><RotateCcw className="h-4 w-4" />PM üret</Button>}
      </div>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{kpis.map(([label, count]) => <Card key={String(label)} className="p-4"><div className="text-xs font-medium uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold">{count}</div></Card>)}</section>

    <Card className="p-4"><div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
      <Filter label="Tesis" value={filters.plant} onChange={(v) => setFilters({ ...filters, plant: v })} options={(assets.data ?? []).map((a) => [a.plant?.id, a.plant?.name])} />
      <Filter label="Makine" value={filters.machine} onChange={(v) => setFilters({ ...filters, machine: v })} options={(assets.data ?? []).map((a) => [a.id, `${a.assetCode ? `${a.assetCode} · ` : ""}${a.name}`])} />
      <Filter label="Durum" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} options={option("status").map((x) => [x, x])} />
      <Filter label="Öncelik" value={filters.priority} onChange={(v) => setFilters({ ...filters, priority: v })} options={PRIORITIES.map((x) => [x, x])} />
      <Filter label="Teknisyen" value={filters.technician} onChange={(v) => setFilters({ ...filters, technician: v })} options={option("technician").map((x) => [x, x])} />
      <Filter label="Bakım tipi" value={filters.type} onChange={(v) => setFilters({ ...filters, type: v })} options={option("type").map((x) => [x, x])} />
      <div><Label htmlFor="cmms-from">Başlangıç tarihi</Label><Input id="cmms-from" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
      <div><Label htmlFor="cmms-to">Bitiş tarihi</Label><Input id="cmms-to" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
    </div></Card>

    <nav className="flex flex-wrap gap-2" aria-label="CMMS çalışma listeleri">{tabs.map(([id, label]) => <Button key={id} variant={tab === id ? "primary" : "outline"} onClick={() => setTab(id)}>{label}</Button>)}</nav>
    {workbench.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
    {tab === "assets" && <AssetsTable rows={assets.data ?? []} onOpen={setSelectedAssetId} />}
    {tab === "requests" && <GenericTable headers={["Talep", "Makine", "Problem", "Öncelik", "Durum", "Bildirildi"]} rows={filtered(rows.requests)} cells={(r) => [r.requestNo, r.machine?.name, r.problem, r.priority, r.status, fmtDate(r.reportedAt)]} />}
    {tab === "breakdowns" && <BreakdownTable rows={filtered(rows.breakdowns)} canConvert={can(ACTION.plan)} onConvert={(id) => command.mutate({ path: `/maintenance-orders/breakdowns/${id}/convert`, body: {} })} />}
    {tab === "orders" && <OrdersTable rows={filtered(rows.orders)} onOpen={setSelectedOrderId} />}
    {tab === "pm" && <GenericTable headers={["Plan", "Makine", "Sonraki tarih", "Durum", "Öncelik"]} rows={filtered(rows.pm)} cells={(r) => [r.name, r.machine?.name, fmtDate(r.nextDueAt ?? r.dueAt), r.dueState, r.priority]} />}
    {tab === "downtime" && <GenericTable headers={["Makine", "Başlangıç", "Bitiş", "Tür", "Kaynak"]} rows={filtered(rows.downtime)} cells={(r) => [r.machine?.name, fmtDate(r.startedAt ?? r.start), r.endedAt ? fmtDate(r.endedAt) : "Açık", r.reasonCategory, r.source]} />}

    <Modal open={requestOpen} title="Bakım talebi bildir" onClose={() => setRequestOpen(false)}><EntityForm assets={assets.data ?? []} form={form} setForm={setForm} problem priorityLabel="Talep önceliği" submitLabel="Talebi kaydet" onSubmit={() => submit("/maintenance-orders/requests", { machineId: form.machineId, problem: form.problem, priority: form.priority, ...(form.description ? { description: form.description } : {}) }, () => setRequestOpen(false))} /></Modal>
    <Modal open={breakdownOpen} title="Arıza bildir" onClose={() => setBreakdownOpen(false)}><EntityForm assets={assets.data ?? []} form={form} setForm={setForm} problem priorityLabel="Arıza önceliği" submitLabel="Arızayı kaydet" onSubmit={() => submit("/maintenance-orders/breakdowns", { machineId: form.machineId, description: form.problem, priority: form.priority, failureStartedAt: form.failureStartedAt || new Date().toISOString(), productionImpact: "PRODUCTION_STOP" }, () => setBreakdownOpen(false))} breakdown /></Modal>
    <Modal open={!!selectedOrderId} title={`Bakım iş emri ${orderDetail.data?.bakNo ?? ""}`} onClose={() => setSelectedOrderId(undefined)} className="max-h-[90vh] max-w-4xl overflow-y-auto">{orderDetail.data && <OrderDetail data={orderDetail.data} can={can} run={(p, b, method) => command.mutate({ path: p, body: b, method })} />}</Modal>
    <Modal open={!!selectedAssetId} title={`Varlık ${assetDetail.data?.assetCode ?? assetDetail.data?.name ?? ""}`} onClose={() => { setSelectedAssetId(undefined); setRtsOpen(false); }} className="max-h-[90vh] max-w-4xl overflow-y-auto">{assetDetail.data && <AssetDetail data={assetDetail.data} history={assetHistory.data} canRts={can(ACTION.rts)} rtsOpen={rtsOpen} setRtsOpen={setRtsOpen} form={form} setForm={setForm} submit={() => submit(`/maintenance-orders/assets/${selectedAssetId}/return-to-service`, { notes: form.rtsNotes, idempotencyKey: key() }, () => setRtsOpen(false))} />}</Modal>
  </div>;
}

function Filter({ label, value: current, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: any[][] }) {
  const id = `filter-${label}`; return <div><Label htmlFor={id}>{label}</Label><Select id={id} value={current} onChange={(e) => onChange(e.target.value)}><option value="">Tümü</option>{options.filter((o) => o[0]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>;
}
function Empty({ span }: { span: number }) { return <tr><td colSpan={span} className="px-4 py-8 text-center text-slate-400">Kayıt yok</td></tr>; }
function GenericTable({ headers, rows, cells }: { headers: string[]; rows: Entity[]; cells: (r: Entity) => unknown[] }) { return <Table headers={headers}>{rows.length ? rows.map((r) => <tr key={r.id}>{cells(r).map((c, i) => <td key={i} className="px-4 py-3">{value(c)}</td>)}</tr>) : <Empty span={headers.length} />}</Table>; }
function AssetsTable({ rows, onOpen }: { rows: Asset[]; onOpen: (id: string) => void }) { return <Table headers={["Varlık", "Ad", "Tesis / İş merkezi", "Bakım durumu", "Üretim", ""]}>{rows.length ? rows.map((a) => <tr key={a.id}><td className="px-4 py-3 font-medium">{a.assetCode ?? a.id}</td><td className="px-4 py-3">{a.name}</td><td className="px-4 py-3">{a.plant?.name ?? "—"} / {a.workCenter?.name ?? "—"}</td><td className="px-4 py-3">{a.maintenanceState ?? "AVAILABLE"}</td><td className="px-4 py-3">{a.productionAllowed === false ? "BLOKE" : "İZİNLİ"}</td><td className="px-4 py-3"><Button variant="ghost" aria-label={`${a.assetCode ?? a.name} bakım ayrıntısını aç`} onClick={() => onOpen(a.id)}><History className="h-4 w-4" />Ayrıntı</Button></td></tr>) : <Empty span={6} />}</Table>; }
function BreakdownTable({ rows, canConvert, onConvert }: { rows: Entity[]; canConvert: boolean; onConvert: (id: string) => void }) { return <Table headers={["Arıza", "Makine", "Açıklama", "Öncelik", "Başlangıç", "İşlem"]}>{rows.length ? rows.map((r) => <tr key={r.id}><td className="px-4 py-3 font-medium">{r.breakdownNo ?? r.id}</td><td className="px-4 py-3">{r.machine?.name}</td><td className="px-4 py-3">{r.description}</td><td className="px-4 py-3">{r.priority}</td><td className="px-4 py-3">{fmtDate(r.failureStartedAt ?? r.reportedAt)}</td><td className="px-4 py-3">{canConvert && !r.maintenanceOrderId && <Button size="sm" onClick={() => onConvert(r.id)}>İş emrine dönüştür</Button>}</td></tr>) : <Empty span={6} />}</Table>; }
function OrdersTable({ rows, onOpen }: { rows: Entity[]; onOpen: (id: string) => void }) { return <Table headers={["No", "Makine", "Tip", "Öncelik", "Durum", "Teknisyen", ""]}>{rows.length ? rows.map((r) => <tr key={r.id}><td className="px-4 py-3 font-medium">{r.bakNo ?? r.number}</td><td className="px-4 py-3">{r.machine?.name}</td><td className="px-4 py-3">{r.type}</td><td className="px-4 py-3">{r.priority}</td><td className="px-4 py-3">{r.status}</td><td className="px-4 py-3">{r.assignments?.map((a: Entity) => a.user?.name).filter(Boolean).join(", ") || "—"}</td><td className="px-4 py-3"><Button variant="ghost" aria-label={`${r.bakNo ?? r.number} ayrıntısını aç`} onClick={() => onOpen(r.id)}><ClipboardList className="h-4 w-4" />Ayrıntı</Button></td></tr>) : <Empty span={7} />}</Table>; }

function EntityForm({ assets, form, setForm, priorityLabel, submitLabel, onSubmit, breakdown }: { assets: Asset[]; form: Entity; setForm: (v: Entity) => void; priorityLabel: string; submitLabel: string; onSubmit: () => void; problem?: boolean; breakdown?: boolean }) { return <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}><div><Label htmlFor="entity-machine">Varlık / makine</Label><Select id="entity-machine" required value={form.machineId ?? ""} onChange={(e) => setForm({ ...form, machineId: e.target.value })}><option value="">Seçin…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.assetCode ? `${a.assetCode} · ` : ""}{a.name}</option>)}</Select></div><div><Label htmlFor="entity-problem">Problem</Label><Input id="entity-problem" required value={form.problem ?? ""} onChange={(e) => setForm({ ...form, problem: e.target.value })} /></div><div><Label htmlFor="entity-priority">{priorityLabel}</Label><Select id="entity-priority" value={form.priority ?? "MEDIUM"} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></div>{breakdown && <div><Label htmlFor="failure-start">Arıza başlangıcı</Label><Input id="failure-start" type="datetime-local" value={form.failureStartedAt ?? ""} onChange={(e) => setForm({ ...form, failureStartedAt: e.target.value })} /></div>}<div><Label htmlFor="entity-description">Açıklama</Label><Textarea id="entity-description" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div><div className="flex justify-end"><Button type="submit">{submitLabel}</Button></div></form>; }

function OrderDetail({ data, can, run }: { data: Entity; can: (a: string) => boolean; run: (path: string, body?: Entity, method?: "PATCH") => void }) {
  const [local, setLocal] = useState<Entity>({}); const tasks = data.tasks ?? []; const incompleteRequired = tasks.some((t: Entity) => t.required && !t.completedAt);
  return <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-3"><Card className="p-4"><b>Durum</b><div>{data.status}</div></Card><Card className="p-4"><b>Makine</b><div>{data.machine?.name}</div></Card><Card className="p-4"><b>Teknisyen</b><div>{data.assignments?.map((a: Entity) => a.user?.name).join(", ") || "Atanmadı"}</div></Card></div>
    <section><h3 className="mb-2 font-semibold">Kontrol listesi</h3>{tasks.map((t: Entity) => <div key={t.id} className="flex items-center justify-between border-b py-2"><span>{t.sequence}. {t.description} {t.required && <b className="text-red-600">(zorunlu)</b>}</span>{can(ACTION.execute) && !t.completedAt && <Button size="sm" aria-label={`Görevi tamamla: ${t.description}`} onClick={() => run(`/maintenance-orders/${data.id}/tasks/${t.id}/complete`, {}, "PATCH")}><CheckCircle2 className="h-4 w-4" />Tamamla</Button>}</div>)}{incompleteRequired && <p className="mt-2 text-sm text-amber-700">Zorunlu görevler tamamlanmadan iş emri kapatılamaz.</p>}</section>
    <section><h3 className="mb-2 font-semibold">İşçilik</h3>{(data.laborEntries ?? data.labor ?? []).map((l: Entity) => <div key={l.id} className="text-sm">{l.technician?.name ?? l.user?.name} · {l.durationMinutes} dk · {l.notes}</div>)}</section>
    <section><h3 className="mb-2 font-semibold">Yedek parçalar</h3>{(data.spareLines ?? []).map((s: Entity) => <div key={s.id} className="flex justify-between border-b py-2 text-sm"><span>{s.itemName ?? s.item?.name}</span><span>Plan {s.plannedQuantity} · Çıkış {s.issuedQuantity} · İade {s.returnedQuantity}</span>{can(ACTION.spare) && <span className="flex gap-1"><Button size="sm" variant="outline" onClick={() => run(`/maintenance-orders/${data.id}/spares/${s.id}/issue`, { quantity: "1", idempotencyKey: key() })}>Çıkış</Button><Button size="sm" variant="outline" onClick={() => run(`/maintenance-orders/${data.id}/spares/${s.id}/return`, { quantity: "1", idempotencyKey: key() })}>İade</Button></span>}</div>)}</section>
    {can(ACTION.assign) && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(`/maintenance-orders/${data.id}/technicians`, { userId: local.userId, isPrimary: true }); }}><Input aria-label="Teknisyen kullanıcı kimliği" placeholder="Teknisyen kullanıcı kimliği" value={local.userId ?? ""} onChange={(e) => setLocal({ ...local, userId: e.target.value })} /><Button type="submit">Teknisyen ata</Button></form>}
    {can(ACTION.execute) && <div className="flex flex-wrap gap-2">{data.status === "DRAFT" && <Button onClick={() => run(`/maintenance-orders/${data.id}/transition`, { status: "PLANNED" }, "PATCH")}>Planla</Button>}{data.status === "PLANNED" && <Button onClick={() => run(`/maintenance-orders/${data.id}/transition`, { status: "RELEASED" }, "PATCH")}>Serbest bırak</Button>}{["RELEASED", "ON_HOLD"].includes(data.status) && <Button onClick={() => run(`/maintenance-orders/${data.id}/transition`, { status: "IN_PROGRESS" }, "PATCH")}>Başlat / devam et</Button>}{data.status === "IN_PROGRESS" && <Button variant="outline" onClick={() => run(`/maintenance-orders/${data.id}/transition`, { status: "ON_HOLD" }, "PATCH")}>İş emrini beklet</Button>}</div>}
    {can(ACTION.execute) && data.status === "IN_PROGRESS" && <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(`/maintenance-orders/${data.id}/complete`, { resolution: local.resolution, remedyCode: local.remedy, machineDisposition: local.disposition, idempotencyKey: key() }); }}><Input required aria-label="Çözüm" placeholder="Çözüm / tamamlanma notu" value={local.resolution ?? ""} onChange={(e) => setLocal({ ...local, resolution: e.target.value })} /><Input required aria-label="Çözüm kodu" placeholder="Çözüm kodu" value={local.remedy ?? ""} onChange={(e) => setLocal({ ...local, remedy: e.target.value })} /><Select required aria-label="Makine kararı" value={local.disposition ?? ""} onChange={(e) => setLocal({ ...local, disposition: e.target.value })}><option value="">Makine kararı…</option><option value="READY_FOR_RETURN_TO_SERVICE">Servise dönüş kontrolü gerekli</option><option value="REMAINS_OUT_OF_SERVICE">Servis dışında kalsın</option></Select><Button type="submit" disabled={incompleteRequired}>İş emrini tamamla</Button></form>}
  </div>;
}

function AssetDetail({ data, history, canRts, rtsOpen, setRtsOpen, form, setForm, submit }: { data: Entity; history?: Entity; canRts: boolean; rtsOpen: boolean; setRtsOpen: (v: boolean) => void; form: Entity; setForm: (v: Entity) => void; submit: () => void }) { return <div className="space-y-5"><div className={`rounded-lg border p-4 ${data.productionAllowed === false ? "border-red-300 bg-red-50" : "border-green-300 bg-green-50"}`}><div className="font-semibold">Üretim izni: {data.productionAllowed === false ? "BLOKE" : "İZİNLİ"}</div><div className="text-sm">Bakım durumu: {data.maintenanceState ?? "AVAILABLE"}</div>{data.productionAllowed === false && <p className="mt-2 text-sm font-medium text-red-700">Controller READY durumu bakım blokajını kaldırmaz.</p>}</div>{canRts && data.productionAllowed === false && <Button onClick={() => setRtsOpen(true)}><ShieldAlert className="h-4 w-4" />Üretime geri al</Button>}{rtsOpen && <form className="space-y-2 rounded-lg border p-4" onSubmit={(e) => { e.preventDefault(); submit(); }}><Label htmlFor="rts-notes">Servise dönüş notu</Label><Textarea id="rts-notes" required value={form.rtsNotes ?? ""} onChange={(e) => setForm({ ...form, rtsNotes: e.target.value })} /><Button type="submit">Servise dönüşü onayla</Button></form>}<section><h3 className="mb-2 flex items-center gap-2 font-semibold"><History className="h-4 w-4" />Bakım geçmişi</h3><div className="grid gap-3 sm:grid-cols-2">{[["Talepler", history?.requests], ["Arızalar", history?.breakdowns], ["İş emirleri", history?.orders], ["Duruşlar", history?.downtime]].map(([title, items]) => <Card key={String(title)} className="p-4"><b>{title}</b><div className="mt-1 text-2xl">{Array.isArray(items) ? items.length : 0}</div></Card>)}</div></section></div>; }
