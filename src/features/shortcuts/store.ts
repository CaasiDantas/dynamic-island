import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/native";

/**
 * Atalhos de sites e de aplicativos: nome, destino e ícone. Ficam só neste
 * PC (localStorage). Sites abrem no navegador padrão; apps, pelo Windows
 * (Menu Iniciar, Store ou um .exe escolhido).
 */

/** Ícone do atalho: o favicon do próprio site, a inicial do nome ou um símbolo da lista. */
export type ShortcutIcon = "site" | "app" | "letter" | GlyphId;
export type GlyphId = "globe" | "mail" | "code" | "chat" | "video" | "music" | "doc" | "cart" | "star" | "home" | "book" | "calendar";

export const GLYPHS: GlyphId[] = ["globe", "mail", "code", "chat", "video", "music", "doc", "cart", "star", "home", "book", "calendar"];

export interface Shortcut {
  id: string;
  name: string;
  /** Site: endereço. App: `shell:AppsFolder\<id>` ou caminho do .exe. */
  url: string;
  icon: ShortcutIcon;
  /** Ausente nos atalhos antigos = site. */
  kind?: "site" | "app";
  /** Ícone do app (PNG em data URL), guardado para não pedir ao Windows toda vez. */
  image?: string | null;
}

export const isApp = (s: Pick<Shortcut, "kind">) => s.kind === "app";

/** Linha de apoio do atalho: o domínio do site ou "Aplicativo". */
export const subtitleOf = (s: Pick<Shortcut, "kind" | "url">) => (isApp(s) ? "Aplicativo" : hostOf(s.url));

/** Sugestões do estado vazio (um clique adiciona). */
export const SUGGESTIONS: Omit<Shortcut, "id">[] = [
  { name: "Zoho Mail", url: "https://mail.zoho.com", icon: "site" },
  { name: "WhatsApp", url: "https://web.whatsapp.com", icon: "site" },
  { name: "GitHub", url: "https://github.com", icon: "site" },
  { name: "YouTube", url: "https://www.youtube.com", icon: "site" },
  { name: "Claude", url: "https://claude.ai", icon: "site" },
];

const KEY = "island.shortcuts.v1";
const MAX = 40;

function load(): Shortcut[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((s) => s && typeof s.url === "string" && typeof s.name === "string") : [];
  } catch {
    return [];
  }
}

let list: Shortcut[] = load();
const listeners = new Set<() => void>();

function commit(next: Shortcut[]) {
  list = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
  listeners.forEach((l) => l());
}

/**
 * Aceita "github.com", "https://..." ou "mailto:...". Devolve null se não
 * for um endereço que o navegador consiga abrir.
 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol === "mailto:") return u.href;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Nome sugerido a partir do endereço ("www.github.com" → "Github"). */
export function nameFromUrl(url: string) {
  try {
    // Nome do domínio, não do subdomínio: web.whatsapp.com → Whatsapp, g1.globo.com.br → Globo.
    const parts = new URL(url).hostname.split(".");
    if (parts.length > 1) parts.pop();
    if (parts.length > 1 && /^(com|net|org|gov|edu|co)$/.test(parts[parts.length - 1])) parts.pop();
    const word = parts[parts.length - 1] ?? "";
    return word.charAt(0).toUpperCase() + word.slice(1);
  } catch {
    return "";
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Favicon servido pelo próprio site (nenhum serviço de terceiros vê seus atalhos). */
export function faviconOf(url: string) {
  try {
    const u = new URL(url);
    return u.protocol.startsWith("http") ? `${u.origin}/favicon.ico` : null;
  } catch {
    return null;
  }
}

export const shortcuts = {
  add(s: Omit<Shortcut, "id">) {
    if (list.length >= MAX) return null;
    const item: Shortcut = { ...s, id: crypto.randomUUID() };
    commit([...list, item]);
    return item;
  },
  update(id: string, patch: Partial<Omit<Shortcut, "id">>) {
    commit(list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  },
  /** Remove e devolve como desfazer. */
  remove(id: string) {
    const index = list.findIndex((s) => s.id === id);
    if (index < 0) return () => {};
    const removed = list[index];
    commit(list.filter((s) => s.id !== id));
    return () => {
      if (list.some((s) => s.id === removed.id)) return;
      const next = [...list];
      next.splice(Math.min(index, next.length), 0, removed);
      commit(next);
    };
  },
  move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
  },
  async open(s: Pick<Shortcut, "url" | "kind">) {
    try {
      if (isApp(s)) {
        if (isTauri) await invoke("app_launch", { target: s.url });
        return;
      }
      if (isTauri) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(s.url);
      } else {
        window.open(s.url, "_blank", "noopener");
      }
    } catch (err) {
      console.error("não abriu o atalho", err);
    }
  },
  get: () => list,
  full: () => list.length >= MAX,
};

export function useShortcuts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => list,
  );
}

/* ───────── Aplicativos instalados ───────── */

export interface AppEntry {
  name: string;
  target: string;
}

let appsPromise: Promise<AppEntry[]> | null = null;

/** Apps do Menu Iniciar. A consulta leva ~3 s: fica guardada na sessão. */
export function listApps(): Promise<AppEntry[]> {
  if (!isTauri) return Promise.resolve([]);
  appsPromise ??= invoke<AppEntry[]>("apps_list").catch((err) => {
    appsPromise = null;
    throw err;
  });
  return appsPromise;
}

const iconCache = new Map<string, Promise<string | null>>();

/** Ícone do app como o Explorer mostra (PNG), uma vez por destino. */
export function appIcon(target: string): Promise<string | null> {
  if (!isTauri || !target) return Promise.resolve(null);
  let p = iconCache.get(target);
  if (!p) {
    p = invoke<string | null>("app_icon", { target }).catch(() => null);
    iconCache.set(target, p);
  }
  return p;
}

/** Nome a partir do caminho do executável (".../Notepad++.exe" → "Notepad++"). */
export function nameFromPath(path: string) {
  const base = path.split(/[\\/]/).pop() ?? "";
  return base.replace(/\.(exe|lnk|appref-ms|bat|cmd)$/i, "");
}
