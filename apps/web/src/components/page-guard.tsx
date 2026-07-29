import { Navigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { hasPageAccess, useAuth } from "../lib/auth";

/** Bir kullanıcı, sidebar'da görmediği bir sayfaya doğrudan URL ile gitmeye
 * çalışırsa burada da engellenir — arka uç zaten PagesGuard ile 403 döner,
 * bu sadece kullanıcıya API hatası yerine anlaşılır bir mesaj gösterir. */
export function PageGuard({ page, children }: { page: string; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasPageAccess(user, page)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center text-slate-500">
        <ShieldOff className="mb-3 h-10 w-10 text-slate-300" />
        <p className="text-lg font-semibold text-slate-700">Bu sayfaya erişim yetkiniz yok</p>
        <p className="mt-1 text-sm">Erişim gerekiyorsa yöneticinizden rol grubunuza bu sayfayı eklemesini isteyin.</p>
      </div>
    );
  }
  return <>{children}</>;
}
