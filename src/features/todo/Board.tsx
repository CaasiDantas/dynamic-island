import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { IconBell, IconCheck, IconChevronLeft, IconClose, IconFolder, IconPlus, IconTrash } from "../../island/icons";
import { toast } from "../../island/toast";
import { focusIsland } from "../claude/store";
import { FOLDER_MAX_COLUMNS, columnTasks, hhmm, reminderLabel, startOfDay, todo, useFolders, useTasks, type Folder, type Task } from "./store";

/* ═════════ Pastas: lista + criar ═════════ */

export function Folders({ onBack }: { onBack: () => void }) {
  const folders = useFolders();
  const tasks = useTasks();
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const create = () => {
    const f = todo.addFolder(name);
    if (!f) return;
    setName("");
    todo.open({ kind: "board", id: f.id });
  };

  return (
    <div className="td">
      <header className="settings-head">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          <IconChevronLeft />
        </button>
        <h1>Pastas</h1>
        <span className="settings-version">{folders.length ? `${folders.length} pasta${folders.length > 1 ? "s" : ""}` : ""}</span>
      </header>

      <div className="composer composer--line td-input">
        <input
          ref={inputRef}
          value={name}
          placeholder="Nova pasta, ex.: Cadastrar empresas"
          spellCheck={false}
          maxLength={40}
          onPointerDown={focusIsland}
          onFocus={focusIsland}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              create();
            }
          }}
        />
        <button className="td-primary td-primary--sm" onClick={create} disabled={!name.trim()}>
          Criar
        </button>
      </div>

      {folders.length === 0 ? (
        <p className="td-empty">
          Cada pasta vira um quadro com colunas (A fazer, Fazendo, Feito). Arraste as tarefas entre elas conforme o trabalho anda.
        </p>
      ) : (
        <ul className="fd-list">
          {folders.map((f) => {
            const mine = tasks.filter((t) => t.folderId === f.id);
            const done = mine.filter((t) => t.done).length;
            return (
              <li key={f.id}>
                <button className="fd-row" onClick={() => todo.open({ kind: "board", id: f.id })}>
                  <span className="fd-icon">
                    <IconFolder />
                  </span>
                  <span className="fd-text">
                    <strong>{f.name}</strong>
                    <em>{mine.length ? `${done} de ${mine.length} concluídas` : "Vazia"}</em>
                  </span>
                  <span className="fd-bar" aria-hidden>
                    <i style={{ transform: `scaleX(${mine.length ? done / mine.length : 0})` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ═════════ Quadro da pasta ═════════ */

type Over = { col: string; index: number };
type Drag = { id: string; startX: number; startY: number; offX: number; offY: number; w: number; active: boolean };

/** Distância mínima (px) para um clique virar arraste. */
const DRAG_SLOP = 5;

export function Board({ id, onBack }: { id: string; onBack: () => void }) {
  const folders = useFolders();
  const tasks = useTasks();
  const folder = folders.find((f) => f.id === id);
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const overRef = useRef<Over | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });

  // O fantasma nasce no próximo render: posiciona já no cursor, sem piscar no canto.
  useLayoutEffect(() => {
    if (dragId) placeGhost(lastPointer.current.x, lastPointer.current.y);
  });

  useEffect(() => {
    // Pasta apagada (ou desfeita em outro lugar): volta para a lista.
    if (!folder) onBack();
  }, [folder, onBack]);
  if (!folder) return null;

  const placeGhost = (x: number, y: number) => {
    const g = ghostRef.current;
    const b = boardRef.current;
    const d = drag.current;
    if (!g || !b || !d) return;
    const r = b.getBoundingClientRect();
    g.style.transform = `translate(${x - r.left - d.offX}px, ${y - r.top - d.offY}px) rotate(-1.5deg)`;
  };

  /** Coluna e posição sob o cursor (o cartão arrastado não conta). */
  const targetAt = (x: number, y: number): Over | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-col]");
    if (!el) return null;
    const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-card]")).filter((c) => c.dataset.card !== drag.current?.id);
    const index = cards.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2 < y;
    }).length;
    return { col: el.dataset.col!, index };
  };

  // A captura fica no quadro: o cartão arrastado sai da coluna sem perder o ponteiro.
  const onCardDown = (e: RPointerEvent<HTMLElement>, t: Task) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button.tdc-check")) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { id: t.id, startX: e.clientX, startY: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, w: r.width, active: false };
    lastPointer.current = { x: e.clientX, y: e.clientY };
    boardRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_SLOP) return;
      d.active = true;
      setDragId(d.id);
    }
    placeGhost(e.clientX, e.clientY);
    const t = targetAt(e.clientX, e.clientY);
    const prev = overRef.current;
    if (t?.col !== prev?.col || t?.index !== prev?.index) {
      overRef.current = t;
      setOver(t);
    }
  };

  const endDrag = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    const target = overRef.current;
    overRef.current = null;
    setOver(null);
    setDragId(null);
    if (!d) return;
    if (!d.active) {
      // Foi um clique: abre a tarefa para editar.
      if (commit) todo.open({ kind: "edit", id: d.id });
      return;
    }
    if (commit && target) todo.moveTo(d.id, target.col, target.index);
  };

  const dragged = dragId ? tasks.find((t) => t.id === dragId) : undefined;
  const total = tasks.filter((t) => t.folderId === folder.id);
  const done = total.filter((t) => t.done).length;

  return (
    <div className="td bd">
      <header className="settings-head">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar para as pastas">
          <IconChevronLeft />
        </button>
        <InlineName className="bd-title" value={folder.name} onSave={(n) => todo.renameFolder(folder.id, n)} label="Renomear pasta" />
        <span className="settings-version">{total.length ? `${done}/${total.length}` : ""}</span>
        <button
          className="icon-btn icon-btn--ghost icon-btn--danger bd-delete"
          aria-label="Apagar pasta"
          title="Apagar pasta"
          onClick={() => {
            const undo = todo.removeFolder(folder.id);
            toast(`Pasta "${folder.name}" apagada`, { label: "Desfazer", run: undo });
          }}
        >
          <IconTrash />
        </button>
      </header>

      <div
        ref={boardRef}
        className="bd-board"
        data-dragging={dragId ? "" : undefined}
        onPointerMove={onMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
      >
        {folder.columns.map((c, ci) => {
          const list = columnTasks(tasks, folder, c.id);
          const isLast = ci === folder.columns.length - 1 && folder.columns.length > 1;
          const visible = list.filter((t) => t.id !== dragId);
          return (
            <section key={c.id} className="bd-col" data-col={c.id} data-over={over?.col === c.id || undefined} data-final={isLast || undefined}>
              <header className="bd-col-head">
                <InlineName className="bd-col-name" value={c.name} onSave={(n) => todo.renameColumn(folder.id, c.id, n)} label="Renomear coluna" />
                <span className="bd-count">{list.length}</span>
                {folder.columns.length > 1 && (
                  <button
                    className="bd-col-x"
                    aria-label={`Remover coluna ${c.name}`}
                    title="Remover coluna (as tarefas vão para a primeira)"
                    onClick={() => todo.removeColumn(folder.id, c.id)}
                  >
                    <IconClose />
                  </button>
                )}
              </header>
              <ul className="bd-cards">
                {visible.map((t, i) => (
                  <BoardCardSlot key={t.id} showGap={over?.col === c.id && over.index === i}>
                    <BoardCard task={t} onPointerDown={(e) => onCardDown(e, t)} />
                  </BoardCardSlot>
                ))}
                {over?.col === c.id && over.index >= visible.length && <li className="bd-gap" aria-hidden />}
              </ul>
              <AddCard folder={folder} columnId={c.id} />
            </section>
          );
        })}
        {folder.columns.length < FOLDER_MAX_COLUMNS && (
          <button className="bd-addcol" onClick={() => todo.addColumn(folder.id)} title="Nova coluna (entra antes da última)">
            <IconPlus />
            <span>Coluna</span>
          </button>
        )}

        {dragged && (
          <div ref={ghostRef} className="bd-ghost" style={{ width: drag.current?.w }} aria-hidden>
            <BoardCard task={dragged} />
          </div>
        )}
      </div>
    </div>
  );
}

