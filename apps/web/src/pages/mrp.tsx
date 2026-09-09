import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PlayCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Input, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";

type Policy = "MAKE" | "BUY" | "MAKE_OR_BUY";
type ProposalStatus = "PROPOSED" | "FIRMED" | "CONVERTED" | "CANCELLED" | "SUPERSEDED";
type Severity = "CRITICAL" | "WARNING" | "INFO";
type ExceptionType =
  | "SHORTAGE"
  | "RESCHEDULE_IN"
  | "RESCHEDULE_OUT"
  | "CANCEL"
  | "QUANTITY_EXCESS"
  | "QUANTITY_SHORTAGE"
  | "MISSING_POLICY";

interface Plant {
  id: string;
  name: string;
}

interface Pegging {
  demandType: string;
  demandId: string;
  parentDemandType?: string | null;
  parentDemandId?: string | null;
  quantity: string;
  requiredDate: string;
}

interface Proposal {
  id: string;
  proposalNo: string;
  itemType: "MATERIAL" | "PART";
  itemId: string;
  policy: Policy;
  quantity: string;
  receiptDate: string;
  releaseDate: string;
  status: ProposalStatus;
  calculation: Record<string, unknown>;
  parameterSnapshot: Record<string, unknown>;
  peggings: Pegging[];
}

interface MrpException {
  id: string;
  type: ExceptionType;
  severity: Severity;
  itemType: "MATERIAL" | "PART";
  itemId: string;
  quantity: string | null;
  requiredDate: string | null;
  suggestedDate: string | null;
  explanation: Record<string, unknown>;
  acknowledgedAt: string | null;
}

interface MrpRun {
  id: string;
  status: string;
  planningDate: string;
  horizonEnd: string;
  startedAt: string;
  summary: { proposalCount?: number; exceptionCount?: number } | null;
}

const proposalStatusLabel: Record<ProposalStatus, string> = {
  PROPOSED: "Önerildi",
  FIRMED: "Firm",
  CONVERTED: "Dönüştürüldü",
  CANCELLED: "İptal",
  SUPERSEDED: "Yerine yenisi",
};

const proposalStatusClass: Record<ProposalStatus, string> = {
  PROPOSED: "bg-blue-100 text-blue-700",
  FIRMED: "bg-violet-100 text-violet-700",
  CONVERTED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
  SUPERSEDED: "bg-slate-100 text-slate-600",
};

const severityClass: Record<Severity, string> = {
  CRITICAL: "bg-red-100 text-red-700",
  WARNING: "bg-amber-100 text-amber-700",
  INFO: "bg-slate-100 text-slate-700",
};

