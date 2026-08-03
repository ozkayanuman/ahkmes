import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Pencil, Plus, Search, Trash2, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "@ahkmes/shared-types";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Input, Label, Modal, Select, Table } from "./ui";
import { useConfirm } from "./confirm-dialog";
import { useToast } from "./toast";

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

export interface Field {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  required?: boolean;
  createOnly?: boolean;
  defaultValue?: boolean;
}

type FormState = Record<string, string | boolean>;

function initialForm(fields: Field[], row?: Record<string, unknown>): FormState {
  const state: FormState = {};
  for (const f of fields) {
    if (f.type === "checkbox") {
      state[f.name] = row ? Boolean(row[f.name]) : (f.defaultValue ?? true);
    } else if (f.type === "password") {
      state[f.name] = "";
    } else {
      state[f.name] = row && row[f.name] != null ? String(row[f.name]) : "";
    }
  }
  return state;
}

function toPayload(form: FormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v === "") continue; // boş metin alanlarını gönderme (opsiyonel alanlar)
    payload[k] = v;
  }
  return payload;
}

export function CrudPage<T extends { id: string }>({
  title,
  icon: Icon,
  endpoint,
  columns,
  fields,
  writeRoles,
  deleteRoles = ["ADMIN"],
  searchable = true,
  rowActions,
  headerActions,
}: {
  title: string;
  /** Sidebar nav'daki ikonla eşleşen, sayfanın kimliğini pekiştiren ikon —
   * uygulama genelinde tutarlı bir görsel dil için (bkz. layout.tsx NAV). */
  icon?: LucideIcon;
  endpoint: string;
  columns: Column<T>[];
  fields: Field[];
  writeRoles: Role[];
  deleteRoles?: Role[];
  searchable?: boolean;
  rowActions?: (row: T) => ReactNode;
  /** "Yeni" butonunun yanına eklenen ek aksiyonlar (örn. Users sayfasındaki
   * "İçe Aktar" / "AD Ayarları" butonları) — sayfaya özgü, generic kalması gereken
   * CrudPage'i özelleştirmeden genişletmeyi sağlar. */
  headerActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canWrite = !!user && writeRoles.includes(user.role);
  const canDelete = !!user && deleteRoles.includes(user.role);
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; row: T } | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [formError, setFormError] = useState<string | null>(null);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [endpoint, q],
    queryFn: () => apiGet<T[]>(`${endpoint}${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = toPayload(form);
      if (modal?.mode === "edit") return apiPatch(`${endpoint}/${modal.row.id}`, payload);
      return apiPost(endpoint, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [endpoint] });
      setModal(null);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setFormError(t("Kayıt çakışması: bu değer zaten kayıtlı"));
      else if (e instanceof ApiError && e.status === 400) setFormError(t("Doğrulama hatası: alanları kontrol edin"));
      else setFormError(t("Kaydedilemedi, tekrar deneyin"));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`${endpoint}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [endpoint] }),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409)
        toast(t("Bu kayda bağlı başka kayıtlar var, silinemez."), "error");
      else toast(t("Silinemedi."), "error");
    },
  });

  function openCreate() {
    setForm(initialForm(fields));
    setFormError(null);
    setModal({ mode: "create" });
  }

  function openEdit(row: T) {
    setForm(initialForm(fields, row as unknown as Record<string, unknown>));
    setFormError(null);
    setModal({ mode: "edit", row });
  }

  const visibleFields = fields.filter((f) => !(f.createOnly && modal?.mode === "edit"));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Icon className="h-5 w-5" />
            </span>
          )}
          <h1 className="text-2xl font-bold">{t(title)}</h1>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          {canWrite && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t("Yeni")}
            </Button>
          )}
        </div>
      </div>

      {searchable && (
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input placeholder={t("Ara…")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      )}

      {query.isLoading && <p className="text-slate-500">{t("Yükleniyor…")}</p>}
      {query.error && <p className="text-red-600">{t("Liste alınamadı.")}</p>}

      {query.data && (
        <Table
          headers={[
            ...columns.map((c) => t(c.label)),
            ...(rowActions ? [""] : []),
            ...(canWrite ? [t("İşlem")] : []),
          ]}
        >
          {query.data.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (rowActions ? 1 : 0) + (canWrite ? 1 : 0)}
                className="px-4 py-12 text-center text-slate-400"
              >
                <div className="flex flex-col items-center gap-2">
                  <Inbox className="h-8 w-8 text-slate-300" />
                  <span>{t("Kayıt yok")}</span>
                </div>
              </td>
            </tr>
          )}
          {query.data.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3">
                  {c.render ? c.render(row) : t(String((row as Record<string, unknown>)[c.key] ?? "—"))}
                </td>
              ))}
              {rowActions && <td className="px-4 py-3">{rowActions(row)}</td>}
              {canWrite && (
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(row)} title={t("Düzenle")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-red-600"
                        title={t("Sil")}
                        onClick={async () => {
                          if (await confirm({ message: t("Bu kaydı silmek istediğinize emin misiniz?"), danger: true }))
                            remove.mutate(row.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={modal !== null}
        title={modal?.mode === "edit" ? t("{{title}} Düzenle", { title: t(title) }) : t("Yeni {{title}}", { title: t(title) })}
        onClose={() => setModal(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          {visibleFields.map((f) => (
            <div key={f.name}>
              {f.type === "checkbox" ? (
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(form[f.name])}
                    onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })}
                  />
                  {t(f.label)}
                </label>
              ) : f.type === "select" ? (
                <>
                  <Label htmlFor={f.name}>{t(f.label)}</Label>
                  <Select
                    id={f.name}
                    value={String(form[f.name] ?? "")}
                    required={f.required}
                    onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                  >
                    <option value="">{t("Seçin…")}</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.label)}
                      </option>
                    ))}
                  </Select>
                </>
              ) : (
                <>
                  <Label htmlFor={f.name}>{t(f.label)}</Label>
                  <Input
                    id={f.name}
                    type={f.type ?? "text"}
                    value={String(form[f.name] ?? "")}
                    required={f.required && !(f.type === "password" && modal?.mode === "edit")}
                    onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                  />
                </>
              )}
            </div>
          ))}
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModal(null)}>
              {t("Vazgeç")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t("Kaydediliyor…") : t("Kaydet")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
