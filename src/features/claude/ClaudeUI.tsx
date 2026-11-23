import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useCommitCount } from "../../perf/hooks";
import { IconArrowUp, IconChevronLeft, IconClose, IconFolder, IconPlus, IconSpark, IconStop } from "../../island/icons";
import { Markdown } from "./Markdown";
import { claude, focusIsland, folderName, toolLabel, turnText, useClaude, useClaudeBusy, type Turn } from "./store";

/** Quem estiver com o painel aberto registra aqui como pôr o cursor na caixa de texto. */
let focusPanelComposer: (() => void) | null = null;

/* ───────── Página do expandido ───────── */

/**
 * Página "Claude" do expandido: pasta, prévia da última resposta e a caixa
 * de pergunta. Enviar abre o painel grande com a conversa.
 */
export function ClaudePage({ onOpen }: { onOpen: () => void }) {
  useCommitCount("ClaudePage");
  const s = useClaude();
  const last = s.turns[s.turns.length - 1];
  const preview = last ? previewOf(last) : "";

  const openAndFocus = () => {
    onOpen();
    // O painel só deixa de ser inerte depois do próximo render.
    window.setTimeout(() => focusPanelComposer?.(), 60);
  };

  return (
    <div className="cp">
      <div className="cp-top">
        <FolderChip folder={s.folder} />
        {s.turns.length > 0 && (
          <button className="cp-link" onClick={onOpen}>
            Ver conversa
          </button>
        )}
      </div>
      <button className="cp-preview" onClick={onOpen} disabled={!last} data-busy={s.busy || undefined}>
        {s.busy && <IconSpark className="claude-spin" />}
        <span>{preview || (s.folder ? `Pergunte sobre o código de ${folderName(s.folder)}` : "Pergunte qualquer coisa ao Claude")}</span>
      </button>
      <Composer variant="line" onSent={openAndFocus} />
    </div>
  );
}

function previewOf(t: Turn) {
  if (t.role === "user") return "";
  if (t.status === "streaming") {
    const text = turnText(t);
    if (text) return text.split("\n").pop() || text;
    const tool = [...t.parts].reverse().find((p) => p.kind === "tool");
    return tool && tool.kind === "tool" ? toolLabel(tool) + "…" : "Pensando…";
  }
  if (t.status === "cancelled") return "Resposta interrompida";
  return turnText(t).replace(/[`*#>]/g, "").replace(/\s+/g, " ").trim();
}

/* ───────── Painel da conversa ───────── */

export function ClaudeView({ onBack }: { onBack: () => void }) {
  useCommitCount("ClaudeView");
  const s = useClaude();
  const listRef = useRef<HTMLDivElement>(null);
  /** Rola junto com a resposta só se o usuário já estava no fim da lista. */
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [s.turns]);

  return (
    <div className="cv">
      <header className="settings-head">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          <IconChevronLeft />
        </button>
        <h1>Claude</h1>
        <FolderChip folder={s.folder} />
        <button className="icon-btn cv-new" onClick={claude.newChat} disabled={s.turns.length === 0} aria-label="Nova conversa" title="Nova conversa">
          <IconPlus />
        </button>
      </header>

      <div
        ref={listRef}
        className="cv-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {s.turns.length === 0 ? <EmptyChat folder={s.folder} recent={s.recentFolders} /> : s.turns.map((t) => <TurnView key={t.id} turn={t} />)}
      </div>

      <Composer variant="box" registerFocus />
    </div>
  );
}

function EmptyChat({ folder, recent }: { folder: string | null; recent: string[] }) {
  const others = recent.filter((f) => f !== folder).slice(0, 3);
  return (
    <div className="cv-empty">
      <IconSpark className="cv-empty-mark" />
      <p>{folder ? `O Claude pode ler o código de ${folderName(folder)} para responder (só leitura).` : "Pergunta livre. Escolha uma pasta para perguntar sobre um projeto."}</p>
      {others.length > 0 && (
        <div className="cv-recent">
          {others.map((f) => (
            <button key={f} onClick={() => claude.setFolder(f)} title={f}>
              <IconFolder /> {folderName(f)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TurnView = memo(function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return <div className="cv-user">{turnText(turn)}</div>;
  }
  const empty = turn.parts.length === 0;
  return (
    <div className="cv-reply" data-status={turn.status}>
      {turn.parts.map((p, i) =>
        p.kind === "text" ? (
          <Markdown key={i} text={p.text} />
        ) : (
          <div key={i} className="cv-tool">
            <i aria-hidden /> {toolLabel(p)}
          </div>
        ),
      )}
      {turn.status === "streaming" && (
        <span className="cv-typing" aria-label="Claude está respondendo">
          <i />
          <i />
          <i />
        </span>
      )}
      {turn.status === "cancelled" && <span className="cv-note">{empty ? "Pergunta cancelada" : "Interrompido"}</span>}
    </div>
  );
});

/* ───────── Peças compartilhadas ───────── */

function FolderChip({ folder }: { folder: string | null }) {
  return (
    <span className="folder-chip" data-set={folder ? true : undefined}>
      <button onClick={() => void claude.pickFolder()} title={folder ?? "Escolher uma pasta de código"}>
        <IconFolder />
        <span>{folder ? folderName(folder) : "Sem pasta"}</span>
      </button>
      {folder && (
        <button className="folder-chip-x" onClick={() => claude.setFolder(null)} aria-label="Tirar a pasta" title="Tirar a pasta">
          <IconClose />
        </button>
      )}
    </span>
  );
}

function Composer({ variant, onSent, registerFocus }: { variant: "line" | "box"; onSent?: () => void; registerFocus?: boolean }) {
  const busy = useClaudeBusy();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!registerFocus) return;
    const fn = () => {
      focusIsland();
      // Sem rolar: a ilha ainda está crescendo e o navegador rolaria o conteúdo dela para mostrar a caixa.
      ref.current?.focus({ preventScroll: true });
    };
    focusPanelComposer = fn;
    return () => {
      if (focusPanelComposer === fn) focusPanelComposer = null;
    };
  }, [registerFocus]);

  // Caixa grande: cresce com o texto até o max-height do CSS (mede só quando o texto muda).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || variant !== "box") return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, variant]);

  const send = () => {
    if (!text.trim() || busy) return;
    claude.ask(text);
    setText("");
    onSent?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={`composer composer--${variant}`}>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={busy ? "Aguardando a resposta…" : "Pergunte ao Claude"}
        spellCheck={false}
        onPointerDown={focusIsland}
        onFocus={focusIsland}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {busy ? (
        <button className="composer-btn composer-btn--stop" onClick={claude.cancel} aria-label="Parar" title="Parar">
          <IconStop />
        </button>
      ) : (
        <button className="composer-btn" onClick={send} disabled={!text.trim()} aria-label="Enviar" title="Enviar (Enter)">
          <IconArrowUp />
        </button>
      )}
    </div>
  );
}

/** Marca do compacto enquanto o Claude responde. */
export function ClaudeBusyMark() {
  return <IconSpark className="claude-spin claude-spin--compact" aria-label="Claude respondendo" />;
}
