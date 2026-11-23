import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";

/**
 * Pílulas de aviso: a ilha fechada alarga por um instante para mostrar um
 * evento do sistema (carregador, fone, Caps Lock, volume, internet) e volta.
 *
 * Só existe uma pílula por vez. Um evento do mesmo tipo substitui o atual e
 * renova o tempo (ex.: segurar a tecla de volume não empilha avisos).
 */

export type PillKind = "power" | "audio" | "volume" | "caps" | "network" | "notify" | "todo" | "update";
export type PillIcon = "bolt" | "battery" | "headphones" | "speaker" | "mute" | "caps" | "wifi" | "wifi-off" | "bell" | "download";
export type PillTone = "ok" | "warn" | "accent" | "muted";

export interface Pill {
  kind: PillKind;
  icon: PillIcon;
  title: string;
  subtitle: string;
  /** Texto grande à direita (ex.: "70%"). */
  value?: string;
  /** Preenchimento do anel (0..1); null = anel cheio só como moldura. */
  ring: number | null;
  tone: PillTone;
  /** Ícone do app (data URL) no lugar do anel: notificações. */
  image?: string;
  /** Nome pequeno do app, no canto (notificações). */
  meta?: string;
  /** Clique na pílula: abre o app de origem em vez de expandir a ilha. */
  open?: () => void;
}

export type SysEvent =
  | { kind: "power"; plugged: boolean; percent: number | null }
  | { kind: "capsLock"; on: boolean }
  | { kind: "volume"; level: number; muted: boolean }
  | { kind: "audioOutput"; name: string; headphones: boolean };

const DURATION: Record<PillKind, number> = {
  power: 2600,
  audio: 2800,
  network: 2600,
  caps: 1600,
  volume: 1500,
  notify: 5500,
  todo: 9000,
  update: 9000,
};
/** Depois que o cursor sai de cima de uma notificação, ela fica mais este tempo. */
const AFTER_HOVER_MS = 1800;

interface State {
  /** Pílula na tela agora (null = nenhuma). */
  current: Pill | null;
  /** Última mostrada: o conteúdo continua lá enquanto a ilha encolhe. */
  last: Pill | null;
  /** Sobe a cada pílula nova (não nas renovações do mesmo tipo). */
  seq: number;
}

let state: State = { current: null, last: null, seq: 0 };
let timer: number | undefined;
let started = false;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function showPill(pill: Pill) {
  window.clearTimeout(timer);
  const renew = state.current?.kind === pill.kind;
  set({ current: pill, last: pill, seq: renew ? state.seq : state.seq + 1 });
  // Notificação/lembrete com a ilha aberta: espera ela fechar para começar a contar.
  timer = pill.open ? undefined : window.setTimeout(hidePill, DURATION[pill.kind]);
}

/** A ilha mostrou a pílula: começa a contar o tempo dela (se ainda não estava contando). */
export function pillShown() {
  if (state.current && timer === undefined) timer = window.setTimeout(hidePill, DURATION[state.current.kind]);
}

export function hidePill() {
  window.clearTimeout(timer);
  timer = undefined;
  if (state.current) set({ ...state, current: null });
}

/** A pílula atual pode ser clicada (abre o app) e segura enquanto o cursor está em cima? */
export function pillIsActionable() {
  return !!state.current?.open;
}

/** Cursor em cima: pausa o sumiço; saiu: some pouco depois. */
export function holdPill(hold: boolean) {
  if (!state.current) return;
  window.clearTimeout(timer);
  timer = hold ? undefined : window.setTimeout(hidePill, AFTER_HOVER_MS);
}

/** Clique na pílula de notificação: abre o app e some. */
export function openPill() {
  const open = state.current?.open;
  hidePill();
  open?.();
}

export function pillFromSys(e: SysEvent): Pill {
  switch (e.kind) {
    case "power":
      return {
        kind: "power",
        icon: e.plugged ? "bolt" : "battery",
        title: e.plugged ? "Carregando" : "Na bateria",
        subtitle: e.plugged ? "Carregador conectado" : "Carregador desconectado",
        value: e.percent != null ? `${e.percent}%` : undefined,
        ring: e.percent != null ? e.percent / 100 : null,
        tone: e.plugged ? "ok" : e.percent != null && e.percent <= 20 ? "warn" : "muted",
      };
    case "capsLock":
      return {
        kind: "caps",
        icon: "caps",
        title: "Caps Lock",
        subtitle: e.on ? "Letras maiúsculas" : "Letras minúsculas",
        value: e.on ? "ON" : "OFF",
        ring: e.on ? 1 : 0,
        tone: e.on ? "accent" : "muted",
      };
    case "volume":
      return {
        kind: "volume",
        icon: e.muted || e.level === 0 ? "mute" : "speaker",
        title: e.muted ? "Sem som" : "Volume",
        subtitle: e.muted ? "Áudio silenciado" : "Saída atual",
        value: e.muted ? undefined : `${e.level}%`,
        ring: e.muted ? 0 : e.level / 100,
        tone: e.muted ? "muted" : "accent",
      };
    case "audioOutput":
      return {
        kind: "audio",
        icon: e.headphones ? "headphones" : "speaker",
        title: e.name || "Saída de áudio",
        subtitle: e.headphones ? "Fone conectado" : "Saída de áudio trocada",
        ring: null,
        tone: "accent",
      };
  }
}

function ensureStarted() {
  if (started) return;
  started = true;
  if (isTauri) void listen<SysEvent>("island://sys", (e) => showPill(pillFromSys(e.payload)));
  window.addEventListener("online", () =>
    showPill({ kind: "network", icon: "wifi", title: "Conectado", subtitle: "Internet de volta", ring: null, tone: "ok" }),
  );
  window.addEventListener("offline", () =>
    showPill({ kind: "network", icon: "wifi-off", title: "Sem internet", subtitle: "Conexão perdida", ring: null, tone: "warn" }),
  );
}

const subscribe = (l: () => void) => {
  ensureStarted();
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePills() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Só "tem pílula agora?" + seq: a casca da ilha não re-renderiza por mudança de conteúdo. */
export function usePillActive() {
  return useSyncExternalStore(subscribe, () => state.current !== null);
}

export function usePillSeq() {
  return useSyncExternalStore(subscribe, () => state.seq);
}

/** Teste no navegador: `(await import("/src/features/pills/store.ts")).debugPill("volume")`. */
export function debugPill(kind: "power" | "caps" | "volume" | "audio" = "volume") {
  const e: SysEvent =
    kind === "power"
      ? { kind: "power", plugged: true, percent: 70 }
      : kind === "caps"
        ? { kind: "capsLock", on: true }
        : kind === "audio"
          ? { kind: "audioOutput", name: "Fone JBL Tune 510BT", headphones: true }
          : { kind: "volume", level: 45, muted: false };
  showPill(pillFromSys(e));
}
