import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { useState } from "react";
import { Button, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";

type ProposalStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CONVERTED";

interface SupplierOption {
  id: string;
  name: string;
}

interface PurchaseProposalLineRow {
  id: string;
  qty: string;
  neededByDate: string | null;
  material: { id: string; code: string; name: string; unit: string };
}

interface PurchaseProposalRow {
  id: string;
  ppNo: string;
  status: ProposalStatus;
  supplier: { id: string; name: string } | null;
  lines: PurchaseProposalLineRow[];
  createdAt: string;
}

interface ProductionProposalRow {
  id: string;
  prNo: string;
  status: ProposalStatus;
  qty: string;
  dueDate: string;
  part: { id: string; partNo: string; name: string };
  createdAt: string;
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Taslak",
  PENDING_APPROVAL: "Onay Bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  CONVERTED: "Dönüştürüldü",
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  const cls =
    status === "REJECTED"
      ? "bg-red-100 text-red-700"
      : status === "CONVERTED"
        ? "bg-green-100 text-green-700"
        : status === "PENDING_APPROVAL"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-500";
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{STATUS_LABEL[status]}</span>;
}

function ApprovePurchaseModal({
  proposal,
  suppliers,
  onClose,
  onDone,
}: {
  proposal: PurchaseProposalRow;
  suppliers: SupplierOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [supplierId, setSupplierId] = useState(proposal.supplier?.id ?? "");

  const approve = useMutation({
    mutationFn: () =>
      apiPatch(`/mrp/purchase-proposals/${proposal.id}/approve`, {
        supplierId: supplierId || undefined,
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Onaylanamadı", "error");
    },
  });

  return (
    <Modal open title={`${proposal.ppNo} — Onayla`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Onaylanınca bu öneri gerçek bir satınalma siparişine dönüştürülür. Tedarikçi seçilmeli.
        </p>
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Tedarikçi seçiniz</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={!supplierId || approve.isPending} onClick={() => approve.mutate()}>
            Onayla ve Siparişe Dönüştür
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function MrpPage() {
  const { user } = useAuth();
  const canManage = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [approvingPp, setApprovingPp] = useState<PurchaseProposalRow | null>(null);

  useInvalidateOn(
    ["mrp.proposal.created", "purchaseproposal.updated", "productionproposal.updated"],
    ["/mrp/purchase-proposals", "/mrp/production-proposals"],
  );

  const purchaseProposals = useQuery({
    queryKey: ["/mrp/purchase-proposals"],
    queryFn: () => apiGet<PurchaseProposalRow[]>("/mrp/purchase-proposals"),
  });
  const productionProposals = useQuery({
    queryKey: ["/mrp/production-proposals"],
    queryFn: () => apiGet<ProductionProposalRow[]>("/mrp/production-proposals"),
  });
  const suppliers = useQuery({
    queryKey: ["/suppliers"],
    queryFn: () => apiGet<SupplierOption[]>("/suppliers"),
    enabled: canManage,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["/mrp/purchase-proposals"] }).then(() =>
      qc.invalidateQueries({ queryKey: ["/mrp/production-proposals"] }),
    );

  const runMrp = useMutation({
    mutationFn: () => apiPost("/mrp/run", {}),
    onSuccess: (res: { purchaseProposal: unknown; productionProposals: unknown[] }) => {
      invalidate();
      const ppCount = res.purchaseProposal ? 1 : 0;
      toast(`MRP çalıştırıldı: ${ppCount} satınalma, ${res.productionProposals.length} üretim önerisi`, "success");
    },
    onError: () => toast("MRP çalıştırılamadı", "error"),
  });

  const submitPp = useMutation({
    mutationFn: (id: string) => apiPatch(`/mrp/purchase-proposals/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: () => toast("Onaya gönderilemedi", "error"),
  });
  const rejectPp = useMutation({
    mutationFn: (id: string) => apiPatch(`/mrp/purchase-proposals/${id}/reject`, {}),
    onSuccess: invalidate,
    onError: () => toast("Reddedilemedi", "error"),
  });
  const submitPrp = useMutation({
    mutationFn: (id: string) => apiPatch(`/mrp/production-proposals/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: () => toast("Onaya gönderilemedi", "error"),
  });
  const approvePrp = useMutation({
    mutationFn: (id: string) => apiPatch(`/mrp/production-proposals/${id}/approve`, {}),
    onSuccess: invalidate,
    onError: () => toast("Onaylanamadı", "error"),
  });
  const rejectPrp = useMutation({
    mutationFn: (id: string) => apiPatch(`/mrp/production-proposals/${id}/reject`, {}),
    onSuccess: invalidate,
    onError: () => toast("Reddedilemedi", "error"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">MRP — Malzeme İhtiyaç Planlama</h1>
          <p className="text-sm text-slate-500">
            Açık iş emirleri + reorder-point'e göre satınalma/üretim önerisi üretir.
          </p>
        </div>
        {canManage && (
          <Button disabled={runMrp.isPending} onClick={() => runMrp.mutate()}>
            <PlayCircle className="mr-1 h-4 w-4" /> MRP Çalıştır
          </Button>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Satınalma Önerileri</h2>
        <Table headers={["No", "Tedarikçi", "Satır Sayısı", "Durum", "Oluşturulma", "İşlem"]}>
          {(purchaseProposals.data ?? []).map((pp) => (
            <tr key={pp.id}>
              <td className="px-4 py-3 font-medium">{pp.ppNo}</td>
              <td className="px-4 py-3">{pp.supplier?.name ?? "—"}</td>
              <td className="px-4 py-3">{pp.lines.length}</td>
              <td className="px-4 py-3">
                <StatusBadge status={pp.status} />
              </td>
              <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(pp.createdAt)}</td>
              <td className="px-4 py-3">
                {canManage && pp.status === "DRAFT" && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => submitPp.mutate(pp.id)}>
                    Onaya Gönder
                  </Button>
                )}
                {canManage && pp.status === "PENDING_APPROVAL" && (
                  <div className="flex gap-1">
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setApprovingPp(pp)}>
                      Onayla
                    </Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => rejectPp.mutate(pp.id)}>
                      Reddet
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {purchaseProposals.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                Öneri yok.
              </td>
            </tr>
          )}
        </Table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Üretim Önerileri</h2>
        <Table headers={["No", "Parça", "Miktar", "Termin", "Durum", "Oluşturulma", "İşlem"]}>
          {(productionProposals.data ?? []).map((prp) => (
            <tr key={prp.id}>
              <td className="px-4 py-3 font-medium">{prp.prNo}</td>
              <td className="px-4 py-3">
                {prp.part.partNo} — {prp.part.name}
              </td>
              <td className="px-4 py-3">{Number(prp.qty)}</td>
              <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(prp.dueDate)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={prp.status} />
              </td>
              <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(prp.createdAt)}</td>
              <td className="px-4 py-3">
                {canManage && prp.status === "DRAFT" && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => submitPrp.mutate(prp.id)}>
                    Onaya Gönder
                  </Button>
                )}
                {canManage && prp.status === "PENDING_APPROVAL" && (
                  <div className="flex gap-1">
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => approvePrp.mutate(prp.id)}>
                      Onayla
                    </Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => rejectPrp.mutate(prp.id)}>
                      Reddet
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {productionProposals.data?.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                Öneri yok.
              </td>
            </tr>
          )}
        </Table>
      </div>

      {approvingPp && (
        <ApprovePurchaseModal
          proposal={approvingPp}
          suppliers={suppliers.data ?? []}
          onClose={() => setApprovingPp(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}
