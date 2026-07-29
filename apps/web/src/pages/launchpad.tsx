import { Link, Navigate } from "react-router-dom";
import { LogOut, Package } from "lucide-react";
import { NAV_GROUPS } from "../lib/nav-groups";
import { hasPageAccess, useAuth } from "../lib/auth";

/** Giriş sonrası ana sayfa (Launchpad) — sol nav bar yerine, sektör standardı MES
 * ürünlerindeki (Siemens Opcenter/DSM vb.) gibi grup kartları + kaydırılabilir ikon
 * karo görünümü. ERP/MRP/MES gruplaması ISA-95/MESA-11 modeline dayanır (bkz.
 * nav-groups.ts). Bir sayfa seçildiğinde AppLayout'un ikon-only kenar çubuğuna geçilir. */
export function LaunchpadPage() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Yükleniyor…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) => (!i.adminOnly || user.role === "ADMIN") && (!i.page || hasPageAccess(user, i.page)),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Package className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-bold leading-tight">AHK Teknoloji</div>
            <div className="text-xs leading-tight text-slate-400">AHKMES</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm font-medium leading-tight">{user.name}</div>
            <div className="text-xs leading-tight text-slate-400">{user.role}</div>
          </div>
          <button
            onClick={logout}
            title="Çıkış"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="mb-1 text-2xl font-bold text-slate-800">Hoş geldiniz</h1>
        <p className="mb-8 text-sm text-slate-500">Bir modül seçin ya da aşağı kaydırarak tüm sayfaları görün.</p>

        <div className="mb-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {visibleGroups.map((g) => {
            const GroupIcon = g.icon;
            return (
              <a
                key={g.key}
                href={`#group-${g.key}`}
                className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                  <GroupIcon className="h-6 w-6" />
                </span>
                <h2 className="mb-1 text-lg font-semibold text-slate-800">{g.label}</h2>
                <p className="text-sm text-slate-500">{g.description}</p>
              </a>
            );
          })}
        </div>

        <div className="space-y-10">
          {visibleGroups.map((g) => (
            <section key={g.key} id={`group-${g.key}`} className="scroll-mt-6">
              <h3 className="mb-1 text-base font-semibold text-slate-700">{g.label}</h3>
              <p className="mb-4 text-xs text-slate-400">{g.description}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {g.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                        <ItemIcon className="h-5 w-5" />
                      </span>
                      <span className="text-xs font-medium text-slate-700">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
