import { AlertTriangle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button, Modal } from "./ui";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (result: boolean) => void;
}

/** Native `window.confirm()` yerine uygulama tasarımıyla tutarlı onay modalı —
 * tarayıcının kendi (Chrome) popup'ı yerine. `useConfirm()` ile çağrılır,
 * `confirm()` gibi bir Promise<boolean> döner. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    const options = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  function close(result: boolean) {
    pending?.resolve(result);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={!!pending} onClose={() => close(false)} title={pending?.options.title ?? "Onay"}>
        {pending && (
          <div>
            <div className="mb-5 flex items-start gap-3">
              {pending.options.danger && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
              )}
              <p className="text-sm text-slate-600">{pending.options.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => close(false)}>
                {pending.options.cancelLabel ?? "Vazgeç"}
              </Button>
              <Button variant={pending.options.danger ? "danger" : "primary"} onClick={() => close(true)}>
                {pending.options.confirmLabel ?? "Onayla"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm, ConfirmProvider içinde kullanılmalı");
  return ctx;
}
