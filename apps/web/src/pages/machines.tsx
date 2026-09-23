import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Check, Copy, Factory, GraduationCap, KeyRound, Link2 } from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import { CrudPage } from "../components/crud-page";
import { Button, Input, Label, Modal, Select } from "../components/ui";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";

interface MachineRow {
  id: string;
  name: string;
  model: string;
  controller?: string | null;
  isActive: boolean;
  activeWorkOrderId?: string | null;
  activeWorkOrder?: { id: string; woNo: string; status: string } | null;
  lastEventAt?: string | null;
  lastStatus?: string | null;
  operatorQualificationRequired?: boolean;
}

interface UserOption { id: string; name: string; role: string; isActive: boolean; }
interface OperatorQualification {
  id: string; status: "ACTIVE" | "REVOKED"; qualificationReference?: string | null; expiresAt?: string | null; grantedAt: string;
  operator: { id: string; name: string; role: string; isActive: boolean };
  grantedBy: { id: string; name: string };
  revokedAt?: string | null;
}

interface WorkOrderOption {
  id: string;
  woNo: string;
  status: string;
  machine?: { id: string } | null;
}

const MACHINE_STATUS: Record<string, { label: string; cls: string }> = {
  CYCLE_START: { label: "Çalışıyor", cls: "bg-blue-100 text-blue-700" },
  PART_COMPLETE: { label: "Çalışıyor", cls: "bg-blue-100 text-blue-700" },
  CYCLE_END: { label: "Boşta", cls: "bg-slate-100 text-slate-700" },
  IDLE: { label: "Boşta", cls: "bg-slate-100 text-slate-700" },
  ALARM: { label: "Alarm", cls: "bg-red-100 text-red-700" },
};

function machineStatus(row: MachineRow) {
  if (!row.lastStatus || !row.lastEventAt) return { label: "Bağlı değil", cls: "bg-slate-100 text-slate-400" };
  return MACHINE_STATUS[row.lastStatus] ?? { label: row.lastStatus, cls: "bg-slate-100 text-slate-700" };
}

/** Yeni üretilen connector anahtarını gösterir (bir daha gösterilmez) — kopyala
 * butonuyla; native prompt() yerine. */
function ConnectorKeyModal({ machineName, apiKey, onClose }: { machineName: string; apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal open title={`${machineName} — Connector Anahtarı`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Bu değer bir daha gösterilmeyecek — connector <code>.env</code> dosyasına (<code>MACHINE_KEY</code>)
          kopyalayın.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md bg-slate-100 px-3 py-2 text-sm">{apiKey}</code>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(apiKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Kopyalandı" : "Kopyala"}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Kapat</Button>
        </div>
      </div>
    </Modal>
  );
}

