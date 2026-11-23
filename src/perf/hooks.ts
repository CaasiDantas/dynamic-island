import { useLayoutEffect, useSyncExternalStore } from "react";
import { perf } from "./monitor";

/** Conta commits do componente (não renders do StrictMode descartados). */
export function useCommitCount(name: string) {
  useLayoutEffect(() => {
    if (perf.enabled) perf.countRender(name);
  });
}

const subscribe = (l: () => void) => perf.subscribe(l);
const getEnabled = () => perf.enabled;

export function usePerfEnabled() {
  return useSyncExternalStore(subscribe, getEnabled);
}

/** Ações que o controle remoto de testes (dev) pode disparar. */
export const perfActions: {
  setMode?: (mode: "compact" | "expanded" | "settings") => void;
  setSetting?: (key: string, value: unknown) => void;
} = {};
