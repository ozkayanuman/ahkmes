import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Plus, Printer, ScanLine } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";
import { BackwardTree, type BackwardTraceNode } from "../components/trace-tree";

interface PartOption {
  id: string;
  partNo: string;
  name: string;
}
interface MaterialOption {
  id: string;
  code: string;
  name: string;
}
interface WorkOrderOption {
  id: string;
  woNo: string;
}
interface LotOption {
  id: string;
  lotNo: string;
}
interface SerialRow {
  id: string;
  serialNo: string;
  partId: string;
  workOrderId: string | null;
  lotId: string | null;
  createdAt: string;
}

interface TraceResult {
  serial: SerialRow;
  producedByWorkOrder: {
    id: string;
    woNo: string;
    status: string;
    part: { partNo: string; name: string };
    consumptions: {
      id: string;
      itemType: "MATERIAL" | "PART";
      itemId: string;
      lot: { id: string; lotNo: string } | null;
      backward: BackwardTraceNode | null;
    }[];
  } | null;
}

/** Barkod/QR tarama sonrası arama — lots.tsx'teki ScanModal ile aynı desen
 * (fiziksel scanner klavye girişi gibi davranıp Enter'la gönderir). */
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
    mutationFn: (serialNo: string) =>
      apiGet<TraceResult>(`/serial-numbers/scan/${encodeURIComponent(serialNo)}`),
    onSuccess: setResult,
    onError: (e) => {
      setResult(null);
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Seri numarası bulunamadı", "error");
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
          <Label htmlFor="scanCode">Seri No (barkod/QR tarayıcı ile veya elle girin)</Label>
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
            <span className="font-semibold">{result.serial.serialNo}</span>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
              Üreten İş Emri (geri izlenebilirlik)
            </div>
            {!result.producedByWorkOrder && <p className="text-slate-400">Bir iş emrine bağlanmamış.</p>}
            {result.producedByWorkOrder && (
              <div className="rounded-md border border-slate-100 p-2">
                <div className="font-medium">
                  {result.producedByWorkOrder.woNo} — {result.producedByWorkOrder.part.partNo} (
                  {result.producedByWorkOrder.status})
                </div>
                {result.producedByWorkOrder.consumptions.length === 0 && (
                  <div className="text-slate-400">Tüketilen kalem yok</div>
                )}
                {result.producedByWorkOrder.consumptions.map((c) => (
                  <div key={c.id} className="mt-1">
                    <div className="text-slate-500">
                      ← Tüketilen: {itemLabel(c)}
                      {c.lot ? ` (${c.lot.lotNo})` : ""}
                    </div>
                    {c.backward && <BackwardTree node={c.backward} itemLabel={itemLabel} depth={1} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function SerialNumbersPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [serialNo, setSerialNo] = useState("");
  const [partId, setPartId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [lotId, setLotId] = useState("");
  const [showScan, setShowScan] = useState(false);

  const serials = useQuery({
    queryKey: ["/serial-numbers"],
    queryFn: () => apiGet<SerialRow[]>("/serial-numbers"),
  });
  const parts = useQuery({
    queryKey: ["/parts"],
    queryFn: () => apiGet<PartOption[]>("/parts"),
    enabled: open,
  });
  const workOrders = useQuery({
    queryKey: ["/work-orders"],
    queryFn: () => apiGet<WorkOrderOption[]>("/work-orders"),
    enabled: open,
  });
  const lots = useQuery({
    queryKey: ["/lots"],
    queryFn: () => apiGet<LotOption[]>("/lots"),
    enabled: open,
  });

  const partById = new Map((parts.data ?? []).map((p) => [p.id, p]));
  const woById = new Map((workOrders.data ?? []).map((w) => [w.id, w]));
  const lotById = new Map((lots.data ?? []).map((l) => [l.id, l]));

  /** lots.tsx printLabel ile aynı desen — document.write yerine güvenli DOM
   * API'si (createElement/textContent), serialNo kullanıcı girişi olduğundan
   * stored-XSS'e karşı. */
  async function printLabel(row: SerialRow) {
    const dataUrl = await QRCode.toDataURL(row.serialNo, { width: 220, margin: 1 });
    const w = window.open("", "_blank", "width=380,height=480");
    if (!w) return;
    const doc = w.document;
    doc.title = row.serialNo;

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
    h2.textContent = row.serialNo;
    const pItem = doc.createElement("p");
    const part = partById.get(row.partId);
    pItem.textContent = part ? `${part.partNo} — ${part.name}` : row.partId;
    doc.body.append(img, h2, pItem);

    w.focus();
    w.print();
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost("/serial-numbers", {
        serialNo,
        partId,
        ...(workOrderId ? { workOrderId } : {}),
        ...(lotId ? { lotId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/serial-numbers"] });
      setOpen(false);
      setSerialNo("");
      setPartId("");
      setWorkOrderId("");
      setLotId("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Seri numarası oluşturulamadı", "error");
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Seri Numarası Takibi</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowScan(true)}>
            <ScanLine className="h-4 w-4" /> Kod ile Ara
          </Button>
          {canWrite && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Yeni Seri No
            </Button>
          )}
        </div>
      </div>

      {serials.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["Seri No", "Parça", "İş Emri", "Lot", "Oluşturma", "İşlem"]}>
        {(serials.data ?? []).length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(serials.data ?? []).map((row) => {
          const part = partById.get(row.partId);
          const wo = row.workOrderId ? woById.get(row.workOrderId) : undefined;
          const lot = row.lotId ? lotById.get(row.lotId) : undefined;
          return (
            <tr key={row.id}>
              <td className="px-4 py-3 font-medium">{row.serialNo}</td>
              <td className="px-4 py-3">{part ? `${part.partNo} — ${part.name}` : row.partId}</td>
              <td className="px-4 py-3">{wo?.woNo ?? "—"}</td>
              <td className="px-4 py-3">{lot?.lotNo ?? "—"}</td>
              <td className="px-4 py-3">{fmtDate(row.createdAt)}</td>
              <td className="px-4 py-3">
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => printLabel(row)}>
                  <Printer className="h-4 w-4" /> QR Etiket
                </Button>
              </td>
            </tr>
          );
        })}
      </Table>

      <Modal open={open} title="Yeni Seri Numarası" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="serialNo">Seri No</Label>
            <Input id="serialNo" required value={serialNo} onChange={(e) => setSerialNo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="partId">Parça</Label>
            <Select id="partId" required value={partId} onChange={(e) => setPartId(e.target.value)}>
              <option value="">Seçin…</option>
              {parts.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNo} — {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="workOrderId">İş Emri (opsiyonel)</Label>
            <Select id="workOrderId" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
              <option value="">Seçin…</option>
              {workOrders.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.woNo}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="lotId">Lot (opsiyonel)</Label>
            <Select id="lotId" value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">Seçin…</option>
              {lots.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lotNo}
                </option>
              ))}
            </Select>
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
      {showScan && <ScanModal onClose={() => setShowScan(false)} />}
    </div>
  );
}
