import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";
import { providerDef, type ProviderId } from "./providers";

/**
 * Conversa com a IA que a pessoa conectou (Claude Code, Codex...), pelo
 * programa oficial instalado no PC (ver src-tauri/src/ai.rs e claude.rs).
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
  /** IA conectada; null = ainda não escolheu (a aba mostra "Conectar minha IA"). */
  provider: ProviderId | null;
  /** Contexto ocupado na conversa; window = tamanho total, quando conhecido. */
  context: { tokens: number; window: number | null } | null;
  /** Lista "Conectar minha IA" aberta no painel (para conectar ou trocar de IA). */
  choosing: boolean;
  /** Últimos limites de uso informados por cada IA (guardados entre sessões). */
  limits: Partial<Record<ProviderId, LimitWindow[]>>;
  /** Conversa atual no histórico (null = ainda não teve resposta). */
  chatId: string | null;
  /** Conversas salvas, da mais recente para a mais antiga. */
  history: Conversation[];
  /** Lista do histórico aberta no painel. */
  showHistory: boolean;
}

export interface Conversation {
  id: string;
  provider: ProviderId;
  folder: string | null;
  /** Sessão da IA: reabrir continua a mesma conversa do lado dela. */
  sessionId: string | null;
  title: string;
  updatedAt: number;
  turns: Turn[];
}

export interface LimitWindow {
  /** "five_hour", "seven_day", "seven_day_opus", "daily"... */
  kind: string;
  /** Quanto já foi usado, de 0 a 1. */
  used: number;
  /** Quando zera (segundos desde 1970). */
  resetsAt: number | null;
}

type RustEvent =
  | { kind: "session"; id: number; sessionId: string }
  | { kind: "text"; id: number; text: string }
  | { kind: "tool"; id: number; name: string; detail: string }
  | { kind: "usage"; id: number; tokens: number; window: number | null }
  | { kind: "limits"; id: number; windows: LimitWindow[] }
  | { kind: "done"; id: number; ok: boolean; cancelled: boolean; text: string; sessionId: string | null };

const FLUSH_MS = 60;
const FOLDER_KEY = "island.claude.folder.v1";
const RECENT_KEY = "island.claude.recent.v1";
const MAX_RECENT = 5;
const PROVIDER_KEY = "island.ai.provider.v1";
const LIMITS_KEY = "island.ai.limits.v1";
const HISTORY_KEY = "island.ai.history.v1";
/** Histórico enxuto: o localStorage tem poucos MB para o app inteiro. */
const MAX_CONVERSATIONS = 40;
const MAX_TURNS = 60;
const MAX_CHARS = 120_000;

/** Quem já usava o Claude antes do "Conectar minha IA" continua com ele. */
function loadProvider(): ProviderId | null {
  const saved = loadJson<ProviderId | null>(PROVIDER_KEY, null);
  if (saved && providerDef(saved)?.ready) return saved;
  try {
    if (localStorage.getItem(FOLDER_KEY) !== null || localStorage.getItem(RECENT_KEY) !== null) return "claude";
  } catch {
    /* sem armazenamento */
  }
  return null;
}

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
  provider: loadProvider(),
  context: null,
  choosing: false,
  limits: loadJson<ClaudeState["limits"]>(LIMITS_KEY, {}),
  chatId: null,
  history: loadJson<Conversation[]>(HISTORY_KEY, []),
  showHistory: false,
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
    case "usage":
      set({ context: { tokens: e.tokens, window: e.window } });
      break;
    case "limits": {
      if (!state.provider) break;
      const limits = { ...state.limits, [state.provider]: e.windows };
      saveJson(LIMITS_KEY, limits);
      set({ limits });
      break;
    }
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
  saveCurrent();
}

/** Guarda a conversa atual no histórico (só as mensagens prontas, sem as que ainda chegam). */
function saveCurrent() {
  const provider = state.provider;
  const turns = state.turns.filter((t) => t.status !== "streaming");
  if (!provider || !turns.some((t) => t.role === "assistant")) return;
  // Corta do começo até caber: as últimas mensagens importam mais.
  let kept = turns.slice(-MAX_TURNS);
  while (kept.length > 2 && JSON.stringify(kept).length > MAX_CHARS) kept = kept.slice(2);
  const id = state.chatId ?? `c${Date.now().toString(36)}`;
  const firstUser = turns.find((t) => t.role === "user");
  const title = (firstUser ? turnText(firstUser) : "Conversa").replace(/\s+/g, " ").trim().slice(0, 90);
  const convo: Conversation = { id, provider, folder: state.folder, sessionId: state.sessionId, title, updatedAt: Date.now(), turns: kept };
  const history = [convo, ...state.history.filter((c) => c.id !== id)].slice(0, MAX_CONVERSATIONS);
  saveHistory(history);
  set({ chatId: id, history });
}

