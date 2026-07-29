import { ArrowLeft, LogOut } from "lucide-react";
import { Link, NavLink, Navigate, Outlet } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth, hasPageAccess } from "../lib/auth";
import { NAV_GROUPS } from "../lib/nav-groups";
import { GlobalStatusBar } from "./global-status-bar";

/** Sayfa içindeyken sol kenar çubuğu her zaman ikon-only'dir (Launchpad'in tersine,
 * burada genişletme/daraltma yoktur) — gruplar arasında ince bir ayraçla ISA-95
 * gruplaması (Genel Bakış/ERP/MRP/MES) görsel olarak korunur. */
export function AppLayout() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Yükleniyor…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (n) => (!n.adminOnly || user.role === "ADMIN") && (!n.page || hasPageAccess(user, n.page)),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-16 flex-col border-r border-slate-200 bg-white print:hidden">
        <Link
          to="/"
          title="Ana Sayfaya Dön"
          className="flex items-center justify-center border-b border-slate-200 py-4 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <nav className="flex-1 space-y-3 overflow-y-auto p-2 py-3">
          {visibleGroups.map((g, gi) => (
            <div key={g.key} className={clsx(gi > 0 && "border-t border-slate-100 pt-3", "space-y-1")}>
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={label}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center justify-center rounded-md py-2 text-sm font-medium",
                      isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-2">
          <button
            onClick={logout}
            title="Çıkış"
            className="flex w-full items-center justify-center rounded-md py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6">
        <GlobalStatusBar />
        <Outlet />
      </main>
    </div>
  );
}
