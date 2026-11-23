import { useSyncExternalStore } from "react";

/** Seção aberta no painel de ajustes; outros lugares podem abrir direto numa seção. */
export type SettingsSection = "appearance" | "island" | "pages" | "shortcuts" | "keyboard" | "notifications" | "general";

/** Algo para fazer ao abrir a seção (ex.: já abrir o formulário de novo atalho). */
export type SettingsIntent = { kind: "new-shortcut"; url?: string; app?: boolean } | { kind: "edit-shortcut"; id: string } | null;

interface State {
  section: SettingsSection;
  intent: SettingsIntent;
  /** Sobe a cada pedido de abertura vindo de fora do painel. */
  seq: number;
}

let state: State = { section: "appearance", intent: null, seq: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setSettingsSection(section: SettingsSection) {
  if (state.section === section && !state.intent) return;
  state = { ...state, section, intent: null };
  emit();
}

/** Pede para abrir os ajustes numa seção (o Island escuta `seq`). */
export function requestSettings(section: SettingsSection, intent: SettingsIntent = null) {
  state = { section, intent, seq: state.seq + 1 };
  emit();
}

export function consumeIntent() {
  const i = state.intent;
  if (i) {
    state = { ...state, intent: null };
    emit();
  }
  return i;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useSettingsNav = () => useSyncExternalStore(subscribe, () => state);
