import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Input, Label, Modal, Select, Table } from "../components/ui";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useTagValues } from "../lib/socket";

type ConnectorType = "MANUAL" | "OPC_UA" | "M80";

interface MachineOption {
  id: string;
  name: string;
  connectorType: ConnectorType;
  connectorConfig: Record<string, unknown> | null;
}

const CONNECTOR_LABEL: Record<ConnectorType, string> = {
  MANUAL: "Manuel (bağlantı yok)",
  OPC_UA: "OPC-UA",
  M80: "Mitsubishi M80 (EZSocket/GIOP)",
};

/** Bağlantı tipine göre dinamik config formu — panel seçilince ilgili alanlar gösterilir. */
function ConnectionSettingsCard({ machine }: { machine: MachineOption }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [connectorType, setConnectorType] = useState<ConnectorType>(machine.connectorType);
  const [config, setConfig] = useState<Record<string, string>>(
    (machine.connectorConfig as Record<string, string>) ?? {},
  );

  useEffect(() => {
    setConnectorType(machine.connectorType);
    setConfig((machine.connectorConfig as Record<string, string>) ?? {});
  }, [machine.id, machine.connectorType, machine.connectorConfig]);

  const save = useMutation({
    mutationFn: () => apiPatch(`/machines/${machine.id}`, { connectorType, connectorConfig: config }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/machines"] }),
    onError: () => toast("Bağlantı ayarları kaydedilemedi", "error"),
  });

  return (
    <Card>
      <div className="mb-3 text-xs uppercase text-slate-500">Bağlantı Ayarları</div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="connectorType">Bağlantı Tipi</Label>
          <Select
            id="connectorType"
            value={connectorType}
            onChange={(e) => {
              setConnectorType(e.target.value as ConnectorType);
              setConfig({});
            }}
          >
            {(Object.entries(CONNECTOR_LABEL) as [ConnectorType, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {connectorType === "OPC_UA" && (
          <div>
            <Label htmlFor="endpointUrl">Endpoint URL</Label>
            <Input
              id="endpointUrl"
              placeholder="opc.tcp://host:4840/UA/Machine"
              value={config.endpointUrl ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, endpointUrl: e.target.value }))}
            />
          </div>
        )}

        {connectorType === "M80" && (
          <>
            <div>
              <Label htmlFor="host">Host</Label>
              <Input
                id="host"
                placeholder="192.168.1.10"
                value={config.host ?? ""}
                onChange={(e) => setConfig((c) => ({ ...c, host: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                placeholder="683"
                value={config.port ?? ""}
                onChange={(e) => setConfig((c) => ({ ...c, port: e.target.value }))}
              />
            </div>
          </>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Kaydet
        </Button>
      </div>
    </Card>
  );
}

interface TagRow {
  id: string;
  name: string;
  address: string;
  dataType: "NUMBER" | "STRING" | "BOOLEAN";
  lastValue?: string | null;
  lastValueAt?: string | null;
}

interface TagFormState {
  name: string;
  address: string;
  dataType: "NUMBER" | "STRING" | "BOOLEAN";
}

const EMPTY_FORM: TagFormState = { name: "", address: "", dataType: "STRING" };

function TagFormModal({
  machineId,
  tag,
  onClose,
}: {
  machineId: string;
  tag: TagRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const queryKey = `/machines/${machineId}/tags`;
  const [form, setForm] = useState<TagFormState>(
    tag ? { name: tag.name, address: tag.address, dataType: tag.dataType } : EMPTY_FORM,
  );

  const save = useMutation({
    mutationFn: () =>
      tag
        ? apiPatch(`/machines/${machineId}/tags/${tag.id}`, form)
        : apiPost(`/machines/${machineId}/tags`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError && err.body && typeof err.body === "object" && "message" in err.body
          ? String((err.body as { message: unknown }).message)
          : "Kaydedilemedi";
      toast(message, "error");
    },
  });

  return (
    <Modal open title={tag ? "Tag Düzenle" : "Yeni Tag"} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Ad</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="address">
            Adres (OPC-UA: <code>ns=1;s=CycleStatus</code>, M80: <code>13:40031</code>)
          </Label>
          <Input
            id="address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="dataType">Veri Tipi</Label>
          <Select
            id="dataType"
            value={form.dataType}
            onChange={(e) => setForm((f) => ({ ...f, dataType: e.target.value as TagFormState["dataType"] }))}
          >
            <option value="STRING">STRING</option>
            <option value="NUMBER">NUMBER</option>
            <option value="BOOLEAN">BOOLEAN</option>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={save.isPending || !form.name || !form.address} onClick={() => save.mutate()}>
            Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function AutomationGatewayPage() {
  const { user } = useAuth();
  const canManage = !!user && user.role === "ADMIN";
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [machineId, setMachineId] = useState<string>("");
  const [formTag, setFormTag] = useState<TagRow | "new" | null>(null);

  const machines = useQuery({
    queryKey: ["/machines"],
    queryFn: () => apiGet<MachineOption[]>("/machines"),
  });

  const tagsQueryKey = `/machines/${machineId}/tags`;
  const tags = useQuery({
    queryKey: [tagsQueryKey],
    queryFn: () => apiGet<TagRow[]>(`/machines/${machineId}/tags`),
    enabled: !!machineId,
  });

  useTagValues(machineId || null, tagsQueryKey);

  const removeTag = useMutation({
    mutationFn: (tagId: string) => apiDelete(`/machines/${machineId}/tags/${tagId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [tagsQueryKey] }),
    onError: () => toast("Silinemedi", "error"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Automation Gateway</h1>
        {canManage && machineId && (
          <Button onClick={() => setFormTag("new")}>
            <Plus className="mr-1 h-4 w-4" /> Tag Ekle
          </Button>
        )}
      </div>

      <div className="max-w-xs">
        <Label htmlFor="machine">Makine</Label>
        <Select id="machine" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
          <option value="">Seçiniz</option>
          {(machines.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>

      {machineId &&
        (() => {
          const selected = (machines.data ?? []).find((m) => m.id === machineId);
          return selected && canManage ? <ConnectionSettingsCard machine={selected} /> : null;
        })()}

      {machineId && (
        <Table headers={["Ad", "Adres", "Tip", "Son Değer", "Güncelleme", "İşlem"]}>
          {(tags.data ?? []).map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-3 font-medium">{t.name}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500">{t.address}</td>
              <td className="px-4 py-3">{t.dataType}</td>
              <td className="px-4 py-3 font-mono">{t.lastValue ?? "—"}</td>
              <td className="px-4 py-3 text-xs text-slate-400">
                {t.lastValueAt ? fmtDate(t.lastValueAt) : "—"}
              </td>
              <td className="px-4 py-3">
                {canManage && (
                  <div className="flex gap-1">
                    <Button variant="ghost" className="px-2 py-1" onClick={() => setFormTag(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1"
                      onClick={async () => {
                        if (await confirm({ message: `"${t.name}" tag'i silinsin mi?`, danger: true }))
                          removeTag.mutate(t.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {tags.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                Bu makine için tanımlı tag yok.
              </td>
            </tr>
          )}
        </Table>
      )}

      {formTag && (
        <TagFormModal
          machineId={machineId}
          tag={formTag === "new" ? null : formTag}
          onClose={() => setFormTag(null)}
        />
      )}
    </div>
  );
}