function saveHistory(history: Conversation[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Sem espaço: guarda só a metade mais recente.
    saveJson(HISTORY_KEY, history.slice(0, Math.ceil(history.length / 2)));
  }
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
      failRunning("A IA só responde dentro do app (npm run tauri dev).");
      return;
    }
    if (!state.provider) {
      failRunning("Conecte uma IA primeiro.");
      return;
    }
    invoke("ai_ask", { provider: state.provider, id: reply.id, prompt: text, folder: state.folder, sessionId: state.sessionId }).catch((err) =>
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
    set({ turns: [], sessionId: null, context: null, chatId: null, showHistory: false });
  },

  /** Abre/fecha a lista do histórico no painel. */
  toggleHistory(open = !state.showHistory) {
    if (open !== state.showHistory) set({ showHistory: open, choosing: false });
  },

  /** Reabre uma conversa salva: mesma IA, mesma pasta e a sessão dela (dá para continuar). */
  openConversation(id: string) {
    const c = state.history.find((h) => h.id === id);
    if (!c) return;
    if (state.busy) claude.cancel();
    saveJson(PROVIDER_KEY, c.provider);
    saveJson(FOLDER_KEY, c.folder);
    set({
      provider: c.provider,
      folder: c.folder,
      sessionId: c.sessionId,
      turns: c.turns,
      chatId: c.id,
      context: null,
      showHistory: false,
      choosing: false,
    });
  },

  deleteConversation(id: string) {
    const history = state.history.filter((c) => c.id !== id);
    saveHistory(history);
    set({ history, ...(state.chatId === id ? { chatId: null } : {}) });
  },

  /** Troca a IA conectada; a conversa recomeça (cada IA tem as próprias sessões). */
  setProvider(provider: ProviderId | null) {
    if (provider === state.provider) return;
    saveJson(PROVIDER_KEY, provider);
    if (state.busy) claude.cancel();
    set({ provider, turns: [], sessionId: null, context: null, choosing: false, chatId: null });
  },

  /** Abre/fecha a lista de IAs no painel (conectar outra ou trocar). */
  openChooser(open = true) {
    if (open !== state.choosing) set({ choosing: open, showHistory: false });
  },

  setFolder(folder: string | null) {
    if (folder === state.folder) return;
    const recentFolders = folder ? [folder, ...state.recentFolders.filter((f) => f !== folder)].slice(0, MAX_RECENT) : state.recentFolders;
    saveJson(FOLDER_KEY, folder);
    saveJson(RECENT_KEY, recentFolders);
    // As sessões do Claude Code são por pasta: trocar de pasta começa outra conversa.
    if (state.busy) claude.cancel();
    set({ folder, recentFolders, turns: [], sessionId: null, context: null, chatId: null });
  },

  /** Seletor de pasta nativo do Windows. */
  async pickFolder() {
    if (!isTauri || picking) return;
    picking = true;
    try {
      const picked = await invoke<string | null>("plugin:dialog|open", {
        options: { directory: true, multiple: false, title: "Pasta para perguntar à IA", defaultPath: state.folder ?? undefined },
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
  command: "Executando",
  tool: "Usando",
};

export function toolLabel(p: Extract<Part, { kind: "tool" }>) {
  const label = TOOL_LABEL[p.name] ?? p.name;
  return p.detail ? `${label} ${p.detail}` : label;
}

/** Nome da IA conectada, para textos da interface ("Pergunte ao ChatGPT"). */
export const currentProvider = () => state.provider;

export function providerName(id: ProviderId | null) {
  return providerDef(id)?.name ?? "IA";
}

/** Modo demonstração (vídeo de apresentação): monta a conversa sem chamar o Claude Code. */
export function __demoSetClaude(patch: Partial<ClaudeState>) {
  set(patch);
}
