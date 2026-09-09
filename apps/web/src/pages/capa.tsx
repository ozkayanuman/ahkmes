import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { Button, Input, Label, Modal, Table, Textarea } from "../components/ui";
import { useToast } from "../components/toast";
import { ReauthModal } from "../components/reauth-modal";

type CapaStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CLOSED";

const STATUS_LABEL: Record<CapaStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Taslak", cls: "bg-slate-100 text-slate-700" },
  PENDING_APPROVAL: { label: "Onay Bekliyor", cls: "bg-amber-100 text-amber-700" },
  APPROVED: { label: "Onaylandı", cls: "bg-green-100 text-green-700" },
  REJECTED: { label: "Reddedildi", cls: "bg-red-100 text-red-700" },
  CLOSED: { label: "Kapatıldı", cls: "bg-slate-100 text-slate-500" },
};

interface CapaRow {
  id: string;
  dofNo: string;
  title: string;
  rootCause: string | null;
  actionPlan: string | null;
  status: CapaStatus;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export function CapaPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const canDecide = !!user && user.role === "ADMIN";
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [pendingDecision, setPendingDecision] = useState<{ id: string; action: "approve" | "reject" } | null>(null);

  useInvalidateOn(["capa.updated"], ["/capa"]);

  const query = useQuery({ queryKey: ["/capa"], queryFn: () => apiGet<CapaRow[]>("/capa") });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/capa"] });
  const onError = (fallback: string) => (e: unknown) => {
    const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
    toast(msg ?? fallback, "error");
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost("/capa", {
        title,
        ...(rootCause ? { rootCause } : {}),
        ...(actionPlan ? { actionPlan } : {}),
      }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setTitle("");
      setRootCause("");
      setActionPlan("");
    },
    onError: onError("CAPA oluşturulamadı"),
  });

  const submit = useMutation({
    mutationFn: (id: string) => apiPatch(`/capa/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: onError("Onaya gönderilemedi"),
  });
  const approve = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiPatch(`/capa/${id}/approve`, { password }),
    onSuccess: () => {
      invalidate();
      setPendingDecision(null);
    },
    onError: onError("Onaylanamadı"),
  });
  const reject = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiPatch(`/capa/${id}/reject`, { password }),
    onSuccess: () => {
      invalidate();
      setPendingDecision(null);
    },
    onError: onError("Reddedilemedi"),
  });
  const close = useMutation({
    mutationFn: (id: string) => apiPatch(`/capa/${id}/close`, {}),
    onSuccess: invalidate,
    onError: onError("Kapatılamadı"),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Düzeltici/Önleyici Faaliyet (CAPA)</h1>
        {canWrite && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Yeni CAPA
          </Button>
        )}
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["No", "Başlık", "Durum", "Oluşturan", "Tarih", "İşlem"]}>
        {(query.data ?? []).length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(query.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.dofNo}</td>
            <td className="px-4 py-3">{row.title}</td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_LABEL[row.status].cls}`}
              >
                {STATUS_LABEL[row.status].label}
              </span>
            </td>
            <td className="px-4 py-3">{row.createdBy.name}</td>
            <td className="px-4 py-3">{fmtDate(row.createdAt)}</td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-1">
                {canWrite && row.status === "DRAFT" && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => submit.mutate(row.id)}>
                    <Send className="h-4 w-4" /> Onaya Gönder
                  </Button>
                )}
                {canDecide && row.status === "PENDING_APPROVAL" && (
                  <>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => setPendingDecision({ id: row.id, action: "approve" })}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Onayla
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-red-600"
                      onClick={() => setPendingDecision({ id: row.id, action: "reject" })}
                    >
                      <XCircle className="h-4 w-4" /> Reddet
                    </Button>
                  </>
                )}
                {canWrite && row.status === "APPROVED" && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => close.mutate(row.id)}>
                    Kapat
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni CAPA" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="title">Başlık</Label>
            <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rootCause">Kök Neden</Label>
            <Textarea id="rootCause" rows={3} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="actionPlan">Aksiyon Planı</Label>
            <Textarea id="actionPlan" rows={3} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} />
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

      <ReauthModal
        open={pendingDecision !== null}
        onClose={() => setPendingDecision(null)}
        busy={approve.isPending || reject.isPending}
        onConfirm={(password) => {
          if (!pendingDecision) return;
          const mutation = pendingDecision.action === "approve" ? approve : reject;
          mutation.mutate({ id: pendingDecision.id, password });
        }}
      />
    </div>
  );
}
