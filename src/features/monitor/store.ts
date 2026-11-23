import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";

/**
 * Hardware (aba "Hardware") e privacidade (câmera/microfone em uso), vindos
 * de src-tauri/src/monitor.rs. O Rust só amostra o hardware enquanto a aba
 * está aberta: quem decide é `setHwWatch`, chamado pela ilha.
 */

export interface HwStats {
  cpu: number | null;
  gpu: number | null;
  ramUsed: number;
  ramTotal: number;
  diskUsed: number;
  diskTotal: number;
  /** Bytes por segundo. */
  netUp: number | null;
  netDown: number | null;
}

export interface Privacy {
  camera: boolean;
  mic: boolean;
}

let hw: HwStats | null = null;
let privacy: Privacy = { camera: false, mic: false };
const hwListeners = new Set<() => void>();
const privacyListeners = new Set<() => void>();

if (isTauri) {
  listen<HwStats>("island://hw", (e) => {
    hw = e.payload;
    hwListeners.forEach((l) => l());
  });
  const setPrivacy = (p: Privacy) => {
    if (p.camera === privacy.camera && p.mic === privacy.mic) return;
    privacy = p;
    privacyListeners.forEach((l) => l());
  };
  listen<Privacy>("island://privacy", (e) => setPrivacy(e.payload));
  invoke<Privacy>("privacy_state").then(setPrivacy, () => {});
}

let watching = false;

/** Liga a amostragem só com a aba de hardware visível. */
export function setHwWatch(on: boolean) {
  if (on === watching) return;
  watching = on;
  if (isTauri) invoke("hw_watch", { on }).catch(() => {});
}

export function useHw() {
  return useSyncExternalStore(
    (l) => {
      hwListeners.add(l);
      return () => hwListeners.delete(l);
    },
    () => hw,
  );
}

export function usePrivacy() {
  return useSyncExternalStore(
    (l) => {
      privacyListeners.add(l);
      return () => privacyListeners.delete(l);
    },
    () => privacy,
  );
}

/** Só para o modo demonstração. */
export function __demoSetHw(next: HwStats | null) {
  hw = next;
  hwListeners.forEach((l) => l());
}

export function __demoSetPrivacy(next: Privacy) {
  privacy = next;
  privacyListeners.forEach((l) => l());
}
