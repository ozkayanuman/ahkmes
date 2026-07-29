import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { apiGet, apiPatch } from "../lib/api";
import { getSocket } from "../lib/socket";
import { useAuth } from "../lib/auth";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  entity: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

/** Kurumsal MES ürünlerinde standart olan zil ikonlu bildirim merkezi — açık uygunsuzluk,
 * makine alarmı gibi olaylarda anında haberdar eder (bkz. Faz A: Notification Engine). */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { user } = useAuth();

  const countQuery = useQuery({
    queryKey: ["/notifications", "unread-count"],
    queryFn: () => apiGet<{ count: number }>("/notifications/unread-count"),
    refetchInterval: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ["/notifications"],
    queryFn: () => apiGet<NotificationItem[]>("/notifications"),
    enabled: open,
  });

  useEffect(() => {
    const s = getSocket();
    const handler = (payload: { userId: string }) => {
      if (payload.userId !== user?.userId) return;
      qc.invalidateQueries({ queryKey: ["/notifications"] });
    };
    s.on("notification.created", handler);
    return () => {
      s.off("notification.created", handler);
    };
  }, [qc, user?.userId]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const markRead = async (id: string) => {
    await apiPatch(`/notifications/${id}/read`, {});
    qc.invalidateQueries({ queryKey: ["/notifications"] });
  };

  const count = countQuery.data?.count ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Bildirimler"
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Bildirimler
          </div>
          <div className="max-h-96 overflow-y-auto">
            {listQuery.data?.length === 0 && (
              <div className="px-3 py-4 text-sm text-slate-400">Bildirim yok</div>
            )}
            {listQuery.data?.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={clsx(
                  "block w-full border-b border-slate-50 px-3 py-2 text-left text-sm hover:bg-slate-50",
                  !n.isRead && "bg-blue-50/50",
                )}
              >
                <div className="flex items-center gap-1.5">
                  {!n.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                  <span className="font-medium text-slate-700">{n.title}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{n.message}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
