import { Wrench } from "lucide-react";
import { CrudPage } from "../components/crud-page";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
}

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Yönetici" },
  { value: "SALES", label: "Satış" },
  { value: "PLANNER", label: "Planlamacı" },
  { value: "FOREMAN", label: "Usta" },
  { value: "OPERATOR", label: "Operatör" },
];

export function UsersPage() {
  return (
    <CrudPage<UserRow>
      title="Kullanıcılar"
      icon={Wrench}
      endpoint="/users"
      writeRoles={["ADMIN"]}
      searchable={false}
      columns={[
        { key: "email", label: "E-posta" },
        { key: "name", label: "Ad" },
        {
          key: "role",
          label: "Rol",
          render: (r) => ROLE_OPTIONS.find((o) => o.value === r.role)?.label ?? r.role,
        },
        { key: "isActive", label: "Durum", render: (r) => (r.isActive ? "Aktif" : "Pasif") },
      ]}
      fields={[
        { name: "email", label: "E-posta", type: "email", required: true },
        { name: "password", label: "Şifre (düzenlemede boş bırakılırsa değişmez)", type: "password", required: true },
        { name: "name", label: "Ad Soyad", required: true },
        { name: "role", label: "Rol", type: "select", required: true, options: ROLE_OPTIONS },
        { name: "isActive", label: "Aktif", type: "checkbox" },
      ]}
    />
  );
}
