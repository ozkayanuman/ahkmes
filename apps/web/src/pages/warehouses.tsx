import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Warehouse as WarehouseIcon } from "lucide-react";
import { useState } from "react";
import { ApiError, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Input, Label, Modal, Table } from "../components/ui";
import { useToast } from "../components/toast";

interface BinRow {
  id: string;
  code: string;
  name: string | null;
}
interface WarehouseRow {
  id: string;
  name: string;
  code: string | null;
  bins: BinRow[];
}

export function WarehousesPage() {
  const { user } = useAuth();
  const canWrite = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [whOpen, setWhOpen] = useState(false);
  const [whName, setWhName] = useState("");
  const [whCode, setWhCode] = useState("");
  const [binWarehouse, setBinWarehouse] = useState<WarehouseRow | null>(null);
  const [binCode, setBinCode] = useState("");
  const [binName, setBinName] = useState("");

  const query = useQuery({
    queryKey: ["/warehouses"],
    queryFn: () => apiGet<WarehouseRow[]>("/warehouses"),
  });

  const createWarehouse = useMutation({
    mutationFn: () => apiPost("/warehouses", { name: whName, ...(whCode ? { code: whCode } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/warehouses"] });
      setWhOpen(false);
      setWhName("");
      setWhCode("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Depo oluşturulamadı", "error");
    },
  });

  const createBin = useMutation({
    mutationFn: () =>
      apiPost("/bins", {
        warehouseId: binWarehouse!.id,
        code: binCode,
        ...(binName ? { name: binName } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/warehouses"] });
      setBinWarehouse(null);
      setBinCode("");
      setBinName("");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Raf oluşturulamadı", "error");
    },
  });

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Depolar</h1>
        {canWrite && (
          <Button onClick={() => setWhOpen(true)}>
            <Plus className="h-4 w-4" /> Yeni Depo
          </Button>
        )}
      </div>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {query.error && <p className="text-red-600">Liste alınamadı.</p>}

      <div className="space-y-3">
        {(query.data ?? []).map((wh) => (
          <div key={wh.id} className="rounded-lg border border-slate-200">
            <button
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              onClick={() => toggle(wh.id)}
            >
              <span className="flex items-center gap-2 font-medium">
                {expanded.has(wh.id) ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <WarehouseIcon className="h-4 w-4 text-slate-400" />
                {wh.name}
                {wh.code && <span className="text-xs text-slate-400">({wh.code})</span>}
              </span>
              <span className="text-xs text-slate-400">{wh.bins.length} raf</span>
            </button>
            {expanded.has(wh.id) && (
              <div className="border-t border-slate-100 p-4">
                <Table headers={["Kod", "Ad"]}>
                  {wh.bins.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                        Raf yok.
                      </td>
                    </tr>
                  )}
                  {wh.bins.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2 font-medium">{b.code}</td>
                      <td className="px-4 py-2">{b.name ?? "—"}</td>
                    </tr>
                  ))}
                </Table>
                {canWrite && (
                  <Button
                    variant="outline"
                    className="mt-3 px-2 py-1 text-xs"
                    onClick={() => setBinWarehouse(wh)}
                  >
                    <Plus className="h-3 w-3" /> Raf Ekle
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
        {query.data?.length === 0 && <p className="text-center text-slate-400">Depo yok.</p>}
      </div>

      <Modal open={whOpen} title="Yeni Depo" onClose={() => setWhOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createWarehouse.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="whName">Ad</Label>
            <Input id="whName" required value={whName} onChange={(e) => setWhName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="whCode">Kod</Label>
            <Input id="whCode" value={whCode} onChange={(e) => setWhCode(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setWhOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={createWarehouse.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={binWarehouse !== null} title={`${binWarehouse?.name} — Yeni Raf`} onClose={() => setBinWarehouse(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createBin.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="binCode">Kod</Label>
            <Input id="binCode" required value={binCode} onChange={(e) => setBinCode(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="binName">Ad</Label>
            <Input id="binName" value={binName} onChange={(e) => setBinName(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setBinWarehouse(null)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={createBin.isPending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
