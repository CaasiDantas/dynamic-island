import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";

/** Sessão de mídia real do Windows (SMTC), enviada pelo Rust só quando muda. */
export interface MediaInfo {
  app: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  /** Horário (Unix, ms) em que `positionMs` foi medida. */
  updatedAt: number;
  canPrev: boolean;
  canNext: boolean;
  canToggle: boolean;
  artwork: string | null;
}

type Action = "toggle" | "next" | "prev" | "refresh" | "seek";

let current: MediaInfo | null = null;
const listeners = new Set<() => void>();
let started = false;

function emit() {
  listeners.forEach((l) => l());
}

/** Liga a escuta na primeira assinatura e pede o estado atual ao Rust. */
function ensureStarted() {
  if (started || !isTauri) return;
  started = true;
  void listen<MediaInfo | null>("island://media", (event) => {
    current = event.payload;
    emit();
  }).then(() => send("refresh"));
}

function send(action: Action, value?: number) {
  if (!isTauri) return;
  void invoke("media_control", { action, value }).catch(() => {});
}

const subscribe = (l: () => void) => {
  ensureStarted();
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Para módulos fora do React (ex.: espectro): avisa a cada mudança da sessão. */
export const subscribeMedia = subscribe;
export const getMedia = () => current;

export function useMedia() {
  return useSyncExternalStore(subscribe, () => current);
}

/** Só "tem sessão de mídia?" (a ilha alarga para a letra só com música). */
export function useMediaPresent() {
  return useSyncExternalStore(subscribe, () => current !== null);
}

/** Letra só no Spotify: em vídeos do navegador o tempo do clipe não bate com a letra. */
export const hasLyricsSupport = (m: MediaInfo | null) => m?.app === "Spotify";

export function useLyricsSupported() {
  return useSyncExternalStore(subscribe, () => hasLyricsSupport(current));
}

/** Só o "está tocando?": o compacto não re-renderiza a cada mudança de faixa/posição. */
export function useMediaPlaying() {
  return useSyncExternalStore(subscribe, () => current?.playing ?? false);
}

/** Só a capa: quem mostra a miniatura não re-renderiza a cada mudança de posição. */
export function useArtwork() {
  return useSyncExternalStore(subscribe, () => current?.artwork ?? null);
}

/** Posição atual estimada: a última medida + o tempo corrido desde então, se tocando. */
export function positionOf(m: MediaInfo, now = Date.now()) {
  const p = m.positionMs + (m.playing && m.updatedAt > 0 ? now - m.updatedAt : 0);
  return m.durationMs > 0 ? Math.min(Math.max(0, p), m.durationMs) : Math.max(0, p);
}

export const media = {
  toggle() {
    // Resposta imediata no botão; o Rust confirma o estado real logo em seguida.
    if (current) {
      const now = Date.now();
      current = { ...current, playing: !current.playing, positionMs: positionOf(current, now), updatedAt: now };
      emit();
    }
    send("toggle");
  },
  next: () => send("next"),
  prev: () => send("prev"),
  /** Pula para `ms`; a barra já vai para lá antes da confirmação do player. */
  seek(ms: number) {
    if (!current) return;
    const clamped = Math.max(0, Math.min(ms, current.durationMs || ms));
    current = { ...current, positionMs: clamped, updatedAt: Date.now() };
    emit();
    send("seek", clamped);
  },
};

export function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Modo demonstração (vídeo de apresentação): injeta uma faixa sem passar pelo Windows. */
export function __demoSetMedia(m: MediaInfo | null) {
  current = m;
  emit();
}
