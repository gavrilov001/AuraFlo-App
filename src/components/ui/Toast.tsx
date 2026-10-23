"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type ToastTone = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

interface ToastApi {
  success: (message: string, action?: ToastAction) => void;
  error: (message: string, action?: ToastAction) => void;
  info: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, action?: ToastAction) => {
      const id = nextId.current++;
      setToasts((current) => [
        ...current.slice(-3),
        { id, tone, message, action },
      ]);
      window.setTimeout(() => dismiss(id), action ? 7000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, a) => push("success", m, a),
      error: (m, a) => push("error", m, a),
      info: (m, a) => push("info", m, a),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-md border bg-surface px-3.5 py-2.5 shadow-pop",
              "motion-safe:animate-[app-fade-in_160ms_ease-out]",
              toast.tone === "error" ? "border-danger/25" : "border-line",
            )}
          >
            {toast.tone === "error" ? (
              <CircleAlert
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-danger"
              />
            ) : (
              <CheckCircle2
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-gold-dark"
              />
            )}
            <p className="flex-1 text-sm leading-snug text-body">
              {toast.message}
            </p>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
                className="-my-0.5 shrink-0 rounded px-1.5 py-0.5 text-sm font-medium text-ink hover:text-gold-dark"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-m-1 rounded p-1 text-faint hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
