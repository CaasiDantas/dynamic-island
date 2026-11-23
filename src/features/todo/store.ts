import { useSyncExternalStore } from "react";
import { showPill } from "../pills/store";

/**
 * Tarefas com lembrete opcional. Tudo fica no próprio PC (localStorage).
 *
 * Lembretes: um único timer, marcado para o próximo lembrete pendente
 * (nada de checar a cada segundo). Lembrete que venceu com o app fechado
 * aparece assim que a ilha abre.
 */

export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  /** Quando foi concluída (para "feitas hoje" e o histórico). */
  doneAt: number | null;
  /** Hora do lembrete (ms) ou null. */
  remindAt: number | null;
  /** Lembrete já avisado (não repete). */
  notified: boolean;
  /** Pasta (quadro) da tarefa; sem pasta = lista do dia. */
  folderId?: string | null;
  /** Coluna do quadro; a última coluna conta como concluída. */
  columnId?: string | null;
  /** Posição dentro da coluna. */
  order?: number;
}

export interface Column {
  id: string;
  name: string;
}

/** Pasta de tarefas: abre como quadro com colunas (estilo kanban). */
export interface Folder {
  id: string;
  name: string;
  columns: Column[];
  createdAt: number;
}

const DEFAULT_COLUMNS = ["A fazer", "Fazendo", "Feito"];
export const FOLDER_MAX_COLUMNS = 6;

/** O que o painel de tarefas mostra. */
/** "new" pode vir com o dia já escolhido (criada pelo calendário). */
export type TodoPanel =
  | { kind: "new"; day?: number }
  | { kind: "edit"; id: string }
  | { kind: "history" }
  | { kind: "calendar" }
  | { kind: "folders" }
  | { kind: "board"; id: string };

/** Quadro aberto: a ilha alarga para caber as colunas. */
export const isWidePanel = (p: TodoPanel) => p.kind === "board";

interface State {
  tasks: Task[];
  folders: Folder[];
  panel: TodoPanel;
  /** Sobe quando alguém pede para abrir o painel. */
  openSeq: number;
  /** Sobe quando um lembrete pede para mostrar a página de tarefas. */
  showSeq: number;
  /** Tarefa destacada na página (a do lembrete). */
  flashId: string | null;
}

const KEY = "island.todo.v1";
const FOLDERS_KEY = "island.todo.folders.v1";
/** setTimeout não aceita mais que ~24 dias; reavalia uma vez por dia no máximo. */
const MAX_WAIT = 24 * 60 * 60 * 1000;

function load(): Task[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Partial<Task>[];
    // Versão anterior não tinha doneAt.
    return raw.map((t) => ({ doneAt: t.done ? (t.createdAt ?? Date.now()) : null, ...t }) as Task);
  } catch {
    return [];
  }
}

function loadFolders(): Folder[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((f) => f && typeof f.id === "string" && Array.isArray(f.columns) && f.columns.length) : [];
  } catch {
    return [];
  }
}

let state: State = { tasks: load(), folders: loadFolders(), panel: { kind: "new" }, openSeq: 0, showSeq: 0, flashId: null };
const listeners = new Set<() => void>();
let timer: number | undefined;

function set(next: State, persist = true) {
  state = next;
  if (persist) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next.tasks));
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(next.folders));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  }
  listeners.forEach((l) => l());
  if (persist) schedule();
}

const patchTasks = (fn: (tasks: Task[]) => Task[]) => set({ ...state, tasks: fn(state.tasks) });
const patchFolders = (fn: (folders: Folder[]) => Folder[]) => set({ ...state, folders: fn(state.folders) });

const lastColumn = (f: Folder) => f.columns[f.columns.length - 1].id;
const folderOf = (id: string | null | undefined) => (id ? state.folders.find((f) => f.id === id) : undefined);
/** Com uma coluna só não existe "concluída por coluna". */
const isDoneColumn = (f: Folder, columnId: string) => f.columns.length > 1 && columnId === lastColumn(f);

