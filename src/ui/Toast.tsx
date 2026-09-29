import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './primitives.tsx';

export interface ToastAction {
  label: string;
  onPress: () => void | Promise<void>;
}

export interface ToastOptions {
  text: string;
  action?: ToastAction;
  tone?: 'normal' | 'danger';
  /** По умолчанию 5 секунд — столько живёт «Отменить» после удаления. */
  durationMs?: number;
}

const ToastContext = createContext<(options: ToastOptions) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((options: ToastOptions) => {
    setToast({ ...options, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), toast.durationMs ?? 5000);
    return () => clearTimeout(timer.current);
  }, [toast]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3"
        >
          <div className="pointer-events-auto mb-2 flex w-full max-w-md items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 shadow-lg">
            <span
              className={
                toast.tone === 'danger' ? 'flex-1 text-sm text-danger' : 'flex-1 text-sm'
              }
            >
              {toast.text}
            </span>
            {toast.action && (
              <Button
                variant="ghost"
                className="px-2 text-accent"
                onClick={() => {
                  void toast.action?.onPress();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </Button>
            )}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
