import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, KeySquare, ShieldCheck, Trash2, Upload, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import { CrudPage } from "../components/crud-page";
import { Button, Input, Label, Modal, Select } from "../components/ui";
import { ApiError, apiDelete, apiGet, apiPost, apiUpload } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useToast } from "../components/toast";
import { useConfirm } from "../components/confirm-dialog";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  authSource?: "LOCAL" | "LDAP" | "OIDC";
}

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Yönetici" },
  { value: "SALES", label: "Satış" },
  { value: "PLANNER", label: "Planlamacı" },
  { value: "FOREMAN", label: "Usta" },
  { value: "OPERATOR", label: "Operatör" },
];

interface ImportResult {
  created: { email: string; name: string; password?: string }[];
  errors: string[];
}

function ImportCsvModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: (file: File) => apiUpload<ImportResult>("/users/import", file),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ["/users"] });
    },
    onError: () => toast("İçe aktarma başarısız", "error"),
  });

  return (
    <Modal open title="Kullanıcıları CSV'den İçe Aktar" onClose={onClose} className="max-w-lg">
      <div className="space-y-4 text-sm">
        <p className="text-slate-500">
          Kolonlar: <code>email,name,role</code> (zorunlu), <code>password</code> (opsiyonel — boş bırakılırsa
          rastgele şifre üretilir ve bir kez gösterilir). Rol değerleri: ADMIN, SALES, PLANNER, FOREMAN, OPERATOR.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importMutation.mutate(file);
          }}
        />
        {importMutation.isPending && <p className="text-slate-500">Yükleniyor…</p>}
        {result && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <p className="font-medium text-green-700">{result.created.length} kullanıcı oluşturuldu.</p>
            {result.created.filter((c) => c.password).length > 0 && (
              <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                <p className="mb-1 font-semibold">Rastgele üretilen şifreler (bir daha gösterilmez):</p>
                <ul className="space-y-0.5 font-mono">
                  {result.created
                    .filter((c) => c.password)
                    .map((c) => (
                      <li key={c.email}>
                        {c.email}: {c.password}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="text-xs text-red-600">
                {result.errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface LdapConfigView {
  host: string;
  port: number;
  useTls: boolean;
  bindDn: string;
  baseDn: string;
  userFilter: string;
  attrEmail: string;
  attrName: string;
  defaultRole: string;
  configured: boolean;
}

function LdapSettingsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ["/ldap/config"],
    queryFn: () => apiGet<LdapConfigView | null>("/ldap/config"),
  });
  const [form, setForm] = useState({
    host: "",
    port: 389,
    useTls: false,
    bindDn: "",
    bindPassword: "",
    baseDn: "",
    userFilter: "(objectClass=person)",
    attrEmail: "mail",
    attrName: "displayName",
    defaultRole: "OPERATOR",
  });
  const [loaded, setLoaded] = useState(false);
  if (existing.data && !loaded) {
    setForm((f) => ({ ...f, ...existing.data }));
    setLoaded(true);
  }
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);

  const test = useMutation({
    mutationFn: () => apiPost("/ldap/test-connection", form),
    onSuccess: () => setTestResult("ok"),
    onError: () => setTestResult("fail"),
  });
  const save = useMutation({
    mutationFn: () => apiPost("/ldap/config", form),
    onSuccess: () => {
      toast("LDAP yapılandırması kaydedildi", "success");
      qc.invalidateQueries({ queryKey: ["/ldap/config"] });
    },
    onError: () => toast("Kaydedilemedi", "error"),
  });
  const sync = useMutation({
    mutationFn: () => apiPost<{ created: number; updated: number; skipped: number }>("/ldap/sync", {}),
    onSuccess: (res) => {
      setSyncResult(res);
      qc.invalidateQueries({ queryKey: ["/users"] });
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Senkronizasyon başarısız", "error");
    },
  });

  return (
    <Modal open title="Active Directory / LDAP Ayarları" onClose={onClose} className="max-w-xl">
      <div className="space-y-4 text-sm">
        <p className="text-slate-500">
          Fabrikanızın kendi Active Directory sunucusuna bağlanarak kullanıcıları içe aktarın. LDAP kaynaklı
          kullanıcıların şifresi burada saklanmaz — girişte doğrudan AD'ye bağlanılarak doğrulanır.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="host">Sunucu (host)</Label>
            <Input id="host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="port">Port</Label>
            <Input
              id="port"
              type="number"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="bindDn">Bind DN (servis hesabı)</Label>
            <Input
              id="bindDn"
              placeholder="cn=admin,dc=firma,dc=local"
              value={form.bindDn}
              onChange={(e) => setForm({ ...form, bindDn: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="bindPassword">Bind Şifresi</Label>
            <Input
              id="bindPassword"
              type="password"
              value={form.bindPassword}
              onChange={(e) => setForm({ ...form, bindPassword: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="baseDn">Base DN</Label>
            <Input
              id="baseDn"
              placeholder="ou=users,dc=firma,dc=local"
              value={form.baseDn}
              onChange={(e) => setForm({ ...form, baseDn: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="userFilter">Kullanıcı Filtresi</Label>
            <Input
              id="userFilter"
              value={form.userFilter}
              onChange={(e) => setForm({ ...form, userFilter: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="attrEmail">E-posta Alanı</Label>
            <Input
              id="attrEmail"
              value={form.attrEmail}
              onChange={(e) => setForm({ ...form, attrEmail: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="attrName">Ad Alanı</Label>
            <Input
              id="attrName"
              value={form.attrName}
              onChange={(e) => setForm({ ...form, attrName: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="defaultRole">Yeni Kullanıcılar İçin Varsayılan Rol</Label>
            <Select
              id="defaultRole"
              value={form.defaultRole}
              onChange={(e) => setForm({ ...form, defaultRole: e.target.value })}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {testResult === "ok" && <p className="text-sm text-green-700">Bağlantı başarılı.</p>}
        {testResult === "fail" && <p className="text-sm text-red-600">Bağlantı kurulamadı, bilgileri kontrol edin.</p>}
        {syncResult && (
          <p className="text-sm text-slate-600">
            Senkronizasyon: {syncResult.created} yeni, {syncResult.updated} güncellendi, {syncResult.skipped} atlandı.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
          <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            Bağlantıyı Test Et
          </Button>
          <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
            Kaydet
          </Button>
          <Button disabled={sync.isPending || !existing.data?.configured} onClick={() => sync.mutate()}>
            Kullanıcıları Senkronize Et
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface OidcProviderRow {
  id: string;
  name: string;
  issuer: string;
  isActive: boolean;
}

/** LdapSettingsModal ile aynı yerde (Kullanıcılar sayfası) ama farklı desen —
 * LDAP tek yapılandırma (upsert), OIDC çoklu sağlayıcı (liste + ekle/sil). */
function OidcSettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [defaultRole, setDefaultRole] = useState("OPERATOR");

  const providers = useQuery({
    queryKey: ["/oidc-providers"],
    queryFn: () => apiGet<OidcProviderRow[]>("/oidc-providers"),
  });

  const create = useMutation({
    mutationFn: () => apiPost("/oidc-providers", { name, issuer, clientId, clientSecret, defaultRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/oidc-providers"] });
      setName("");
      setIssuer("");
      setClientId("");
      setClientSecret("");
      toast("OIDC sağlayıcısı eklendi", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Sağlayıcı eklenemedi", "error");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/oidc-providers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/oidc-providers"] }),
    onError: () => toast("Silinemedi", "error"),
  });

  return (
    <Modal open title="SSO / OIDC Sağlayıcıları" onClose={onClose} className="max-w-xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Bir sağlayıcı eklendikten sonra, o sağlayıcıyla giriş yapacak kullanıcıları "Kaynak: OIDC" olarak elle
          oluşturmanız gerekir (otomatik kayıt yok) — ilk başarılı girişte kullanıcı bu sağlayıcıya bağlanır.
        </p>

        <div className="max-h-48 space-y-2 overflow-y-auto">
          {providers.data?.length === 0 && <p className="text-sm text-slate-400">Henüz sağlayıcı yok.</p>}
          {providers.data?.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-md bg-slate-50 p-2 text-sm">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-slate-400">{p.issuer}</div>
              </div>
              <Button
                variant="ghost"
                className="px-2 py-1 text-red-600"
                onClick={async () => {
                  if (await confirm({ message: `${p.name} silinsin mi?`, danger: true })) remove.mutate(p.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-slate-100 pt-4">
          <div>
            <Label htmlFor="oidcName">Ad (giriş butonunda görünür)</Label>
            <Input id="oidcName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Azure AD" />
          </div>
          <div>
            <Label htmlFor="oidcIssuer">Issuer</Label>
            <Input
              id="oidcIssuer"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="https://login.microsoftonline.com/{tenant}/v2.0"
            />
          </div>
          <div>
            <Label htmlFor="oidcClientId">Client ID</Label>
            <Input id="oidcClientId" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="oidcClientSecret">Client Secret</Label>
            <Input
              id="oidcClientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="oidcDefaultRole">Varsayılan Rol</Label>
            <Select id="oidcDefaultRole" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!name.trim() || !issuer.trim() || !clientId.trim() || !clientSecret.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              Sağlayıcı Ekle
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface SkillDefRow { id: string; code: string; name: string; description?: string | null; }

/** Beceri tanımları (makineden bağımsız) — Kullanıcılar sayfasında yönetilir,
 * OperatorSkillsModal ve machines.tsx'teki MachineRequiredSkillsModal bu listeyi tüketir. */
function SkillDefinitionsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const skills = useQuery({ queryKey: ["/skills"], queryFn: () => apiGet<SkillDefRow[]>("/skills") });

  const create = useMutation({
    mutationFn: () => apiPost("/skills", { code: code.trim(), name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/skills"] });
      setCode("");
      setName("");
      setDescription("");
      toast("Beceri tanımı eklendi", "success");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? (e.body as { message?: string } | null)?.message : undefined;
      toast(msg ?? "Beceri tanımı eklenemedi", "error");
    },
  });

  return (
    <Modal open title="Beceri Tanımları" onClose={onClose} className="max-w-xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Makineden bağımsız, çapraz-makine beceri/yetkinlik tanımları (örn. "5 Eksen Freze", "CNC Tornalama
          Seviye 2"). Operatörlere bu listeden beceri verilir; makinelere de gerekli beceri olarak atanır.
        </p>
        <div className="max-h-48 space-y-2 overflow-y-auto">
          {skills.data?.length === 0 && <p className="text-sm text-slate-400">Henüz beceri tanımı yok.</p>}
          {skills.data?.map((s) => (
            <div key={s.id} className="rounded-md bg-slate-50 p-2 text-sm">
              <div className="font-medium">{s.code} · {s.name}</div>
              {s.description && <div className="text-xs text-slate-400">{s.description}</div>}
            </div>
          ))}
        </div>
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="skillCode">Kod</Label>
              <Input id="skillCode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CNC-5AX" />
            </div>
            <div>
              <Label htmlFor="skillName">Ad</Label>
              <Input id="skillName" value={name} onChange={(e) => setName(e.target.value)} placeholder="5 Eksen Freze" />
            </div>
          </div>
          <div>
            <Label htmlFor="skillDesc">Açıklama (opsiyonel)</Label>
            <Input id="skillDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button disabled={!code.trim() || !name.trim() || create.isPending} onClick={() => create.mutate()}>
              Beceri Tanımı Ekle
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface OperatorSkillRow {
  id: string; level: "TRAINEE" | "QUALIFIED" | "EXPERT"; status: "ACTIVE" | "REVOKED";
  certificateReference?: string | null; expiresAt?: string | null; grantedAt: string;
  skill: { id: string; code: string; name: string };
  grantedBy: { id: string; name: string };
}

const SKILL_LEVEL_LABEL: Record<string, string> = { TRAINEE: "Çırak", QUALIFIED: "Yetkin", EXPERT: "Uzman" };

function OperatorSkillsModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [skillId, setSkillId] = useState("");
  const [level, setLevel] = useState<"TRAINEE" | "QUALIFIED" | "EXPERT">("QUALIFIED");
  const [certificateReference, setCertificateReference] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const skills = useQuery({ queryKey: ["/skills"], queryFn: () => apiGet<SkillDefRow[]>("/skills") });
  const grants = useQuery({ queryKey: ["/skills/operators", user.id], queryFn: () => apiGet<OperatorSkillRow[]>(`/skills/operators/${user.id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["/skills/operators", user.id] });
  const grant = useMutation({
    mutationFn: () => apiPost("/skills/grants", { operatorId: user.id, skillId, level, ...(certificateReference.trim() ? { certificateReference: certificateReference.trim() } : {}), ...(expiresAt ? { expiresAt } : {}) }),
    onSuccess: () => { toast("Beceri verildi.", "success"); setCertificateReference(""); setExpiresAt(""); refresh(); },
    onError: () => toast("Beceri verilemedi.", "error"),
  });
  const revoke = useMutation({
    mutationFn: (grantId: string) => apiPost(`/skills/grants/${grantId}/revoke`, {}),
    onSuccess: () => { toast("Beceri kaldırıldı.", "success"); refresh(); },
    onError: () => toast("Kaldırılamadı.", "error"),
  });
  return <Modal open title={`${user.name} — Beceriler`} onClose={onClose}><div className="space-y-4"><p className="text-sm text-slate-600">Makineden bağımsız çapraz-yetkinlik kaydı. Bir makinenin gerekli becerileri tanımlıysa (bkz. Tezgahlar sayfası), HMI başlangıcı bu kayıtları kontrol eder.</p><div className="grid gap-3 rounded border p-3 sm:grid-cols-2"><div><Label htmlFor="grant-skill">Beceri</Label><Select id="grant-skill" value={skillId} onChange={(event) => setSkillId(event.target.value)}><option value="">Seçin…</option>{skills.data?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></div><div><Label htmlFor="grant-level">Seviye</Label><Select id="grant-level" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}><option value="TRAINEE">Çırak</option><option value="QUALIFIED">Yetkin</option><option value="EXPERT">Uzman</option></Select></div><div><Label htmlFor="grant-cert">Sertifika referansı (opsiyonel)</Label><Input id="grant-cert" value={certificateReference} onChange={(event) => setCertificateReference(event.target.value)} /></div><div><Label htmlFor="grant-expires">Geçerlilik bitişi</Label><Input id="grant-expires" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div></div><div className="flex justify-end"><Button disabled={!skillId || grant.isPending} onClick={() => grant.mutate()}>Beceri Ver</Button></div><div><h3 className="font-medium">Kayıtlar</h3>{grants.isLoading ? <p className="mt-2 text-sm text-slate-500">Yükleniyor…</p> : (grants.data ?? []).length === 0 ? <p className="mt-2 text-sm text-slate-500">Kayıt yok.</p> : <div className="mt-2 space-y-2">{grants.data?.map((g) => <div key={g.id} className="rounded border p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{g.skill.code}</b> · {g.skill.name} · {SKILL_LEVEL_LABEL[g.level]}<div className="mt-1 text-xs text-slate-600">{g.certificateReference ?? "Referans belirtilmedi"} · veren: {g.grantedBy.name} · {fmtDate(g.grantedAt)}{g.expiresAt ? ` · bitiş: ${fmtDate(g.expiresAt)}` : " · süresiz"}</div></div><div className="flex items-center gap-2"><span className={`rounded px-2 py-1 text-xs font-semibold ${g.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>{g.status === "ACTIVE" ? "Aktif" : "Kaldırıldı"}</span>{g.status === "ACTIVE" && <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(g.id)}>Kaldır</Button>}</div></div></div>)}</div>}</div></div></Modal>;
}

export function UsersPage() {
  const [showImport, setShowImport] = useState(false);
  const [showLdap, setShowLdap] = useState(false);
  const [showOidc, setShowOidc] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [skillsFor, setSkillsFor] = useState<UserRow | null>(null);

  return (
    <>
      <CrudPage<UserRow>
        title="Kullanıcılar"
        icon={Wrench}
        endpoint="/users"
        writeRoles={["ADMIN"]}
        searchable={false}
        headerActions={
          <>
            <Button variant="outline" onClick={() => setShowLdap(true)}>
              <KeySquare className="h-4 w-4" /> AD/LDAP
            </Button>
            <Button variant="outline" onClick={() => setShowOidc(true)}>
              <ShieldCheck className="h-4 w-4" /> SSO/OIDC
            </Button>
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" /> İçe Aktar
            </Button>
            <Button variant="outline" onClick={() => setShowSkills(true)}>
              <GraduationCap className="h-4 w-4" /> Beceri Tanımları
            </Button>
          </>
        }
        rowActions={(row) => (
          <Button variant="ghost" className="px-2 py-1" title="Beceriler" onClick={() => setSkillsFor(row)}>
            <GraduationCap className="h-4 w-4" />
          </Button>
        )}
        columns={[
          { key: "email", label: "E-posta" },
          { key: "name", label: "Ad" },
          {
            key: "role",
            label: "Rol",
            render: (r) => ROLE_OPTIONS.find((o) => o.value === r.role)?.label ?? r.role,
          },
          {
            key: "authSource",
            label: "Kaynak",
            render: (r) =>
              r.authSource === "LDAP" ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                  AD/LDAP
                </span>
              ) : r.authSource === "OIDC" ? (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                  SSO/OIDC
                </span>
              ) : (
                <span className="text-xs text-slate-400">Yerel</span>
              ),
          },
          { key: "isActive", label: "Durum", render: (r) => (r.isActive ? "Aktif" : "Pasif") },
        ]}
        fields={[
          { name: "email", label: "E-posta", type: "email", required: true },
          { name: "password", label: "Şifre (düzenlemede boş bırakılırsa değişmez)", type: "password", required: true },
          { name: "name", label: "Ad Soyad", required: true },
          { name: "role", label: "Rol", type: "select", required: true, options: ROLE_OPTIONS },
          { name: "isActive", label: "Aktif", type: "checkbox" },
          { name: "department", label: "Departman" },
          { name: "position", label: "Pozisyon" },
          { name: "hourlyRate", label: "Saatlik Ücret", type: "number" },
          {
            name: "authSource",
            label: "Giriş Kaynağı (LDAP için AD/LDAP panelini kullanın)",
            type: "select",
            options: [
              { value: "LOCAL", label: "Yerel (e-posta/şifre)" },
              { value: "OIDC", label: "SSO/OIDC" },
            ],
          },
        ]}
      />
      {showImport && <ImportCsvModal onClose={() => setShowImport(false)} />}
      {showLdap && <LdapSettingsModal onClose={() => setShowLdap(false)} />}
      {showOidc && <OidcSettingsModal onClose={() => setShowOidc(false)} />}
      {showSkills && <SkillDefinitionsModal onClose={() => setShowSkills(false)} />}
      {skillsFor && <OperatorSkillsModal user={skillsFor} onClose={() => setSkillsFor(null)} />}
    </>
  );
}
