import { useQuery } from "@tanstack/react-query";
import { PAGE_PRODUCT_MODULE, type PageKey, type ProductModule } from "@ahkmes/shared-types";
import { ShieldOff } from "lucide-react";
import { Navigate } from "react-router-dom";
import { apiGet } from "../lib/api";
import { hasPageAccess, useAuth } from "../lib/auth";

/**
 * UI feedback mirrors the backend PagesGuard entitlement check. The API remains
 * the source of enforcement, so direct URLs and callers cannot bypass it.
 */
export function PageGuard({ page, children }: { page: string; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const canAccess = Boolean(user && hasPageAccess(user, page));
  const entitlements = useQuery({
    queryKey: ["/platform/modules"],
    queryFn: () => apiGet<Array<{ module: ProductModule; isEnabled: boolean }>>("/platform/modules"),
    enabled: canAccess,
    staleTime: 30_000,
  });

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center text-slate-500">
        <ShieldOff className="mb-3 h-10 w-10 text-slate-300" />
        <p className="text-lg font-semibold text-slate-700">Bu sayfaya erişim yetkiniz yok</p>
        <p className="mt-1 text-sm">Erişim gerekiyorsa yöneticinizden rol grubunuza bu sayfayı eklemesini isteyin.</p>
      </div>
    );
  }
  if (entitlements.isLoading) return null;
  const module = PAGE_PRODUCT_MODULE[page as PageKey];
  // This is the single recovery route: an administrator must be able to
  // re-enable Platform Core after it has been disabled for a tenant.
  if (page !== "platform-modules" && module && entitlements.data?.some((item) => item.module === module && !item.isEnabled)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center text-slate-500">
        <ShieldOff className="mb-3 h-10 w-10 text-slate-300" />
        <p className="text-lg font-semibold text-slate-700">Bu ürün modülü etkin değil</p>
        <p className="mt-1 text-sm">Erişim için yöneticinizden ilgili modülü etkinleştirmesini isteyin.</p>
      </div>
    );
  }
  return <>{children}</>;
}
