import { CrudPage } from "../components/crud-page";

interface PartRow {
  id: string;
  partNo: string;
  revision: string;
  name: string;
  description?: string | null;
  stock?: { qty: string } | null;
}

export function PartsPage() {
  return (
    <CrudPage<PartRow>
      title="Parçalar"
      endpoint="/parts"
      writeRoles={["ADMIN", "PLANNER"]}
      columns={[
        { key: "partNo", label: "Parça No" },
        { key: "revision", label: "Revizyon" },
        { key: "name", label: "Ad" },
        { key: "description", label: "Açıklama" },
        { key: "stock", label: "Mamul Stok", render: (r) => r.stock?.qty ?? "0" },
      ]}
      fields={[
        { name: "partNo", label: "Parça No", required: true },
        { name: "revision", label: "Revizyon", required: true },
        { name: "name", label: "Ad", required: true },
        { name: "description", label: "Açıklama" },
        { name: "drawingFileRef", label: "Çizim Dosya Referansı" },
        { name: "stepFileRef", label: "STEP Dosya Referansı" },
      ]}
    />
  );
}
