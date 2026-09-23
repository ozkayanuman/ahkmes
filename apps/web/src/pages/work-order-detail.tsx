import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { DocumentsPanel } from "../components/documents-panel";
import { StatusBadge, WO_STATUS } from "../components/status";
import { Button, Card, Input, Label, Modal, Select, Table } from "../components/ui";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";
import type { WorkOrderRow } from "./work-orders";

interface MachineOption {
  id: string;
  name: string;
  isActive: boolean;
}
interface MaterialOption {
  id: string;
  code: string;
  name: string;
  unit: string;
  stockQty: string;
}
interface PartOption {
  id: string;
  partNo: string;
  name: string;
}
interface BinOption {
  id: string;
  code: string;
  warehouse: { id: string; name: string };
}
interface ConsumptionRow {
  id: string;
  itemType: "MATERIAL" | "PART";
  itemId: string;
  type: "RESERVED" | "CONSUMED";
  quantity: string;
  date: string;
  createdBy: { name: string };
}
interface FinishedGoodsRow {
  id: string;
  quantity: string;
  date: string;
  createdBy: { name: string };
}
interface DefinitionOption {
  id: string;
  status: string;
  plant: { id: string; name: string };
  part: { id: string };
}
interface ReservationRow {
  id: string;
  binId: string;
  bin: { id: string; code: string };
  lot?: { id: string; lotNo: string } | null;
  quantity: string;
  issuedQty: string;
  status: string;
}
interface RequirementRow {
  id: string;
  itemType: "MATERIAL" | "PART";
  itemId: string;
  requiredQty: string;
  reservedQty: string;
  issuedQty: string;
  consumedQty: string;
  returnedQty: string;
  scrappedQty: string;
  item: { code?: string; partNo?: string; name: string; unit: string } | null;
  reservations: ReservationRow[];
}

// Backend'deki geçiş kurallarının aynası — butonları buna göre göster
const NEXT: Record<string, { status: string; label: string; danger?: boolean }[]> = {
  PLANNED: [
    { status: "WAITING_MATERIAL", label: "Malzeme Bekliyor" },
    { status: "IN_PRODUCTION", label: "Üretime Al" },
    { status: "CANCELLED", label: "İptal Et", danger: true },
  ],
  WAITING_MATERIAL: [
    { status: "PLANNED", label: "Planlandıya Al" },
    { status: "IN_PRODUCTION", label: "Üretime Al" },
    { status: "CANCELLED", label: "İptal Et", danger: true },
  ],
  IN_PRODUCTION: [
    { status: "COMPLETED", label: "Tamamla" },
    { status: "CANCELLED", label: "İptal Et", danger: true },
  ],
  COMPLETED: [],
  CANCELLED: [],
};

