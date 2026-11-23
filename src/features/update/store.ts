import { useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "../../lib/native";
import { showPill } from "../pills/store";

/**
 * Atualização pelo próprio app.
 *
 * Consulta o `latest.json` da última Release no GitHub (assinada com a chave
 * do projeto; o plugin recusa pacote com assinatura diferente). Ao achar
 * versão nova, avisa uma vez por versão com uma pílula; o clique baixa,
 * instala (instalador em modo silencioso com barra de progresso) e reabre.
 *
 * Só na versão instalada: em desenvolvimento não faz sentido instalar por cima.
 */
export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; version: string; progress: number | null }
  | { kind: "error"; message: string };

interface State {
  current: string;
  status: UpdateStatus;
}

const ENABLED = isTauri && import.meta.env.PROD;
/** Primeira consulta um pouco depois de abrir (não disputa com a inicialização). */
const FIRST_CHECK = 20_000;
const EVERY = 6 * 60 * 60 * 1000;
const ANNOUNCED_KEY = "island.update.announced";

let state: State = { current: "", status: { kind: "idle" } };
const listeners = new Set<() => void>();
type PendingUpdate = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;
let pending: PendingUpdate = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function announce(version: string) {
  try {
    if (localStorage.getItem(ANNOUNCED_KEY) === version) return;
    localStorage.setItem(ANNOUNCED_KEY, version);
  } catch {
    /* sem armazenamento: avisa de novo na próxima vez */
  }
  showPill({
    kind: "update",
    icon: "download",
    meta: "Dynamic Island",
    title: "Atualização disponível",
    subtitle: `Versão ${version} · clique para instalar`,
    value: `v${version}`,
    ring: null,
    tone: "accent",
    open: () => void installUpdate(),
  });
}

export async function checkForUpdate(manual = false) {
  if (!ENABLED) return;
  const s = state.status.kind;
  if (s === "checking" || s === "downloading") return;
  set({ status: { kind: "checking" } });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    pending = await check();
    if (pending) {
      set({ status: { kind: "available", version: pending.version, notes: pending.body ?? "" } });
      if (!manual) announce(pending.version);
    } else {
      set({ status: { kind: "uptodate" } });
    }
  } catch (err) {
    // Sem internet ou GitHub fora do ar: em segundo plano não incomoda; no botão, mostra.
    set({ status: manual ? { kind: "error", message: "Não consegui verificar agora. Tente de novo mais tarde." } : { kind: "idle" } });
    console.warn("verificação de atualização falhou", err);
  }
}

export async function installUpdate() {
  if (!ENABLED) return;
  if (!pending) await checkForUpdate(true);
  const update = pending;
  if (!update) return;
  let total = 0;
  let got = 0;
  set({ status: { kind: "downloading", version: update.version, progress: null } });
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        set({ status: { kind: "downloading", version: update.version, progress: total ? Math.min(1, got / total) : null } });
      }
    });
    // No Windows o instalador já fecha o app; reabrir cobre os outros casos.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.error("atualização falhou", err);
    set({ status: { kind: "error", message: "A atualização não terminou. Tente de novo." } });
  }
}

let started = false;
function ensureStarted() {
  if (started || !isTauri) return;
  started = true;
  void getVersion()
    .then((v) => set({ current: v }))
    .catch(() => {});
  if (!ENABLED) return;
  window.setTimeout(() => void checkForUpdate(), FIRST_CHECK);
  window.setInterval(() => void checkForUpdate(), EVERY);
}

const subscribe = (l: () => void) => {
  ensureStarted();
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useUpdate = () => useSyncExternalStore(subscribe, () => state);
export const useUpdateAvailable = () =>
  useSyncExternalStore(subscribe, () => state.status.kind === "available" || state.status.kind === "downloading");

/** Chamado no início do app para as verificações rodarem mesmo sem ninguém olhar os ajustes. */
export function startUpdateChecks() {
  ensureStarted();
}

export const updatesSupported = ENABLED;
