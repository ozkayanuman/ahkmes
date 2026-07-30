import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { Button, Input, Label, Modal, Select, Table } from "../components/ui";
import { useToast } from "../components/toast";

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

  const create = useMutation({
    mutationFn: () =>
      apiPost("/lots", { lotNo, itemType, itemId, ...(expiryDate ? { expiryDate } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/lots"] });
      setOpen(false);
      setLotNo("");
      setItemId("");
      setExpiryDate("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Lot oluşturulamadı", "error");
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Lot / Parti Takibi</h1>
        {canWrite && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Yeni Lot
          </Button>
        )}
      </div>

      {lots.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["Lot No", "Tip", "Kalem", "Son Kullanma", "Alım Tarihi"]}>
        {(lots.data ?? []).length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(lots.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.lotNo}</td>
            <td className="px-4 py-3">{row.itemType === "MATERIAL" ? "Malzeme" : "Mamul"}</td>
            <td className="px-4 py-3">{itemLabel(row)}</td>
            <td className="px-4 py-3">{row.expiryDate ? fmtDate(row.expiryDate) : "—"}</td>
            <td className="px-4 py-3">{fmtDate(row.receivedDate)}</td>
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
    </div>
  );
}
