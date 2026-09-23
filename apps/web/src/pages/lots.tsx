import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Check, FileText, Plus, Printer, ScanLine, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";
import { DocumentsPanel } from "../components/documents-panel";
import { BackwardTree, ForwardTree, type BackwardTraceNode, type ForwardTraceNode } from "../components/trace-tree";

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
interface SupplierOption {
  id: string;
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

interface TraceResult {
  lot: LotRow;
  forward?: ForwardTraceNode;
  backward?: BackwardTraceNode;
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

          {result.backward && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Üreten İş Emri (geri izlenebilirlik — çok seviyeli)
              </div>
              {result.backward.producedByWorkOrders.length === 0 && (
                <p className="text-slate-400">Üreten iş emri bulunamadı.</p>
              )}
              <BackwardTree node={result.backward} itemLabel={itemLabel} />
            </div>
          )}

          {result.forward && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Tüketen İş Emirleri (ileri izlenebilirlik — çok seviyeli)
              </div>
              {result.forward.consumedByWorkOrders.length === 0 && (
                <p className="text-slate-400">Henüz hiçbir iş emrinde tüketilmedi.</p>
              )}
              <ForwardTree node={result.forward} />
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
  const [inspectionLot, setInspectionLot] = useState<LotRow | null>(null);
  const [acceptanceDecision, setAcceptanceDecision] = useState<"ACCEPTED" | "QUARANTINED" | "REJECTED" | null>(null);
  const [acceptanceNote, setAcceptanceNote] = useState("");
  const [supplierReturnLot, setSupplierReturnLot] = useState<LotRow | null>(null);
  const [supplierReturn, setSupplierReturn] = useState({ supplierId: "", quantity: "", shipmentReference: "", reason: "" });

  const lots = useQuery({ queryKey: ["/lots"], queryFn: () => apiGet<LotRow[]>("/lots") });
  const incomingInspectionHistory = useQuery({ queryKey: ["/lots", inspectionLot?.id, "incoming-inspections"], queryFn: () => apiGet<any[]>(`/lots/${inspectionLot?.id}/incoming-inspections`), enabled: !!inspectionLot, retry: false });
  const supplierReturnHistory = useQuery({ queryKey: ["/lots", supplierReturnLot?.id, "supplier-returns"], queryFn: () => apiGet<any[]>(`/lots/${supplierReturnLot?.id}/supplier-returns`), enabled: !!supplierReturnLot, retry: false });
  const suppliers = useQuery({ queryKey: ["/suppliers"], queryFn: () => apiGet<SupplierOption[]>("/suppliers"), enabled: !!supplierReturnLot, retry: false });
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
    mutationFn: ({ id, status, note }: { id: string; status: "ACCEPTED" | "QUARANTINED" | "REJECTED"; note: string }) =>
      apiPost(`/lots/${id}/acceptance`, { status, note: note.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/lots"] }); incomingInspectionHistory.refetch(); setAcceptanceDecision(null); setAcceptanceNote(""); },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Kabul kararı kaydedilemedi", "error");
    },
  });
  const recordSupplierReturn = useMutation({
    mutationFn: () => apiPost(`/lots/${supplierReturnLot?.id}/supplier-returns`, { supplierId: supplierReturn.supplierId, quantity: Number(supplierReturn.quantity), shipmentReference: supplierReturn.shipmentReference.trim(), reason: supplierReturn.reason.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/lots"] }); supplierReturnHistory.refetch(); setSupplierReturn({ supplierId: "", quantity: "", shipmentReference: "", reason: "" }); },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Tedarikçi iadesi kaydedilemedi", "error");
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
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setInspectionLot(row); setAcceptanceDecision(null); setAcceptanceNote(""); }}>Muayene</Button>
                {canWrite && row.itemType === "MATERIAL" && row.acceptanceStatus === "REJECTED" && <Button variant="ghost" className="px-2 py-1 text-xs text-red-700" onClick={() => { setSupplierReturnLot(row); setSupplierReturn({ supplierId: "", quantity: "", shipmentReference: "", reason: "" }); }}>Tedarikçiye iade</Button>}
                {canWrite && row.acceptanceStatus !== "ACCEPTED" && row.acceptanceStatus !== "REJECTED" && (
                  <>
                    <Button variant="ghost" className="px-2 py-1 text-xs text-emerald-700" onClick={() => { setInspectionLot(row); setAcceptanceDecision("ACCEPTED"); setAcceptanceNote(""); }}><Check className="h-4 w-4" /> Kabul</Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs text-amber-700" onClick={() => { setInspectionLot(row); setAcceptanceDecision("QUARANTINED"); setAcceptanceNote(""); }}><ShieldAlert className="h-4 w-4" /> Karantina</Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs text-red-700" onClick={() => { setInspectionLot(row); setAcceptanceDecision("REJECTED"); setAcceptanceNote(""); }}><X className="h-4 w-4" /> Red</Button>
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
      <Modal open={inspectionLot !== null} title={inspectionLot ? `${inspectionLot.lotNo} — Gelen kabul muayenesi` : "Gelen kabul muayenesi"} onClose={() => { setInspectionLot(null); setAcceptanceDecision(null); setAcceptanceNote(""); }}>
        {inspectionLot && <div className="space-y-4"><p className="text-sm text-slate-600">Bu kayıt kabul/karantina/red kararının değişmez kanıtıdır. Ayrıntılı numune ve ölçüm planları ayrı QMS akışında yönetilir.</p>{acceptanceDecision && <form onSubmit={(e) => { e.preventDefault(); decideAcceptance.mutate({ id: inspectionLot.id, status: acceptanceDecision, note: acceptanceNote }); }} className="space-y-3 rounded border p-3"><div className="text-sm font-medium">Karar: {acceptanceDecision}</div><div><Label htmlFor="acceptanceNote">Muayene notu (opsiyonel)</Label><Input id="acceptanceNote" value={acceptanceNote} onChange={(e) => setAcceptanceNote(e.target.value)} /></div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAcceptanceDecision(null)}>Vazgeç</Button><Button type="submit" disabled={decideAcceptance.isPending}>Kararı kaydet</Button></div></form>}<div><h3 className="mb-2 text-sm font-medium">Karar geçmişi</h3>{incomingInspectionHistory.isLoading ? <p className="text-sm text-slate-500">Yükleniyor…</p> : <div className="space-y-2">{(incomingInspectionHistory.data ?? []).map((entry) => <div key={entry.id} className="rounded border p-2 text-sm"><b>{entry.decision}</b> · {new Date(entry.inspectedAt).toLocaleString("tr-TR")} · {entry.inspectedBy?.name ?? "Bilinmeyen kullanıcı"}<div className="mt-1 text-slate-600">{entry.note ?? "Not girilmedi"}</div></div>)}{!incomingInspectionHistory.data?.length && <p className="text-sm text-slate-500">Henüz kabul muayenesi kararı yok.</p>}</div>}</div></div>}
      </Modal>
      <Modal open={supplierReturnLot !== null} title={supplierReturnLot ? `${supplierReturnLot.lotNo} — Tedarikçiye iade` : "Tedarikçiye iade"} onClose={() => { setSupplierReturnLot(null); setSupplierReturn({ supplierId: "", quantity: "", shipmentReference: "", reason: "" }); }}>
        {supplierReturnLot && <div className="space-y-4"><p className="text-sm text-slate-600">Bu kayıt reddedilen ve henüz stoğa alınmamış lotun fiziksel tedarikçi iadesini belgelendirir. Kabul edilmiş stok için hareket oluşturmaz.</p>{!supplierReturnHistory.data?.length && <form onSubmit={(e) => { e.preventDefault(); recordSupplierReturn.mutate(); }} className="space-y-3"><div><Label htmlFor="supplierReturnSupplier">Tedarikçi</Label><Select id="supplierReturnSupplier" value={supplierReturn.supplierId} onChange={(e) => setSupplierReturn({ ...supplierReturn, supplierId: e.target.value })}><option value="">Tedarikçi seçin</option>{suppliers.data?.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</Select></div><div><Label htmlFor="supplierReturnQuantity">İade miktarı</Label><Input id="supplierReturnQuantity" type="number" min="0.001" step="0.001" value={supplierReturn.quantity} onChange={(e) => setSupplierReturn({ ...supplierReturn, quantity: e.target.value })} /></div><div><Label htmlFor="supplierReturnShipment">Sevk / RMA referansı</Label><Input id="supplierReturnShipment" value={supplierReturn.shipmentReference} onChange={(e) => setSupplierReturn({ ...supplierReturn, shipmentReference: e.target.value })} /></div><div><Label htmlFor="supplierReturnReason">Zorunlu iade gerekçesi</Label><Input id="supplierReturnReason" value={supplierReturn.reason} onChange={(e) => setSupplierReturn({ ...supplierReturn, reason: e.target.value })} /></div><div className="flex justify-end"><Button type="submit" disabled={recordSupplierReturn.isPending || !supplierReturn.supplierId || !(Number(supplierReturn.quantity) > 0) || !supplierReturn.shipmentReference.trim() || !supplierReturn.reason.trim()}>İadeyi kaydet</Button></div></form>}<div><h3 className="mb-2 text-sm font-medium">İade geçmişi</h3>{supplierReturnHistory.isLoading ? <p className="text-sm text-slate-500">Yükleniyor…</p> : <div className="space-y-2">{(supplierReturnHistory.data ?? []).map((entry) => <div key={entry.id} className="rounded border p-2 text-sm"><b>{entry.supplier?.name ?? "Tedarikçi"}</b> · {entry.quantity} · {new Date(entry.returnedAt).toLocaleString("tr-TR")}<div className="mt-1">Sevk/RMA: {entry.shipmentReference}</div><div className="mt-1 text-slate-600">{entry.reason}</div></div>)}{!supplierReturnHistory.data?.length && <p className="text-sm text-slate-500">Henüz iade kaydı yok.</p>}</div>}</div></div>}
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
