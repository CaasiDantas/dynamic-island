import { useEffect, useState, useSyncExternalStore } from "react";
import { playChime, primeAudio } from "./sound";

export type Phase = "focus" | "short" | "long";
export type Status = "idle" | "running" | "paused" | "done";

export interface PomodoroConfig {
  focusMin: number;
  shortMin: number;
  longMin: number;
  /** Focos até a pausa longa. */
  cycles: number;
  /** Começar a próxima fase sozinho ao terminar a atual. */
  autoStart: boolean;
  sound: boolean;
}

export interface PomodoroState {
  status: Status;
  /** Fase atual (em `done`, a fase que acabou de terminar). */
  phase: Phase;
  /** Próxima fase (relevante em `idle` e `done`). */
  next: Phase;
  totalMs: number;
  /** Horário de término quando `running`. O tempo restante é sempre derivado dele. */
  endsAt: number | null;
  /** Tempo restante congelado quando `paused`. */
  remainingMs: number;
  /** Focos concluídos no ciclo atual (zera após a pausa longa). */
  focusDone: number;
  /** Incrementa a cada fase concluída: a ilha usa para se expandir e avisar. */
  finishSeq: number;
}

export const PHASE_LABEL: Record<Phase, string> = {
  focus: "Foco",
  short: "Pausa",
  long: "Pausa longa",
};

const CONFIG_KEY = "island.pomodoro.config.v1";
const STATE_KEY = "island.pomodoro.state.v1";

export const DEFAULT_CONFIG: PomodoroConfig = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  cycles: 4,
  autoStart: false,
  sound: true,
};

const IDLE: PomodoroState = {
  status: "idle",
  phase: "focus",
  next: "focus",
  totalMs: 0,
  endsAt: null,
  remainingMs: 0,
  focusDone: 0,
  finishSeq: 0,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento: segue em memória */
  }
}

let config: PomodoroConfig = load(CONFIG_KEY, DEFAULT_CONFIG);
let state: PomodoroState = load(STATE_KEY, IDLE);
const listeners = new Set<() => void>();
let finishTimer: number | undefined;

function emit() {
  save(STATE_KEY, state);
  listeners.forEach((l) => l());
}

function set(patch: Partial<PomodoroState>) {
  state = { ...state, ...patch };
  emit();
}

const minutes = (phase: Phase) =>
  (phase === "focus" ? config.focusMin : phase === "short" ? config.shortMin : config.longMin) * 60_000;

function nextAfter(phase: Phase, focusDone: number): Phase {
  if (phase !== "focus") return "focus";
  return focusDone > 0 && focusDone % config.cycles === 0 ? "long" : "short";
}

/** Um único timer por fase, agendado para o horário exato de término. */
function scheduleFinish() {
  window.clearTimeout(finishTimer);
  if (state.status !== "running" || state.endsAt === null) return;
  finishTimer = window.setTimeout(() => finish(true), Math.max(0, state.endsAt - Date.now()));
}

function finish(withSound: boolean) {
  window.clearTimeout(finishTimer);
  const ended = state.phase;
  const focusDone = ended === "focus" ? state.focusDone + 1 : ended === "long" ? 0 : state.focusDone;
  const next = nextAfter(ended, focusDone);
  if (withSound && config.sound) playChime(ended === "focus" ? "break" : "focus");
  if (config.autoStart) {
    const totalMs = minutes(next);
    set({
      status: "running",
      phase: next,
      next: nextAfter(next, focusDone),
      totalMs,
      endsAt: Date.now() + totalMs,
      remainingMs: totalMs,
      focusDone,
      finishSeq: state.finishSeq + 1,
    });
    scheduleFinish();
  } else {
    set({ status: "done", phase: ended, next, endsAt: null, remainingMs: 0, focusDone, finishSeq: state.finishSeq + 1 });
  }
}

// ───────── ações ─────────

export const pomodoro = {
  start(phase: Phase = state.status === "done" || state.status === "idle" ? state.next : "focus") {
    primeAudio(); // chamado num clique: libera o áudio para o aviso no fim
    const totalMs = minutes(phase);
    set({ status: "running", phase, totalMs, endsAt: Date.now() + totalMs, remainingMs: totalMs });
    scheduleFinish();
  },
  pause() {
    if (state.status !== "running" || state.endsAt === null) return;
    window.clearTimeout(finishTimer);
    set({ status: "paused", remainingMs: Math.max(0, state.endsAt - Date.now()), endsAt: null });
  },
  resume() {
    if (state.status !== "paused") return;
    primeAudio();
    set({ status: "running", endsAt: Date.now() + state.remainingMs });
    scheduleFinish();
  },
  /** Encerra a fase atual agora e segue para a próxima (sem som). */
  skip() {
    if (state.status === "running" || state.status === "paused") finish(false);
    else if (state.status === "done") pomodoro.start(state.next);
  },
  /** Para tudo e zera o ciclo. */
  stop() {
    window.clearTimeout(finishTimer);
    set({ ...IDLE, finishSeq: state.finishSeq });
  },
  /** Fecha o aviso de fase concluída sem iniciar a próxima. */
  dismiss() {
    if (state.status !== "done") return;
    set({ status: "idle", totalMs: 0, remainingMs: 0 });
  },
  setConfig(patch: Partial<PomodoroConfig>) {
    config = { ...config, ...patch };
    save(CONFIG_KEY, config);
    listeners.forEach((l) => l());
  },
};

// Recupera um timer que estava rodando quando o app foi fechado.
if (state.status === "running" && state.endsAt !== null) {
  if (state.endsAt <= Date.now()) finish(false);
  else scheduleFinish();
}

// ───────── leitura no React ─────────

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePomodoro() {
  return useSyncExternalStore(subscribe, () => state);
}

export function usePomodoroConfig() {
  return useSyncExternalStore(subscribe, () => config);
}

/** Muda só quando uma fase termina (a ilha não re-renderiza a cada pausa/retomada). */
export function usePomodoroFinishSeq() {
  return useSyncExternalStore(subscribe, () => state.finishSeq);
}

/** Há uma atividade de Pomodoro visível na ilha? */
export function usePomodoroActive() {
  return useSyncExternalStore(subscribe, () => state.status !== "idle");
}

export function remainingOf(s: PomodoroState, now = Date.now()) {
  if (s.status === "running" && s.endsAt !== null) return Math.max(0, s.endsAt - now);
  if (s.status === "paused") return s.remainingMs;
  return 0;
}

/**
 * Tempo restante que atualiza uma vez por segundo, alinhado à virada do
 * segundo do cronômetro — só enquanto está rodando, e só no componente que
 * mostra o tempo (o resto da ilha não re-renderiza).
 */
export function useRemaining(s: PomodoroState) {
  const [, force] = useState(0);
  useEffect(() => {
    if (s.status !== "running" || s.endsAt === null) return;
    let timer = 0;
    const tick = () => {
      force((n) => n + 1);
      const left = s.endsAt! - Date.now();
      if (left > 0) timer = window.setTimeout(tick, (left % 1000) + 5);
    };
    timer = window.setTimeout(tick, ((s.endsAt - Date.now()) % 1000) + 5);
    return () => window.clearTimeout(timer);
  }, [s.status, s.endsAt]);
  return remainingOf(s);
}

export function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
