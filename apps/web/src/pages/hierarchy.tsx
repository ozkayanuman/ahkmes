import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Factory, Layers, Plus, Server, Trash2, Pencil, Cpu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Card, Input, Label, Modal, Select } from "../components/ui";

interface MachineNode {
  id: string;
  name: string;
  model: string;
  controller?: string | null;
  isActive: boolean;
  lastStatus?: string | null;
  activeWorkOrder?: { id: string; woNo: string; status: string } | null;
}
interface UnitNode {
  id: string;
  name: string;
  machines: MachineNode[];
}
interface WorkplaceNode {
  id: string;
  name: string;
  units: UnitNode[];
}
interface AreaNode {
  id: string;
  name: string;
  workplaces: WorkplaceNode[];
}
interface PlantNode {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  areas: AreaNode[];
}
interface MachineRow {
  id: string;
  name: string;
  model: string;
  unitId?: string | null;
}

const onError = (e: unknown) => {
  const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
  alert(msg ?? "İşlem başarısız.");
};

function machineDotColor(m: MachineNode) {
  if (!m.isActive) return "bg-slate-400";
  if (m.lastStatus === "ALARM") return "bg-red-500";
  if (m.activeWorkOrder) return "bg-blue-500";
  return "bg-green-500";
}

type Level = "plant" | "area" | "workplace" | "unit";

/** Saha hiyerarşisi: Plant > Area > Workplace > Unit > Machine (ISA-95 tarzı).
 * Hem normal süreçlerde (makine yerleşimi) hem Digital Twin'de temel olarak kullanılır. */
