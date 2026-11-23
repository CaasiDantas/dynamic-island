import { memo, useSyncExternalStore } from "react";
import { IconCheck } from "./icons";

/**
 * Aviso curto de confirmação ("Tema salvo", "Atalho removido · Desfazer").
 * Um por vez; some sozinho. Anima só opacidade e deslocamento.
 */
interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

const DURATION = 3800;

let current: Toast | null = null;
let seq = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, action?: Toast["action"]) {
  window.clearTimeout(timer);
  current = { id: ++seq, text, action };
  emit();
  timer = window.setTimeout(dismiss, action ? DURATION + 1500 : DURATION);
}

function dismiss() {
  window.clearTimeout(timer);
  current = null;
  emit();
}

function useToast() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export const ToastHost = memo(function ToastHost() {
  const t = useToast();
  return (
    <div className="toast-host" aria-live="polite">
      {t && (
        <div key={t.id} className="toast" role="status">
          <IconCheck className="toast-icon" />
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismiss();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
