import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

interface WorkOrderOption {
  id: string;
  woNo: string;
}
interface InspectionRow {
  id: string;
  insNo: string;
  checkpointName: string;
  result: "PASS" | "FAIL";
  inspectedAt: string;
  workOrder: { id: string; woNo: string };
  inspectedBy: { id: string; name: string };
  nonConformance: { id: string; failureType: string } | null;
}

export function InspectionsPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [workOrderId, setWorkOrderId] = useState("");
  const [checkpointName, setCheckpointName] = useState("");
  const [result, setResult] = useState<"PASS" | "FAIL">("PASS");
  const [notes, setNotes] = useState("");

  const inspections = useQuery({
    queryKey: ["/inspections"],
    queryFn: () => apiGet<InspectionRow[]>("/inspections"),
  });
  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => apiPost("/inspections", { workOrderId, checkpointName, result, ...(notes ? { notes } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/inspections"] });
      qc.invalidateQueries({ queryKey: ["/non-conformances"] });
      setOpen(false);
      setCheckpointName("");
      setNotes("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Muayene kaydedilemedi", "error");
    },
  });

  function openCreate() {
    setWorkOrderId("");
    setCheckpointName("");
    setResult("PASS");
    setNotes("");
    setOpen(true);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Muayene / Kontrol Kayıtları</h1>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Yeni Muayene
          </Button>
        )}
      </div>

      {inspections.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["No", "İş Emri", "Kontrol Noktası", "Sonuç", "Uygunsuzluk", "Muayene Eden", "Tarih"]}>
        {(inspections.data ?? []).length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(inspections.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.insNo}</td>
            <td className="px-4 py-3">{row.workOrder.woNo}</td>
            <td className="px-4 py-3">{row.checkpointName}</td>
            <td className="px-4 py-3">
              <span
                className={
                  row.result === "PASS"
                    ? "inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700"
                    : "inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700"
                }
              >
                {row.result === "PASS" ? "Uygun" : "Uygun Değil"}
              </span>
            </td>
            <td className="px-4 py-3">
              {row.nonConformance ? (
                <Link to="/non-conformances" className="text-brand-700 hover:underline">
                  {row.nonConformance.failureType}
                </Link>
              ) : (
                "—"
              )}
            </td>
            <td className="px-4 py-3">{row.inspectedBy.name}</td>
            <td className="px-4 py-3">{fmtDate(row.inspectedAt)}</td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni Muayene" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="workOrder">İş Emri</Label>
            <Select id="workOrder" required value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
              <option value="">Seçin…</option>
              {workOrders.data?.map((wo) => (
                <option key={wo.id} value={wo.id}>
                  {wo.woNo}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="checkpointName">Kontrol Noktası</Label>
            <Input
              id="checkpointName"
              required
              placeholder="Örn: İlk Parça Kontrolü"
              value={checkpointName}
              onChange={(e) => setCheckpointName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="result">Sonuç</Label>
            <Select id="result" value={result} onChange={(e) => setResult(e.target.value as "PASS" | "FAIL")}>
              <option value="PASS">Uygun</option>
              <option value="FAIL">Uygun Değil</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Notlar</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {result === "FAIL" && (
            <p className="text-sm text-amber-600">
              "Uygun Değil" seçilirse otomatik olarak bir uygunsuzluk (NonConformance) kaydı oluşturulacak.
            </p>
          )}
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
