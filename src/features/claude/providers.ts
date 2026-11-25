import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";

/**
 * "Conectar minha IA": quais IAs existem, o que está instalado/logado no PC,
 * instalação com progresso e login (ver src-tauri/src/ai.rs).
 */

export type ProviderId = "codex" | "gemini" | "claude" | "cursor";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  /** Programa oficial usado por baixo. */
  app: string;
  account: string;
  /** Instalação: o que vai ser baixado, além das dependências que faltarem. */
  installs: string;
  ready: boolean;
  /** Dica mostrada enquanto o login está aberto. */
  loginHint: string;
}

/** Ordem: as mais populares primeiro. */
export const PROVIDERS: ProviderDef[] = [
  {
    id: "codex",
    name: "ChatGPT",
    app: "Codex",
    account: "Conta ChatGPT Plus ou Pro",
    installs: "Codex (programa oficial da OpenAI)",
    ready: true,
    loginHint: "Abrimos o login do ChatGPT no navegador. Entre com a sua conta; a ilha percebe sozinha quando terminar.",
  },
  {
    id: "gemini",
    name: "Gemini",
    app: "Gemini CLI",
    account: "Conta Google (grátis ou Google AI Pro)",
    installs: "Gemini CLI (programa oficial do Google)",
    ready: true,
    loginHint: "Na janela que abriu, escolha “Sign in with Google” e entre com a sua conta. Depois pode fechar a janela.",
  },
  {
    id: "claude",
    name: "Claude",
    app: "Claude Code",
    account: "Conta Claude Pro ou Max",
    installs: "Claude Code (programa oficial da Anthropic)",
    ready: true,
    loginHint: "Abrimos o login do Claude no navegador. Entre com a sua conta; a ilha percebe sozinha quando terminar.",
  },
  {
    id: "cursor",
    name: "Cursor",
    app: "Cursor CLI",
    account: "Conta Cursor",
    installs: "Cursor CLI (programa oficial do Cursor)",
    ready: true,
    loginHint: "Abrimos o login do Cursor no navegador. Entre com a sua conta; a ilha percebe sozinha quando terminar.",
  },
];

export const providerDef = (id: ProviderId | null) => PROVIDERS.find((p) => p.id === id) ?? null;

/** Tamanho aproximado das dependências, para o aviso antes de instalar. */
const NEED_SIZE: Record<string, string> = { "Node.js": "~30 MB" };
export const needLabel = (n: string) => (NEED_SIZE[n] ? `${n} (${NEED_SIZE[n]})` : n);

export interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  loggedIn: boolean | null;
  plan: string | null;
  needs: string[];
}

export type StepStatus = "pending" | "running" | "done" | "error";

export interface InstallState {
  provider: ProviderId;
  steps: { step: string; label: string; status: StepStatus }[];
  error: string | null;
  finished: boolean;
}

interface State {
  status: Partial<Record<ProviderId, ProviderStatus>>;
  loading: boolean;
  install: InstallState | null;
  /** Login aberto numa janela; a ilha confere de tempos em tempos se já entrou. */
  waitingLogin: ProviderId | null;
  loginError: string | null;
}

interface InstallEvent {
  provider: ProviderId;
  step: string;
  status: "running" | "done" | "error";
  message: string;
}

let state: State = { status: {}, loading: false, install: null, waitingLogin: null, loginError: null };
const listeners = new Set<() => void>();
let started = false;
let pollTimer: number | undefined;
let pollUntil = 0;
/** Quem chamar `login` diz o que fazer quando a pessoa terminar de entrar. */
let onLoggedIn: ((id: ProviderId) => void) | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function ensureStarted() {
  if (started || !isTauri) return;
  started = true;
  void listen<InstallEvent>("island://ai-install", (e) => onInstallEvent(e.payload));
}

function onInstallEvent(e: InstallEvent) {
  const cur = state.install;
  if (!cur || cur.provider !== e.provider) return;
  if (e.step === "end") {
    const steps = e.status === "error" ? cur.steps.map((s) => (s.status === "running" ? { ...s, status: "error" as const } : s)) : cur.steps;
    set({ install: { ...cur, steps, finished: true, error: e.status === "error" ? e.message || "A instalação falhou." : null } });
    void providers.refresh();
    return;
  }
  const steps = cur.steps.map((s) => (s.step === e.step ? { ...s, status: e.status } : s));
  set({ install: { ...cur, steps } });
}

const STEP_LABEL: Record<string, string> = {
  node: "Instalando Node.js",
  codex: "Instalando Codex",
  claude: "Instalando Claude Code",
  gemini: "Instalando Gemini CLI",
  cursor: "Instalando Cursor CLI",
};

export const providers = {
  async refresh() {
    if (!isTauri) return;
    ensureStarted();
    set({ loading: true });
    try {
      const list = await invoke<ProviderStatus[]>("ai_providers");
      const status: State["status"] = {};
      for (const s of list) status[s.id] = s;
      set({ status, loading: false });
    } catch (err) {
      console.error("ai_providers falhou", err);
      set({ loading: false });
    }
  },

  install(id: ProviderId) {
    if (!isTauri || state.install?.finished === false) return;
    ensureStarted();
    const needs = state.status[id]?.needs ?? [];
    const steps = [...(needs.includes("Node.js") ? ["node"] : []), id].map((step) => ({ step, label: STEP_LABEL[step] ?? step, status: "pending" as StepStatus }));
    set({ install: { provider: id, steps, error: null, finished: false } });
    invoke("ai_install", { provider: id }).catch((err) => onInstallEvent({ provider: id, step: "end", status: "error", message: String(err) }));
  },

  clearInstall() {
    if (state.install?.finished) set({ install: null });
  },

  /** Abre o login oficial e fica conferindo por até 3 minutos se a pessoa já entrou. */
  async login(id: ProviderId, done: (id: ProviderId) => void) {
    if (!isTauri) return;
    onLoggedIn = done;
    try {
      await invoke("ai_login", { provider: id });
    } catch (err) {
      set({ loginError: String(err) });
      return;
    }
    set({ waitingLogin: id, loginError: null });
    pollUntil = Date.now() + 180_000;
    window.clearTimeout(pollTimer);
    const tick = async () => {
      await providers.refresh();
      if (state.waitingLogin !== id) return;
      if (state.status[id]?.loggedIn) {
        set({ waitingLogin: null });
        onLoggedIn?.(id);
        onLoggedIn = null;
        return;
      }
      if (Date.now() < pollUntil) pollTimer = window.setTimeout(tick, 3000);
      else set({ waitingLogin: null });
    };
    pollTimer = window.setTimeout(tick, 3000);
  },

  stopWaiting() {
    window.clearTimeout(pollTimer);
    onLoggedIn = null;
    set({ waitingLogin: null });
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useProviders() {
  return useSyncExternalStore(subscribe, () => state);
}