export function WorkOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const canStatus = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const canConsume = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    quantity: "",
    dueDate: "",
    priority: "5",
    machineId: "",
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [consForm, setConsForm] = useState({
    itemType: "MATERIAL" as "MATERIAL" | "PART",
    itemId: "",
    type: "CONSUMED",
    quantity: "",
    binId: "",
  });
  const [fgQty, setFgQty] = useState("");
  const [fgBinId, setFgBinId] = useState("");
  const [releaseDefinitionId, setReleaseDefinitionId] = useState("");
  const [reserveForm, setReserveForm] = useState<Record<string, { binId: string; quantity: string }>>({});
  const [txForm, setTxForm] = useState<Record<string, { type: "consume" | "return" | "scrap"; quantity: string }>>({});

  useInvalidateOn(
    ["workorder.updated", "stock.updated", "productionrun.updated"],
    ["/work-orders", "/consumptions", "/finished-goods", "/materials", "/parts"],
  );

  const query = useQuery({
    queryKey: ["/work-orders", id],
    queryFn: () => apiGet<WorkOrderRow>(`/work-orders/${id}`),
  });
  const oee = useQuery({
    queryKey: ["/work-orders", id, "oee"],
    queryFn: () =>
      apiGet<{
        quality: number | null;
        performance: number | null;
        availability: number | null;
        oee: number | null;
        note?: string;
      }>(`/work-orders/${id}/oee`),
  });
  const cost = useQuery({
    queryKey: ["/work-orders", id, "cost"],
    queryFn: () =>
      apiGet<{
        materialCost: number;
        materialCostPartial: boolean;
        machineCost: number;
        machineCostPartial: boolean;
        laborCost: number;
        laborCostPartial: boolean;
        totalCost: number;
        currency?: string | null;
        dataQuality?: string;
        planned?: { total: number | null };
        actual?: { total: number | null };
        variance?: { total: number | null; percentage: number | null };
        unitCost?: number | null;
        issues?: { code: string }[];
        note?: string;
      }>(`/work-orders/${id}/cost`),
  });
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
    enabled: editOpen || canStatus,
  });
  const consumptions = useQuery({
    queryKey: ["/consumptions", id],
    queryFn: () => apiGet<ConsumptionRow[]>(`/consumptions?workOrderId=${id}`),
  });
  const finishedGoods = useQuery({
    queryKey: ["/finished-goods", id],
    queryFn: () => apiGet<FinishedGoodsRow[]>(`/finished-goods?workOrderId=${id}`),
  });
  const materials = useQuery({
    queryKey: ["/materials"],
    queryFn: () => apiGet<MaterialOption[]>("/materials"),
    enabled: canConsume,
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
    enabled: canConsume,
  });
  const bins = useQuery({
    queryKey: ["/bins"],
    queryFn: () => apiGet<BinOption[]>("/bins"),
    enabled: canConsume,
  });
  const routed = !!query.data?.operations?.length;
  const definitions = useQuery({
    queryKey: ["/production-definitions", query.data?.part.id],
    queryFn: () => apiGet<DefinitionOption[]>(`/production-definitions?partId=${query.data!.part.id}`),
    enabled: !!query.data && !routed,
  });
  const requirements = useQuery({
    queryKey: ["/production-material/work-orders", id],
    queryFn: () => apiGet<RequirementRow[]>(`/production-material/work-orders/${id}`),
    enabled: routed,
  });

  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/work-orders"] });
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      const msg = (e.body as { message?: string } | null)?.message;
      toast(msg ?? "İşlem çakışması (409)", "error");
    } else toast("İşlem başarısız.", "error");
  };

  const setStatus = useMutation({
    mutationFn: (status: string) => apiPatch(`/work-orders/${id}/status`, { status }),
    onSuccess: invalidate,
    onError,
  });
  const assignOperationMachine = useMutation({
    mutationFn: ({ operationId, machineId }: { operationId: string; machineId: string }) =>
      apiPatch(`/work-orders/${id}/operations/${operationId}`, { machineId: machineId || null }),
    onSuccess: invalidate,
    onError,
  });
  const save = useMutation({
    mutationFn: () => {
      const wo = query.data!;
      const payload: Record<string, unknown> = {
        priority: Number(form.priority),
        ...(form.machineId ? { machineId: form.machineId } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
      };
      if (wo.status === "PLANNED") {
        payload.quantity = Number(form.quantity);
        payload.dueDate = form.dueDate;
      }
      return apiPatch(`/work-orders/${id}`, payload);
    },
    onSuccess: () => {
      invalidate();
      setEditOpen(false);
    },
    onError: (e) =>
      setErr(e instanceof ApiError && e.status === 400 ? "Doğrulama hatası" : "Kaydedilemedi"),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/work-orders/${id}`),
    onSuccess: () => {
      invalidate();
      navigate("/work-orders");
    },
    onError,
  });
  const invalidateOps = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["/consumptions"] });
    qc.invalidateQueries({ queryKey: ["/finished-goods"] });
    qc.invalidateQueries({ queryKey: ["/materials"] });
    qc.invalidateQueries({ queryKey: ["/parts"] });
  };
  const addConsumption = useMutation({
    mutationFn: () =>
      apiPost("/consumptions", {
        workOrderId: id,
        itemType: consForm.itemType,
        itemId: consForm.itemId,
        type: consForm.type,
        quantity: Number(consForm.quantity),
        ...(consForm.binId ? { binId: consForm.binId } : {}),
      }),
    onSuccess: () => {
      invalidateOps();
      setConsForm({ itemType: "MATERIAL", itemId: "", type: "CONSUMED", quantity: "", binId: "" });
    },
    onError,
  });
  const removeConsumption = useMutation({
    mutationFn: (consId: string) => apiDelete(`/consumptions/${consId}`),
    onSuccess: invalidateOps,
    onError,
  });
  const addFinishedGoods = useMutation({
    mutationFn: () =>
      apiPost<{ totalProduced: number; completionSuggested: boolean }>("/finished-goods", {
        workOrderId: id,
        quantity: Number(fgQty),
        ...(fgBinId ? { binId: fgBinId } : {}),
      }),
    onSuccess: async (res) => {
      invalidateOps();
      setFgQty("");
      setFgBinId("");
      if (
        res.completionSuggested &&
        (await confirm(`Toplam üretilen (${res.totalProduced}) iş emri miktarına ulaştı. İş emri tamamlansın mı?`))
      ) {
        setStatus.mutate("COMPLETED");
      }
    },
    onError,
  });
  const invalidateMaterial = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["/production-material/work-orders", id] });
  };
  const releaseEngineering = useMutation({
    mutationFn: (definitionId: string) => {
      const def = definitions.data!.find((d) => d.id === definitionId)!;
      return apiPost(`/work-orders/${id}/release-engineering`, {
        plantId: def.plant.id,
        productionDefinitionId: definitionId,
      });
    },
    onSuccess: () => {
      invalidate();
      setReleaseDefinitionId("");
    },
    onError,
  });
  const reserveMaterial = useMutation({
    mutationFn: ({ requirementId, binId, quantity }: { requirementId: string; binId: string; quantity: number }) =>
      apiPost("/production-material/reservations", {
        requirementId,
        binId,
        quantity,
        idempotencyKey: `web-reserve-${requirementId}-${Date.now()}`,
      }),
    onSuccess: invalidateMaterial,
    onError,
  });
  const issueMaterial = useMutation({
    mutationFn: ({ requirementId, reservationId, quantity }: { requirementId: string; reservationId: string; quantity: number }) =>
      apiPost("/production-material/issue", {
        requirementId,
        reservationId,
        quantity,
        idempotencyKey: `web-issue-${reservationId}-${Date.now()}`,
      }),
    onSuccess: invalidateMaterial,
    onError,
  });
  const cancelReservation = useMutation({
    mutationFn: (reservationId: string) => apiPost(`/production-material/reservations/${reservationId}/cancel`, {}),
    onSuccess: invalidateMaterial,
    onError,
  });
  const materialTransaction = useMutation({
    mutationFn: ({ requirementId, type, quantity }: { requirementId: string; type: "consume" | "return" | "scrap"; quantity: number }) =>
      apiPost(`/production-material/${type}`, {
        requirementId,
        quantity,
        idempotencyKey: `web-${type}-${requirementId}-${Date.now()}`,
      }),
    onSuccess: invalidateMaterial,
    onError,
  });

  if (query.isLoading) return <p className="text-slate-500">Yükleniyor…</p>;
  if (query.error || !query.data) return <p className="text-red-600">İş emri alınamadı.</p>;
  const wo = query.data;

  function openEdit() {
    setForm({
      quantity: String(Number(wo.quantity)),
      dueDate: wo.dueDate.slice(0, 10),
      priority: String(wo.priority),
      machineId: wo.machine?.id ?? "",
      notes: wo.notes ?? "",
    });
    setErr(null);
    setEditOpen(true);
  }

  const terminal = wo.status === "COMPLETED" || wo.status === "CANCELLED";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="px-2" onClick={() => navigate("/work-orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">{wo.woNo}</h1>
          <StatusBadge map={WO_STATUS} status={wo.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canStatus &&
            NEXT[wo.status]?.map((t) => (
              <Button
                key={t.status}
                variant={t.danger ? "danger" : "primary"}
                disabled={setStatus.isPending}
                onClick={async () => {
                  if (!t.danger || (await confirm({ message: `${wo.woNo} iptal edilsin mi?`, danger: true })))
                    setStatus.mutate(t.status);
                }}
              >
                {t.label}
              </Button>
            ))}
          {canEdit && !terminal && (
            <Button variant="outline" onClick={openEdit}>
              <Pencil className="h-4 w-4" /> Düzenle
            </Button>
          )}
          {user?.role === "ADMIN" && (wo.status === "PLANNED" || wo.status === "CANCELLED") && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirm({ message: "İş emrini silmek istediğinize emin misiniz?", danger: true }))
                  remove.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" /> Sil
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card className="lg:col-span-2">
          <div className="text-xs uppercase text-slate-500">Parça</div>
          <div className="mt-1 font-medium">
            {wo.part.partNo} rev{wo.part.revision} — {wo.part.name}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Miktar</div>
          <div className="mt-1 font-medium">{fmtQty(wo.quantity)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Termin</div>
          <div className="mt-1 font-medium">{fmtDate(wo.dueDate)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Öncelik</div>
          <div className="mt-1 font-medium">{wo.priority}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Tezgah</div>
          <div className="mt-1 font-medium">{wo.machine?.name ?? "Atanmadı"}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500" title={oee.data?.note}>
            OEE (Kalite×Performans)
          </div>
          <div className="mt-1 font-medium">
            {oee.data?.oee != null ? `${(oee.data.oee * 100).toFixed(0)}%` : "Veri yok"}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Kalite: {oee.data?.quality != null ? `${(oee.data.quality * 100).toFixed(0)}%` : "—"} · Perf:{" "}
            {oee.data?.performance != null ? `${(oee.data.performance * 100).toFixed(0)}%` : "—"}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500" title={cost.data?.note}>
            Maliyet {cost.data?.dataQuality === "PARTIAL" || cost.data?.note ? "(eksik veri)" : ""}
          </div>
          <div className="mt-1 font-medium">{cost.data?.actual?.total != null ? cost.data.actual.total.toFixed(2) : cost.data ? cost.data.totalCost.toFixed(2) : "—"} {cost.data?.currency ?? ""}</div>
          <div className="mt-1 text-xs text-slate-400">
            Malzeme: {cost.data ? cost.data.materialCost.toFixed(2) : "—"} · Makine:{" "}
            {cost.data ? cost.data.machineCost.toFixed(2) : "—"} · İşçilik:{" "}
            {cost.data ? cost.data.laborCost.toFixed(2) : "—"}
          </div>
          {cost.data?.planned && <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Plan/fark ayrıntısı</summary><div className="mt-1">Plan: {cost.data.planned.total?.toFixed(2) ?? "Kullanılamıyor"} · Fark: {cost.data.variance?.total?.toFixed(2) ?? "Kullanılamıyor"} · İyi birim: {cost.data.unitCost?.toFixed(2) ?? "Kullanılamıyor"}{cost.data.issues?.length ? ` · ${cost.data.issues.map((issue) => issue.code).join(", ")}` : ""}</div></details>}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="text-xs uppercase text-slate-500">Kaynak Teklif</div>
          <div className="mt-1 font-medium">
            {wo.quoteLine ? (
              <>
                <Link
                  to={`/quotes/${wo.quoteLine.quote.id}`}
                  className="text-brand-700 hover:underline"
                >
                  {wo.quoteLine.quote.quoteNo}
                </Link>
                <span className="text-slate-500"> — {wo.quoteLine.quote.customer.name}</span>
              </>
            ) : (
              "Manuel oluşturuldu"
            )}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Notlar</div>
          <div className="mt-1 text-sm">{wo.notes || "—"}</div>
        </Card>
      </div>

      {wo.operations?.length ? (
        <section className="mt-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Rota Operasyonları</h2>
            <span className="text-sm text-slate-500">Revizyon {wo.recipeRevision ?? "—"} iş emrine sabitlendi</span>
          </div>
          <Table headers={["Sıra", "Operasyon", "Tezgah", "Durum", "WIP sağlam", "Hurda"]}>
            {wo.operations.map((operation) => (
              <tr key={operation.id}>
                <td className="px-4 py-3">{operation.seq}</td>
                <td className="px-4 py-3 font-medium">{operation.name}</td>
                <td className="px-4 py-3">
                  {canStatus && operation.status === "PENDING" ? (
                    <Select
                      value={operation.machine?.id ?? ""}
                      onChange={(e) => assignOperationMachine.mutate({ operationId: operation.id, machineId: e.target.value })}
                    >
                      <option value="">Atanmadı</option>
                      {machines.data?.filter((machine) => machine.isActive).map((machine) => (
                        <option key={machine.id} value={machine.id}>{machine.name}</option>
                      ))}
                    </Select>
                  ) : operation.machine?.name ?? "Atanmadı"}
                </td>
                <td className="px-4 py-3">{operation.status}</td>
                <td className="px-4 py-3">{fmtQty(operation.completedQty)}</td>
                <td className="px-4 py-3">{fmtQty(operation.scrapQty)}</td>
              </tr>
            ))}
          </Table>
        </section>
      ) : (
        <section className="mt-6">
          <p className="text-sm text-slate-500">
            Bu iş emrine henüz rota bağlanmadı. Operasyon/malzeme akışının çalışabilmesi için
            önce parçanın yayınlanmış bir üretim tanımıyla mühendislik yayını yapılmalıdır.
          </p>
          {canEdit && !terminal && (
            <Card className="mt-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-64 flex-1">
                  <Label htmlFor="releaseDef">Yayınlanmış üretim tanımı</Label>
                  <Select id="releaseDef" value={releaseDefinitionId} onChange={(e) => setReleaseDefinitionId(e.target.value)}>
                    <option value="">Seçin…</option>
                    {definitions.data
                      ?.filter((d) => d.status === "RELEASED")
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.plant.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <Button
                  disabled={!releaseDefinitionId || releaseEngineering.isPending}
                  onClick={() => releaseEngineering.mutate(releaseDefinitionId)}
                >
                  Mühendislik Yayınla
                </Button>
              </div>
              {definitions.data && !definitions.data.some((d) => d.status === "RELEASED") && (
                <p className="mt-2 text-xs text-amber-700">
                  Bu parça için yayınlanmış bir üretim tanımı yok — Üretim Tanımları sayfasından oluşturup yayınlayın.
                </p>
              )}
            </Card>
          )}
        </section>
      )}

      {routed && (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Malzeme Rezervasyon / Verme / Tüketim (kontrollü akış)</h2>
          <p className="mb-3 text-xs text-slate-500">
            Rotalı iş emirlerinde malzeme eski Tüketim ekranı yerine bu kontrollü rezerve→ver→tüket akışından yürür.
          </p>
          <Table headers={["Kalem", "Gerekli", "Rezerve", "Verilen", "Tüketilen/İade/Hurda", ""]}>
            {requirements.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Malzeme gereksinimi yok</td>
              </tr>
            )}
            {requirements.data?.map((r) => {
              const label = r.item ? (r.itemType === "MATERIAL" ? `${r.item.code} — ${r.item.name}` : `${r.item.partNo} — ${r.item.name}`) : r.itemId;
              const remainingToReserve = Number(r.requiredQty) - Number(r.reservedQty);
              const rf = reserveForm[r.id] ?? { binId: "", quantity: remainingToReserve > 0 ? String(remainingToReserve) : "" };
              const tf = txForm[r.id] ?? { type: "consume" as const, quantity: "" };
              return (
                <tr key={r.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{label}<div className="text-xs font-normal text-slate-400">{r.item?.unit}</div></td>
                  <td className="px-4 py-3">{fmtQty(r.requiredQty)}</td>
                  <td className="px-4 py-3">{fmtQty(r.reservedQty)}</td>
                  <td className="px-4 py-3">{fmtQty(r.issuedQty)}</td>
                  <td className="px-4 py-3">{fmtQty(r.consumedQty)} / {fmtQty(r.returnedQty)} / {fmtQty(r.scrappedQty)}</td>
                  <td className="px-4 py-3 space-y-2">
                    {canConsume && !terminal && remainingToReserve > 0.0001 && (
                      <div className="flex items-end gap-1">
                        <Select className="w-28" value={rf.binId} onChange={(e) => setReserveForm({ ...reserveForm, [r.id]: { ...rf, binId: e.target.value } })}>
                          <option value="">Raf…</option>
                          {bins.data?.map((b) => <option key={b.id} value={b.id}>{b.warehouse.name}/{b.code}</option>)}
                        </Select>
                        <Input className="w-20" type="number" step="any" min="0.001" value={rf.quantity} onChange={(e) => setReserveForm({ ...reserveForm, [r.id]: { ...rf, quantity: e.target.value } })} />
                        <Button
                          variant="outline"
                          disabled={!rf.binId || !(Number(rf.quantity) > 0) || reserveMaterial.isPending}
                          onClick={() => reserveMaterial.mutate({ requirementId: r.id, binId: rf.binId, quantity: Number(rf.quantity) })}
                        >
                          Rezerve
                        </Button>
                      </div>
                    )}
                    {r.reservations.map((res) => {
                      const remainingToIssue = Number(res.quantity) - Number(res.issuedQty);
                      return (
                        <div key={res.id} className="flex items-center gap-1 text-xs text-slate-600">
                          <span>{res.bin.code}: {fmtQty(res.quantity)} ({fmtQty(res.issuedQty)} verildi)</span>
                          {canConsume && !terminal && remainingToIssue > 0.0001 && (
                            <Button variant="ghost" className="px-2 py-0.5" onClick={() => issueMaterial.mutate({ requirementId: r.id, reservationId: res.id, quantity: remainingToIssue })} disabled={issueMaterial.isPending}>
                              Ver
                            </Button>
                          )}
                          {canConsume && !terminal && Number(res.issuedQty) === 0 && (
                            <Button variant="ghost" className="px-2 py-0.5 text-red-600" onClick={() => cancelReservation.mutate(res.id)} disabled={cancelReservation.isPending}>
                              İptal
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {canConsume && !terminal && Number(r.issuedQty) - Number(r.consumedQty) - Number(r.returnedQty) - Number(r.scrappedQty) > 0.0001 && (
                      <div className="flex items-end gap-1">
                        <Select className="w-24" value={tf.type} onChange={(e) => setTxForm({ ...txForm, [r.id]: { ...tf, type: e.target.value as typeof tf.type } })}>
                          <option value="consume">Tüket</option>
                          <option value="return">İade</option>
                          <option value="scrap">Hurda</option>
                        </Select>
                        <Input className="w-20" type="number" step="any" min="0.001" value={tf.quantity} onChange={(e) => setTxForm({ ...txForm, [r.id]: { ...tf, quantity: e.target.value } })} />
                        <Button
                          variant="outline"
                          disabled={!(Number(tf.quantity) > 0) || materialTransaction.isPending}
                          onClick={() => materialTransaction.mutate({ requirementId: r.id, type: tf.type, quantity: Number(tf.quantity) })}
                        >
                          Uygula
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </section>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">{routed ? "Eski Tüketim Kaydı (rotasız dönem)" : "Malzeme Rezervasyon / Tüketim"}</h2>
          {!routed && canConsume && !terminal && (
            <Card className="mb-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-32">
                  <Label htmlFor="consItemType">Kalem Tipi</Label>
                  <Select
                    id="consItemType"
                    value={consForm.itemType}
                    onChange={(e) =>
                      setConsForm({ ...consForm, itemType: e.target.value as "MATERIAL" | "PART", itemId: "" })
                    }
                  >
                    <option value="MATERIAL">Malzeme</option>
                    <option value="PART">Parça (alt montaj)</option>
                  </Select>
                </div>
                <div className="min-w-52 flex-1">
                  <Label htmlFor="consMat">Kalem</Label>
                  <Select
                    id="consMat"
                    value={consForm.itemId}
                    onChange={(e) => setConsForm({ ...consForm, itemId: e.target.value })}
                  >
                    <option value="">Seçin…</option>
                    {consForm.itemType === "MATERIAL"
                      ? materials.data?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} — {m.name} (stok {fmtQty(m.stockQty)} {m.unit})
                          </option>
                        ))
                      : parts.data?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.partNo} — {p.name}
                          </option>
                        ))}
                  </Select>
                </div>
                <div className="w-32">
                  <Label htmlFor="consType">Tür</Label>
                  <Select
                    id="consType"
                    value={consForm.type}
                    onChange={(e) => setConsForm({ ...consForm, type: e.target.value })}
                  >
                    <option value="RESERVED">Rezervasyon</option>
                    <option value="CONSUMED">Tüketim</option>
                  </Select>
                </div>
                <div className="w-28">
                  <Label htmlFor="consQty">Miktar</Label>
                  <Input
                    id="consQty"
                    type="number"
                    step="any"
                    min="0.001"
                    value={consForm.quantity}
                    onChange={(e) => setConsForm({ ...consForm, quantity: e.target.value })}
                  />
                </div>
                <div className="min-w-40 flex-1">
                  <Label htmlFor="consBin">Kaynak raf</Label>
                  <Select id="consBin" value={consForm.binId} onChange={(e) => setConsForm({ ...consForm, binId: e.target.value })}>
                    <option value="">Atanmamış stok</option>
                    {bins.data?.map((b) => <option key={b.id} value={b.id}>{b.warehouse.name} / {b.code}</option>)}
                  </Select>
                </div>
                <Button
                  disabled={
                    !consForm.itemId || !(Number(consForm.quantity) > 0) || addConsumption.isPending
                  }
                  onClick={() => addConsumption.mutate()}
                >
                  Ekle
                </Button>
              </div>
            </Card>
          )}
          <Table headers={["Kalem", "Tür", "Miktar", "Tarih", "Kaydeden", ""]}>
            {consumptions.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Kayıt yok
                </td>
              </tr>
            )}
            {consumptions.data?.map((c) => {
              const item =
                c.itemType === "MATERIAL"
                  ? materials.data?.find((m) => m.id === c.itemId)
                  : parts.data?.find((p) => p.id === c.itemId);
              const itemLabel = item
                ? c.itemType === "MATERIAL"
                  ? `${(item as MaterialOption).code} — ${item.name}`
                  : `${(item as PartOption).partNo} — ${item.name}`
                : c.itemId;
              const unit = c.itemType === "MATERIAL" ? (item as MaterialOption | undefined)?.unit ?? "" : "";
              return (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">{itemLabel}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      c.type === "CONSUMED"
                        ? "inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
                        : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                    }
                  >
                    {c.type === "CONSUMED" ? "Tüketim" : "Rezervasyon"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {fmtQty(c.quantity)} {unit}
                </td>
                <td className="px-4 py-3">{fmtDate(c.date)}</td>
                <td className="px-4 py-3">{c.createdBy.name}</td>
                <td className="px-4 py-3">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-red-600"
                      title="Sil (tüketim geri alınır)"
                      onClick={async () => {
                        if (
                          await confirm({ message: "Kayıt silinsin mi? Tüketimse stok iade edilir.", danger: true })
                        )
                          removeConsumption.mutate(c.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
              );
            })}
          </Table>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Mamul Girişleri</h2>
          {canConsume && !terminal && (
            <Card className="mb-3">
              <div className="flex items-end gap-2">
                <div className="w-36">
                  <Label htmlFor="fgQty">Miktar</Label>
                  <Input
                    id="fgQty"
                    type="number"
                    step="any"
                    min="0.001"
                    value={fgQty}
                    onChange={(e) => setFgQty(e.target.value)}
                  />
                </div>
                <div className="min-w-40 flex-1">
                  <Label htmlFor="fgBin">Hedef raf</Label>
                  <Select id="fgBin" value={fgBinId} onChange={(e) => setFgBinId(e.target.value)}>
                    <option value="">Atanmamış stok</option>
                    {bins.data?.map((b) => <option key={b.id} value={b.id}>{b.warehouse.name} / {b.code}</option>)}
                  </Select>
                </div>
                <Button
                  disabled={!(Number(fgQty) > 0) || addFinishedGoods.isPending}
                  onClick={() => addFinishedGoods.mutate()}
                >
                  Mamul Girişi Yap
                </Button>
                <div className="ml-auto text-sm text-slate-500">
                  Toplam üretilen:{" "}
                  <span className="font-semibold text-slate-900">
                    {fmtQty(
                      finishedGoods.data?.reduce((s, f) => s + Number(f.quantity), 0) ?? 0,
                    )}{" "}
                    / {fmtQty(wo.quantity)}
                  </span>
                </div>
              </div>
            </Card>
          )}
          <Table headers={["Miktar", "Tarih", "Kaydeden"]}>
            {finishedGoods.data?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  Mamul girişi yok
                </td>
              </tr>
            )}
            {finishedGoods.data?.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">{fmtQty(f.quantity)}</td>
                <td className="px-4 py-3">{fmtDate(f.date)}</td>
                <td className="px-4 py-3">{f.createdBy.name}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      <div className="mt-6">
        <DocumentsPanel entityType="work-order" entityId={id} />
      </div>

      <Modal open={editOpen} title="İş Emri Düzenle" onClose={() => setEditOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          {wo.status === "PLANNED" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="qty">Miktar</Label>
                <Input
                  id="qty"
                  type="number"
                  step="any"
                  min="0.001"
                  required
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="due">Termin</Label>
                <Input
                  id="due"
                  type="date"
                  required
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="prio">Öncelik (1-10)</Label>
            <Input
              id="prio"
              type="number"
              min="1"
              max="10"
              required
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="machine">Tezgah</Label>
            <Select
              id="machine"
              value={form.machineId}
              onChange={(e) => setForm({ ...form, machineId: e.target.value })}
            >
              <option value="">Atanmadı</option>
              {machines.data
                ?.filter((m) => m.isActive)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Notlar</Label>
            <Input
              id="notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
