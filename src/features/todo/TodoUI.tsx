import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useCommitCount } from "../../perf/hooks";
import { IconBell, IconCalendar, IconCheck, IconChevronLeft, IconChevronRight, IconClose, IconFolder, IconPlus, IconReset } from "../../island/icons";
import { Board, Folders } from "./Board";
import { focusIsland } from "../claude/store";
import {
  dayLabel,
  historyGroups,
  hhmm,
  reminderLabel,
  startOfDay,
  tasksByDay,
  todayList,
  todo,
  useTasks,
  useTodoFlash,
  useTodoPanel,
  type Task,
} from "./store";

/** Foco do campo de texto do formulário (o painel só deixa de ser inerte depois de abrir). */
let focusFormInput: (() => void) | null = null;
export const focusTodoInput = () => window.setTimeout(() => focusFormInput?.(), 80);

/* ═════════ Página do expandido (como no Nusa): placar à esquerda, cartões à direita ═════════ */

export function TodoPage() {
  useCommitCount("TodoPage");
  const tasks = useTasks();
  const flash = useTodoFlash();
  const { pending, doneToday, list } = todayList(tasks);
  const total = pending.length + doneToday.length;
  const listRef = useRef<HTMLUListElement>(null);

  // Lembrete clicado: rola até a tarefa e a destaca.
  useEffect(() => {
    if (!flash) return;
    listRef.current?.querySelector(`[data-id="${flash}"]`)?.scrollIntoView({ block: "nearest" });
  }, [flash]);

  return (
    <div className="tdp">
      <div className="tdp-side">
        <div className="tdp-score">
          <strong>
            {doneToday.length}/{total}
          </strong>
          <span>{total ? "Feitas hoje" : "Nenhuma tarefa"}</span>
        </div>
        <div className="tdp-actions">
          <button className="tdp-btn" onClick={() => todo.open({ kind: "new" })}>
            <IconPlus /> Nova
          </button>
          <button className="tdp-btn tdp-btn--icon" onClick={() => todo.open({ kind: "folders" })} aria-label="Pastas" title="Pastas (quadros)">
            <IconFolder />
          </button>
          <button className="tdp-btn tdp-btn--icon" onClick={() => todo.open({ kind: "calendar" })} aria-label="Calendário" title="Calendário">
            <IconCalendar />
          </button>
          <button className="tdp-btn tdp-btn--icon" onClick={() => todo.open({ kind: "history" })} aria-label="Histórico" title="Histórico">
            <IconReset />
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <button className="tdp-empty" onClick={() => todo.open({ kind: "new" })}>
          <IconPlus />
          Adicione uma tarefa e, se quiser, um horário para a ilha te lembrar
        </button>
      ) : (
        <ul ref={listRef} className="tdp-list">
          {list.map((t) => (
            <Card key={t.id} task={t} flash={t.id === flash} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ task, flash }: { task: Task; flash: boolean }) {
  const overdue = !task.done && task.remindAt != null && task.remindAt <= Date.now();
  return (
    <li className="tdc" data-id={task.id} data-done={task.done || undefined} data-flash={flash || undefined}>
      <button className="tdc-check" role="checkbox" aria-checked={task.done} aria-label={task.done ? "Desmarcar" : "Concluir"} onClick={() => todo.toggle(task.id)}>
        <IconCheck />
      </button>
      <button className="tdc-text" onClick={() => todo.open({ kind: "edit", id: task.id })} title="Editar">
        {task.text}
      </button>
      {task.remindAt != null && !task.done && (
        <span className="tdc-when" data-overdue={overdue || undefined}>
          <IconBell />
          {startOfDay(task.remindAt) === startOfDay() ? hhmm(new Date(task.remindAt)) : reminderLabel(task.remindAt)}
        </span>
      )}
    </li>
  );
}

/* ═════════ Painel: formulário (nova/editar) ou histórico ═════════ */

const toFolders = () => todo.open({ kind: "folders" });

export function TodoView({ onBack }: { onBack: () => void }) {
  useCommitCount("TodoView");
  const panel = useTodoPanel();
  const tasks = useTasks();
  if (panel.kind === "history") return <History tasks={tasks} onBack={onBack} />;
  if (panel.kind === "calendar") return <Calendar tasks={tasks} onBack={onBack} />;
  if (panel.kind === "folders") return <Folders onBack={onBack} />;
  if (panel.kind === "board") return <Board key={panel.id} id={panel.id} onBack={toFolders} />;
  const editing = panel.kind === "edit" ? tasks.find((t) => t.id === panel.id) : undefined;
  // key: trocar de tarefa recomeça o formulário com os dados dela.
  const day = panel.kind === "new" ? panel.day : undefined;
  // Criada pelo calendário: volta para ele ao salvar/cancelar.
  // Tarefa de pasta: volta para o quadro dela.
  const folderId = editing?.folderId;
  const back = day != null ? () => todo.open({ kind: "calendar" }) : folderId ? () => todo.open({ kind: "board", id: folderId }) : onBack;
  return <Form key={editing?.id ?? `new-${day ?? ""}`} task={editing} day={day} onDone={back} />;
}

type Remind = { mode: "none" } | { mode: "rel"; min: number } | { mode: "at"; day: number; time: string };

const REL = [
  { min: 15, label: "Em 15 min" },
  { min: 60, label: "Em 1 hora" },
];
const HOURS = ["09:00", "12:00", "18:00", "21:00"];

/** Próxima hora cheia (para "Hoje" sem horário escolhido). */
function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return hhmm(d);
}

function toTime(r: Remind): number | null {
  if (r.mode === "none") return null;
  if (r.mode === "rel") return Date.now() + r.min * 60_000;
  const [h, m] = r.time.split(":").map(Number);
  const d = new Date(r.day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function fromTask(t?: Task, day?: number): Remind {
  if (day != null && !t) return { mode: "at", day, time: day === startOfDay() ? nextHour() : "09:00" };
  if (!t?.remindAt) return { mode: "none" };
  return { mode: "at", day: startOfDay(t.remindAt), time: hhmm(new Date(t.remindAt)) };
}

const dateValue = (day: number) => {
  const d = new Date(day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Form({ task, day, onDone }: { task?: Task; day?: number; onDone: () => void }) {
  const [text, setText] = useState(task?.text ?? "");
  const [remind, setRemind] = useState<Remind>(() => fromTask(task, day));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fn = () => {
      focusIsland();
      ref.current?.focus({ preventScroll: true });
    };
    focusFormInput = fn;
    return () => {
      if (focusFormInput === fn) focusFormInput = null;
    };
  }, []);

  const today = startOfDay();
  const tomorrow = startOfDay(Date.now(), 1);
  const at = toTime(remind);
  const past = remind.mode === "at" && at != null && at <= Date.now();

  const setDay = (day: number) =>
    setRemind((r) => ({ mode: "at", day, time: r.mode === "at" ? r.time : day === today ? nextHour() : "09:00" }));
  const setHour = (time: string) => setRemind((r) => ({ mode: "at", day: r.mode === "at" ? r.day : today, time }));

  const save = () => {
    if (!text.trim() || past) return;
    if (task) todo.update(task.id, text, at);
    else todo.add(text, at);
    onDone();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className="td">
      <header className="settings-head">
        <button className="icon-btn" onClick={onDone} aria-label="Voltar">
          <IconChevronLeft />
        </button>
        <h1>{task ? "Editar tarefa" : "Nova tarefa"}</h1>
      </header>

      <div className="composer composer--line td-input">
        <input
          ref={ref}
          value={text}
          placeholder="O que você precisa fazer?"
          spellCheck={false}
          maxLength={200}
          onPointerDown={focusIsland}
          onFocus={focusIsland}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <section className="td-remind">
        <h2>
          <IconBell /> Lembrete
        </h2>
        <div className="td-line">
          <span>Rápido</span>
          <Chip on={remind.mode === "none"} onClick={() => setRemind({ mode: "none" })}>
            Sem lembrete
          </Chip>
          {REL.map((r) => (
            <Chip key={r.min} on={remind.mode === "rel" && remind.min === r.min} onClick={() => setRemind({ mode: "rel", min: r.min })}>
              {r.label}
            </Chip>
          ))}
        </div>
        <div className="td-line">
          <span>Dia</span>
          <Chip on={remind.mode === "at" && remind.day === today} onClick={() => setDay(today)}>
            Hoje
          </Chip>
          <Chip on={remind.mode === "at" && remind.day === tomorrow} onClick={() => setDay(tomorrow)}>
            Amanhã
          </Chip>
          <label className="td-chip td-chip--field" data-on={(remind.mode === "at" && remind.day > tomorrow) || undefined}>
            <input
              type="date"
              min={dateValue(today)}
              value={remind.mode === "at" ? dateValue(remind.day) : ""}
              aria-label="Outro dia"
              onFocus={focusIsland}
              onChange={(e) => {
                if (!e.target.value) return;
                const [y, mo, d] = e.target.value.split("-").map(Number);
                setDay(new Date(y, mo - 1, d).getTime());
              }}
            />
          </label>
        </div>
        <div className="td-line">
          <span>Hora</span>
          {HOURS.map((h) => (
            <Chip key={h} on={remind.mode === "at" && remind.time === h} onClick={() => setHour(h)}>
              {h}
            </Chip>
          ))}
          <label className="td-chip td-chip--field" data-on={(remind.mode === "at" && !HOURS.includes(remind.time)) || undefined}>
            <input
              type="time"
              value={remind.mode === "at" ? remind.time : ""}
              aria-label="Outro horário"
              onFocus={focusIsland}
              onChange={(e) => e.target.value && setHour(e.target.value)}
            />
          </label>
        </div>
        <p className="td-summary" data-warn={past || undefined}>
          {remind.mode === "none"
            ? "Sem lembrete: a tarefa só fica na lista."
            : past
              ? "Esse horário já passou. Escolha outro."
              : `A ilha vai te lembrar ${dayLabel(at!).toLowerCase()} às ${hhmm(new Date(at!))}.`}
        </p>
      </section>

      <footer className="td-foot">
        {task && (
          <button
            className="td-danger"
            onClick={() => {
              todo.remove(task.id);
              onDone();
            }}
          >
            Excluir
          </button>
        )}
        <button className="td-ghost" onClick={onDone}>
          Cancelar
        </button>
        <button className="td-primary" onClick={save} disabled={!text.trim() || past}>
          {task ? "Salvar" : "Adicionar"}
        </button>
      </footer>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="td-chip" role="radio" aria-checked={on} onClick={onClick}>
      {children}
    </button>
  );
}

function History({ tasks, onBack }: { tasks: Task[]; onBack: () => void }) {
  const groups = historyGroups(tasks);
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  return (
    <div className="td">
      <header className="settings-head">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          <IconChevronLeft />
        </button>
        <h1>Histórico</h1>
        <span className="settings-version">{total ? `${total} concluída${total > 1 ? "s" : ""}` : ""}</span>
      </header>

      {total === 0 ? (
        <p className="td-empty">As tarefas que você concluir aparecem aqui, separadas por dia.</p>
      ) : (
        <div className="td-history">
          {groups.map((g) => (
            <section key={g.label}>
              <h2>{g.label}</h2>
              <ul>
                {g.tasks.map((t) => (
                  <li key={t.id} className="tdh-row">
                    <button className="tdc-check" role="checkbox" aria-checked onClick={() => todo.toggle(t.id)} title="Voltar para pendentes">
                      <IconCheck />
                    </button>
                    <span className="tdh-text">{t.text}</span>
                    <span className="tdh-time">{t.doneAt ? hhmm(new Date(t.doneAt)) : dayLabel(t.createdAt)}</span>
                    <button className="tdh-remove" onClick={() => todo.remove(t.id)} aria-label="Apagar" title="Apagar">
                      <IconClose />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {total > 0 && (
        <footer className="td-foot">
          <button className="td-ghost" onClick={todo.clearHistory}>
            Limpar histórico
          </button>
        </footer>
      )}
    </div>
  );
}

/* ═════════ Calendário: mês à esquerda, tarefas do dia à direita ═════════ */

const WEEK = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Dia selecionado e mês visível ficam guardados entre aberturas do painel. */
let calState = { day: startOfDay(), month: startOfDay() };

function Calendar({ tasks, onBack }: { tasks: Task[]; onBack: () => void }) {
  const [day, setDayState] = useState(calState.day);
  const [month, setMonthState] = useState(() => {
    const d = new Date(calState.month);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const setDay = (d: number) => {
    calState = { ...calState, day: d };
    setDayState(d);
  };
  const setMonth = (m: number) => {
    calState = { ...calState, month: m };
    setMonthState(m);
  };

  const byDay = tasksByDay(tasks);
  const today = startOfDay();
  const first = new Date(month);
  const y = first.getFullYear();
  const m = first.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(y, m, i + 1).getTime())];
  const monthName = first.toLocaleDateString("pt-BR", { month: "long" });
  const title = `${monthName[0].toUpperCase()}${monthName.slice(1)} de ${y}`;
  const dayTasks = byDay.get(day) ?? [];

  return (
    <div className="td td--cal">
      <header className="settings-head">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          <IconChevronLeft />
        </button>
        <h1>Calendário</h1>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => setMonth(new Date(y, m - 1, 1).getTime())} aria-label="Mês anterior">
            <IconChevronLeft />
          </button>
          <span>{title}</span>
          <button className="icon-btn" onClick={() => setMonth(new Date(y, m + 1, 1).getTime())} aria-label="Próximo mês">
            <IconChevronRight />
          </button>
        </div>
      </header>

      <div className="cal">
        <div className="cal-grid" role="grid" aria-label={title}>
          {WEEK.map((w, i) => (
            <span key={i} className="cal-wd">
              {w}
            </span>
          ))}
          {cells.map((c, i) => {
            if (c == null) return <span key={`e${i}`} />;
            const list = byDay.get(c);
            const pending = list?.some((t) => !t.done);
            return (
              <button
                key={c}
                className="cal-day"
                data-today={c === today || undefined}
                data-selected={c === day || undefined}
                data-past={c < today || undefined}
                onClick={() => setDay(c)}
                aria-label={dayLabel(c)}
              >
                {new Date(c).getDate()}
                {list && <i className="cal-dot" data-done={!pending || undefined} />}
              </button>
            );
          })}
        </div>

        <div className="cal-side">
          <h2>{dayLabel(day)}</h2>
          {dayTasks.length === 0 ? (
            <p className="cal-none">Nada marcado</p>
          ) : (
            <ul className="cal-list">
              {dayTasks.map((t) => (
                <li key={t.id} className="tdc tdc--sm" data-done={t.done || undefined}>
                  <button className="tdc-check" role="checkbox" aria-checked={t.done} aria-label={t.done ? "Desmarcar" : "Concluir"} onClick={() => todo.toggle(t.id)}>
                    <IconCheck />
                  </button>
                  <button className="tdc-text" onClick={() => todo.open({ kind: "edit", id: t.id })} title={t.text}>
                    {t.text}
                  </button>
                  {t.remindAt != null && <span className="tdc-when">{hhmm(new Date(t.remindAt))}</span>}
                </li>
              ))}
            </ul>
          )}
          {day >= today && (
            <button className="tdp-btn cal-add" onClick={() => todo.open({ kind: "new", day })}>
              <IconPlus /> Nova neste dia
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
