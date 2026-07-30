import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface MachineOption {
  id: string;
  name: string;
}
interface CalibrationRow {
  id: string;
  kalNo: string;
  calibratedAt: string;
  nextDueDate: string;
  machine: { id: string; name: string };
  performedBy: { id: string; name: string };
}

export function CalibrationsPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [machineId, setMachineId] = useState("");
  const [calibratedAt, setCalibratedAt] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const calibrations = useQuery({
    queryKey: ["/calibrations"],
    queryFn: () => apiGet<CalibrationRow[]>("/calibrations"),
  });
  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
    enabled: open,
  });

  const today = new Date().toISOString().slice(0, 10);

  const create = useMutation({
    mutationFn: () =>
      apiPost("/calibrations", { machineId, calibratedAt, nextDueDate, ...(notes ? { notes } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/calibrations"] });
      setOpen(false);
      setNotes("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Kalibrasyon kaydedilemedi", "error");
    },
  });

  function openCreate() {
    setMachineId("");
    setCalibratedAt(today);
    setNextDueDate("");
    setNotes("");
    setOpen(true);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Kalibrasyon Kayıtları</h1>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Yeni Kalibrasyon
          </Button>
        )}
      </div>

      {calibrations.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["No", "Makine", "Kalibrasyon Tarihi", "Sonraki Vade", "Yapan", "Durum"]}>
        {(calibrations.data ?? []).length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(calibrations.data ?? []).map((row) => {
          const overdue = new Date(row.nextDueDate) < new Date();
          return (
            <tr key={row.id}>
              <td className="px-4 py-3 font-medium">{row.kalNo}</td>
              <td className="px-4 py-3">{row.machine.name}</td>
              <td className="px-4 py-3">{fmtDate(row.calibratedAt)}</td>
              <td className="px-4 py-3">{fmtDate(row.nextDueDate)}</td>
              <td className="px-4 py-3">{row.performedBy.name}</td>
              <td className="px-4 py-3">
                {overdue ? (
                  <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                    Vadesi Geçti
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                    Güncel
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </Table>

      <Modal open={open} title="Yeni Kalibrasyon" onClose={() => setOpen(false)}>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="calibratedAt">Kalibrasyon Tarihi</Label>
              <Input
                id="calibratedAt"
                type="date"
                required
                value={calibratedAt}
                onChange={(e) => setCalibratedAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="nextDueDate">Sonraki Vade</Label>
              <Input
                id="nextDueDate"
                type="date"
                required
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
              />
            </div>
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