function BoardCardSlot({ showGap, children }: { showGap: boolean; children: React.ReactNode }) {
  return (
    <>
      {showGap && <li className="bd-gap" aria-hidden />}
      {children}
    </>
  );
}

function BoardCard({ task, onPointerDown }: { task: Task; onPointerDown?: (e: RPointerEvent<HTMLElement>) => void }) {
  const overdue = !task.done && task.remindAt != null && task.remindAt <= Date.now();
  return (
    <li className="bd-card" data-card={task.id} data-done={task.done || undefined} onPointerDown={onPointerDown}>
      <button className="tdc-check" role="checkbox" aria-checked={task.done} aria-label={task.done ? "Reabrir" : "Concluir"} onClick={() => todo.toggle(task.id)}>
        <IconCheck />
      </button>
      <span className="bd-card-text">{task.text}</span>
      {task.remindAt != null && !task.done && (
        <span className="tdc-when" data-overdue={overdue || undefined}>
          <IconBell />
          {startOfDay(task.remindAt) === startOfDay() ? hhmm(new Date(task.remindAt)) : reminderLabel(task.remindAt)}
        </span>
      )}
    </li>
  );
}

/** "+ Adicionar" no pé da coluna: vira um campo; Enter adiciona e continua aberto. */
function AddCard({ folder, columnId }: { folder: Folder; columnId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    focusIsland();
    ref.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) {
    return (
      <button className="bd-add" onClick={() => setOpen(true)}>
        <IconPlus /> Adicionar
      </button>
    );
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      todo.addToColumn(folder.id, columnId, text);
      setText("");
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      setText("");
    }
  };

  return (
    <input
      ref={ref}
      className="bd-add-input"
      value={text}
      placeholder="Tarefa e Enter"
      spellCheck={false}
      maxLength={200}
      onPointerDown={focusIsland}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => {
        if (text.trim()) todo.addToColumn(folder.id, columnId, text);
        setText("");
        setOpen(false);
      }}
    />
  );
}

/** Texto que vira campo ao clicar (nome da pasta/coluna). */
function InlineName({ value, onSave, className, label }: { value: string; onSave: (v: string) => void; className: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    focusIsland();
    ref.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <button
        className={`inline-name ${className}`}
        title={`${label} (clique)`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  }
  const finish = (save: boolean) => {
    if (save && draft.trim() && draft !== value) onSave(draft);
    setEditing(false);
  };
  return (
    <input
      ref={ref}
      className={`inline-name inline-name--edit ${className}`}
      value={draft}
      aria-label={label}
      spellCheck={false}
      maxLength={40}
      onPointerDown={focusIsland}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") {
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}
