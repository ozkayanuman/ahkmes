import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Pause,
  Play,
  Save,
  SplitSquareHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { Button, Card, Input, Label, Modal, Select } from "../components/ui";
import { DocumentsPanel } from "../components/documents-panel";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";

interface RunRow {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  goodCount: number;
  scrapCount: number;
  downtimeNote?: string | null;
  workOrder: {
    id: string;
    woNo: string;
    quantity: string;
    status: string;
    part: { id: string; partNo: string; name: string };
  };
  machine?: { id: string; name: string } | null;
  operator: { id: string; name: string };
  operation?: { id: string; seq: number; name: string; status: string } | null;
}
interface RouteOperation {
  id: string;
  seq: number;
  name: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "SKIPPED";
  completedQty: string;
  scrapQty: string;
  machine?: { id: string; name: string } | null;
  ncProgram?: { id: string; version: number; status: string; fileName: string; checksum: string; effectivityScope: string } | null;
}
interface WoRow {
  id: string;
  woNo: string;
  quantity: string;
  status: string;
  dueDate: string;
  part: { id: string; partNo: string; name: string };
  machine?: { id: string; name: string } | null;
  recipeRevision?: string | null;
  operations?: RouteOperation[];
}
interface MachineOption {
  id: string;
  name: string;
  isActive: boolean;
}
interface ToolingSetup { operation: { id: string; machineId?: string | null; ncProgramId?: string | null; ncProgramVersion?: number | null; ncProgramChecksum?: string | null; toolRequirements: any[]; fixtureRequirements: any[] }; verification: any | null; fixtureCompliance?: Array<{ fixtureId: string; evaluation: { warnings: string[]; blockers: string[] } }>; }

