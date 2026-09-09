import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { StatusBadge, WO_STATUS } from "../components/status";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";

interface PartOption {
  id: string;
  partNo: string;
  revision: string;
  name: string;
}
interface MachineOption {
  id: string;
  name: string;
  isActive: boolean;
}
export interface WorkOrderRow {
  id: string;
  woNo: string;
  quantity: string;
  dueDate: string;
  priority: number;
  status: string;
  notes?: string | null;
  part: PartOption;
  machine?: { id: string; name: string } | null;
  recipeRevision?: string | null;
  routeSnapshotAt?: string | null;
  operations?: {
    id: string;
    seq: number;
    name: string;
    status: string;
    completedQty: string;
    scrapQty: string;
    machine?: { id: string; name: string } | null;
  }[];
  quoteLine?: {
    id: string;
    quote: { id: string; quoteNo: string; customer: { id: string; name: string } };
  } | null;
}

export function WorkOrdersPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    partId: "",
    quantity: "",
    dueDate: "",
    priority: "5",
    machineId: "",
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);

  useInvalidateOn(["workorder.updated"], ["/work-orders"]);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const query = useQuery({
    queryKey: ["/work-orders", q, status],
    queryFn: () => apiGet<WorkOrderRow[]>(`/work-orders?${params.toString()}`),
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
    enabled: open,
  });
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<WorkOrderRow>("/work-orders", {
        partId: form.partId,
        quantity: Number(form.quantity),
        dueDate: form.dueDate,
        priority: Number(form.priority),
        ...(form.machineId ? { machineId: form.machineId } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["/work-orders"] });
      setOpen(false);
      navigate(`/work-orders/${created.id}`);
    },
    onError: (e) =>
      setErr(
        e instanceof ApiError && e.status === 400 ? "Doğrulama hatası" : "Kaydedilemedi",
      ),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">İş Emirleri</h1>
        {canWrite && (
          <Button
            onClick={() => {
              setForm({ partId: "", quantity: "", dueDate: "", priority: "5", machineId: "", notes: "" });
              setErr(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Yeni İş Emri
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="İş emri no veya parça ara…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-48">
          <option value="">Tüm Durumlar</option>
          {Object.entries(WO_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Liste alınamadı.</p>}

      {query.data && (
        <Table headers={["İş Emri", "Parça", "Miktar", "Termin", "Öncelik", "Durum", "Tezgah", "Teklif"]}>
          {query.data.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                Kayıt yok
              </td>
            </tr>
          )}
          {query.data.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => navigate(`/work-orders/${row.id}`)}
            >
              <td className="px-4 py-3 font-medium text-brand-700">{row.woNo}</td>
              <td className="px-4 py-3">
                {row.part.partNo} — {row.part.name}
              </td>
              <td className="px-4 py-3">{fmtQty(row.quantity)}</td>
              <td className="px-4 py-3">{fmtDate(row.dueDate)}</td>
              <td className="px-4 py-3">{row.priority}</td>
              <td className="px-4 py-3">
                <StatusBadge map={WO_STATUS} status={row.status} />
              </td>
              <td className="px-4 py-3">{row.machine?.name ?? "—"}</td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                {row.quoteLine ? (
                  <Link
                    to={`/quotes/${row.quoteLine.quote.id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {row.quoteLine.quote.quoteNo}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={open} title="Yeni İş Emri" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="part">Parça</Label>
            <Select
              id="part"
              required
              value={form.partId}
              onChange={(e) => setForm({ ...form, partId: e.target.value })}
            >
              <option value="">Seçin…</option>
              {parts.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNo} rev{p.revision} — {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
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
          </div>
          <div>
            <Label htmlFor="machine">Tezgah (opsiyonel)</Label>
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
