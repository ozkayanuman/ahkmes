import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Input, Label, Modal, Select, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { ReauthModal } from "../components/reauth-modal";

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
  actionType: "GENERIC" | "SCRAP" | "REWORK" | "BLOCKING" | "DEVIATION";
  status: "OPEN" | "RESOLVED" | "PENDING_DEVIATION_APPROVAL";
  createdAt: string;
  resolvedAt?: string | null;
  resolvedBy?: { id: string; name: string } | null;
  resolutionNote?: string | null;
}

interface NcFormState {
  workOrderId: string;
  failureType: string;
  description: string;
  actionType: NcRow["actionType"];
}

const ACTION_LABEL: Record<NcRow["actionType"], string> = {
  GENERIC: "Genel",
  SCRAP: "Hurda",
  REWORK: "Yeniden İşlem",
  BLOCKING: "Bloke",
  DEVIATION: "Deviation (olduğu gibi kabul)",
};

const STATUS_LABEL: Record<NcRow["status"], { label: string; cls: string }> = {
  OPEN: { label: "Açık", cls: "bg-red-100 text-red-700" },
  PENDING_DEVIATION_APPROVAL: { label: "Deviation Onayı Bekliyor", cls: "bg-amber-100 text-amber-700" },
  RESOLVED: { label: "Kapalı", cls: "bg-slate-100 text-slate-500" },
};

