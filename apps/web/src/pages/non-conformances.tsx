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
  inspectionLot?: {
    id: string;
    lotId?: string | null;
    status: string;
    requirement: { planRevision: string; inspectionPoint: string; snapshot: { checks?: Array<{ seq: number; checkpointName: string; lowerLimit?: string; upperLimit?: string }> } };
    measurements: Array<{ sampleNo: number; checkSeq: number; result: string; numericValue?: string | null; resultValue?: string | null }>;
    holds: Array<{ id: string; status: string; reason: string; quantity?: string | null }>;
  } | null;
  dispositions?: Array<{ id: string; type: string; quantity?: string | null; reason: string; createdAt: string }>;
  reworkRequirements?: Array<{ id: string; status: string; quantity: string }>;
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
        {nc.inspectionLot && (
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-xs uppercase text-slate-400">Released inspection context</div>
            <div className="mt-1">Plan revision {nc.inspectionLot.requirement.planRevision} · {nc.inspectionLot.requirement.inspectionPoint} · lot {nc.inspectionLot.status}</div>
            <ul className="mt-2 list-disc pl-5 text-slate-600">{nc.inspectionLot.measurements.map((measurement) => <li key={`${measurement.sampleNo}-${measurement.checkSeq}`}>Sample {measurement.sampleNo}, check {measurement.checkSeq}: {measurement.numericValue ?? measurement.resultValue} — <b>{measurement.result}</b></li>)}</ul>
            {nc.inspectionLot.holds.map((hold) => <div key={hold.id} className={hold.status === "ACTIVE" ? "mt-2 font-medium text-red-700" : "mt-2 text-green-700"}>Hold {hold.status}: {hold.reason}{hold.quantity ? ` (${hold.quantity})` : ""}</div>)}
          </div>
        )}
        {nc.dispositions?.length ? <div className="rounded-md bg-slate-50 p-3"><div className="text-xs uppercase text-slate-400">Disposition</div>{nc.dispositions.map((item) => <div key={item.id}>{item.type}: {item.reason}</div>)}{nc.reworkRequirements?.map((item) => <div key={item.id} className="mt-1 font-medium text-amber-700">Rework {item.status}: {item.quantity}</div>)}</div> : null}
      </div>
    </Modal>
  );
}

function QualityDispositionModal({ action, onClose, onSubmit, busy }: { action: { nc: NcRow; type: "ACCEPT" | "USE_AS_IS" | "REWORK" | "SCRAP" }; onClose: () => void; onSubmit: (reason: string, quantity?: number) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState("");
  const needsQuantity = action.type === "SCRAP" || action.type === "REWORK";
  return <Modal open title={`${action.type} disposition`} onClose={onClose}><div className="space-y-4 text-sm"><p><b>{action.nc.workOrder.woNo}</b> · failed released inspection</p>{action.type === "USE_AS_IS" && <p className="rounded bg-amber-50 p-2 text-amber-800">USE_AS_IS requires the dedicated server-side approval right. An explicit quality release remains required.</p>}{action.type === "REWORK" && <p className="rounded bg-amber-50 p-2 text-amber-800">This creates a controlled pending rework requirement; it does not execute rework.</p>}{action.type === "SCRAP" && <p className="rounded bg-red-50 p-2 text-red-800">Scrap posts one canonical inventory movement for the affected output lot.</p>}{needsQuantity && <div><Label htmlFor="qualityQuantity">Affected quantity</Label><Input id="qualityQuantity" type="number" min="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>}<div><Label htmlFor="qualityReason">Reason / deviation justification</Label><Textarea id="qualityReason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !reason.trim() || (needsQuantity && !(Number(quantity) > 0))} onClick={() => onSubmit(reason, needsQuantity ? Number(quantity) : undefined)}>Confirm {action.type}</Button></div></div></Modal>;
}

function QualityHoldReleaseModal({ nc, onClose, onSubmit, busy }: { nc: NcRow; onClose: () => void; onSubmit: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return <Modal open title="Explicit quality release" onClose={onClose}><div className="space-y-4"><p className="text-sm">{nc.workOrder.woNo}: server validates the disposition before releasing the hold.</p><div><Label htmlFor="releaseReason">Release reason</Label><Textarea id="releaseReason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !reason.trim()} onClick={() => onSubmit(reason)}>Release</Button></div></div></Modal>;
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
  const [qualityAction, setQualityAction] = useState<{ nc: NcRow; type: "ACCEPT" | "USE_AS_IS" | "REWORK" | "SCRAP" } | null>(null);
  const [releasingHold, setReleasingHold] = useState<{ id: string; nc: NcRow } | null>(null);

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
  const qualityDisposition = useMutation({
    mutationFn: ({ ncId, type, reason, quantity }: { ncId: string; type: string; reason: string; quantity?: number }) => apiPost(`/quality-execution/ncr/${ncId}/dispositions`, { type, reason, ...(quantity ? { quantity } : {}), idempotencyKey: `ui-disposition-${crypto.randomUUID()}` }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/non-conformances"] }); setQualityAction(null); toast("Kalite disposition kaydedildi", "success"); },
    onError: onError("Disposition reddedildi"),
  });
  const releaseHold = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiPost(`/quality-execution/holds/${id}/release`, { reason, idempotencyKey: `ui-release-${crypto.randomUUID()}` }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/non-conformances"] }); setReleasingHold(null); toast("Kalite hold serbest bırakıldı", "success"); },
    onError: onError("Kalite release reddedildi"),
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
                {canManage && nc.inspectionLot && nc.status === "OPEN" && !nc.dispositions?.length && (
                  <>
                    {(["ACCEPT", "USE_AS_IS", "REWORK", "SCRAP"] as const).map((type) => <Button key={type} variant="ghost" className="px-2 py-1 text-xs" onClick={() => setQualityAction({ nc, type })}>{type}</Button>)}
                  </>
                )}
                {canManage && nc.inspectionLot?.holds.filter((hold) => hold.status === "ACTIVE").map((hold) => <Button key={hold.id} variant="ghost" className="px-2 py-1 text-xs text-green-700" onClick={() => setReleasingHold({ id: hold.id, nc })}>Quality release</Button>)}
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
      {qualityAction && <QualityDispositionModal action={qualityAction} onClose={() => setQualityAction(null)} onSubmit={(reason, quantity) => qualityDisposition.mutate({ ncId: qualityAction.nc.id, type: qualityAction.type, reason, quantity })} busy={qualityDisposition.isPending} />}
      {releasingHold && <QualityHoldReleaseModal nc={releasingHold.nc} onClose={() => setReleasingHold(null)} onSubmit={(reason) => releaseHold.mutate({ id: releasingHold.id, reason })} busy={releaseHold.isPending} />}

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