export function HierarchyPage() {
  const { user } = useAuth();
  const canManage = !!user && ["ADMIN", "PLANNER"].includes(user.role);
  const canDelete = !!user && user.role === "ADMIN";
  const qc = useQueryClient();

  const tree = useQuery({ queryKey: ["/hierarchy/tree"], queryFn: () => apiGet<PlantNode[]>("/hierarchy/tree") });
  const machines = useQuery({ queryKey: ["/machines"], queryFn: () => apiGet<MachineRow[]>("/machines") });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/hierarchy/tree"] });
    qc.invalidateQueries({ queryKey: ["/machines"] });
  };

  const [formState, setFormState] = useState<{
    level: Level;
    parentId?: string;
    editing?: { id: string; name: string; code?: string; location?: string };
  } | null>(null);

  const createPlant = useMutation({
    mutationFn: (data: { name: string; code?: string; location?: string }) => apiPost("/hierarchy/plants", data),
    onSuccess: () => {
      invalidate();
      setFormState(null);
    },
    onError,
  });
  const updatePlant = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; code?: string; location?: string } }) =>
      apiPatch(`/hierarchy/plants/${id}`, data),
    onSuccess: () => {
      invalidate();
      setFormState(null);
    },
    onError,
  });
  const removePlant = useMutation({
    mutationFn: (id: string) => apiDelete(`/hierarchy/plants/${id}`),
    onSuccess: invalidate,
    onError,
  });

  const createArea = useMutation({
    mutationFn: ({ plantId, name }: { plantId: string; name: string }) =>
      apiPost("/hierarchy/areas", { plantId, name }),
    onSuccess: () => {
      invalidate();
      setFormState(null);
    },
    onError,
  });
  const updateArea = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPatch(`/hierarchy/areas/${id}`, { name }),
    onSuccess: () => {
      invalidate();
      setFormState(null);
    },
    onError,
  });
  const removeArea = useMutation({
    mutationFn: (id: string) => apiDelete(`/hierarchy/areas/${id}`),
    onSuccess: invalidate,
    onError,
  });

  const createWorkplace = useMutation({
    mutationFn: ({ workplaceId: _ignored, areaId, name }: { areaId: string; name: string; workplaceId?: never }) =>
      apiPost("/hierarchy/workplaces", { areaId, name }),
    onSuccess: () => {
      invalidate();
      setFormState(null);
    },
    onError,
  });
  const updateWorkplace = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPatch(`/hierarchy/workplaces/${id}`, { name }),
    onSuccess: () => {
      invalidate();
      setFormState(null);
    },
    onError,
  });
  const removeWorkplace = useMutation({
    mutationFn: (id: string) => apiDelete(`/hierarchy/workplaces/${id}`),
    onSuccess: invalidate,
    onError,
  });

  const createUnit = useMutation({
    mutationFn: ({ workplaceId, name }: { workplaceId: string; name: string }) =>
      apiPost("/hierarchy/units", { workplaceId, name }),
    onSuccess: () => {
      invalidate();
      setFormState(null);
    },
    onError,
  });
  const updateUnit = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPatch(`/hierarchy/units/${id}`, { name }),
    onSuccess: () => {
      invalidate();
      setFormState(null);
    },
    onError,
  });
  const removeUnit = useMutation({
    mutationFn: (id: string) => apiDelete(`/hierarchy/units/${id}`),
    onSuccess: invalidate,
    onError,
  });

  const assignMachine = useMutation({
    mutationFn: ({ machineId, unitId }: { machineId: string; unitId: string | null }) =>
      apiPatch(`/hierarchy/machines/${machineId}/unit`, { unitId }),
    onSuccess: invalidate,
    onError,
  });

  const unassigned = (machines.data ?? []).filter((m) => !m.unitId);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Saha Hiyerarşisi</h1>
        {canManage && (
          <Button onClick={() => setFormState({ level: "plant" })}>
            <Plus className="h-4 w-4" /> Yeni Tesis
          </Button>
        )}
      </div>

      {tree.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      {tree.data?.length === 0 && <p className="text-slate-400">Henüz tesis eklenmedi.</p>}

      <div className="space-y-3">
        {tree.data?.map((plant) => (
          <PlantRow
            key={plant.id}
            plant={plant}
            canManage={canManage}
            canDelete={canDelete}
            onAddArea={(plantId) => setFormState({ level: "area", parentId: plantId })}
            onEditPlant={(p) =>
              setFormState({
                level: "plant",
                editing: { id: p.id, name: p.name, code: p.code ?? "", location: p.location ?? "" },
              })
            }
            onDeletePlant={(id) => {
              if (confirm("Bu tesis (ve altındaki her şey) silinsin mi?")) removePlant.mutate(id);
            }}
            onAddWorkplace={(areaId) => setFormState({ level: "workplace", parentId: areaId })}
            onEditArea={(a) => setFormState({ level: "area", editing: { id: a.id, name: a.name } })}
            onDeleteArea={(id) => {
              if (confirm("Bu alan (ve altındaki her şey) silinsin mi?")) removeArea.mutate(id);
            }}
            onAddUnit={(workplaceId) => setFormState({ level: "unit", parentId: workplaceId })}
            onEditWorkplace={(w) => setFormState({ level: "workplace", editing: { id: w.id, name: w.name } })}
            onDeleteWorkplace={(id) => {
              if (confirm("Bu çalışma alanı (ve altındaki her şey) silinsin mi?")) removeWorkplace.mutate(id);
            }}
            onEditUnit={(u) => setFormState({ level: "unit", editing: { id: u.id, name: u.name } })}
            onDeleteUnit={(id) => {
              if (confirm("Bu birim silinsin mi? İçindeki makineler yerleşimsiz kalır.")) removeUnit.mutate(id);
            }}
            onUnassignMachine={(machineId) => assignMachine.mutate({ machineId, unitId: null })}
          />
        ))}
      </div>

      {canManage && unassigned.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Yerleşimsiz Makineler ({unassigned.length})</h2>
          <div className="space-y-2">
            {unassigned.map((m) => (
              <UnassignedMachineRow
                key={m.id}
                machine={m}
                tree={tree.data ?? []}
                onAssign={(unitId) => assignMachine.mutate({ machineId: m.id, unitId })}
              />
            ))}
          </div>
        </Card>
      )}

      {formState && (
        <NodeFormModal
          state={formState}
          onClose={() => setFormState(null)}
          onSubmit={(name, extra) => {
            const { level, parentId, editing } = formState;
            if (level === "plant") {
              if (editing) updatePlant.mutate({ id: editing.id, data: { name, ...extra } });
              else createPlant.mutate({ name, ...extra });
            } else if (level === "area") {
              if (editing) updateArea.mutate({ id: editing.id, name });
              else createArea.mutate({ plantId: parentId!, name });
            } else if (level === "workplace") {
              if (editing) updateWorkplace.mutate({ id: editing.id, name });
              else createWorkplace.mutate({ areaId: parentId!, name });
            } else if (level === "unit") {
              if (editing) updateUnit.mutate({ id: editing.id, name });
              else createUnit.mutate({ workplaceId: parentId!, name });
            }
          }}
        />
      )}
    </div>
  );
}

