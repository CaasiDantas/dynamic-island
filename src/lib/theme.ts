import { useSyncExternalStore } from "react";
import { buildPalette, modeForSurface, type ColorMode } from "./color";
import type { Appearance, ThemeMode } from "./settings";

/* ───────── Modo efetivo (segue o Windows em "Sistema") ───────── */

const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function resolveMode(theme: ThemeMode): ColorMode {
  if (theme === "system") return darkQuery?.matches === false ? "light" : "dark";
  return theme;
}

const subscribeScheme = (l: () => void) => {
  darkQuery?.addEventListener("change", l);
  return () => darkQuery?.removeEventListener("change", l);
};

/** Re-renderiza quando o Windows troca entre claro e escuro. */
export function useSystemDark() {
  return useSyncExternalStore(subscribeScheme, () => darkQuery?.matches !== false);
}

/* ───────── Aplicação no documento ───────── */

let lastKey = "";

/**
 * Escreve os tokens no :root. Toda a interface lê só esses tokens, então
 * trocar a cor ou o modo repinta tudo de uma vez, sem nada esquecido.
 * Chamadas repetidas com o mesmo tema não tocam no DOM.
 */
export function applyAppearance(a: Appearance) {
  // Fundo personalizado decide se o texto é claro ou escuro.
  const mode = modeForSurface(a.surface, resolveMode(a.theme));
  const key = `${mode}|${a.accent}|${a.surface}|${a.surfaceOpacity}|${a.glow}`;
  if (key === lastKey) return;
  lastKey = key;
  const root = document.documentElement;
  const { vars } = buildPalette(a.accent, mode, a.surface);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.setProperty("--shell-alpha", String(a.surfaceOpacity));
  root.style.setProperty("--glow-strength", String(a.glow));
  root.dataset.theme = mode;
}

/* ───────── Temas salvos ───────── */

export interface SavedTheme extends Appearance {
  id: string;
  name: string;
}

const KEY = "island.themes.v1";

function load(): SavedTheme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let themes: SavedTheme[] = load();
const listeners = new Set<() => void>();

function commit(next: SavedTheme[]) {
  themes = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sem armazenamento */
  }
  listeners.forEach((l) => l());
}

export const savedThemes = {
  add(name: string, a: Appearance) {
    const clean = name.trim() || `Tema ${themes.length + 1}`;
    const theme: SavedTheme = { id: crypto.randomUUID(), name: clean, theme: a.theme, accent: a.accent, surface: a.surface, surfaceOpacity: a.surfaceOpacity, glow: a.glow };
    commit([...themes, theme]);
    return theme;
  },
  remove(id: string) {
    commit(themes.filter((t) => t.id !== id));
  },
  restore(theme: SavedTheme, index: number) {
    const next = [...themes];
    next.splice(Math.min(index, next.length), 0, theme);
    commit(next);
  },
};

export function useSavedThemes() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => themes,
  );
}