/** Tarefas de uma coluna, na ordem do quadro. */
export function columnTasks(tasks: Task[], folder: Folder, columnId: string) {
  const first = folder.columns[0].id;
  return tasks
    .filter((t) => t.folderId === folder.id && (t.columnId ?? first) === columnId)
    .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

export const todo = {
  add(text: string, remindAt: number | null) {
    const t = text.trim();
    if (!t) return;
    const task: Task = { id: crypto.randomUUID(), text: t, done: false, createdAt: Date.now(), doneAt: null, remindAt, notified: false };
    patchTasks((tasks) => [...tasks, task]);
  },
  /** Nova tarefa direto numa coluna do quadro (vai para o fim dela). */
  addToColumn(folderId: string, columnId: string, text: string) {
    const t = text.trim();
    const folder = folderOf(folderId);
    if (!t || !folder) return;
    const col = columnTasks(state.tasks, folder, columnId);
    const done = isDoneColumn(folder, columnId);
    const task: Task = {
      id: crypto.randomUUID(),
      text: t.slice(0, 200),
      done,
      createdAt: Date.now(),
      doneAt: done ? Date.now() : null,
      remindAt: null,
      notified: false,
      folderId,
      columnId,
      order: (col[col.length - 1]?.order ?? col.length) + 1,
    };
    patchTasks((tasks) => [...tasks, task]);
  },
  /** Arrasta para outra coluna/posição. Entrar na última coluna conclui; sair dela reabre. */
  moveTo(id: string, columnId: string, index: number) {
    const task = state.tasks.find((t) => t.id === id);
    const folder = folderOf(task?.folderId);
    if (!task || !folder) return;
    const others = columnTasks(state.tasks, folder, columnId).filter((t) => t.id !== id);
    const at = Math.max(0, Math.min(index, others.length));
    const ordered = [...others.slice(0, at), task, ...others.slice(at)];
    const orderOf = new Map(ordered.map((t, i) => [t.id, i]));
    const done = isDoneColumn(folder, columnId);
    patchTasks((tasks) =>
      tasks.map((t) => {
        if (t.id === id) {
          return { ...t, columnId, order: orderOf.get(id)!, done, doneAt: done ? (t.done ? t.doneAt : Date.now()) : null };
        }
        return orderOf.has(t.id) ? { ...t, order: orderOf.get(t.id)! } : t;
      }),
    );
  },
  update(id: string, text: string, remindAt: number | null) {
    const t = text.trim();
    if (!t) return;
    patchTasks((tasks) =>
      tasks.map((x) => (x.id === id ? { ...x, text: t, remindAt, notified: remindAt === x.remindAt ? x.notified : false } : x)),
    );
  },
  toggle(id: string) {
    const task = state.tasks.find((t) => t.id === id);
    const folder = folderOf(task?.folderId);
    if (task && folder && folder.columns.length > 1) {
      // No quadro, concluir = ir para a última coluna; reabrir = voltar para a primeira.
      todo.moveTo(id, task.done ? folder.columns[0].id : lastColumn(folder), Infinity);
      return;
    }
    patchTasks((tasks) => tasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? null : Date.now() } : t)));
  },
  remove(id: string) {
    patchTasks((tasks) => tasks.filter((t) => t.id !== id));
  },
  clearHistory() {
    patchTasks((tasks) => tasks.filter((t) => !t.done || !!t.folderId));
  },
  /* ── Pastas ── */

  addFolder(name: string) {
    const n = name.trim();
    if (!n) return null;
    const folder: Folder = {
      id: crypto.randomUUID(),
      name: n.slice(0, 40),
      columns: DEFAULT_COLUMNS.map((c) => ({ id: crypto.randomUUID(), name: c })),
      createdAt: Date.now(),
    };
    patchFolders((f) => [...f, folder]);
    return folder;
  },
  renameFolder(id: string, name: string) {
    const n = name.trim();
    if (n) patchFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name: n.slice(0, 40) } : f)));
  },
  /** Apaga a pasta e as tarefas dela; devolve como desfazer. */
  removeFolder(id: string) {
    const folder = folderOf(id);
    if (!folder) return () => {};
    const index = state.folders.indexOf(folder);
    const removedTasks = state.tasks.filter((t) => t.folderId === id);
    set({ ...state, folders: state.folders.filter((f) => f.id !== id), tasks: state.tasks.filter((t) => t.folderId !== id) });
    return () => {
      if (folderOf(id)) return;
      const folders = [...state.folders];
      folders.splice(Math.min(index, folders.length), 0, folder);
      set({ ...state, folders, tasks: [...state.tasks, ...removedTasks] });
    };
  },
  addColumn(folderId: string, name = "Nova coluna") {
    patchFolders((fs) =>
      fs.map((f) =>
        f.id === folderId && f.columns.length < FOLDER_MAX_COLUMNS
          ? // Entra antes da última, que é a das concluídas.
            { ...f, columns: [...f.columns.slice(0, -1), { id: crypto.randomUUID(), name }, f.columns[f.columns.length - 1]] }
          : f,
      ),
    );
  },
  renameColumn(folderId: string, columnId: string, name: string) {
    const n = name.trim();
    if (!n) return;
    patchFolders((fs) =>
      fs.map((f) => (f.id === folderId ? { ...f, columns: f.columns.map((c) => (c.id === columnId ? { ...c, name: n.slice(0, 24) } : c)) } : f)),
    );
  },
  /** Remove a coluna; as tarefas dela vão para a primeira coluna restante. */
  removeColumn(folderId: string, columnId: string) {
    const folder = folderOf(folderId);
    if (!folder || folder.columns.length <= 1) return;
    const columns = folder.columns.filter((c) => c.id !== columnId);
    const next: Folder = { ...folder, columns };
    set({
      ...state,
      folders: state.folders.map((f) => (f.id === folderId ? next : f)),
      tasks: state.tasks.map((t) => {
        if (t.folderId !== folderId) return t;
        const col = !t.columnId || t.columnId === columnId ? columns[0].id : t.columnId;
        const done = isDoneColumn(next, col);
        return { ...t, columnId: col, done, doneAt: done ? (t.doneAt ?? Date.now()) : null };
      }),
    });
  },

  /** Abre o painel em "nova", "editar" ou "histórico". */
  open(panel: TodoPanel) {
    set({ ...state, panel, openSeq: state.openSeq + 1 }, false);
  },
  /** Lembrete clicado: mostra a página de tarefas com ela em destaque. */
  show(id: string | null) {
    set({ ...state, flashId: id, showSeq: state.showSeq + 1 }, false);
  },
};

