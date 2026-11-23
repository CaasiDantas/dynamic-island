import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";

/**
 * Volume da saída de áudio padrão do Windows (o mesmo da bandeja).
 * Lê ao abrir, acompanha mudanças feitas fora (teclas de volume) e ajusta
 * pela ilha sem disparar a pílula de volume (o Rust silencia o aviso).
 */
export interface VolumeState {
  level: number;
  muted: boolean;
}

let state: VolumeState | null = isTauri ? null : { level: 60, muted: false };
const listeners = new Set<() => void>();
let started = false;

function emit() {
  listeners.forEach((l) => l());
}

function ensureStarted() {
  if (started || !isTauri) return;
  started = true;
  void invoke<VolumeState | null>("volume_get")
    .then((v) => {
      if (v && state === null) {
        state = v;
        emit();
      }
    })
    .catch(() => {});
  void listen<{ kind: string; level?: number; muted?: boolean }>("island://sys", (e) => {
    const p = e.payload;
    if (p.kind !== "volume" || p.level == null || pending !== undefined) return;
    state = { level: p.level, muted: !!p.muted };
    emit();
  });
}

const subscribe = (l: () => void) => {
  ensureStarted();
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useVolume() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Envio limitado a ~16/s durante o arraste; o último valor sempre chega. */
const SEND_EVERY = 60;
let lastSent = 0;
let pending: number | undefined;

function sendLevel(level: number) {
  if (!isTauri) return;
  window.clearTimeout(pending);
  const wait = SEND_EVERY - (performance.now() - lastSent);
  const run = () => {
    pending = undefined;
    lastSent = performance.now();
    void invoke("volume_set", { level, muted: level > 0 ? false : null }).catch(() => {});
  };
  if (wait <= 0) run();
  else pending = window.setTimeout(run, wait);
}

export const volume = {
  set(level: number) {
    const l = Math.round(Math.max(0, Math.min(100, level)));
    state = { level: l, muted: l > 0 ? false : (state?.muted ?? false) };
    emit();
    sendLevel(l);
  },
  toggleMute() {
    if (!state) return;
    state = { ...state, muted: !state.muted };
    emit();
    if (isTauri) void invoke("volume_set", { level: null, muted: state.muted }).catch(() => {});
  },
};
