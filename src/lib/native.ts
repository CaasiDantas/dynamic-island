import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** true dentro da janela Tauri; false quando aberto num navegador comum (`npm run dev`). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface DisplayInfo {
  /** Largura do monitor em pixels lógicos. */
  width: number;
  height: number;
  scaleFactor: number;
}

export async function getDisplayInfo(): Promise<DisplayInfo> {
  if (!isTauri) {
    return { width: window.screen.width, height: window.screen.height, scaleFactor: window.devicePixelRatio };
  }
  return invoke<DisplayInfo>("display_info");
}

/** Dimensiona a janela (px lógicos) e a centraliza no topo, `top` px abaixo da borda. */
export async function configureWindow(width: number, height: number, top: number) {
  if (!isTauri) return;
  await invoke("configure_island", { width, height, top });
}

export function setHitRegion(rect: { x: number; y: number; w: number; h: number }) {
  if (!isTauri) return;
  void invoke("set_hit_region", rect);
}

export async function setAlwaysOnTop(value: boolean) {
  if (!isTauri) return;
  await invoke("set_always_on_top", { value });
}

export async function quitApp() {
  if (!isTauri) return;
  await invoke("quit_app");
}

/** Cursor entrou/saiu da cápsula (calculado no Rust, pois a janela ignora o mouse fora dela). */
export function onIslandHover(handler: (inside: boolean) => void): () => void {
  return onNative<boolean>("island://hover", handler);
}

/** "Configurações" escolhido no menu da bandeja. */
export function onTrayOpenSettings(handler: () => void): () => void {
  return onNative("island://open-settings", handler);
}

function onNative<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauri) return () => {};
  let unlisten: (() => void) | undefined;
  let disposed = false;
  listen<T>(event, (e) => handler(e.payload)).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Atalho global disparado (registrado no Rust com RegisterHotKey). */
export function onGlobalHotkey(handler: () => void): () => void {
  return onNative("island://hotkey", handler);
}

/** Registra (ou desliga, com null) o atalho global. false = combinação recusada pelo Windows. */
export async function setGlobalHotkey(hotkey: { mods: number; vk: number } | null): Promise<boolean> {
  if (!isTauri) return true;
  return invoke<boolean>("set_global_hotkey", { mods: hotkey?.mods ?? 0, vk: hotkey?.vk ?? 0 });
}
