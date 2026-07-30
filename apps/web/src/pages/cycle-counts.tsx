import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPatch, apiPost } from "../lib/api";
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
interface BalanceRow {
  itemType: "MATERIAL" | "PART";
  itemId: string;
  qty: string;
}
interface CycleCountRow {
  id: string;
  ccNo: string;
  status: "OPEN" | "POSTED";
  bin: { id: string; code: string; warehouse: { name: string } };
  createdAt: string;
  lines: { id: string; itemType: "MATERIAL" | "PART"; itemId: string; systemQty: string; countedQty: string; varianceQty: string }[];
}
interface LineDraft {
  itemType: "MATERIAL" | "PART";
  itemId: string;
  countedQty: string;
}

export function CycleCountsPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER", "FOREMAN"].includes(user.role);
  const canPost = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [binId, setBinId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  useInvalidateOn(["cyclecount.created", "cyclecount.updated"], ["/cycle-counts"]);

  const query = useQuery({
    queryKey: ["/cycle-counts"],
    queryFn: () => apiGet<CycleCountRow[]>("/cycle-counts"),
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
  const balances = useQuery({
    queryKey: ["/bins", binId, "balances"],
    queryFn: () => apiGet<BalanceRow[]>(`/bins/${binId}/balances`),
    enabled: open && !!binId,
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

  function selectBin(id: string) {
    setBinId(id);
    setLines([]);
  }
  function loadBalancesIntoLines() {
    setLines(
      (balances.data ?? []).map((b) => ({ itemType: b.itemType, itemId: b.itemId, countedQty: b.qty })),
    );
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost("/cycle-counts", {
        binId,
        lines: lines
          .filter((l) => l.itemId && l.countedQty !== "")
          .map((l) => ({ itemType: l.itemType, itemId: l.itemId, countedQty: Number(l.countedQty) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/cycle-counts"] });
      setOpen(false);
      toast("Sayım kaydedildi", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Sayım kaydedilemedi", "error");
    },
  });

  const post = useMutation({
    mutationFn: (id: string) => apiPatch(`/cycle-counts/${id}/post`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/cycle-counts"] });
      toast("Sayım postalandı, stok bakiyeleri güncellendi", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Postalanamadı", "error");
    },
  });

  function openCreate() {
    setBinId("");
    setLines([]);
    setOpen(true);
  }
  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Stok Sayımı</h1>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Yeni Sayım
          </Button>
        )}
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <Table headers={["No", "Raf", "Durum", "Satır", "Tarih", "İşlem"]}>
        {(query.data ?? []).length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
              Kayıt yok
            </td>
          </tr>
        )}
        {(query.data ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.ccNo}</td>
            <td className="px-4 py-3">
              {row.bin.warehouse.name} / {row.bin.code}
            </td>
            <td className="px-4 py-3">
              <span
                className={
                  row.status === "OPEN"
                    ? "inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700"
                    : "inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700"
                }
              >
                {row.status === "OPEN" ? "Açık" : "Postalandı"}
              </span>
            </td>
            <td className="px-4 py-3 text-xs text-slate-500">
              {row.lines
                .map((l) => `${itemLabel(l.itemType, l.itemId)}: ${fmtQty(l.systemQty)}→${fmtQty(l.countedQty)}`)
                .join(", ")}
            </td>
            <td className="px-4 py-3">{fmtDate(row.createdAt)}</td>
            <td className="px-4 py-3">
              {canPost && row.status === "OPEN" && (
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => post.mutate(row.id)}>
                  <CheckCircle2 className="h-4 w-4" /> Postala
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={open} title="Yeni Stok Sayımı" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="binId">Raf</Label>
            <Select id="binId" required value={binId} onChange={(e) => selectBin(e.target.value)}>
              <option value="">Seçin…</option>
              {bins.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.warehouse.name} / {b.code}
                </option>
              ))}
            </Select>
          </div>

          {binId && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Sayım Satırları</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="px-2 py-1 text-xs"
                    onClick={loadBalancesIntoLines}
                  >
                    Mevcut Bakiyeleri Getir
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="px-2 py-1 text-xs"
                    onClick={() => setLines((ls) => [...ls, { itemType: "MATERIAL", itemId: "", countedQty: "" }])}
                  >
                    <Plus className="h-3 w-3" /> Satır Ekle
                  </Button>
                </div>
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
                      min="0"
                      placeholder="Sayılan"
                      required
                      value={l.countedQty}
                      onChange={(e) => setLine(i, { countedQty: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2 py-1 text-red-600"
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {lines.length === 0 && (
                  <p className="text-sm text-slate-400">Satır ekleyin veya mevcut bakiyeleri getirin.</p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={create.isPending || lines.length === 0}>
              Sayımı Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