const calculationLabels: Record<string, string> = {
  openingUsable: "Açılış kullanılabilir stok",
  grossRequirement: "Brüt ihtiyaç",
  existingSupplyBeforeDate: "İhtiyaç tarihine kadarki arz",
  safetyStock: "Emniyet stoğu",
  netRequirement: "Net ihtiyaç",
  lotRule: "Lot kuralı",
  recommendedQuantity: "Önerilen miktar",
  projectedBalanceBeforeProposal: "Öneri öncesi projeksiyon",
  requiredReceipt: "Gerekli giriş tarihi",
  leadTimeWorkingDays: "Çalışma günü lead time",
  recommendedRelease: "Önerilen serbest bırakma",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKey(value: string | null) {
  return value?.slice(0, 10) ?? "";
}

function isWithinDateRange(value: string | null, from: string, to: string) {
  const key = dateKey(value);
  if (!from && !to) return true;
  if (!key) return false;
  return (!from || key >= from) && (!to || key <= to);
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${proposalStatusClass[status]}`}>
      {proposalStatusLabel[status]}
    </span>
  );
}

function ProposalDetail({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const calculationEntries = Object.entries(proposal.calculation);
  const leadTime = proposal.parameterSnapshot.leadTimeWorkingDays;

  return (
    <Modal
      open
      title={`${proposal.proposalNo} — Hesap Açıklaması`}
      onClose={onClose}
      className="max-h-[90vh] max-w-3xl overflow-y-auto"
    >
      <div className="space-y-5 text-sm">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Kalem / politika</dt>
            <dd className="font-medium">{proposal.itemType}: {proposal.itemId} / {proposal.policy}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Önerilen miktar</dt>
            <dd className="font-medium">{proposal.quantity}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">İhtiyaç tarihi</dt>
            <dd>{fmtDate(proposal.receiptDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Serbest bırakma tarihi</dt>
            <dd>{fmtDate(proposal.releaseDate)}</dd>
          </div>
        </dl>

        <section>
          <h3 className="font-semibold">Saklanan kanonik hesap</h3>
          <dl className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
            {calculationEntries.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3 border-b border-slate-200 py-1 last:border-0">
                <dt className="text-slate-600">{calculationLabels[key] ?? key}</dt>
                <dd className="text-right font-mono text-xs">{displayValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="font-semibold">Parametre snapshotı</h3>
          <div className="mt-2 rounded-lg border p-3 text-xs">
            {leadTime !== undefined && <p className="mb-2 font-medium">{displayValue(leadTime)} çalışma günü</p>}
            <pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(proposal.parameterSnapshot, null, 2)}</pre>
          </div>
        </section>

        <section>
          <h3 className="font-semibold">Pegging</h3>
          {proposal.peggings.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {proposal.peggings.map((pegging, index) => (
                <li key={`${pegging.demandId}-${index}`} className="rounded-lg border p-3 text-xs">
                  <p className="font-medium">{pegging.demandType} / {pegging.demandId}</p>
                  <p className="mt-1 text-slate-600">{pegging.quantity} — {fmtDate(pegging.requiredDate)}</p>
                  {pegging.parentDemandId && (
                    <p className="mt-1 text-slate-500">Üst talep: {pegging.parentDemandType} / {pegging.parentDemandId}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-slate-500">Bu öneri için saklanan pegging yok.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}

function ConversionModal({
  proposal,
  busy,
  onCancel,
  onConfirm,
}: {
  proposal: Proposal;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isMake = proposal.policy === "MAKE";
  return (
    <Modal open title={`${proposal.proposalNo} — Kontrollü Dönüşüm`} onClose={onCancel}>
      <div className="space-y-4 text-sm">
        <p>
          {isMake
            ? "MAKE önerisi planlı iş emrine dönüştürülecek; mevcut mühendislik release sınırı korunacak."
            : "BUY önerisi satınalma talebine dönüştürülecek; satınalma siparişi oluşturulmayacak."}
        </p>
        <p className="rounded bg-slate-50 p-3 text-xs text-slate-600">
          {proposal.itemType}: {proposal.itemId} — {proposal.quantity} — ihtiyaç {fmtDate(proposal.receiptDate)}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onCancel}>Vazgeç</Button>
          <Button disabled={busy} onClick={onConfirm}>
            {isMake ? "Planlı İş Emrine Dönüştür" : "Satınalma Talebine Dönüştür"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function MrpPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [plantId, setPlantId] = useState("");
  const [planningDate, setPlanningDate] = useState(today());
  const [horizonEnd, setHorizonEnd] = useState(plusDays(90));
  const [policy, setPolicy] = useState("");
  const [proposalStatus, setProposalStatus] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exceptionType, setExceptionType] = useState("");
  const [severity, setSeverity] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");
  const [detail, setDetail] = useState<Proposal | null>(null);
  const [conversion, setConversion] = useState<Proposal | null>(null);
  const canManage = !!user && ["ADMIN", "PLANNER"].includes(user.role);

  const plants = useQuery({ queryKey: ["/plants"], queryFn: () => apiGet<Plant[]>("/plants") });
  const selectedPlant = plantId || plants.data?.[0]?.id || "";

  const proposals = useQuery({
    queryKey: ["/mrp/proposals", selectedPlant, policy, proposalStatus],
    enabled: !!selectedPlant,
    queryFn: () => {
      const params = new URLSearchParams({ plantId: selectedPlant });
      if (policy) params.set("policy", policy);
      if (proposalStatus) params.set("status", proposalStatus);
      return apiGet<Proposal[]>(`/mrp/proposals?${params.toString()}`);
    },
  });

  const exceptions = useQuery({
    queryKey: ["/mrp/exceptions", selectedPlant, severity, exceptionType],
    enabled: !!selectedPlant,
    queryFn: () => {
      const params = new URLSearchParams({ plantId: selectedPlant });
      if (severity) params.set("severity", severity);
      if (exceptionType) params.set("type", exceptionType);
      return apiGet<MrpException[]>(`/mrp/exceptions?${params.toString()}`);
    },
  });

  const runs = useQuery({
    queryKey: ["/mrp/runs", selectedPlant],
    enabled: !!selectedPlant,
    queryFn: () => apiGet<MrpRun[]>(`/mrp/runs?plantId=${encodeURIComponent(selectedPlant)}`),
  });

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/mrp/proposals"] }),
    queryClient.invalidateQueries({ queryKey: ["/mrp/exceptions"] }),
    queryClient.invalidateQueries({ queryKey: ["/mrp/runs"] }),
  ]);

  const run = useMutation({
    mutationFn: () => apiPost("/mrp/runs", { plantId: selectedPlant, planningDate, horizonEnd }),
    onSuccess: () => {
      void invalidate();
      toast("MRP günlük planı tamamlandı", "success");
    },
    onError: () => toast("MRP planı çalıştırılamadı. Parametre ve takvimi kontrol edin.", "error"),
  });

  const firm = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      apiPatch(`/mrp/proposals/${id}/${value ? "firm" : "unfirm"}`, {}),
    onSuccess: () => void invalidate(),
    onError: () => toast("Firm durumu değiştirilemedi", "error"),
  });

  const convert = useMutation({
    mutationFn: (proposal: Proposal) =>
      apiPost(`/mrp/proposals/${proposal.id}/${proposal.policy === "MAKE" ? "convert-make" : "convert-buy"}`, {}),
    onSuccess: () => {
      setConversion(null);
      void invalidate();
      toast("Öneri downstream sınıra güvenli biçimde dönüştürüldü", "success");
    },
    onError: () => toast("Dönüşüm yapılamadı", "error"),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => apiPost(`/mrp/exceptions/${id}/acknowledge`, {}),
    onSuccess: () => {
      void invalidate();
      toast("İstisna onaylandı", "success");
    },
    onError: () => toast("İstisna onaylanamadı", "error"),
  });

  const normalizedItemSearch = itemSearch.trim().toLocaleLowerCase("tr-TR");
  const filteredProposals = useMemo(
    () => (proposals.data ?? []).filter((item) => {
      const searchable = `${item.proposalNo} ${item.itemType} ${item.itemId}`.toLocaleLowerCase("tr-TR");
      return (!policy || item.policy === policy)
        && (!proposalStatus || item.status === proposalStatus)
        && (!normalizedItemSearch || searchable.includes(normalizedItemSearch))
        && isWithinDateRange(item.receiptDate, dateFrom, dateTo);
    }),
    [dateFrom, dateTo, normalizedItemSearch, policy, proposalStatus, proposals.data],
  );

  const filteredExceptions = useMemo(
    () => (exceptions.data ?? [])
      .filter((item) => {
        const searchable = `${item.itemType} ${item.itemId}`.toLocaleLowerCase("tr-TR");
        const acknowledgementMatches = !acknowledgement
          || (acknowledgement === "OPEN" && !item.acknowledgedAt)
          || (acknowledgement === "ACKNOWLEDGED" && !!item.acknowledgedAt);
        return (!exceptionType || item.type === exceptionType)
          && (!severity || item.severity === severity)
          && acknowledgementMatches
          && (!normalizedItemSearch || searchable.includes(normalizedItemSearch))
          && isWithinDateRange(item.requiredDate, dateFrom, dateTo);
      })
      .sort((a, b) => `${a.requiredDate ?? ""}${a.severity}`.localeCompare(`${b.requiredDate ?? ""}${b.severity}`)),
    [acknowledgement, dateFrom, dateTo, exceptionType, exceptions.data, normalizedItemSearch, severity],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">MRP — Günlük Planlama</h1>
        <p className="text-sm text-slate-500">
          Tarihli ihtiyaç, kullanılabilir arz, istisna, pegging ve önerileri tek kanonik planda gösterir.
        </p>
      </header>

      <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-4">
        <label className="text-sm" htmlFor="mrp-plant">
          Plant
          <Select id="mrp-plant" className="mt-1" value={selectedPlant} onChange={(event) => setPlantId(event.target.value)}>
            {(plants.data ?? []).map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
          </Select>
        </label>
        <label className="text-sm" htmlFor="mrp-planning-date">
          Planlama tarihi
          <Input id="mrp-planning-date" className="mt-1" type="date" value={planningDate} onChange={(event) => setPlanningDate(event.target.value)} />
        </label>
        <label className="text-sm" htmlFor="mrp-horizon-end">
          Ufuk sonu
          <Input id="mrp-horizon-end" className="mt-1" type="date" value={horizonEnd} onChange={(event) => setHorizonEnd(event.target.value)} />
        </label>
        <div className="self-end">
          {canManage && (
            <Button disabled={!selectedPlant || run.isPending || horizonEnd < planningDate} onClick={() => run.mutate()}>
              <PlayCircle className="h-4 w-4" /> Tam MRP Çalıştır
            </Button>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Çalışma geçmişi</h2>
        <Table headers={["Durum", "Plan tarihi", "Ufuk", "Öneri / istisna", "Başlangıç"]}>
          {(runs.data ?? []).slice(0, 5).map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-2">{item.status}</td>
              <td className="px-4 py-2">{fmtDate(item.planningDate)}</td>
              <td className="px-4 py-2">{fmtDate(item.horizonEnd)}</td>
              <td className="px-4 py-2">{item.summary?.proposalCount ?? 0} / {item.summary?.exceptionCount ?? 0}</td>
              <td className="px-4 py-2">{fmtDate(item.startedAt)}</td>
            </tr>
          ))}
          {runs.data?.length === 0 && <tr><td colSpan={5} className="px-4 py-5 text-center text-slate-500">Henüz günlük MRP çalışması yok.</td></tr>}
        </Table>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Planlayıcı Workbench</h2>
          <p className="text-xs text-slate-500">Tarihli MAKE/BUY önerileri, durum geçişleri ve kontrollü conversion sınırı.</p>
        </div>
        <div className="grid gap-3 rounded-lg border bg-slate-50 p-3 md:grid-cols-3 xl:grid-cols-5">
          <label className="text-xs" htmlFor="mrp-policy-filter">Politika<Select id="mrp-policy-filter" className="mt-1" value={policy} onChange={(event) => setPolicy(event.target.value)}><option value="">Tümü</option><option value="MAKE">MAKE</option><option value="BUY">BUY</option></Select></label>
          <label className="text-xs" htmlFor="mrp-item-filter">Kalem ara<Input id="mrp-item-filter" className="mt-1" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Kod, ID veya öneri no" /></label>
          <label className="text-xs" htmlFor="mrp-status-filter">Öneri durumu<Select id="mrp-status-filter" className="mt-1" value={proposalStatus} onChange={(event) => setProposalStatus(event.target.value)}><option value="">Tümü</option>{Object.entries(proposalStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
          <label className="text-xs" htmlFor="mrp-date-from">Başlangıç tarihi<Input id="mrp-date-from" className="mt-1" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label className="text-xs" htmlFor="mrp-date-to">Bitiş tarihi<Input id="mrp-date-to" className="mt-1" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        </div>
        <Table headers={["No", "Kalem", "Politika", "Miktar", "İhtiyaç", "Serbest bırak", "Durum", "İşlem"]}>
          {filteredProposals.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-3 font-medium"><button className="underline" aria-label={`${item.proposalNo} ayrıntısını aç`} onClick={() => setDetail(item)}>{item.proposalNo}</button></td>
              <td className="px-4 py-3 text-xs">{item.itemType}: {item.itemId}</td>
              <td className="px-4 py-3">{item.policy}</td>
              <td className="px-4 py-3">{item.quantity}</td>
              <td className="px-4 py-3">{fmtDate(item.receiptDate)}</td>
              <td className="px-4 py-3">{fmtDate(item.releaseDate)}</td>
              <td className="px-4 py-3"><ProposalStatusBadge status={item.status} /></td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {canManage && item.status === "PROPOSED" && <Button variant="ghost" size="sm" disabled={firm.isPending} onClick={() => firm.mutate({ id: item.id, value: true })}>Firmle</Button>}
                  {canManage && item.status === "FIRMED" && <Button variant="ghost" size="sm" disabled={firm.isPending} onClick={() => firm.mutate({ id: item.id, value: false })}>Firmi kaldır</Button>}
                  {canManage && item.status === "FIRMED" && (item.policy === "MAKE" || item.policy === "BUY") && <Button variant="outline" size="sm" disabled={convert.isPending} onClick={() => setConversion(item)}>Dönüştür</Button>}
                </div>
              </td>
            </tr>
          ))}
          {filteredProposals.length === 0 && <tr><td colSpan={8} className="px-4 py-5 text-center text-slate-500">Bu filtrelerde öneri yok.</td></tr>}
        </Table>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">İstisna Workbench</h2>
          <p className="text-xs text-slate-500">Kritik açıkları, reschedule ve lifecycle önerilerini saklanan açıklamalarıyla yönetin.</p>
        </div>
        <div className="grid gap-3 rounded-lg border bg-slate-50 p-3 md:grid-cols-3">
          <label className="text-xs" htmlFor="mrp-exception-type">İstisna türü<Select id="mrp-exception-type" className="mt-1" value={exceptionType} onChange={(event) => setExceptionType(event.target.value)}><option value="">Tümü</option><option value="SHORTAGE">SHORTAGE</option><option value="RESCHEDULE_IN">RESCHEDULE_IN</option><option value="RESCHEDULE_OUT">RESCHEDULE_OUT</option><option value="CANCEL">CANCEL</option><option value="QUANTITY_EXCESS">QUANTITY_EXCESS</option><option value="QUANTITY_SHORTAGE">QUANTITY_SHORTAGE</option><option value="MISSING_POLICY">MISSING_POLICY</option></Select></label>
          <label className="text-xs" htmlFor="mrp-severity-filter">Önem<Select id="mrp-severity-filter" className="mt-1" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">Tümü</option><option value="CRITICAL">Kritik</option><option value="WARNING">Uyarı</option><option value="INFO">Bilgi</option></Select></label>
          <label className="text-xs" htmlFor="mrp-ack-filter">Onay durumu<Select id="mrp-ack-filter" className="mt-1" value={acknowledgement} onChange={(event) => setAcknowledgement(event.target.value)}><option value="">Tümü</option><option value="OPEN">Açık</option><option value="ACKNOWLEDGED">Onaylandı</option></Select></label>
        </div>
        <Table headers={["Önem", "Tür", "Kalem", "Miktar", "İhtiyaç", "Önerilen", "Neden", "Durum / işlem"]}>
          {filteredExceptions.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${severityClass[item.severity]}`}>{item.severity}</span></td>
              <td className="px-4 py-3">{item.type}</td>
              <td className="px-4 py-3 text-xs">{item.itemType}: {item.itemId}</td>
              <td className="px-4 py-3">{item.quantity ?? "—"}</td>
              <td className="px-4 py-3">{item.requiredDate ? fmtDate(item.requiredDate) : "—"}</td>
              <td className="px-4 py-3">{item.suggestedDate ? fmtDate(item.suggestedDate) : "—"}</td>
              <td className="max-w-sm px-4 py-3 text-xs">{String(item.explanation.message ?? "Saklanan MRP planlama istisnası")}</td>
              <td className="px-4 py-3">
                {item.acknowledgedAt ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-4 w-4" /> Onaylandı</span>
                ) : canManage ? (
                  <Button variant="outline" size="sm" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(item.id)}>Onayla</Button>
                ) : (
                  <span className="text-xs text-amber-700">Açık</span>
                )}
              </td>
            </tr>
          ))}
          {filteredExceptions.length === 0 && <tr><td colSpan={8} className="px-4 py-5 text-center text-slate-500">Bu filtrelerde istisna yok.</td></tr>}
        </Table>
      </section>

      {detail && <ProposalDetail proposal={detail} onClose={() => setDetail(null)} />}
      {conversion && <ConversionModal proposal={conversion} busy={convert.isPending} onCancel={() => setConversion(null)} onConfirm={() => convert.mutate(conversion)} />}
    </div>
  );
}