const LEVEL_LABEL: Record<Level, string> = {
  plant: "Tesis (Plant)",
  area: "Alan (Area)",
  workplace: "Çalışma Alanı (Workplace)",
  unit: "Birim (Unit)",
};

function NodeFormModal({
  state,
  onClose,
  onSubmit,
}: {
  state: { level: Level; parentId?: string; editing?: { id: string; name: string; code?: string; location?: string } };
  onClose: () => void;
  onSubmit: (name: string, extra?: { code?: string; location?: string }) => void;
}) {
  const [name, setName] = useState(state.editing?.name ?? "");
  const [code, setCode] = useState(state.editing?.code ?? "");
  const [location, setLocation] = useState(state.editing?.location ?? "");
  const isPlant = state.level === "plant";

  return (
    <Modal open onClose={onClose} title={`${state.editing ? "Düzenle" : "Yeni"} — ${LEVEL_LABEL[state.level]}`}>
      <div className="space-y-3">
        <div>
          <Label htmlFor="node-name">Ad</Label>
          <Input id="node-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {isPlant && (
          <>
            <div>
              <Label htmlFor="node-code">Kod (opsiyonel)</Label>
              <Input id="node-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="node-location">Konum (opsiyonel)</Label>
              <Input id="node-location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
          </>
        )}
        <Button
          className="w-full"
          disabled={!name.trim()}
          onClick={() => onSubmit(name.trim(), isPlant ? { code: code.trim(), location: location.trim() } : undefined)}
        >
          Kaydet
        </Button>
      </div>
    </Modal>
  );
}

