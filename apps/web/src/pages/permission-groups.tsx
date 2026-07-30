import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users2, X } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { PAGE_KEYS, type PageKey } from "@ahkmes/shared-types";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Card, Input, Label, Modal, Select } from "../components/ui";
import { useConfirm } from "../components/confirm-dialog";
import { useToast } from "../components/toast";

const PAGE_LABELS: Record<PageKey, string> = {
  customers: "Müşteriler",
  rfq: "Teklif Talepleri (RFQ)",
  quotes: "Teklifler",
  "sales-orders": "Satış Siparişleri",
  "work-orders": "İş Emirleri",
  mrp: "MRP Planlama",
  "purchase-orders": "Satınalma",
  production: "Operasyon",
  parts: "Parçalar",
  suppliers: "Tedarikçiler",
  materials: "Malzemeler",
  warehouses: "Depolar",
  lots: "Lot / Parti",
  "transfer-orders": "Transfer Emirleri",
  "cycle-counts": "Stok Sayımı",
  machines: "Tezgahlar",
  hierarchy: "Hiyerarşi",
  "digital-twin": "Digital Twin",
  "automation-gateway": "Automation Gateway",
  "non-conformances": "Kalite",
  inspections: "Muayene",
  capa: "CAPA",
  calibrations: "Kalibrasyon",
  "maintenance-orders": "Bakım Emirleri",
  energy: "Enerji İzleme",
  recipes: "Reçeteler",
  spc: "SPC",
  alarms: "Alarmlar",
  ar: "Alacaklar (AR)",
  ap: "Borçlar (AP)",
  genealogy: "Genealogy",
  scheduling: "Scheduling",
  "shift-report": "Vardiya Raporu",
  labor: "İşçilik Takibi",
  users: "Kullanıcılar",
  "audit-log": "Denetim İzi",
};

interface GroupMember {
  user: { id: string; name: string; email: string; role: string };
}
interface GroupRow {
  id: string;
  name: string;
  pages: string[];
  members: GroupMember[];
}
interface UserOption {
  id: string;
  name: string;
  email: string;
}

function GroupFormModal({
  group,
  onClose,
}: {
  group: GroupRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? "");
  const [pages, setPages] = useState<Set<string>>(new Set(group?.pages ?? []));

  const save = useMutation({
    mutationFn: () => {
      const dto = { name, pages: Array.from(pages) };
      return group ? apiPatch(`/permission-groups/${group.id}`, dto) : apiPost("/permission-groups", dto);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/permission-groups"] });
      onClose();
    },
    onError: () => toast("Kaydedilemedi", "error"),
  });

  function toggle(page: string) {
    setPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }

  return (
    <Modal open title={group ? "Grubu Düzenle" : "Yeni Rol Grubu"} onClose={onClose} className="max-w-lg">
      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Grup Adı</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="örn. Süpervizör" />
        </div>
        <div>
          <Label htmlFor="pages">Görebileceği Sayfalar</Label>
          <div className="grid grid-cols-2 gap-1.5 rounded-md border border-slate-200 p-3">
            {PAGE_KEYS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={pages.has(p)} onChange={() => toggle(p)} />
                {PAGE_LABELS[p]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">Hiç sayfa seçilmezse grup üyeleri hiçbir sayfayı göremez.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            Kaydet
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MembersModal({ group, onClose }: { group: GroupRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selectedUserId, setSelectedUserId] = useState("");

  const users = useQuery({
    queryKey: ["/users"],
    queryFn: () => apiGet<UserOption[]>("/users"),
  });
  const memberIds = new Set(group.members.map((m) => m.user.id));
  const available = (users.data ?? []).filter((u) => !memberIds.has(u.id));

  const addMember = useMutation({
    mutationFn: () => apiPost(`/permission-groups/${group.id}/members`, { userId: selectedUserId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/permission-groups"] });
      setSelectedUserId("");
    },
    onError: () => toast("Eklenemedi", "error"),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => apiDelete(`/permission-groups/${group.id}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/permission-groups"] }),
    onError: () => toast("Çıkarılamadı", "error"),
  });

  return (
    <Modal open title={`${group.name} — Üyeler`} onClose={onClose} className="max-w-md">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="flex-1">
            <option value="">Kullanıcı seç…</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
          <Button disabled={!selectedUserId || addMember.isPending} onClick={() => addMember.mutate()}>
            <Plus className="h-4 w-4" /> Ekle
          </Button>
        </div>
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {group.members.length === 0 && <li className="p-3 text-sm text-slate-400">Üye yok</li>}
          {group.members.map((m) => (
            <li key={m.user.id} className="flex items-center justify-between p-3 text-sm">
              <span>
                {m.user.name} <span className="text-slate-400">({m.user.email})</span>
              </span>
              <button
                onClick={() => removeMember.mutate(m.user.id)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                title="Gruptan çıkar"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PermissionGroupsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [formTarget, setFormTarget] = useState<{ group: GroupRow | null } | null>(null);
  const [membersTarget, setMembersTarget] = useState<GroupRow | null>(null);

  const query = useQuery({
    queryKey: ["/permission-groups"],
    queryFn: () => apiGet<GroupRow[]>("/permission-groups"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/permission-groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/permission-groups"] }),
    onError: () => toast("Silinemedi", "error"),
  });

  if (user && user.role !== "ADMIN") return <Navigate to="/" replace />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Users2 className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold">Rol Grupları</h1>
        </div>
        <Button onClick={() => setFormTarget({ group: null })}>
          <Plus className="h-4 w-4" /> Yeni Grup
        </Button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Gruplar, üyelerinin hangi sayfaları görebileceğini belirler (rol ile bağımsız çalışır). Bir kullanıcı hiçbir
        gruba üye değilse tüm sayfalara erişebilir — kısıtlamak için en az bir gruba eklemeniz gerekir.
      </p>

      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(query.data ?? []).map((g) => (
          <Card key={g.id}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">{g.name}</h2>
              <div className="flex gap-1">
                <Button variant="ghost" className="px-2 py-1" onClick={() => setFormTarget({ group: g })}>
                  Düzenle
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-red-600"
                  onClick={async () => {
                    if (await confirm({ message: `"${g.name}" grubu silinsin mi?`, danger: true }))
                      remove.mutate(g.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-1">
              {g.pages.length === 0 && <span className="text-xs text-slate-400">Sayfa seçilmemiş</span>}
              {g.pages.map((p) => (
                <span key={p} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {PAGE_LABELS[p as PageKey] ?? p}
                </span>
              ))}
            </div>
            <button
              onClick={() => setMembersTarget(g)}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              {g.members.length} üye — yönet
            </button>
          </Card>
        ))}
        {query.data?.length === 0 && <p className="text-sm text-slate-400">Henüz rol grubu yok.</p>}
      </div>

      {formTarget && <GroupFormModal group={formTarget.group} onClose={() => setFormTarget(null)} />}
      {membersTarget && (
        <MembersModal
          group={query.data?.find((g) => g.id === membersTarget.id) ?? membersTarget}
          onClose={() => setMembersTarget(null)}
        />
      )}
    </div>
  );
}
