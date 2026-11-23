import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";

/**
 * Conversa com o Claude Code instalado no PC (ver src-tauri/src/claude.rs).
 *
 * O Rust manda eventos pequenos (texto aos pedaços, ferramenta usada, fim).
 * O texto é acumulado e aplicado no estado no máximo a cada FLUSH_MS, para a
 * interface re-renderizar poucas vezes por segundo, não a cada pedaço.
 */

export type Part = { kind: "text"; text: string } | { kind: "tool"; name: string; detail: string };

export interface Turn {
  id: number;
  role: "user" | "assistant";
  parts: Part[];
  status: "streaming" | "done" | "error" | "cancelled";
}

export interface ClaudeState {
  turns: Turn[];
  busy: boolean;
  /** Pasta cujo código o Claude pode ler; null = pergunta livre. */
  folder: string | null;
  recentFolders: string[];
  /** Sessão do Claude Code: as próximas perguntas continuam a mesma conversa. */
  sessionId: string | null;
  /** Sobe a cada resposta concluída (a ilha usa para avisar). */
  doneSeq: number;
}

type RustEvent =
  | { kind: "session"; id: number; sessionId: string }
  | { kind: "text"; id: number; text: string }
  | { kind: "tool"; id: number; name: string; detail: string }
  | { kind: "done"; id: number; ok: boolean; cancelled: boolean; text: string; sessionId: string | null };

const FLUSH_MS = 60;
const FOLDER_KEY = "island.claude.folder.v1";
const RECENT_KEY = "island.claude.recent.v1";
const MAX_RECENT = 5;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento */
  }
}

let state: ClaudeState = {
  turns: [],
  busy: false,
  folder: loadJson<string | null>(FOLDER_KEY, null),
  recentFolders: loadJson<string[]>(RECENT_KEY, []),
  sessionId: null,
  doneSeq: 0,
};

const listeners = new Set<() => void>();
let nextId = Date.now();
/** Pedido em andamento (id enviado ao Rust = id do turno do assistente). */
let runningId: number | null = null;
let pendingText = "";
let flushTimer: number | undefined;
let started = false;
/** Seletor de pasta aberto: a ilha não deve recolher enquanto isso. */
let picking = false;

export const isPickingFolder = () => picking;

function set(patch: Partial<ClaudeState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Troca só o último turno do assistente; os outros mantêm a identidade (memo). */
function updateRunning(fn: (t: Turn) => Turn, extra: Partial<ClaudeState> = {}) {
  const i = state.turns.findIndex((t) => t.id === runningId);
  if (i < 0) return;
  const turns = state.turns.slice();
  turns[i] = fn(turns[i]);
  set({ turns, ...extra });
}

function appendText(parts: Part[], text: string): Part[] {
  const last = parts[parts.length - 1];
  if (last?.kind === "text") return [...parts.slice(0, -1), { kind: "text", text: last.text + text }];
  return [...parts, { kind: "text", text }];
}

function flush() {
  window.clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!pendingText) return;
  const text = pendingText;
  pendingText = "";
  updateRunning((t) => ({ ...t, parts: appendText(t.parts, text) }));
}

function onEvent(e: RustEvent) {
  if (e.id !== runningId) return;
  switch (e.kind) {
    case "session":
      set({ sessionId: e.sessionId });
      break;
    case "text":
      pendingText += e.text;
      flushTimer ??= window.setTimeout(flush, FLUSH_MS);
      break;
    case "tool":
      flush();
      updateRunning((t) => ({ ...t, parts: [...t.parts, { kind: "tool", name: e.name, detail: e.detail }] }));
      break;
    case "done":
      flush();
      finish(e);
      break;
  }
}

function finish(e: Extract<RustEvent, { kind: "done" }>) {
  updateRunning(
    (t) => {
      const hasText = t.parts.some((p) => p.kind === "text" && p.text.trim());
      let parts = t.parts;
      // Resposta sem streaming (ou erro): usa o texto final.
      if (!hasText && e.text) parts = appendText(parts, e.text);
      return { ...t, parts, status: e.cancelled ? "cancelled" : e.ok ? "done" : "error" };
    },
    { busy: false, sessionId: e.sessionId ?? state.sessionId, doneSeq: e.cancelled ? state.doneSeq : state.doneSeq + 1 },
  );
  runningId = null;
}

