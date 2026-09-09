import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageCheck, Trash2, Truck } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtMoney, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { PO_STATUS, StatusBadge } from "../components/status";
import { Button, Card, Input, Select, Table } from "../components/ui";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";
import type { PoRow } from "./purchase-orders";

interface BinOption { id: string; code: string; warehouse: { name: string } }
interface LotOption {
  id: string;
  lotNo: string;
  itemType: "MATERIAL" | "PART";
  itemId: string;
  acceptanceStatus: "PENDING" | "ACCEPTED" | "QUARANTINED" | "REJECTED";
}

export function PurchaseOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canPlan = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const canReceive = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);

  // satır id -> teslim alınacak miktar (input değeri)
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receiveLotId, setReceiveLotId] = useState<Record<string, string>>({});
  const [receiveBinId, setReceiveBinId] = useState("");

  useInvalidateOn(["purchaseorder.updated", "stock.updated"], ["/purchase-orders", "/materials"]);

  const query = useQuery({
    queryKey: ["/purchase-orders", id],
    queryFn: () => apiGet<PoRow>(`/purchase-orders/${id}`),
  });
  const bins = useQuery({
    queryKey: ["/bins"],
    queryFn: () => apiGet<BinOption[]>("/bins"),
    enabled: canReceive,
  });
  const lots = useQuery({
    queryKey: ["/lots", "MATERIAL"],
    queryFn: () => apiGet<LotOption[]>("/lots?itemType=MATERIAL"),
    enabled: canReceive,
  });

  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["/materials"] });
  };
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      const msg = (e.body as { message?: string } | null)?.message;
      toast(msg ?? "İşlem çakışması (409)", "error");
    } else toast("İşlem başarısız.", "error");
  };

  const setStatus = useMutation({
    mutationFn: (status: string) => apiPatch(`/purchase-orders/${id}/status`, { status }),
    onSuccess: invalidate,
    onError,
  });
  const receive = useMutation({
    mutationFn: () => {
      const lines = Object.entries(receiveQty)
        .filter(([, v]) => Number(v) > 0)
        .map(([lineId, v]) => ({
          lineId,
          receivedQty: Number(v),
          ...(receiveBinId ? { binId: receiveBinId } : {}),
          ...(receiveLotId[lineId] ? { lotId: receiveLotId[lineId] } : {}),
        }));
      return apiPost(`/purchase-orders/${id}/receive`, { lines });
    },
    onSuccess: () => {
      invalidate();
      setReceiveQty({});
      setReceiveLotId({});
      setReceiveBinId("");
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/purchase-orders/${id}`),
    onSuccess: () => {
      invalidate();
      navigate("/purchase-orders");
    },
    onError,
  });

  if (query.isLoading) return <p className="text-slate-500">Yükleniyor…</p>;
  if (query.error || !query.data) return <p className="text-red-600">Sipariş alınamadı.</p>;
  const po = query.data;
  const receivable = po.status === "ORDERED" || po.status === "IN_TRANSIT";
  const anyQtyEntered = Object.values(receiveQty).some((v) => Number(v) > 0);
  const totalAmount = po.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="px-2" onClick={() => navigate("/purchase-orders")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">{po.poNo}</h1>
          <StatusBadge map={PO_STATUS} status={po.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canPlan && po.status === "ORDERED" && (
            <Button variant="outline" onClick={() => setStatus.mutate("IN_TRANSIT")}>
              <Truck className="h-4 w-4" /> Yolda İşaretle
            </Button>
          )}
          {canPlan && receivable && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirm({ message: "Siparişi iptal etmek istediğinize emin misiniz?", danger: true }))
                  setStatus.mutate("CANCELLED");
              }}
            >
              İptal Et
            </Button>
          )}
          {user?.role === "ADMIN" && po.status !== "RECEIVED" && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirm({ message: "Siparişi silmek istediğinize emin misiniz?", danger: true }))
                  remove.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" /> Sil
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase text-slate-500">Tedarikçi</div>
          <div className="mt-1 font-medium">{po.supplier.name}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Sipariş Tarihi</div>
          <div className="mt-1 font-medium">{fmtDate(po.orderDate)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Beklenen Teslim</div>
          <div className="mt-1 font-medium">{fmtDate(po.expectedDate)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Toplam Tutar</div>
          <div className="mt-1 font-medium">{fmtMoney(totalAmount)}</div>
        </Card>
      </div>

      {po.notes && (
        <Card className="mb-6">
          <div className="text-xs uppercase text-slate-500">Notlar</div>
          <div className="mt-1 text-sm">{po.notes}</div>
        </Card>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Satırlar</h2>
        {canReceive && receivable && (
          <Button disabled={!anyQtyEntered || receive.isPending} onClick={() => receive.mutate()}>
            <PackageCheck className="h-4 w-4" />
            {receive.isPending ? "Teslim alınıyor…" : "Teslim Al"}
          </Button>
        )}
      </div>
      {canReceive && receivable && (
        <div className="mb-3 max-w-sm">
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="receiveBin">Teslim alma rafı</label>
          <Select id="receiveBin" value={receiveBinId} onChange={(e) => setReceiveBinId(e.target.value)}>
            <option value="">Atanmamış stok</option>
            {(Array.isArray(bins.data) ? bins.data : []).map((b) => <option key={b.id} value={b.id}>{b.warehouse.name} / {b.code}</option>)}
          </Select>
        </div>
      )}
      <Table
        headers={[
          "Malzeme",
          "Sipariş",
          "Birim Fiyat",
          "Teslim Alınan",
          "Kalan",
          "Stok",
          ...(canReceive && receivable ? ["Lot", "Teslim Miktarı"] : []),
        ]}
      >
        {po.lines.map((l) => {
          const remaining = Number(l.quantity) - Number(l.receivedQty);
          return (
            <tr key={l.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                {l.material.code} — {l.material.name}
              </td>
              <td className="px-4 py-3">
                {fmtQty(l.quantity)} {l.material.unit}
              </td>
              <td className="px-4 py-3">{fmtMoney(l.unitPrice)}</td>
              <td className="px-4 py-3">{fmtQty(l.receivedQty)}</td>
              <td className="px-4 py-3">{fmtQty(remaining)}</td>
              <td className="px-4 py-3">{fmtQty(l.material.stockQty)}</td>
              {canReceive && receivable && (
                <td className="px-4 py-3">
                  <Select
                    className="min-w-40"
                    disabled={remaining <= 0}
                    value={receiveLotId[l.id] ?? ""}
                    onChange={(e) => setReceiveLotId({ ...receiveLotId, [l.id]: e.target.value })}
                  >
                    <option value="">
                      {l.material.lotTrackingRequired ? "Lot zorunlu" : "Lotsuz teslim"}
                    </option>
                    {(Array.isArray(lots.data) ? lots.data : [])
                      .filter((lot) => lot.itemId === l.material.id)
                      .map((lot) => (
                        <option key={lot.id} value={lot.id} disabled={lot.acceptanceStatus !== "ACCEPTED"}>
                          {lot.lotNo} ({lot.acceptanceStatus === "ACCEPTED" ? "Kabul" : lot.acceptanceStatus})
                        </option>
                      ))}
                  </Select>
                </td>
              )}
              {canReceive && receivable && (
                <td className="px-4 py-3">
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    max={remaining}
                    placeholder="0"
                    className="w-28"
                    disabled={remaining <= 0}
                    value={receiveQty[l.id] ?? ""}
                    onChange={(e) => setReceiveQty({ ...receiveQty, [l.id]: e.target.value })}
                  />
                </td>
              )}
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
