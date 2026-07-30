import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Play, Plus, Radar, XCircle } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

type MoStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
const STATUS_LABEL: Record<MoStatus, { label: string; cls: string }> = {
  PLANNED: { label: "Planlandı", cls: "bg-slate-100 text-slate-700" },
  IN_PROGRESS: { label: "Devam Ediyor", cls: "bg-blue-100 text-blue-700" },
  COMPLETED: { label: "Tamamlandı", cls: "bg-green-100 text-green-700" },
  CANCELLED: { label: "İptal", cls: "bg-red-100 text-red-700" },
};

interface MachineOption {
  id: string;
  name: string;
}
interface MaintenanceOrderRow {
  id: string;
  bakNo: string;
  type: "PREVENTIVE" | "CORRECTIVE";
  scheduledDate: string;
  status: MoStatus;
  machine: { id: string; name: string };
  createdAt: string;
}

export function MaintenanceOrdersPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [machineId, setMachineId] = useState("");
  const [type, setType] = useState<"PREVENTIVE" | "CORRECTIVE">("PREVENTIVE");
  const [scheduledDate, setScheduledDate] = useState("");
  const [notes, setNotes] = useState("");

  useInvalidateOn(["maintenanceorder.updated"], ["/maintenance-orders"]);

  const query = useQuery({
    queryKey: ["/maintenance-orders"],
    queryFn: () => apiGet<MaintenanceOrderRow[]>("/maintenance-orders"),
  });
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
    enabled: open,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/maintenance-orders"] });
  const onError = (fallback: string) => (e: unknown) => {
    const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
    toast(msg ?? fallback, "error");
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost("/maintenance-orders", { machineId, type, scheduledDate, ...(notes ? { notes } : {}) }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setNotes("");
    },
    onError: onError("Bakım emri oluşturulamadı"),
  });
  const start = useMutation({
    mutationFn: (id: string) => apiPatch(`/maintenance-orders/${id}/start`, {}),
    onSuccess: invalidate,
    onError: onError("Başlatılamadı"),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => apiPatch(`/maintenance-orders/${id}/cancel`, {}),
    onSuccess: invalidate,
    onError: onError("İptal edilemedi"),
  });
  const complete = useMutation({
    mutationFn: (id: string) => apiPatch(`/maintenance-orders/${id}/complete`, {}),
    onSuccess: invalidate,
    onError: onError("Tamamlanamadı"),
  });
  const predictiveCheck = useMutation({
    mutationFn: () =>
      apiPost<{ checked: number; due: number; created: number }>("/maintenance-orders/predictive-check", {}),
    onSuccess: (res) => {
      invalidate();
      toast(
        res.created > 0
          ? `${res.due} makine eşiği aştı, ${res.created} yeni bakım emri oluşturuldu.`
          : `${res.checked} makine kontrol edildi, eşiği aşan yok.`,
        "success",
      );
    },
    onError: onError("Kontrol çalıştırılamadı"),
  });

  function openCreate() {
    setMachineId("");
    setType("PREVENTIVE");
    setScheduledDate("");
    setNotes("");
    setOpen(true);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Bakım Emirleri</h1>
        <div className="flex gap-2">
          {canWrite && (
            <Button
              variant="outline"
              disabled={predictiveCheck.isPending}
              onClick={() => predictiveCheck.mutate()}
            >
              <Radar className="h-4 w-4" /> Öngörülü Bakım Kontrolü
            </Button>
          )}
          {canWrite && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Yeni Bakım Emri
            </Button>
          )}
        </div>
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["No", "Makine", "Tip", "Planlanan Tarih", "Durum", "İşlem"]}>
        {(query.data ?? []).length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(query.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.bakNo}</td>
            <td className="px-4 py-3">{row.machine.name}</td>
            <td className="px-4 py-3">{row.type === "PREVENTIVE" ? "Önleyici (PM)" : "Düzeltici (CM)"}</td>
            <td className="px-4 py-3">{fmtDate(row.scheduledDate)}</td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_LABEL[row.status].cls}`}
              >
                {STATUS_LABEL[row.status].label}
              </span>
            </td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-1">
                {canWrite && row.status === "PLANNED" && (
                  <>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => start.mutate(row.id)}>
                      <Play className="h-4 w-4" /> Başlat
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-red-600"
                      onClick={() => cancel.mutate(row.id)}
                    >
                      <XCircle className="h-4 w-4" /> İptal
                    </Button>
                  </>
                )}
                {canWrite && row.status === "IN_PROGRESS" && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => complete.mutate(row.id)}>
                    <CheckCircle2 className="h-4 w-4" /> Tamamla
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni Bakım Emri" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="machineId">Makine</Label>
            <Select id="machineId" required value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">Seçin…</option>
              {machines.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="type">Tip</Label>
            <Select id="type" value={type} onChange={(e) => setType(e.target.value as "PREVENTIVE" | "CORRECTIVE")}>
              <option value="PREVENTIVE">Önleyici (PM)</option>
              <option value="CORRECTIVE">Düzeltici (CM)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="scheduledDate">Planlanan Tarih</Label>
            <Input
              id="scheduledDate"
              type="date"
              required
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="notes">Notlar</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
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