function AssignWorkOrderModal({
  machine,
  onClose,
}: {
  machine: MachineRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [workOrderId, setWorkOrderId] = useState(machine.activeWorkOrderId ?? "");
  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
  });
  const options = (workOrders.data ?? []).filter(
    (wo) =>
      (wo.machine?.id === machine.id || !wo.machine) &&
      wo.status !== "COMPLETED" &&
      wo.status !== "CANCELLED",
  );

  const assign = useMutation({
    mutationFn: () =>
      apiPatch(`/machines/${machine.id}/active-work-order`, { workOrderId: workOrderId || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/machines"] });
      onClose();
    },
    onError: () => toast("Atama başarısız", "error"),
  });

  return (
    <Modal open title={`${machine.name} — Aktif İş Emri`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="wo">İş Emri</Label>
          <Select id="wo" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
            <option value="">Atanmadı</option>
            {options.map((wo) => (
              <option key={wo.id} value={wo.id}>
                {wo.woNo}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={assign.isPending} onClick={() => assign.mutate()}>
            Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function OperatorQualificationsModal({ machine, onClose }: { machine: MachineRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [operatorId, setOperatorId] = useState("");
  const [reference, setReference] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const users = useQuery({ queryKey: ["/users"], queryFn: () => apiGet<UserOption[]>("/users") });
  const qualifications = useQuery({ queryKey: ["/machines", machine.id, "operator-qualifications"], queryFn: () => apiGet<OperatorQualification[]>(`/machines/${machine.id}/operator-qualifications`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["/machines", machine.id, "operator-qualifications"] });
    qc.invalidateQueries({ queryKey: ["/machines"] });
  };
  const grant = useMutation({
    mutationFn: () => apiPost(`/machines/${machine.id}/operator-qualifications`, { operatorId, ...(reference.trim() ? { qualificationReference: reference.trim() } : {}), ...(expiresAt ? { expiresAt } : {}) }),
    onSuccess: () => { toast("Operatör yetkinliği kaydedildi.", "success"); setReference(""); setExpiresAt(""); refresh(); },
    onError: () => toast("Yetkinlik kaydedilemedi.", "error"),
  });
  const revoke = useMutation({
    mutationFn: (qualificationId: string) => apiPost(`/machines/${machine.id}/operator-qualifications/${qualificationId}/revoke`, {}),
    onSuccess: () => { toast("Operatör yetkinliği kaldırıldı.", "success"); refresh(); },
    onError: () => toast("Yetkinlik kaldırılamadı.", "error"),
  });
  const operators = (users.data ?? []).filter((user) => user.isActive && ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"].includes(user.role));
  return <Modal open title={`${machine.name} — Operatör Yetkinlikleri`} onClose={onClose}><div className="space-y-4"><p className="text-sm text-slate-600">Bu makinede politika açıksa yalnız aktif ve süresi dolmamış yetkinlik kaydı olan kullanıcı HMI üzerinden operasyon başlatabilir.</p>{!machine.operatorQualificationRequired && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">Makine politikası kapalı; kayıtlar tutulur ancak HMI başlangıcını henüz engellemez.</p>}<div className="grid gap-3 rounded border p-3"><div><Label htmlFor="qualification-operator">Kullanıcı</Label><Select id="qualification-operator" value={operatorId} onChange={(event) => setOperatorId(event.target.value)}><option value="">Seçin…</option>{operators.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</Select></div><div><Label htmlFor="qualification-reference">Eğitim / sertifika referansı</Label><Input id="qualification-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Opsiyonel referans" /></div><div><Label htmlFor="qualification-expires">Geçerlilik bitişi</Label><Input id="qualification-expires" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div><Button disabled={!operatorId || grant.isPending} onClick={() => grant.mutate()}>Yetkinlik ver</Button></div><div><h3 className="font-medium">Kayıtlar</h3>{qualifications.isLoading ? <p className="mt-2 text-sm text-slate-500">Yükleniyor…</p> : (qualifications.data ?? []).length === 0 ? <p className="mt-2 text-sm text-slate-500">Kayıt yok.</p> : <div className="mt-2 space-y-2">{qualifications.data?.map((qualification) => <div key={qualification.id} className="rounded border p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{qualification.operator.name}</b> · {qualification.operator.role}<div className="mt-1 text-xs text-slate-600">{qualification.qualificationReference ?? "Referans belirtilmedi"} · veren: {qualification.grantedBy.name} · {fmtDate(qualification.grantedAt)}{qualification.expiresAt ? ` · bitiş: ${fmtDate(qualification.expiresAt)}` : " · süresiz"}</div></div><div className="flex items-center gap-2"><span className={`rounded px-2 py-1 text-xs font-semibold ${qualification.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>{qualification.status === "ACTIVE" ? "Aktif" : "Kaldırıldı"}</span>{qualification.status === "ACTIVE" && <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(qualification.id)}>Kaldır</Button>}</div></div></div>)}</div>}</div></div></Modal>;
}

interface SkillOption { id: string; code: string; name: string; }
interface MachineRequiredSkillRow { id: string; minLevel: string; skill: { id: string; code: string; name: string }; }

const SKILL_LEVEL_OPTIONS = [
  { value: "TRAINEE", label: "Çırak" },
  { value: "QUALIFIED", label: "Yetkin" },
  { value: "EXPERT", label: "Uzman" },
];

function MachineRequiredSkillsModal({ machine, onClose }: { machine: MachineRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [skillId, setSkillId] = useState("");
  const [minLevel, setMinLevel] = useState("QUALIFIED");
  const skills = useQuery({ queryKey: ["/skills"], queryFn: () => apiGet<SkillOption[]>("/skills") });
  const requirements = useQuery({ queryKey: ["/machines", machine.id, "required-skills"], queryFn: () => apiGet<MachineRequiredSkillRow[]>(`/machines/${machine.id}/required-skills`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["/machines", machine.id, "required-skills"] });
  const add = useMutation({
    mutationFn: () => apiPost(`/machines/${machine.id}/required-skills`, { skillId, minLevel }),
    onSuccess: () => { toast("Beceri gereksinimi eklendi.", "success"); setSkillId(""); refresh(); },
    onError: () => toast("Beceri gereksinimi eklenemedi.", "error"),
  });
  const remove = useMutation({
    mutationFn: (requirementId: string) => apiDelete(`/machines/${machine.id}/required-skills/${requirementId}`),
    onSuccess: () => { toast("Beceri gereksinimi kaldırıldı.", "success"); refresh(); },
    onError: () => toast("Kaldırılamadı.", "error"),
  });
  const availableSkills = (skills.data ?? []).filter((skill) => !requirements.data?.some((requirement) => requirement.skill.id === skill.id));
  return <Modal open title={`${machine.name} — Beceri Gereksinimleri`} onClose={onClose}><div className="space-y-4"><p className="text-sm text-slate-600">OperatorMachineQualification'dan bağımsız, çapraz-makine beceri matrisi — HMI başlangıcında operatörün her gereksinimi en az belirtilen seviyede karşılaması gerekir.</p><div className="grid gap-3 rounded border p-3 sm:grid-cols-3"><div><Label htmlFor="req-skill">Beceri</Label><Select id="req-skill" value={skillId} onChange={(event) => setSkillId(event.target.value)}><option value="">Seçin…</option>{availableSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}</Select></div><div><Label htmlFor="req-level">Min. Seviye</Label><Select id="req-level" value={minLevel} onChange={(event) => setMinLevel(event.target.value)}>{SKILL_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div><div className="flex items-end"><Button disabled={!skillId || add.isPending} onClick={() => add.mutate()}>Ekle</Button></div></div><div><h3 className="font-medium">Gereksinimler</h3>{requirements.isLoading ? <p className="mt-2 text-sm text-slate-500">Yükleniyor…</p> : (requirements.data ?? []).length === 0 ? <p className="mt-2 text-sm text-slate-500">Bu makine için beceri gereksinimi tanımlı değil.</p> : <div className="mt-2 space-y-2">{requirements.data?.map((requirement) => <div key={requirement.id} className="flex items-center justify-between rounded border p-3 text-sm"><div><b>{requirement.skill.code}</b> · {requirement.skill.name}<div className="mt-1 text-xs text-slate-600">Min. seviye: {SKILL_LEVEL_OPTIONS.find((option) => option.value === requirement.minLevel)?.label}</div></div><Button size="sm" variant="outline" disabled={remove.isPending} onClick={async () => { if (await confirm({ message: `${requirement.skill.name} gereksinimi kaldırılsın mı?`, danger: true })) remove.mutate(requirement.id); }}>Kaldır</Button></div>)}</div>}</div></div></Modal>;
}

export function MachinesPage() {
  const { user } = useAuth();
  const canManage = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const canAssign = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [assignFor, setAssignFor] = useState<MachineRow | null>(null);
  const [newKeyFor, setNewKeyFor] = useState<{ name: string; key: string } | null>(null);
  const [qualificationsFor, setQualificationsFor] = useState<MachineRow | null>(null);
  const [requiredSkillsFor, setRequiredSkillsFor] = useState<MachineRow | null>(null);
  const canManageQualifications = user?.role === "ADMIN";

  useInvalidateOn(["machine.updated", "machine.alarm"], ["/machines"]);

  const generateKey = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => apiPost<{ key: string }>(`/machines/${id}/connector-key`, {}),
    onSuccess: (res, { name }) => {
      qc.invalidateQueries({ queryKey: ["/machines"] });
      setNewKeyFor({ name, key: res.key });
    },
    onError: () => toast("Anahtar üretilemedi", "error"),
  });

  return (
    <>
      <CrudPage<MachineRow>
        title="Tezgahlar"
        icon={Factory}
        endpoint="/machines"
        writeRoles={["ADMIN"]}
        searchable={false}
        columns={[
          { key: "name", label: "Ad" },
          { key: "model", label: "Model" },
          { key: "controller", label: "Kontrol Ünitesi" },
          { key: "isActive", label: "Durum", render: (r) => (r.isActive ? "Aktif" : "Pasif") },
          { key: "operatorQualificationRequired", label: "Operatör Yetkinliği", render: (r) => r.operatorQualificationRequired ? "Zorunlu" : "Opsiyonel" },
          {
            key: "liveStatus",
            label: "Canlı Durum",
            render: (r) => {
              const s = machineStatus(r);
              return (
                <div className="flex flex-col gap-1">
                  <span
                    className={clsx("inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-medium", s.cls)}
                  >
                    {s.label}
                  </span>
                  {r.lastEventAt && (
                    <span className="text-xs text-slate-400">{fmtDate(r.lastEventAt)}</span>
                  )}
                </div>
              );
            },
          },
          {
            key: "activeWorkOrder",
            label: "Aktif İş Emri",
            render: (r) => r.activeWorkOrder?.woNo ?? "—",
          },
        ]}
        fields={[
          { name: "name", label: "Ad", required: true },
          { name: "model", label: "Model", required: true },
          { name: "controller", label: "Kontrol Ünitesi (örn. Fanuc 0i-MF)" },
          { name: "isActive", label: "Aktif", type: "checkbox" },
          { name: "operatorQualificationRequired", label: "Operatör yetkinliği zorunlu", type: "checkbox" },
          { name: "pmIntervalHours", label: "Öngörülü Bakım Aralığı (saat)", type: "number" },
          { name: "hourlyRate", label: "Saatlik Makine Maliyeti", type: "number" },
          { name: "dailyCapacityMinutes", label: "Günlük Kapasite (dakika)", type: "number" },
        ]}
        rowActions={(row) => (
          <div className="flex gap-1">
            {canAssign && (
              <Button
                variant="ghost"
                className="px-2 py-1"
                title="Aktif İş Emri Ata"
                onClick={() => setAssignFor(row)}
              >
                <Link2 className="h-4 w-4" />
              </Button>
            )}
            {canManage && (
              <Button
                variant="ghost"
                className="px-2 py-1"
                title="Connector Anahtarı Oluştur"
                onClick={async () => {
                  if (
                    await confirm({
                      message: `${row.name} için yeni bir connector anahtarı üretilsin mi? Eski anahtar geçersiz olur.`,
                      danger: true,
                    })
                  )
                    generateKey.mutate({ id: row.id, name: row.name });
                }}
              >
                <KeyRound className="h-4 w-4" />
              </Button>
            )}
            {canManageQualifications && (
              <Button variant="ghost" className="px-2 py-1" title="Operatör Yetkinlikleri" onClick={() => setQualificationsFor(row)}>
                <BadgeCheck className="h-4 w-4" />
              </Button>
            )}
            {canManageQualifications && (
              <Button variant="ghost" className="px-2 py-1" title="Beceri Gereksinimleri" onClick={() => setRequiredSkillsFor(row)}>
                <GraduationCap className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      />
      {assignFor && <AssignWorkOrderModal machine={assignFor} onClose={() => setAssignFor(null)} />}
      {qualificationsFor && <OperatorQualificationsModal machine={qualificationsFor} onClose={() => setQualificationsFor(null)} />}
      {requiredSkillsFor && <MachineRequiredSkillsModal machine={requiredSkillsFor} onClose={() => setRequiredSkillsFor(null)} />}
      {newKeyFor && (
        <ConnectorKeyModal machineName={newKeyFor.name} apiKey={newKeyFor.key} onClose={() => setNewKeyFor(null)} />
      )}
    </>
  );
}