function ensureStarted() {
  if (started || !isTauri) return;
  started = true;
  void listen<RustEvent>("island://claude", (event) => onEvent(event.payload));
}

function failRunning(message: string) {
  finish({ kind: "done", id: runningId ?? 0, ok: false, cancelled: false, text: message, sessionId: null });
}

export const claude = {
  ask(prompt: string) {
    const text = prompt.trim();
    if (!text || state.busy) return;
    ensureStarted();
    const userTurn: Turn = { id: nextId++, role: "user", parts: [{ kind: "text", text }], status: "done" };
    const reply: Turn = { id: nextId++, role: "assistant", parts: [], status: "streaming" };
    runningId = reply.id;
    pendingText = "";
    set({ turns: [...state.turns, userTurn, reply], busy: true });

    if (!isTauri) {
      failRunning("O Claude só responde dentro do app (npm run tauri dev).");
      return;
    }
    invoke("claude_ask", { id: reply.id, prompt: text, folder: state.folder, sessionId: state.sessionId }).catch((err) =>
      failRunning(String(err)),
    );
  },

  cancel() {
    if (runningId === null || !isTauri) return;
    void invoke("claude_cancel", { id: runningId });
  },

  /** Esquece a conversa; a próxima pergunta abre uma sessão nova. */
  newChat() {
    if (state.busy) claude.cancel();
    set({ turns: [], sessionId: null });
  },

  setFolder(folder: string | null) {
    if (folder === state.folder) return;
    const recentFolders = folder ? [folder, ...state.recentFolders.filter((f) => f !== folder)].slice(0, MAX_RECENT) : state.recentFolders;
    saveJson(FOLDER_KEY, folder);
    saveJson(RECENT_KEY, recentFolders);
    // As sessões do Claude Code são por pasta: trocar de pasta começa outra conversa.
    if (state.busy) claude.cancel();
    set({ folder, recentFolders, turns: [], sessionId: null });
  },

  /** Seletor de pasta nativo do Windows. */
  async pickFolder() {
    if (!isTauri || picking) return;
    picking = true;
    try {
      const picked = await invoke<string | null>("plugin:dialog|open", {
        options: { directory: true, multiple: false, title: "Pasta para perguntar ao Claude", defaultPath: state.folder ?? undefined },
      });
      if (typeof picked === "string" && picked) claude.setFolder(picked);
    } catch (err) {
      console.error("seletor de pasta falhou", err);
    } finally {
      picking = false;
    }
  },
};

/** Dá foco de teclado à janela (ela nasce sem foco para não roubar o do app atual). */
export function focusIsland() {
  if (isTauri) void invoke("focus_island").catch(() => {});
}

const subscribe = (l: () => void) => {
  ensureStarted();
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useClaude() {
  return useSyncExternalStore(subscribe, () => state);
}

export function useClaudeBusy() {
  return useSyncExternalStore(subscribe, () => state.busy);
}

export function useClaudeDoneSeq() {
  return useSyncExternalStore(subscribe, () => state.doneSeq);
}

export function folderName(path: string) {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Texto corrido de um turno (para a prévia na página do expandido). */
export function turnText(t: Turn) {
  return t.parts
    .filter((p): p is Extract<Part, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
}

const TOOL_LABEL: Record<string, string> = {
  Read: "Lendo",
  Glob: "Procurando arquivos",
  Grep: "Buscando no código",
  WebSearch: "Pesquisando",
  WebFetch: "Abrindo",
};

export function toolLabel(p: Extract<Part, { kind: "tool" }>) {
  const label = TOOL_LABEL[p.name] ?? p.name;
  return p.detail ? `${label} ${p.detail}` : label;
}

/** Modo demonstração (vídeo de apresentação): monta a conversa sem chamar o Claude Code. */
export function __demoSetClaude(patch: Partial<ClaudeState>) {
  set(patch);
}
