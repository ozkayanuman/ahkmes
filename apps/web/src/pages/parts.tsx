import { FileText } from "lucide-react";
import { useState } from "react";
import { CrudPage } from "../components/crud-page";
import { DocumentsPanel } from "../components/documents-panel";
import { Button, Modal } from "../components/ui";

interface PartRow {
  id: string;
  partNo: string;
  revision: string;
  name: string;
  description?: string | null;
  stock?: { qty: string } | null;
}

export function PartsPage() {
  const [docsFor, setDocsFor] = useState<PartRow | null>(null);

  return (
    <>
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
        rowActions={(row) => (
          <Button
            variant="ghost"
            className="px-2 py-1"
            title="Dokümanlar (STEP / Talimat)"
            onClick={() => setDocsFor(row)}
          >
            <FileText className="h-4 w-4" />
          </Button>
        )}
      />
      <Modal
        open={docsFor !== null}
        title={docsFor ? `${docsFor.partNo} — Dokümanlar` : "Dokümanlar"}
        onClose={() => setDocsFor(null)}
      >
        {docsFor && <DocumentsPanel entityType="part" entityId={docsFor.id} />}
      </Modal>
    </>
  );
}