/* ───────── Lembretes ───────── */

function schedule() {
  window.clearTimeout(timer);
  const next = state.tasks
    .filter((t) => !t.done && !t.notified && t.remindAt != null)
    .reduce<number | null>((min, t) => (min == null || t.remindAt! < min ? t.remindAt! : min), null);
  if (next == null) return;
  timer = window.setTimeout(fireDue, Math.min(MAX_WAIT, Math.max(0, next - Date.now())));
}

function fireDue() {
  const now = Date.now();
  const due = state.tasks.filter((t) => !t.done && !t.notified && t.remindAt != null && t.remindAt <= now + 500);
  if (!due.length) return schedule();
  const ids = new Set(due.map((t) => t.id));
  patchTasks((tasks) => tasks.map((t) => (ids.has(t.id) ? { ...t, notified: true } : t)));
  const first = due[0];
  showPill({
    kind: "todo",
    icon: "bell",
    meta: "Lembrete",
    title: first.text,
    subtitle: due.length > 1 ? `e mais ${due.length - 1} ${due.length > 2 ? "lembretes" : "lembrete"}` : `Agendado para ${reminderLabel(first.remindAt!)}`,
    value: hhmm(new Date(first.remindAt!)),
    ring: null,
    tone: "accent",
    open: () => todo.show(first.id),
  });
}

// Lembretes vencidos com o app fechado: avisa logo depois de abrir.
window.setTimeout(schedule, 1500);

/* ───────── Hooks ───────── */

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useTasks = () => useSyncExternalStore(subscribe, () => state.tasks);
export const useFolders = () => useSyncExternalStore(subscribe, () => state.folders);
export const useTodoWide = () => useSyncExternalStore(subscribe, () => isWidePanel(state.panel));
export const useTodoPanel = () => useSyncExternalStore(subscribe, () => state.panel);
export const useTodoOpenSeq = () => useSyncExternalStore(subscribe, () => state.openSeq);
export const useTodoShowSeq = () => useSyncExternalStore(subscribe, () => state.showSeq);
export const useTodoFlash = () => useSyncExternalStore(subscribe, () => state.flashId);

/* ───────── Listas ───────── */

export function startOfDay(t = Date.now(), plusDays = 0) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + plusDays);
  return d.getTime();
}

/** Lista do dia: pendentes (lembrete mais próximo antes) e, no fim, as concluídas hoje. */
export function todayList(all: Task[]) {
  // Tarefas de pastas vivem no quadro delas, não na lista do dia.
  const tasks = all.filter((t) => !t.folderId);
  const today = startOfDay();
  const pending = tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.remindAt ?? Infinity) - (b.remindAt ?? Infinity) || a.createdAt - b.createdAt);
  const doneToday = tasks.filter((t) => t.done && (t.doneAt ?? 0) >= today).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  return { pending, doneToday, list: [...pending, ...doneToday] };
}

/** Histórico: concluídas, agrupadas por dia (mais recente primeiro). */
export function historyGroups(tasks: Task[]) {
  const done = tasks.filter((t) => t.done && !t.folderId).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const groups: { label: string; tasks: Task[] }[] = [];
  for (const t of done) {
    const label = dayLabel(t.doneAt ?? t.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.tasks.push(t);
    else groups.push({ label, tasks: [t] });
  }
  return groups;
}

/** Dia em que a tarefa aparece no calendário: o do lembrete ou, sem lembrete, o dia em que foi concluída. */
export function taskDay(t: Task) {
  const at = t.remindAt ?? (t.done ? t.doneAt : null);
  return at == null ? null : startOfDay(at);
}

/** Tarefas por dia (início do dia → tarefas), para o calendário. */
export function tasksByDay(tasks: Task[]) {
  const map = new Map<number, Task[]>();
  for (const t of tasks) {
    const day = taskDay(t);
    if (day == null) continue;
    const list = map.get(day);
    if (list) list.push(t);
    else map.set(day, [t]);
  }
  for (const list of map.values()) list.sort((a, b) => (a.remindAt ?? a.doneAt ?? 0) - (b.remindAt ?? b.doneAt ?? 0));
  return map;
}

/* ───────── Horários ───────── */

export const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function dayLabel(t: number) {
  const day = startOfDay(t);
  if (day === startOfDay()) return "Hoje";
  if (day === startOfDay(Date.now(), -1)) return "Ontem";
  if (day === startOfDay(Date.now(), 1)) return "Amanhã";
  return new Date(t).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/** "hoje 14:30", "amanhã 09:00" ou "sex., 20/11 09:00". */
export function reminderLabel(at: number) {
  return `${dayLabel(at).toLowerCase()} ${hhmm(new Date(at))}`;
}
