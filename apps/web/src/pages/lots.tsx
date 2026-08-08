import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Check, FileText, Plus, Printer, ScanLine, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";
import { DocumentsPanel } from "../components/documents-panel";

interface MaterialOption {
  id: string;
  code: string;
  name: string;
}
interface PartOption {
  id: string;
  partNo: string;
  name: string;
}
interface LotRow {
  id: string;
  lotNo: string;
  itemType: "MATERIAL" | "PART";
  itemId: string;
  expiryDate: string | null;
  receivedDate: string;
  heatNumber: string | null;
  supplierLotNo: string | null;
  certificateNo: string | null;
  acceptanceStatus: "PENDING" | "ACCEPTED" | "QUARANTINED" | "REJECTED";
  acceptanceNote: string | null;
}

interface TraceLotRef {
  id: string;
  lotNo: string;
  itemType: "MATERIAL" | "PART";
}
interface TraceResult {
  lot: LotRow;
  forward?: {
    consumedByWorkOrders: {
      consumption: { id: string; quantity: string; date: string };
      workOrder: { id: string; woNo: string; status: string; part: { partNo: string; name: string } };
      producedLots: { id: string; quantity: string; date: string; lot: TraceLotRef | null }[];
    }[];
  };
  backward?: {
    producedByWorkOrders: {
      entry: { id: string; quantity: string; date: string };
      workOrder: { id: string; woNo: string; status: string };
      consumedLots: {
        id: string;
        itemType: "MATERIAL" | "PART";
        itemId: string;
        quantity: string;
        lot: TraceLotRef | null;
      }[];
    }[];
  };
}

/** Barkod/QR tarama sonrası arama — fiziksel scanner çoğu zaman klavye girişi
 * gibi davranıp Enter'la gönderir, bu yüzden basit bir text input + otomatik
 * odak yeterli (özel bir kamera/tarayıcı entegrasyonu gerekmez). */
function ScanModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<TraceResult | null>(null);
  const materials = useQuery({
    queryKey: ["/materials"],
    queryFn: () => apiGet<MaterialOption[]>("/materials"),
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
  });
  const materialById = new Map((materials.data ?? []).map((m) => [m.id, m]));
  const partById = new Map((parts.data ?? []).map((p) => [p.id, p]));
  function itemLabel(c: { itemType: "MATERIAL" | "PART"; itemId: string }) {
    if (c.itemType === "MATERIAL") {
      const m = materialById.get(c.itemId);
      return m ? `${m.code} — ${m.name}` : c.itemId;
    }
    const p = partById.get(c.itemId);
    return p ? `${p.partNo} — ${p.name}` : c.itemId;
  }

  const scan = useMutation({
    mutationFn: (lotNo: string) => apiGet<TraceResult>(`/lots/scan/${encodeURIComponent(lotNo)}`),
    onSuccess: setResult,
    onError: (e) => {
      setResult(null);
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Lot bulunamadı", "error");
    },
  });

  return (
    <Modal open title="Kod ile Ara" onClose={onClose} className="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) scan.mutate(code.trim());
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="scanCode">Lot No (barkod/QR tarayıcı ile veya elle girin)</Label>
          <Input id="scanCode" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={scan.isPending || !code.trim()}>
            Ara
          </Button>
        </div>
      </form>

      {result && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm">
          <div>
            <span className="font-semibold">{result.lot.lotNo}</span>{" "}
            <span className="text-slate-400">({result.lot.itemType === "MATERIAL" ? "Malzeme" : "Mamul"})</span>
          </div>

          {result.forward && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Tüketen İş Emirleri (ileri izlenebilirlik)
              </div>
              {result.forward.consumedByWorkOrders.length === 0 && (
                <p className="text-slate-400">Henüz hiçbir iş emrinde tüketilmedi.</p>
              )}
              {result.forward.consumedByWorkOrders.map((c) => (
                <div key={c.consumption.id} className="rounded-md border border-slate-100 p-2">
                  <div className="font-medium">
                    {c.workOrder.woNo} — {c.workOrder.part.partNo} ({c.workOrder.status})
                  </div>
                  <div className="text-slate-500">Tüketilen: {c.consumption.quantity}</div>
                  {c.producedLots.length > 0 && (
                    <div className="text-slate-500">
                      Üretilen lotlar: {c.producedLots.map((p) => p.lot?.lotNo ?? "—").join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.backward && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Üreten İş Emri (geri izlenebilirlik)
              </div>
              {result.backward.producedByWorkOrders.map((p) => (
                <div key={p.entry.id} className="rounded-md border border-slate-100 p-2">
                  <div className="font-medium">
                    {p.workOrder.woNo} ({p.workOrder.status})
                  </div>
                  <div className="text-slate-500">Üretilen: {p.entry.quantity}</div>
                  {p.consumedLots.length > 0 && (
                    <div className="text-slate-500">
                      Tüketilen lotlar:{" "}
                      {p.consumedLots.map((c) => `${itemLabel(c)}${c.lot ? ` (${c.lot.lotNo})` : ""}`).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function LotsPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [lotNo, setLotNo] = useState("");
  const [itemType, setItemType] = useState<"MATERIAL" | "PART">("MATERIAL");
  const [itemId, setItemId] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [heatNumber, setHeatNumber] = useState("");
  const [supplierLotNo, setSupplierLotNo] = useState("");
  const [certificateNo, setCertificateNo] = useState("");
  const [docsFor, setDocsFor] = useState<LotRow | null>(null);

  const lots = useQuery({ queryKey: ["/lots"], queryFn: () => apiGet<LotRow[]>("/lots") });
  const materials = useQuery({
    queryKey: ["/materials"],
    queryFn: () => apiGet<MaterialOption[]>("/materials"),
    enabled: open,
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
    enabled: open,
  });

  const [showScan, setShowScan] = useState(false);

  const materialById = new Map((materials.data ?? []).map((m) => [m.id, m]));
  const partById = new Map((parts.data ?? []).map((p) => [p.id, p]));

  function itemLabel(row: LotRow) {
    if (row.itemType === "MATERIAL") {
      const m = materialById.get(row.itemId);
      return m ? `${m.code} — ${m.name}` : row.itemId;
    }
    const p = partById.get(row.itemId);
    return p ? `${p.partNo} — ${p.name}` : row.itemId;
  }

  /** Etiketi yeni bir pencerede QR koduyla açar ve yazdırma diyaloğunu tetikler
   * — mevcut sayfaya print-CSS eklemek yerine (shift-report.tsx'in aksine, o
   * tüm sayfayı yazdırıyor) sadece etiket boyutunda izole bir belge üretir.
   * lotNo/malzeme adı kullanıcı girişi olduğundan document.write + string
   * interpolasyonu KULLANILMAZ (stored-XSS riski) — güvenli DOM API'siyle
   * (createElement/textContent) kurulur. */
  async function printLabel(row: LotRow) {
    const dataUrl = await QRCode.toDataURL(row.lotNo, { width: 220, margin: 1 });
    const w = window.open("", "_blank", "width=380,height=480");
    if (!w) return;
    const doc = w.document;
    doc.title = row.lotNo;

    const style = doc.createElement("style");
    style.textContent =
      "body{font-family:sans-serif;text-align:center;padding:24px;}" +
      "img{width:220px;height:220px;} h2{margin:12px 0 4px;font-size:18px;}" +
      "p{color:#555;margin:2px 0;font-size:13px;}";
    doc.head.appendChild(style);

    const img = doc.createElement("img");
    img.src = dataUrl;
    img.alt = "QR";
    const h2 = doc.createElement("h2");
    h2.textContent = row.lotNo;
    const pItem = doc.createElement("p");
    pItem.textContent = itemLabel(row);
    const pType = doc.createElement("p");
    pType.textContent = row.itemType === "MATERIAL" ? "Malzeme" : "Mamul";
    doc.body.append(img, h2, pItem, pType);

    // window.open("", ...) zaten yüklü bir belge açar (yeni bir navigasyon
    // olmadığı için) — w.onload burada güvenilir tetiklenmeyebilir, bu yüzden
    // içerik eklendikten hemen sonra doğrudan çağrılır.
    w.focus();
    w.print();
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost("/lots", {
        lotNo,
        itemType,
        itemId,
        ...(expiryDate ? { expiryDate } : {}),
        ...(heatNumber.trim() ? { heatNumber: heatNumber.trim() } : {}),
        ...(supplierLotNo.trim() ? { supplierLotNo: supplierLotNo.trim() } : {}),
        ...(certificateNo.trim() ? { certificateNo: certificateNo.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/lots"] });
      setOpen(false);
      setLotNo("");
      setItemId("");
      setExpiryDate("");
      setHeatNumber("");
      setSupplierLotNo("");
      setCertificateNo("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Lot oluşturulamadı", "error");
    },
  });
  const decideAcceptance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LotRow["acceptanceStatus"] }) =>
      apiPost(`/lots/${id}/acceptance`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/lots"] }),
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Kabul kararı kaydedilemedi", "error");
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Lot / Parti Takibi</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowScan(true)}>
            <ScanLine className="h-4 w-4" /> Kod ile Ara
          </Button>
          {canWrite && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Yeni Lot
            </Button>
          )}
        </div>
      </div>

      {lots.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["Lot No", "Tip", "Kalem", "Heat / Tedarikçi Lot", "Sertifika", "Kabul", "İşlem"]}>
        {(lots.data ?? []).length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(lots.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.lotNo}</td>
            <td className="px-4 py-3">{row.itemType === "MATERIAL" ? "Malzeme" : "Mamul"}</td>
            <td className="px-4 py-3">{itemLabel(row)}</td>
            <td className="px-4 py-3 text-sm">{row.heatNumber ?? "—"}<br /><span className="text-slate-500">{row.supplierLotNo ?? "—"}</span></td>
            <td className="px-4 py-3">{row.certificateNo ?? "—"}</td>
            <td className="px-4 py-3">
              <span className={row.acceptanceStatus === "ACCEPTED" ? "text-emerald-700" : row.acceptanceStatus === "REJECTED" ? "text-red-700" : "text-amber-700"}>
                {row.acceptanceStatus === "ACCEPTED" ? "Kabul" : row.acceptanceStatus === "REJECTED" ? "Red" : row.acceptanceStatus === "QUARANTINED" ? "Karantina" : "Bekliyor"}
              </span>
            </td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => printLabel(row)}><Printer className="h-4 w-4" /> QR</Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setDocsFor(row)}><FileText className="h-4 w-4" /> Belge</Button>
                {canWrite && row.acceptanceStatus !== "ACCEPTED" && row.acceptanceStatus !== "REJECTED" && (
                  <>
                    <Button variant="ghost" className="px-2 py-1 text-xs text-emerald-700" onClick={() => decideAcceptance.mutate({ id: row.id, status: "ACCEPTED" })}><Check className="h-4 w-4" /> Kabul</Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs text-amber-700" onClick={() => decideAcceptance.mutate({ id: row.id, status: "QUARANTINED" })}><ShieldAlert className="h-4 w-4" /> Karantina</Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs text-red-700" onClick={() => decideAcceptance.mutate({ id: row.id, status: "REJECTED" })}><X className="h-4 w-4" /> Red</Button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni Lot" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="lotNo">Lot No</Label>
            <Input id="lotNo" required value={lotNo} onChange={(e) => setLotNo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="itemType">Kalem Tipi</Label>
            <Select
              id="itemType"
              value={itemType}
              onChange={(e) => {
                setItemType(e.target.value as "MATERIAL" | "PART");
                setItemId("");
              }}
            >
              <option value="MATERIAL">Malzeme</option>
              <option value="PART">Mamul</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="itemId">Kalem</Label>
            <Select id="itemId" required value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Seçin…</option>
              {itemType === "MATERIAL"
                ? materials.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.name}
                    </option>
                  ))
                : parts.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partNo} — {p.name}
                    </option>
                  ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="expiryDate">Son Kullanma Tarihi</Label>
            <Input
              id="expiryDate"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="heatNumber">Heat No</Label>
              <Input id="heatNumber" value={heatNumber} onChange={(e) => setHeatNumber(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="supplierLotNo">Tedarikçi Lot No</Label>
              <Input id="supplierLotNo" value={supplierLotNo} onChange={(e) => setSupplierLotNo(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="certificateNo">Malzeme sertifika no (CoC)</Label>
            <Input id="certificateNo" value={certificateNo} onChange={(e) => setCertificateNo(e.target.value)} />
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
      <Modal
        open={docsFor !== null}
        title={docsFor ? `${docsFor.lotNo} — Sertifikalar ve Belgeler` : "Belgeler"}
        onClose={() => setDocsFor(null)}
      >
        {docsFor && <DocumentsPanel entityType="lot" entityId={docsFor.id} />}
      </Modal>
      {showScan && <ScanModal onClose={() => setShowScan(false)} />}
    </div>
  );
}
