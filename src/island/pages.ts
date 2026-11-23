import { useSyncExternalStore, type ComponentType, type SVGProps } from "react";
import { ALL_PAGES, type PageId } from "../lib/settings";
import { IconCloudSun, IconCpu, IconGrid, IconListCheck, IconMusic, IconSpark, IconTimer } from "./icons";

export type { PageId };

export interface PageDef {
  id: PageId;
  title: string;
  /** Palavras extras para a busca da paleta. */
  keywords: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** Todas as páginas que existem; a ordem e quais aparecem vêm dos ajustes. */
export const PAGE_DEFS: Record<PageId, PageDef> = {
  media: { id: "media", title: "Música", keywords: "mídia spotify youtube player letra", icon: IconMusic },
  pomodoro: { id: "pomodoro", title: "Pomodoro", keywords: "foco timer cronômetro pausa", icon: IconTimer },
  claude: { id: "claude", title: "Claude", keywords: "ia chat pergunta código", icon: IconSpark },
  todo: { id: "todo", title: "Tarefas", keywords: "to-do lembrete lista calendário", icon: IconListCheck },
  shortcuts: { id: "shortcuts", title: "Atalhos", keywords: "sites favoritos links acesso rápido", icon: IconGrid },
  weather: { id: "weather", title: "Clima", keywords: "tempo temperatura chuva previsão umidade vento", icon: IconCloudSun },
  hardware: { id: "hardware", title: "Hardware", keywords: "cpu ram memória gpu disco rede desempenho sistema", icon: IconCpu },
};

const KEY = "island.page.v1";

function load(): PageId {
  try {
    const saved = localStorage.getItem(KEY) as PageId | null;
    return saved && ALL_PAGES.includes(saved) ? saved : "media";
  } catch {
    return "media";
  }
}

interface State {
  page: PageId;
  /** Páginas visíveis, na ordem escolhida. Nunca vazia. */
  visible: PageId[];
}

let state: State = { page: load(), visible: ALL_PAGES };
const listeners = new Set<() => void>();

function commit(next: State) {
  if (next.page === state.page && next.visible === state.visible) return;
  if (next.page !== state.page) {
    try {
      localStorage.setItem(KEY, next.page);
    } catch {
      /* sem armazenamento */
    }
  }
  state = next;
  listeners.forEach((l) => l());
}

/** Chamado pelo App quando a ordem/visibilidade muda nos ajustes. */
export function configurePages(order: PageId[], hidden: PageId[]) {
  let visible = order.filter((p) => !hidden.includes(p));
  if (visible.length === 0) visible = [order[0] ?? "media"];
  const same = visible.length === state.visible.length && visible.every((p, i) => p === state.visible[i]);
  const nextVisible = same ? state.visible : visible;
  const page = nextVisible.includes(state.page) ? state.page : nextVisible[0];
  commit({ page, visible: nextVisible });
}

export function setPage(next: PageId) {
  // Página oculta pedida por um aviso (ex.: lembrete): mostra mesmo assim só se estiver visível.
  if (!state.visible.includes(next)) return;
  commit({ ...state, page: next });
}

/** Próxima/anterior entre as visíveis, dando a volta nas pontas. */
export function stepPage(dir: 1 | -1) {
  const list = state.visible;
  const i = list.indexOf(state.page);
  commit({ ...state, page: list[(i + dir + list.length) % list.length] });
}

/** N-ésima página visível (Ctrl+1…9). */
export function pageAt(index: number) {
  const id = state.visible[index];
  if (id) setPage(id);
}

export const getPage = () => state.page;
export const getVisiblePages = () => state.visible;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePage() {
  return useSyncExternalStore(subscribe, () => state.page);
}

export function useVisiblePages() {
  return useSyncExternalStore(subscribe, () => state.visible);
}
