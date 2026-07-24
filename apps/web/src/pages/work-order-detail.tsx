import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { StatusBadge, WO_STATUS } from "../components/status";
import { Button, Card, Input, Label, Modal, Select } from "../components/ui";
import type { WorkOrderRow } from "./work-orders";

interface MachineOption {
  id: string;
  name: string;
  isActive: boolean;
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

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    quantity: "",
    dueDate: "",
    priority: "5",
    machineId: "",
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);

  useInvalidateOn(["workorder.updated"], ["/work-orders"]);

  const query = useQuery({
    queryKey: ["/work-orders", id],
    queryFn: () => apiGet<WorkOrderRow>(`/work-orders/${id}`),
  });
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
    enabled: editOpen,
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
