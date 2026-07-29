import { CheckCircle2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastType = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

type ToastFn = (message: string, type?: ToastType) => void;

const ToastContext = createContext<ToastFn | null>(null);

const STYLE: Record<ToastType, string> = {
  success: "bg-green-600",
  error: "bg-red-600",
  info: "bg-slate-800",
};

/** Native `window.alert()` yerine sağ altta beliren, otomatik kaybolan bildirim —
 * tarayıcının kendi (Chrome) popup'ı yerine. `useToast()` ile çağrılır. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const showToast = useCallback<ToastFn>(
    (message, type = "info") => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, message, type }]);
      setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${STYLE[item.type]}`}
          >
            {item.type === "error" ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : item.type === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : null}
            <span className="flex-1">{item.message}</span>
            <button onClick={() => remove(item.id)} className="shrink-0 opacity-80 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast, ToastProvider içinde kullanılmalı");
  return ctx;
}
