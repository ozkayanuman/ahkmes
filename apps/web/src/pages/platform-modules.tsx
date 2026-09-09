import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PRODUCT_EDITIONS, type ProductEdition, type ProductImplementationStatus, type ProductModule, type ProductModuleDefinition, type ProductSuite } from "@ahkmes/shared-types";
import { Boxes, Lock, ShieldCheck, Unlock } from "lucide-react";
import { Navigate } from "react-router-dom";
import { Button, Card } from "../components/ui";
import { useToast } from "../components/toast";
import { apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Entitlement {
  module: ProductModule;
  isEnabled: boolean;
  configured: boolean;
  suite: ProductSuite;
  name: string;
  description: string;
  requiredCore: boolean;
  tenantToggleable: boolean;
  implementationStatus: ProductImplementationStatus;
  canonicalModules: string[];
  edition: ProductEdition;
}

const EDITION_LABEL: Record<ProductEdition, string> = {
  FOUNDATION: "Foundation", ESSENTIALS: "Essentials", PROFESSIONAL: "Professional", ENTERPRISE: "Enterprise",
};

const STATUS_LABEL: Record<ProductImplementationStatus, string> = {
  AVAILABLE: "Kullanılabilir", BETA: "Beta", PLANNED: "Planlandı", MISSING: "Eksik",
};

export function PlatformModulesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["/platform/modules"], queryFn: () => apiGet<Entitlement[]>("/platform/modules") });
  const catalog = useQuery({ queryKey: ["/platform/modules/catalog"], queryFn: () => apiGet<ProductModuleDefinition[]>("/platform/modules/catalog") });
  const editionQuery = useQuery({ queryKey: ["/platform/modules/edition"], queryFn: () => apiGet<{ edition: ProductEdition }>("/platform/modules/edition") });
  const update = useMutation({
    mutationFn: ({ module, isEnabled }: Pick<Entitlement, "module" | "isEnabled">) => apiPatch(`/platform/modules/${module}`, { isEnabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/platform/modules"] }); toast("Modül durumu güncellendi", "success"); },
    onError: () => toast("Modül durumu güncellenemedi", "error"),
  });
  const setEdition = useMutation({
    mutationFn: (edition: ProductEdition) => apiPatch("/platform/modules/edition", { edition }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/platform/modules/edition"] });
      qc.invalidateQueries({ queryKey: ["/platform/modules"] });
      toast("Tenant edition güncellendi", "success");
    },
    onError: () => toast("Edition güncellenemedi", "error"),
  });
  if (user && user.role !== "ADMIN") return <Navigate to="/" replace />;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Boxes className="h-5 w-5" /></span>
        <div><h1 className="text-2xl font-bold">Ürün Modülleri</h1><p className="text-sm text-slate-500">Suite, ürün durumu ve tenant entitlement sınırlarını yönetin.</p></div>
      </div>
      <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Core zorunludur ve kapatılamaz. Yalnızca kullanılabilir tenant modülleri etkinleştirilebilir; beta, planlı ve eksik ürünler bilgi amaçlı gösterilir.</p>
      <div className="mb-4 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <span className="font-medium text-slate-700">Tenant Edition:</span>
        <select
          className="rounded border-slate-300 text-sm"
          value={editionQuery.data?.edition ?? "ENTERPRISE"}
          disabled={setEdition.isPending}
          onChange={(e) => setEdition.mutate(e.target.value as ProductEdition)}
        >
          {PRODUCT_EDITIONS.map((ed) => <option key={ed} value={ed}>{EDITION_LABEL[ed]}</option>)}
        </select>
      </div>
      {query.isLoading && <p className="text-slate-500">Yükleniyor…</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(query.data ?? []).map((item) => {
          const pending = update.isPending && update.variables?.module === item.module;
          const editionOk = editionQuery.data
            ? PRODUCT_EDITIONS.indexOf(editionQuery.data.edition) >= PRODUCT_EDITIONS.indexOf(item.edition)
            : true;
          const canToggle = item.tenantToggleable && !item.requiredCore && editionOk;
          return <Card key={item.module}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-medium text-slate-400">{item.suite} · {item.module}</p><h2 className="font-semibold text-slate-800">{item.name}</h2><p className="mt-1 text-sm text-slate-500">{item.description}</p></div>
              {item.requiredCore || item.isEnabled ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <Lock className="h-5 w-5 text-slate-400" />}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div><span className={item.requiredCore || item.isEnabled ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-slate-500"}>{item.requiredCore ? "Core" : item.isEnabled ? "Etkin" : "Kapalı"}</span><span className="ml-2 text-xs text-slate-400">{STATUS_LABEL[item.implementationStatus]}</span></div>
              {canToggle ? <Button variant={item.isEnabled ? "outline" : "primary"} disabled={pending} onClick={() => update.mutate({ module: item.module, isEnabled: !item.isEnabled })}>{item.isEnabled ? <><Lock className="h-4 w-4" /> Kapat</> : <><Unlock className="h-4 w-4" /> Etkinleştir</>}</Button> : <span className="text-xs text-slate-400">{item.requiredCore ? "Zorunlu core" : !editionOk ? `${EDITION_LABEL[item.edition]} edition gerektirir` : "Tenant toggle kapalı"}</span>}
            </div>
          </Card>;
        })}
      </div>
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-slate-800">Ürün yetkinlik kataloğu</h2>
        <p className="mt-1 text-sm text-slate-500">Planlanan ve eksik modüller burada görünür; bunlar etkinleştirilemez ve menüye boş bağlantı eklemez.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(catalog.data ?? []).filter((item) => ["PLANNED", "MISSING"].includes(item.implementationStatus)).map((item) => <Card key={item.code}>
            <p className="text-xs font-medium text-slate-400">{item.suite} · {item.code}</p><h3 className="font-medium text-slate-800">{item.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{item.description}</p><p className="mt-3 text-xs text-slate-400">{STATUS_LABEL[item.implementationStatus]} · {item.frontendAvailability === "NONE" ? "Not installed" : "Kısmi"}</p>
          </Card>)}
        </div>
      </section>
    </div>
  );
}
