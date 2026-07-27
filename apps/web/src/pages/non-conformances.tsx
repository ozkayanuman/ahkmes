import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";

interface WorkOrderOption {
  id: string;
  woNo: string;
  status: string;
}

interface NcRow {
  id: string;
  workOrder: { id: string; woNo: string };
  reportedBy: { id: string; name: string };
  failureType: string;
  description?: string | null;
  actionType: "GENERIC" | "SCRAP" | "REWORK" | "BLOCKING";
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  resolvedAt?: string | null;
}

interface NcFormState {
  workOrderId: string;
  failureType: string;
  description: string;
  actionType: "GENERIC" | "SCRAP" | "REWORK" | "BLOCKING";
}

const ACTION_LABEL: Record<NcRow["actionType"], string> = {
  GENERIC: "Genel",
  SCRAP: "Hurda",
  REWORK: "Yeniden İşlem",
  BLOCKING: "Bloke",
};

function NewNcModal({ workOrders, onClose }: { workOrders: WorkOrderOption[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<NcFormState>({
    workOrderId: "",
    failureType: "",
    description: "",
    actionType: "GENERIC",
  });

  const create = useMutation({
    mutationFn: () => apiPost("/non-conformances", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/non-conformances"] });
      onClose();
    },
    onError: () => alert("Kaydedilemedi"),
  });

  return (
    <Modal open title="Yeni Uygunsuzluk Kaydı" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="wo">İş Emri</Label>
          <Select
            id="wo"
            value={form.workOrderId}
            onChange={(e) => setForm((f) => ({ ...f, workOrderId: e.target.value }))}
          >
            <option value="">Seçiniz</option>
            {workOrders.map((wo) => (
              <option key={wo.id} value={wo.id}>
                {wo.woNo}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="failureType">Hata Tipi</Label>
          <Input
            id="failureType"
            value={form.failureType}
            onChange={(e) => setForm((f) => ({ ...f, failureType: e.target.value }))}
            placeholder="Örn: Yüzey çizik, boyut hatası"
          />
        </div>
        <div>
          <Label htmlFor="description">Açıklama</Label>
          <Input
            id="description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="actionType">Aksiyon Tipi</Label>
          <Select
            id="actionType"
            value={form.actionType}
            onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value as NcFormState["actionType"] }))}
          >
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            disabled={create.isPending || !form.workOrderId || !form.failureType}
            onClick={() => create.mutate()}
          >
            Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function NonConformancesPage() {
  const { user } = useAuth();
  const canManage = !!user && ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"].includes(user.role);
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  useInvalidateOn(["nonconformance.updated"], ["/non-conformances"]);

  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
  });

  const ncs = useQuery({
    queryKey: ["/non-conformances"],
    queryFn: () => apiGet<NcRow[]>("/non-conformances"),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => apiPatch(`/non-conformances/${id}/resolve`, { status: "RESOLVED" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/non-conformances"] }),
    onError: () => alert("Kapatılamadı"),
  });

  const openCount = (ncs.data ?? []).filter((nc) => nc.status === "OPEN").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Kalite — Uygunsuzluk Kayıtları</h1>
          <p className="text-sm text-slate-500">{openCount} açık kayıt</p>
        </div>
        {canManage && (
          <Button onClick={() => setShowNew(true)}>
            <Plus className="mr-1 h-4 w-4" /> Yeni Kayıt
          </Button>
        )}
      </div>

      <Table headers={["İş Emri", "Hata Tipi", "Aksiyon", "Durum", "Bildiren", "Tarih", "İşlem"]}>
        {(ncs.data ?? []).map((nc) => (
          <tr key={nc.id}>
            <td className="px-4 py-3 font-medium">{nc.workOrder.woNo}</td>
            <td className="px-4 py-3">{nc.failureType}</td>
            <td className="px-4 py-3">{ACTION_LABEL[nc.actionType]}</td>
            <td className="px-4 py-3">
              <span
                className={
                  nc.status === "OPEN"
                    ? "inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700"
                    : "inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500"
                }
              >
                {nc.status === "OPEN" ? "Açık" : "Kapalı"}
              </span>
            </td>
            <td className="px-4 py-3 text-xs text-slate-500">{nc.reportedBy.name}</td>
            <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(nc.createdAt)}</td>
            <td className="px-4 py-3">
              {canManage && nc.status === "OPEN" && (
                <Button
                  variant="ghost"
                  className="px-2 py-1"
                  title="Kapat"
                  onClick={() => resolve.mutate(nc.id)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
              )}
            </td>
          </tr>
        ))}
        {ncs.data?.length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
              Kayıt yok.
            </td>
          </tr>
        )}
      </Table>

      {showNew && <NewNcModal workOrders={workOrders.data ?? []} onClose={() => setShowNew(false)} />}
    </div>
  );
}
