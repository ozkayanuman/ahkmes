import { CrudPage } from "../components/crud-page";

interface MachineRow {
  id: string;
  name: string;
  model: string;
  controller?: string | null;
  isActive: boolean;
}

export function MachinesPage() {
  return (
    <CrudPage<MachineRow>
      title="Tezgahlar"
      endpoint="/machines"
      writeRoles={["ADMIN"]}
      searchable={false}
      columns={[
        { key: "name", label: "Ad" },
        { key: "model", label: "Model" },
        { key: "controller", label: "Kontrol Ünitesi" },
        { key: "isActive", label: "Durum", render: (r) => (r.isActive ? "Aktif" : "Pasif") },
      ]}
      fields={[
        { name: "name", label: "Ad", required: true },
        { name: "model", label: "Model", required: true },
        { name: "controller", label: "Kontrol Ünitesi (örn. Fanuc 0i-MF)" },
        { name: "isActive", label: "Aktif", type: "checkbox" },
      ]}
    />
  );
}