function Expandable({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
  defaultOpen = true,
}: {
  icon: typeof Factory;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex items-center justify-between rounded-md py-1.5 pr-1 hover:bg-slate-50">
        <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
          {open ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
          <Icon className="h-4 w-4 text-slate-500" />
          <span className="font-medium text-slate-800">{title}</span>
          {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
        </button>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      {open && <div className="ml-6 border-l border-slate-200 pl-4">{children}</div>}
    </div>
  );
}

function IconBtn({ title, onClick, danger }: { title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded p-1 hover:bg-slate-100 ${danger ? "text-red-600" : "text-slate-500"}`}
    >
      {title === "Sil" ? (
        <Trash2 className="h-3.5 w-3.5" />
      ) : title.startsWith("Ekle") ? (
        <Plus className="h-3.5 w-3.5" />
      ) : (
        <Pencil className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function PlantRow(props: {
  plant: PlantNode;
  canManage: boolean;
  canDelete: boolean;
  onAddArea: (plantId: string) => void;
  onEditPlant: (p: PlantNode) => void;
  onDeletePlant: (id: string) => void;
  onAddWorkplace: (areaId: string) => void;
  onEditArea: (a: AreaNode) => void;
  onDeleteArea: (id: string) => void;
  onAddUnit: (workplaceId: string) => void;
  onEditWorkplace: (w: WorkplaceNode) => void;
  onDeleteWorkplace: (id: string) => void;
  onEditUnit: (u: UnitNode) => void;
  onDeleteUnit: (id: string) => void;
  onUnassignMachine: (machineId: string) => void;
}) {
  const { plant, canManage, canDelete } = props;
  return (
    <Card>
      <Expandable
        icon={Factory}
        title={plant.name}
        subtitle={[plant.code, plant.location].filter(Boolean).join(" · ") || undefined}
        actions={
          canManage && (
            <>
              <IconBtn title="Ekle: Alan" onClick={() => props.onAddArea(plant.id)} />
              <IconBtn title="Düzenle" onClick={() => props.onEditPlant(plant)} />
              {canDelete && <IconBtn title="Sil" danger onClick={() => props.onDeletePlant(plant.id)} />}
            </>
          )
        }
      >
        {plant.areas.length === 0 && <p className="py-2 text-sm text-slate-400">Alan yok.</p>}
        {plant.areas.map((area) => (
          <Expandable
            key={area.id}
            icon={Layers}
            title={area.name}
            actions={
              canManage && (
                <>
                  <IconBtn title="Ekle: Çalışma Alanı" onClick={() => props.onAddWorkplace(area.id)} />
                  <IconBtn title="Düzenle" onClick={() => props.onEditArea(area)} />
                  {canDelete && <IconBtn title="Sil" danger onClick={() => props.onDeleteArea(area.id)} />}
                </>
              )
            }
          >
            {area.workplaces.length === 0 && <p className="py-2 text-sm text-slate-400">Çalışma alanı yok.</p>}
            {area.workplaces.map((wp) => (
              <Expandable
                key={wp.id}
                icon={Server}
                title={wp.name}
                actions={
                  canManage && (
                    <>
                      <IconBtn title="Ekle: Birim" onClick={() => props.onAddUnit(wp.id)} />
                      <IconBtn title="Düzenle" onClick={() => props.onEditWorkplace(wp)} />
                      {canDelete && <IconBtn title="Sil" danger onClick={() => props.onDeleteWorkplace(wp.id)} />}
                    </>
                  )
                }
              >
                {wp.units.length === 0 && <p className="py-2 text-sm text-slate-400">Birim yok.</p>}
                {wp.units.map((unit) => (
                  <div key={unit.id} className="py-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-slate-500" />
                        <span className="font-medium text-slate-800">{unit.name}</span>
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-1">
                          <IconBtn title="Düzenle" onClick={() => props.onEditUnit(unit)} />
                          {canDelete && <IconBtn title="Sil" danger onClick={() => props.onDeleteUnit(unit.id)} />}
                        </div>
                      )}
                    </div>
                    <div className="ml-6 mt-1 space-y-1">
                      {unit.machines.length === 0 && <p className="text-xs text-slate-400">Makine yok.</p>}
                      {unit.machines.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${machineDotColor(m)}`} />
                            <span>{m.name}</span>
                            <span className="text-xs text-slate-400">{m.model}</span>
                            {m.activeWorkOrder && (
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                                {m.activeWorkOrder.woNo}
                              </span>
                            )}
                          </div>
                          {canManage && (
                            <button
                              className="text-xs text-slate-400 hover:text-red-600"
                              onClick={() => props.onUnassignMachine(m.id)}
                            >
                              Kaldır
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </Expandable>
            ))}
          </Expandable>
        ))}
      </Expandable>
    </Card>
  );
}

function UnassignedMachineRow({
  machine,
  tree,
  onAssign,
}: {
  machine: MachineRow;
  tree: PlantNode[];
  onAssign: (unitId: string) => void;
}) {
  const [unitId, setUnitId] = useState("");
  const options = tree.flatMap((p) =>
    p.areas.flatMap((a) =>
      a.workplaces.flatMap((w) =>
        w.units.map((u) => ({ id: u.id, label: `${p.name} / ${a.name} / ${w.name} / ${u.name}` })),
      ),
    ),
  );
  return (
    <div className="flex items-center justify-between gap-3 rounded bg-slate-50 px-3 py-2 text-sm">
      <span>
        {machine.name} <span className="text-xs text-slate-400">{machine.model}</span>
      </span>
      <div className="flex items-center gap-2">
        <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="h-8 text-xs">
          <option value="">Birim seçin…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <Button className="h-8 px-3 text-xs" disabled={!unitId} onClick={() => unitId && onAssign(unitId)}>
          Yerleştir
        </Button>
      </div>
    </div>
  );
}
