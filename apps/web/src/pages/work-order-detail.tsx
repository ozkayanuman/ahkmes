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
interface ConsumptionRow {
  id: string;
  type: "RESERVED" | "CONSUMED";
  quantity: string;
  date: string;
  material: MaterialOption;
  createdBy: { name: string };
}
interface FinishedGoodsRow {
  id: string;
  quantity: string;
  date: string;
  createdBy: { name: string };
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
  const [consForm, setConsForm] = useState({ materialId: "", type: "CONSUMED", quantity: "" });
  const [fgQty, setFgQty] = useState("");

  useInvalidateOn(
    ["workorder.updated", "stock.updated", "productionrun.updated"],
    ["/work-orders", "/consumptions", "/finished-goods", "/materials"],
  );

  const query = useQuery({
    queryKey: ["/work-orders", id],
    queryFn: () => apiGet<WorkOrderRow>(`/work-orders/${id}`),
  });
  const oee = useQuery({
    queryKey: ["/work-orders", id, "oee"],
    queryFn: () =>
      apiGet<{ quality: number | null; performance: number | null; oee: number | null; note: string }>(
        `/work-orders/${id}/oee`,
      ),
  });
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
    enabled: editOpen,
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/work-orders"] });
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      const msg = (e.body as { message?: string } | null)?.message;
      alert(msg ?? "İşlem çakışması (409)");
    } else alert("İşlem başarısız.");
  };

  const setStatus = useMutation({
    mutationFn: (status: string) => apiPatch(`/work-orders/${id}/status`, { status }),
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
  };
  const addConsumption = useMutation({
    mutationFn: () =>
      apiPost("/consumptions", {
        workOrderId: id,
        materialId: consForm.materialId,
        type: consForm.type,
        quantity: Number(consForm.quantity),
      }),
    onSuccess: () => {
      invalidateOps();
      setConsForm({ materialId: "", type: "CONSUMED", quantity: "" });
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
      }),
    onSuccess: (res) => {
      invalidateOps();
      setFgQty("");
      if (
        res.completionSuggested &&
        confirm(
          `Toplam üretilen (${res.totalProduced}) iş emri miktarına ulaştı. İş emri tamamlansın mı?`,
        )
      ) {
        setStatus.mutate("COMPLETED");
      }
    },
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
                onClick={() => {
                  if (!t.danger || confirm(`${wo.woNo} iptal edilsin mi?`))
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
              onClick={() => {
                if (confirm("İş emrini silmek istediğinize emin misiniz?")) remove.mutate();
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

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Malzeme Rezervasyon / Tüketim</h2>
          {canConsume && !terminal && (
            <Card className="mb-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-52 flex-1">
                  <Label htmlFor="consMat">Malzeme</Label>
                  <Select
                    id="consMat"
                    value={consForm.materialId}
                    onChange={(e) => setConsForm({ ...consForm, materialId: e.target.value })}
                  >
                    <option value="">Seçin…</option>
                    {materials.data?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.name} (stok {fmtQty(m.stockQty)} {m.unit})
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
                <Button
                  disabled={
                    !consForm.materialId || !(Number(consForm.quantity) > 0) || addConsumption.isPending
                  }
                  onClick={() => addConsumption.mutate()}
                >
                  Ekle
                </Button>
              </div>
            </Card>
          )}
          <Table headers={["Malzeme", "Tür", "Miktar", "Tarih", "Kaydeden", ""]}>
            {consumptions.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Kayıt yok
                </td>
              </tr>
            )}
            {consumptions.data?.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  {c.material.code} — {c.material.name}
                </td>
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
                  {fmtQty(c.quantity)} {c.material.unit}
                </td>
                <td className="px-4 py-3">{fmtDate(c.date)}</td>
                <td className="px-4 py-3">{c.createdBy.name}</td>
                <td className="px-4 py-3">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-red-600"
                      title="Sil (tüketim geri alınır)"
                      onClick={() => {
                        if (confirm("Kayıt silinsin mi? Tüketimse stok iade edilir."))
                          removeConsumption.mutate(c.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
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
