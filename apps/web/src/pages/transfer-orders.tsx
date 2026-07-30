import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate, fmtQty } from "../lib/format";
import { useInvalidateOn } from "../lib/socket";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";

interface BinOption {
  id: string;
  code: string;
  warehouse: { id: string; name: string };
}
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
interface TransferOrderRow {
  id: string;
  toNo: string;
  fromBin: { id: string; code: string; warehouse: { name: string } };
  toBin: { id: string; code: string; warehouse: { name: string } };
  createdAt: string;
  lines: { id: string; itemType: "MATERIAL" | "PART"; itemId: string; qty: string }[];
}
interface LineDraft {
  itemType: "MATERIAL" | "PART";
  itemId: string;
  qty: string;
}

const emptyLine = (): LineDraft => ({ itemType: "MATERIAL", itemId: "", qty: "" });

export function TransferOrdersPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [fromBinId, setFromBinId] = useState("");
  const [toBinId, setToBinId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  useInvalidateOn(["transferorder.created"], ["/transfer-orders"]);

  const query = useQuery({
    queryKey: ["/transfer-orders"],
    queryFn: () => apiGet<TransferOrderRow[]>("/transfer-orders"),
  });
  const bins = useQuery({
    queryKey: ["/bins"],
    queryFn: () => apiGet<BinOption[]>("/bins"),
    enabled: open,
  });
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

  const materialById = new Map((materials.data ?? []).map((m) => [m.id, m]));
  const partById = new Map((parts.data ?? []).map((p) => [p.id, p]));
  function itemLabel(itemType: "MATERIAL" | "PART", itemId: string) {
    if (itemType === "MATERIAL") {
      const m = materialById.get(itemId);
      return m ? `${m.code} — ${m.name}` : itemId;
    }
    const p = partById.get(itemId);
    return p ? `${p.partNo} — ${p.name}` : itemId;
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost("/transfer-orders", {
        fromBinId,
        toBinId,
        ...(notes ? { notes } : {}),
        lines: lines.map((l) => ({ itemType: l.itemType, itemId: l.itemId, qty: Number(l.qty) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/transfer-orders"] });
      qc.invalidateQueries({ queryKey: ["/bins"] });
      setOpen(false);
      toast("Transfer tamamlandı", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Transfer başarısız", "error");
    },
  });

  function openCreate() {
    setFromBinId("");
    setToBinId("");
    setNotes("");
    setLines([emptyLine()]);
    setOpen(true);
  }
  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Transfer Emirleri</h1>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Yeni Transfer
          </Button>
        )}
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["No", "Kaynak", "Hedef", "Satır", "Tarih"]}>
        {(query.data ?? []).length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(query.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.toNo}</td>
            <td className="px-4 py-3">
              {row.fromBin.warehouse.name} / {row.fromBin.code}
            </td>
            <td className="px-4 py-3">
              {row.toBin.warehouse.name} / {row.toBin.code}
            </td>
            <td className="px-4 py-3 text-xs text-slate-500">
              {row.lines.map((l) => `${itemLabel(l.itemType, l.itemId)}: ${fmtQty(l.qty)}`).join(", ")}
            </td>
            <td className="px-4 py-3">{fmtDate(row.createdAt)}</td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni Transfer Emri" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fromBin">Kaynak Raf</Label>
              <Select id="fromBin" required value={fromBinId} onChange={(e) => setFromBinId(e.target.value)}>
                <option value="">Seçin…</option>
                {bins.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.warehouse.name} / {b.code}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="toBin">Hedef Raf</Label>
              <Select id="toBin" required value={toBinId} onChange={(e) => setToBinId(e.target.value)}>
                <option value="">Seçin…</option>
                {bins.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.warehouse.name} / {b.code}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="notes">Notlar</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Satırlar</Label>
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-xs"
                onClick={() => setLines((ls) => [...ls, emptyLine()])}
              >
                <Plus className="h-3 w-3" /> Satır Ekle
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Select
                    className="w-28"
                    value={l.itemType}
                    onChange={(e) => setLine(i, { itemType: e.target.value as "MATERIAL" | "PART", itemId: "" })}
                  >
                    <option value="MATERIAL">Malzeme</option>
                    <option value="PART">Mamul</option>
                  </Select>
                  <div className="flex-1">
                    <Select required value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                      <option value="">Kalem…</option>
                      {l.itemType === "MATERIAL"
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
                  <Input
                    className="w-24"
                    type="number"
                    step="any"
                    min="0.001"
                    placeholder="Miktar"
                    required
                    value={l.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2 py-1 text-red-600"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Transfer ediliyor…" : "Transfer Et"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