function NewNcModal({ workOrders, onClose }: { workOrders: WorkOrderOption[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
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
    onError: () => toast("Kaydedilemedi", "error"),
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

/** Kaydı kapatmak tek tıkla olmaz — ne yapıldığının (hurda/yeniden işlem/kabul vb.)
 * yazılı gerekçesi zorunludur (bkz. backend RESOLUTION_NOTE_REQUIRED). */
function ResolveNcModal({
  nc,
  onClose,
  onResolved,
}: {
  nc: NcRow;
  onClose: () => void;
  onResolved: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");

  const resolve = useMutation({
    mutationFn: () => apiPatch(`/non-conformances/${nc.id}/resolve`, { status: "RESOLVED", resolutionNote: note }),
    onSuccess: () => {
      onResolved();
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Kapatılamadı", "error");
    },
  });

  return (
    <Modal open title={`${nc.workOrder.woNo} — Kaydı Kapat`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <div className="font-medium text-slate-700">{nc.failureType}</div>
          {nc.description && <div className="mt-1 text-slate-500">{nc.description}</div>}
          <div className="mt-1 text-xs text-slate-400">Aksiyon Tipi: {ACTION_LABEL[nc.actionType]}</div>
        </div>
        <div>
          <Label htmlFor="resolutionNote">Çözüm Açıklaması (zorunlu)</Label>
          <Textarea
            id="resolutionNote"
            rows={4}
            placeholder="Ne yapıldı? Örn: 8 adet hurdaya ayrıldı, kalan 12 adet yeniden işlenip kabul edildi."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={!note.trim() || resolve.isPending} onClick={() => resolve.mutate()}>
            <CheckCircle2 className="h-4 w-4" /> Kaydı Kapat
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function NcDetailModal({ nc, onClose }: { nc: NcRow; onClose: () => void }) {
  return (
    <Modal open title={`${nc.workOrder.woNo} — Kayıt Detayı`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs uppercase text-slate-400">Hata Tipi</div>
          <div className="font-medium text-slate-700">{nc.failureType}</div>
        </div>
        {nc.description && (
          <div>
            <div className="text-xs uppercase text-slate-400">Açıklama</div>
            <div className="text-slate-600">{nc.description}</div>
          </div>
        )}
        <div>
          <div className="text-xs uppercase text-slate-400">Bildiren</div>
          <div className="text-slate-600">
            {nc.reportedBy.name} · {fmtDate(nc.createdAt)}
          </div>
        </div>
        {nc.status === "RESOLVED" && (
          <div className="rounded-md bg-green-50 p-3">
            <div className="text-xs uppercase text-green-700">Çözüm Açıklaması</div>
            <div className="mt-1 text-slate-700">{nc.resolutionNote}</div>
            <div className="mt-2 text-xs text-slate-500">
              {nc.resolvedBy?.name ?? "—"} · {nc.resolvedAt ? fmtDate(nc.resolvedAt) : "—"}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function NonConformancesPage() {
  const { user } = useAuth();
  const canManage = !!user && ["ADMIN", "PLANNER", "FOREMAN", "OPERATOR"].includes(user.role);
  const canDecideDeviation = !!user && user.role === "ADMIN";
  const qc = useQueryClient();
  const toast = useToast();
  const [showNew, setShowNew] = useState(false);
  const [resolvingNc, setResolvingNc] = useState<NcRow | null>(null);
  const [viewingNc, setViewingNc] = useState<NcRow | null>(null);
  const [pendingDeviationDecision, setPendingDeviationDecision] = useState<{ id: string; action: "approve" | "reject" } | null>(null);

  useInvalidateOn(["nonconformance.updated"], ["/non-conformances"]);

  const onError = (fallback: string) => (e: unknown) => {
    const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
    toast(msg ?? fallback, "error");
  };
  const requestDeviation = useMutation({
    mutationFn: (id: string) => apiPatch(`/non-conformances/${id}/request-deviation`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/non-conformances"] }),
    onError: onError("Deviation talebi oluşturulamadı"),
  });
  const approveDeviation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiPatch(`/non-conformances/${id}/approve-deviation`, { password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/non-conformances"] });
      setPendingDeviationDecision(null);
    },
    onError: onError("Onaylanamadı"),
  });
  const rejectDeviation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiPatch(`/non-conformances/${id}/reject-deviation`, { password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/non-conformances"] });
      setPendingDeviationDecision(null);
    },
    onError: onError("Reddedilemedi"),
  });

  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
  });

  const ncs = useQuery({
    queryKey: ["/non-conformances"],
    queryFn: () => apiGet<NcRow[]>("/non-conformances"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/non-conformances"] });

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
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_LABEL[nc.status].cls}`}>
                {STATUS_LABEL[nc.status].label}
              </span>
            </td>
            <td className="px-4 py-3 text-xs text-slate-500">{nc.reportedBy.name}</td>
            <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(nc.createdAt)}</td>
            <td className="px-4 py-3">
              <div className="flex gap-1">
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setViewingNc(nc)}>
                  Detay
                </Button>
                {canManage && nc.status === "OPEN" && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1"
                    title="Kapat"
                    onClick={() => setResolvingNc(nc)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                )}
                {canManage && nc.status === "OPEN" && nc.actionType === "DEVIATION" && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    disabled={requestDeviation.isPending}
                    onClick={() => requestDeviation.mutate(nc.id)}
                  >
                    Deviation Talep Et
                  </Button>
                )}
                {canDecideDeviation && nc.status === "PENDING_DEVIATION_APPROVAL" && (
                  <>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-green-700"
                      onClick={() => setPendingDeviationDecision({ id: nc.id, action: "approve" })}
                    >
                      Onayla
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-red-700"
                      onClick={() => setPendingDeviationDecision({ id: nc.id, action: "reject" })}
                    >
                      Reddet
                    </Button>
                  </>
                )}
              </div>
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
      {resolvingNc && (
        <ResolveNcModal nc={resolvingNc} onClose={() => setResolvingNc(null)} onResolved={invalidate} />
      )}
      {viewingNc && <NcDetailModal nc={viewingNc} onClose={() => setViewingNc(null)} />}

      <ReauthModal
        open={pendingDeviationDecision !== null}
        onClose={() => setPendingDeviationDecision(null)}
        busy={approveDeviation.isPending || rejectDeviation.isPending}
        onConfirm={(password) => {
          if (!pendingDeviationDecision) return;
          const mutation = pendingDeviationDecision.action === "approve" ? approveDeviation : rejectDeviation;
          mutation.mutate({ id: pendingDeviationDecision.id, password });
        }}
      />
    </div>
  );
}