function ToolingChecklist({ operationId, onChanged }: { operationId: string; onChanged: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const actions = useQuery({ queryKey: ["/tooling/actions"], queryFn: () => apiGet<string[]>("/tooling/actions") });
  const setup = useQuery({ queryKey: ["/tooling/operations", operationId, "setup"], queryFn: () => apiGet<ToolingSetup>(`/tooling/operations/${operationId}/setup`) });
  const tooling = useQuery({ queryKey: ["/tooling"], queryFn: () => apiGet<any>("/tooling"), enabled: actions.data?.includes("TOOL_READ") === true });
  const [toolValues, setToolValues] = useState<Record<string, string>>({}); const [fixtureValues, setFixtureValues] = useState<Record<string, string>>({});
  const canManage = actions.data?.includes("OPERATION_SETUP_MANAGE") === true; const canVerify = actions.data?.includes("OPERATION_SETUP_VERIFY") === true;
  const failure = (e: unknown) => toast(e instanceof ApiError ? String((e.body as any)?.message ?? "Setup işlemi başarısız") : "Setup işlemi başarısız", "error");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/tooling/operations", operationId, "setup"] }); onChanged(); };
  const assign = useMutation({ mutationFn: () => apiPost(`/tooling/operations/${operationId}/setup/assignments`, { toolAssignments: Object.entries(toolValues).filter(([, v]) => v).map(([selectionKey, physicalToolInstanceId]) => ({ requirementId: selectionKey.split(":")[0], physicalToolInstanceId })), fixtureAssignments: Object.entries(fixtureValues).filter(([, v]) => v).map(([selectionKey, physicalFixtureInstanceId]) => ({ requirementId: selectionKey.split(":")[0], physicalFixtureInstanceId })) }), onSuccess: refresh, onError: failure });
  const verify = useMutation({ mutationFn: () => apiPost(`/tooling/operations/${operationId}/setup/verify`, {}), onSuccess: refresh, onError: failure });
  if (actions.isError || setup.isError) return <Card className="mt-4 border-red-200"><p className="text-sm text-red-700">Tooling checklist erişilemedi; backend başlangıç kapısı yine de zorunludur.</p></Card>;
  if (!setup.data || (!setup.data.operation.toolRequirements.length && !setup.data.operation.fixtureRequirements.length)) return <Card className="mt-4"><p className="text-sm text-slate-500">Bu operasyonda tooling requirement tanımlı değil; tooling başlangıç kapısı uygulanmaz.</p></Card>;
  const tools = tooling.data?.toolDefinitions?.flatMap((d: any) => d.instances.map((i: any) => ({ ...i, code: d.code }))) ?? [];
  const fixtures = tooling.data?.fixtureDefinitions?.flatMap((d: any) => d.instances.map((i: any) => ({ ...i, code: d.code }))) ?? [];
  const verification = setup.data.verification;
  const compliance = setup.data.fixtureCompliance ?? [];
  return <Card className="mt-4 border-brand-200"><h2 className="mb-2 text-lg font-semibold">CNC Setup Checklist</h2><div className="mb-3 text-sm text-slate-600">NC: {setup.data.operation.ncProgramId ? `rev ${setup.data.operation.ncProgramVersion} · ${setup.data.operation.ncProgramChecksum?.slice(0, 12)}…` : "PUBLISHED NC yok — doğrulanamaz"} · Makine: {setup.data.operation.machineId ?? "atanmamış"}</div><div className="grid gap-3 lg:grid-cols-2"><div>{setup.data.operation.toolRequirements.map((r) => <div key={r.id} className="mb-2 rounded border p-2"><div className="text-xs font-medium">Takım {r.isRequired ? "zorunlu" : "opsiyonel"} · min {r.quantity}{r.alternativeGroup ? ` · alternatif: ${r.alternativeGroup}` : ""}</div>{Array.from({ length: r.quantity }, (_, index) => <Select key={`${r.id}:${index}`} disabled={!canManage} value={toolValues[`${r.id}:${index}`] ?? ""} onChange={(e) => setToolValues({ ...toolValues, [`${r.id}:${index}`]: e.target.value })}><option value="">Fiziksel takım #{index + 1}</option>{tools.map((t: any) => <option key={t.id} value={t.id}>{t.serialNo} · {t.code} · kalan {t.remainingLife} · {t.status}</option>)}</Select>)}</div>)}</div><div>{setup.data.operation.fixtureRequirements.map((r) => <div key={r.id} className="mb-2 rounded border p-2"><div className="text-xs font-medium">Fikstür {r.isRequired ? "zorunlu" : "opsiyonel"} · min {r.quantity}{r.alternativeGroup ? ` · alternatif: ${r.alternativeGroup}` : ""}</div>{Array.from({ length: r.quantity }, (_, index) => <Select key={`${r.id}:${index}`} disabled={!canManage} value={fixtureValues[`${r.id}:${index}`] ?? ""} onChange={(e) => setFixtureValues({ ...fixtureValues, [`${r.id}:${index}`]: e.target.value })}><option value="">Fiziksel fikstür #{index + 1}</option>{fixtures.map((f: any) => <option key={f.id} value={f.id}>{f.serialNo} · {f.code} · {f.status}</option>)}</Select>)}</div>)}</div></div>{compliance.map((item) => <div key={item.fixtureId} className={item.evaluation.blockers.length ? "mt-2 rounded border border-red-300 p-2 text-sm text-red-700" : "mt-2 rounded border border-amber-300 p-2 text-sm text-amber-800"}>Fikstür {item.fixtureId}: {item.evaluation.blockers.join("; ") || item.evaluation.warnings.join("; ") || "Bakım/kalibrasyon uygun"}</div>)}<div className="mt-3 flex gap-2">{canManage && <Button disabled={assign.isPending} onClick={() => assign.mutate()}>Atamaları güncelle</Button>}{canVerify && <Button disabled={verify.isPending || !setup.data.operation.machineId} onClick={() => verify.mutate()}>Setup Doğrula</Button>}</div><div className="mt-3 rounded bg-slate-50 p-2 text-sm">Durum: <b>{verification?.status ?? "ATAMA/DOĞRULAMA BEKLİYOR"}</b>{verification?.invalidatedReason ? ` — yeniden doğrulama: ${verification.invalidatedReason}` : ""}{verification?.verifiedAt ? ` · ${new Date(verification.verifiedAt).toLocaleString("tr-TR")}` : ""}{verification?.snapshot && <details className="mt-2"><summary>Immutable as-built snapshot</summary><pre className="mt-2 max-h-44 overflow-auto text-xs">{JSON.stringify(verification.snapshot.payload, null, 2)}</pre></details>}</div></Card>;
}

type CardStatus = "not_started" | "running" | "paused" | "completed";

function cardStatus(wo: WoRow, activeWoIds: Set<string>): CardStatus {
  if (wo.status === "COMPLETED") return "completed";
  if (activeWoIds.has(wo.id)) return "running";
  if (wo.status === "IN_PRODUCTION") return "paused";
  return "not_started";
}

const STATUS_STYLE: Record<CardStatus, { bg: string; border: string; pill: string; label: string }> = {
  not_started: { bg: "bg-slate-100", border: "border-slate-300", pill: "bg-slate-500", label: "Başlamadı" },
  running: { bg: "bg-blue-50", border: "border-blue-400", pill: "bg-blue-600", label: "Devam Ediyor" },
  paused: { bg: "bg-orange-50", border: "border-orange-400", pill: "bg-orange-500", label: "Duraklatıldı" },
  completed: { bg: "bg-green-50", border: "border-green-400", pill: "bg-green-600", label: "Bitti" },
};

/** Operasyon Ekranı — HMI/kiosk dostu: iş emri kartları duruma göre renklenir, karta
 * tıklanınca operasyon detayına girilir (belge, canlı ilerleme, Tamamla/Parçalı
 * Tamamla/Duraklat/Hurda aksiyonları). */
export function ProductionPage() {
  const { user } = useAuth();
  const canRun = !!user && ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"].includes(user.role);
  const canManage = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  useInvalidateOn(["productionrun.updated", "workorder.updated"], ["/runs", "/work-orders"]);

  const activeRuns = useQuery({
    queryKey: ["/runs", "active"],
    queryFn: () => apiGet<RunRow[]>("/runs?active=true"),
  });
  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WoRow[]>("/work-orders"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/runs"] });
    qc.invalidateQueries({ queryKey: ["/work-orders"] });
  };

  const activeWoIds = new Set(activeRuns.data?.map((r) => r.workOrder.id) ?? []);
  const activeRunByWo = new Map((activeRuns.data ?? []).map((r) => [r.workOrder.id, r]));

  const visible = (workOrders.data ?? []).filter((w) => w.status !== "CANCELLED");
  const open = visible.filter((w) => cardStatus(w, activeWoIds) !== "completed");
  const done = visible.filter((w) => cardStatus(w, activeWoIds) === "completed");

  const target = (activeRuns.data ?? []).reduce((s, r) => s + Number(r.workOrder.quantity), 0);
  const produced = (activeRuns.data ?? []).reduce((s, r) => s + r.goodCount, 0);
  const notStartedCount = open.filter((w) => cardStatus(w, activeWoIds) === "not_started").length;
  const pausedCount = open.filter((w) => cardStatus(w, activeWoIds) === "paused").length;

  const selected = selectedId ? (workOrders.data ?? []).find((w) => w.id === selectedId) ?? null : null;

  if (selected) {
    return (
      <OperationDetail
        wo={selected}
        activeRun={activeRunByWo.get(selected.id) ?? null}
        status={cardStatus(selected, activeWoIds)}
        canRun={canRun}
        canManage={canManage}
        onBack={() => setSelectedId(null)}
        onChanged={invalidate}
      />
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Operasyon Ekranı</h1>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Başlamamış", value: notStartedCount },
          { label: "Duraklatılmış", value: pausedCount },
          { label: "Hedef (Aktif)", value: target },
          { label: "Üretilen (Aktif)", value: produced },
        ].map((t) => (
          <Card key={t.label} className="text-center">
            <div className="text-3xl font-bold text-brand-700">{t.value}</div>
            <div className="text-sm text-slate-500">{t.label}</div>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 text-lg font-semibold">İş Emirleri ({open.length})</h2>
      {workOrders.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {open.length === 0 && !workOrders.isLoading && (
        <p className="mb-8 text-slate-400">Açık iş emri yok.</p>
      )}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {open.map((w) => (
          <WoCard
            key={w.id}
            wo={w}
            status={cardStatus(w, activeWoIds)}
            run={activeRunByWo.get(w.id) ?? null}
            onClick={() => setSelectedId(w.id)}
          />
        ))}
      </div>

      <button
        className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-700"
        onClick={() => setShowCompleted((s) => !s)}
      >
        Bitmiş İşler ({done.length})
        {showCompleted ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
      </button>
      {showCompleted && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {done.length === 0 && <p className="text-slate-400">Henüz tamamlanmış iş emri yok.</p>}
          {done.map((w) => (
            <WoCard key={w.id} wo={w} status="completed" run={null} onClick={() => setSelectedId(w.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function WoCard({
  wo,
  status,
  run,
  onClick,
}: {
  wo: WoRow;
  status: CardStatus;
  run: RunRow | null;
  onClick: () => void;
}) {
  const style = STATUS_STYLE[status];
  const target = Number(wo.quantity);
  const produced = run?.goodCount ?? 0;
  const pct = target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : 0;

  return (
    <button
      onClick={onClick}
      className={`rounded-lg border-2 p-4 text-left shadow-sm transition hover:shadow-md ${style.bg} ${style.border}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-slate-800">{wo.woNo}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white ${style.pill}`}>
          {style.label}
        </span>
      </div>
      <div className="mb-1 text-sm text-slate-600">
        {wo.part.partNo} — {wo.part.name}
      </div>
      <div className="mb-3 text-xs text-slate-500">
        {wo.machine?.name ?? "Tezgah atanmadı"} · Hedef {fmtQty(wo.quantity)}
      </div>
      {status === "running" && (
        <div>
          <div className="mb-1 h-2 overflow-hidden rounded-full bg-white/70">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-xs font-medium text-slate-600">
            {produced}/{target} ({pct}%)
          </div>
        </div>
      )}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/70 p-3 text-center">
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function MachinePicker({ machineId, onChange }: { machineId: string; onChange: (v: string) => void }) {
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
  });
  return (
    <div className="min-w-48">
      <Label htmlFor="machine-picker">Tezgah</Label>
      <Select id="machine-picker" value={machineId} onChange={(e) => onChange(e.target.value)}>
        <option value="">Seçilmedi</option>
        {machines.data
          ?.filter((m) => m.isActive)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </Select>
    </div>
  );
}

function OperationDetail({
  wo,
  activeRun,
  status,
  canRun,
  canManage,
  onBack,
  onChanged,
}: {
  wo: WoRow;
  activeRun: RunRow | null;
  status: CardStatus;
  canRun: boolean;
  canManage: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      toast((e.body as { message?: string } | null)?.message ?? "İşlem çakışması (409)", "error");
    } else toast("İşlem başarısız.", "error");
  };
  const [machineId, setMachineId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [showDocs, setShowDocs] = useState(false);
  const style = STATUS_STYLE[status];
  const hmiSetup = useQuery({ queryKey: ["/tooling/operations", operationId, "setup"], queryFn: () => apiGet<ToolingSetup>(`/tooling/operations/${operationId}/setup`), enabled: !!operationId });
  const toolingBlocked = !!hmiSetup.data && (hmiSetup.data.operation.toolRequirements.some((r) => r.isRequired) || hmiSetup.data.operation.fixtureRequirements.some((r) => r.isRequired)) && hmiSetup.data.verification?.status !== "VERIFIED";

  // Duraklatılmış/bitmiş iş emrinde tüm koşuların (geçmiş oturumların) toplamını
  // görmek için — aktif koşu tek başına toplam üretimi yansıtmaz.
  const allRuns = useQuery({
    queryKey: ["/runs", "wo", wo.id],
    queryFn: () => apiGet<RunRow[]>(`/runs?workOrderId=${wo.id}`),
    enabled: status !== "not_started",
  });
  const totalGood = (allRuns.data ?? []).reduce((s, r) => s + r.goodCount, 0);
  const totalScrap = (allRuns.data ?? []).reduce((s, r) => s + r.scrapCount, 0);
  const target = Number(wo.quantity);

  const activeOperation = wo.operations?.find((operation) => operation.status === "IN_PROGRESS") ?? null;
  const start = useMutation({
    mutationFn: () => apiPost(`/work-orders/${wo.id}/runs`, {
      ...(machineId ? { machineId } : {}),
      ...(wo.operations?.length ? { operationId } : {}),
    }),
    onSuccess: onChanged,
    onError,
  });
  const completeWo = useMutation({
    mutationFn: () => apiPatch(`/work-orders/${wo.id}/status`, { status: "COMPLETED" }),
    onSuccess: onChanged,
    onError,
  });
  const completeOperation = useMutation({
    mutationFn: () => apiPost(`/work-orders/${wo.id}/operations/${activeOperation?.id}/complete`, {}),
    onSuccess: onChanged,
    onError,
  });

  const StartControls = ({ label }: { label: string }) => (
    <div className="flex flex-wrap items-end gap-3">
      {wo.operations?.length ? (
        <div className="min-w-56">
          <Label htmlFor="operation-picker">Rota operasyonu</Label>
          <Select id="operation-picker" value={operationId} onChange={(e) => setOperationId(e.target.value)}>
            <option value="">Seçin…</option>
            {wo.operations.filter((operation) => (operation.status === "PENDING" || operation.status === "IN_PROGRESS") && (!operation.ncProgram || operation.ncProgram.status === "PUBLISHED")).map((operation) => (
              <option key={operation.id} value={operation.id}>
                {operation.seq}. {operation.name} — {operation.status === "IN_PROGRESS" ? "devam ediyor" : "bekliyor"}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {wo.operations?.some((operation) => operation.ncProgram && operation.ncProgram.status !== "PUBLISHED") && (
        <p className="text-sm font-medium text-red-700">Yayınlı olmayan veya üst revizyonla değişmiş NC programı olan operasyon başlatılamaz.</p>
      )}
      <MachinePicker machineId={machineId} onChange={setMachineId} />
      {toolingBlocked && <p className="text-sm font-medium text-red-700">Tooling setup doğrulanmadı; operasyon başlatma backend tarafından da engellenir.</p>}
      <Button className="h-14 px-8 text-base" disabled={start.isPending || (!!wo.operations?.length && !operationId) || toolingBlocked} onClick={() => start.mutate()}>
        <Play className="h-5 w-5" /> {label}
      </Button>
    </div>
  );

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Geri
      </button>

      <div className={`mb-6 rounded-lg border-2 p-5 ${style.bg} ${style.border}`}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-800">{wo.woNo}</h1>
          <span className={`rounded-full px-3 py-1 text-sm font-medium text-white ${style.pill}`}>
            {style.label}
          </span>
        </div>
        <div className="text-slate-600">
          {wo.part.partNo} — {wo.part.name}
        </div>
        <div className="mt-1 text-sm text-slate-500">
          {wo.machine?.name ?? "Tezgah atanmadı"} · Hedef {fmtQty(wo.quantity)}
        </div>
        <Button variant="outline" className="mt-4" onClick={() => setShowDocs(true)}>
          <FileText className="h-4 w-4" /> Belgeler (STEP / Çalışma Talimatı)
        </Button>
      </div>

      {status === "not_started" && canRun && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Operasyonu Başlat</h2>
          <StartControls label="Operasyonu Başlat" />
          {operationId && <ToolingChecklist operationId={operationId} onChanged={onChanged} />}
        </Card>
      )}

      {status === "running" && activeRun && (
        <RunningPanel run={activeRun} target={target} canRun={canRun} onChanged={onChanged} />
      )}

      {status === "paused" && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-orange-700">Duraklatıldı</h2>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Sağlam" value={totalGood} />
            <Stat label="Hurda" value={totalScrap} />
            <Stat label="Hedef" value={target} />
            <Stat label="Kalan" value={Math.max(target - totalGood, 0)} />
          </div>
          {canRun && (
            <div className="flex flex-wrap items-end gap-3">
              <StartControls label="Devam Et" />
              {canManage && (
                <Button
                  className="h-14 px-8 text-base"
                  disabled={completeWo.isPending}
                  onClick={async () => {
                    if (await confirm("İş emri tamamlansın mı?")) completeWo.mutate();
                  }}
                >
                  <CheckCircle2 className="h-5 w-5" /> Tamamla
                </Button>
              )}
              {activeOperation && (
                <Button
                  variant="outline"
                  className="h-14 px-8 text-base"
                  disabled={completeOperation.isPending}
                  onClick={async () => {
                    if (await confirm(`${activeOperation.seq}. ${activeOperation.name} operasyonu tamamlanacak mı?`)) completeOperation.mutate();
                  }}
                >
                  <CheckCircle2 className="h-5 w-5" /> Operasyonu Kapat
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {status === "completed" && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-green-700">İş Emri Tamamlandı</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Sağlam" value={totalGood} />
            <Stat label="Hurda" value={totalScrap} />
            <Stat label="Hedef" value={target} />
          </div>
        </Card>
      )}

      <Modal open={showDocs} onClose={() => setShowDocs(false)} title={`${wo.part.partNo} — Belgeler`}>
        <DocumentsPanel entityType="part" entityId={wo.part.id} />
      </Modal>
    </div>
  );
}

function RunningPanel({
  run,
  target,
  canRun,
  onChanged,
}: {
  run: RunRow;
  target: number;
  canRun: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      toast((e.body as { message?: string } | null)?.message ?? "İşlem çakışması (409)", "error");
    } else toast("İşlem başarısız.", "error");
  };
  const [good, setGood] = useState(String(run.goodCount));
  const [scrap, setScrap] = useState(String(run.scrapCount));
  const [note, setNote] = useState(run.downtimeNote ?? "");

  // Soket üzerinden gelen canlı güncellemeler (ör. makine kaynaklı PART_COMPLETE)
  // yeniden çekilen run verisiyle senkronlanır.
  useEffect(() => {
    setGood(String(run.goodCount));
    setScrap(String(run.scrapCount));
    setNote(run.downtimeNote ?? "");
  }, [run.goodCount, run.scrapCount, run.downtimeNote]);

  const payload = () => ({
    goodCount: Number(good) || 0,
    scrapCount: Number(scrap) || 0,
    ...(note ? { downtimeNote: note } : {}),
  });

  const save = useMutation({
    mutationFn: () => apiPatch(`/runs/${run.id}`, payload()),
    onSuccess: onChanged,
    onError,
  });
  const scrapOne = useMutation({
    mutationFn: () => apiPatch(`/runs/${run.id}`, { scrapCount: run.scrapCount + 1 }),
    onSuccess: onChanged,
    onError,
  });
  const complete = useMutation({
    mutationFn: (completeWorkOrder: boolean) =>
      apiPost(`/runs/${run.id}/complete`, { ...payload(), completeWorkOrder }),
    onSuccess: onChanged,
    onError,
  });

  const produced = run.goodCount;
  const pct = target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : 0;

  return (
    <Card>
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-sm text-slate-600">
          <span>Anlık İlerleme (CNC)</span>
          <span className="font-semibold">
            {produced}/{target} ({pct}%)
          </span>
        </div>
        <div className="h-4 overflow-hidden rounded-full bg-slate-200">
          <div className="h-4 rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`good-${run.id}`}>Sağlam Adet</Label>
          <Input
            id={`good-${run.id}`}
            type="number"
            min="0"
            inputMode="numeric"
            className="h-14 text-center text-2xl font-bold"
            value={good}
            onChange={(e) => setGood(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`scrap-${run.id}`}>Hurda Adet</Label>
          <Input
            id={`scrap-${run.id}`}
            type="number"
            min="0"
            inputMode="numeric"
            className="h-14 text-center text-2xl font-bold text-red-600"
            value={scrap}
            onChange={(e) => setScrap(e.target.value)}
          />
        </div>
      </div>
      <div className="mb-4">
        <Label htmlFor={`note-${run.id}`}>Duruş Notu</Label>
        <Input
          id={`note-${run.id}`}
          placeholder="örn. takım değişimi, ayar…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {canRun && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="h-14 flex-1 text-base"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              <Save className="h-5 w-5" /> Kaydet
            </Button>
            <Button
              variant="danger"
              className="h-14 flex-1 text-base"
              disabled={scrapOne.isPending}
              onClick={() => scrapOne.mutate()}
            >
              <AlertTriangle className="h-5 w-5" /> Hurda +1
            </Button>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="h-14 flex-1 text-base"
              disabled={complete.isPending}
              onClick={async () => {
                if (await confirm("Operasyon duraklatılsın mı? Girilen adetler kaydedilecek.")) complete.mutate(false);
              }}
            >
              <Pause className="h-5 w-5" /> Duraklat
            </Button>
            <Button
              variant="outline"
              className="h-14 flex-1 text-base"
              disabled={complete.isPending}
              onClick={async () => {
                if (await confirm("Bu koşu sonlandırılsın mı? İş emri devam eder (parçalı tamamlama)."))
                  complete.mutate(false);
              }}
            >
              <SplitSquareHorizontal className="h-5 w-5" /> Parçalı Tamamla
            </Button>
          </div>
          <Button
            className="h-14 w-full text-base"
            disabled={complete.isPending}
            onClick={async () => {
              if (await confirm("İş emri tamamen tamamlansın mı?")) complete.mutate(true);
            }}
          >
            <CheckCircle2 className="h-5 w-5" /> Tamamla
          </Button>
        </div>
      )}
    </Card>
  );
}
