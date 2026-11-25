import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useCommitCount } from "../../perf/hooks";
import { IconArrowUp, IconCheck, IconChevronLeft, IconChevronRight, IconClose, IconFolder, IconHistory, IconPlus, IconSearch, IconSpark, IconStop, IconTrash } from "../../island/icons";
import { Markdown } from "./Markdown";
import { claude, focusIsland, folderName, providerName, toolLabel, turnText, useClaude, useClaudeBusy, type ClaudeState, type Conversation, type LimitWindow, type Turn } from "./store";
import { ProviderLogo } from "./ProviderLogo";
import { needLabel, PROVIDERS, providers, useProviders, type ProviderDef, type ProviderId } from "./providers";

/** Quem estiver com o painel aberto registra aqui como pôr o cursor na caixa de texto. */
let focusPanelComposer: (() => void) | null = null;

/* ───────── Página do expandido ───────── */

/**
 * Página "IA" do expandido: pasta, prévia da última resposta e a caixa
 * de pergunta. Enviar abre o painel grande com a conversa. Sem IA conectada,
 * mostra só o convite para conectar.
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

  if (!s.provider) {
    return (
      <div className="cp cp--connect">
        <IconSpark className="cv-empty-mark" />
        <p>Converse com a IA que você já assina: ChatGPT, Claude e outras.</p>
        <button className="btn btn--primary btn--sm" onClick={onOpen}>
          Conectar minha IA
        </button>
      </div>
    );
  }

  return (
    <div className="cp">
      <div className="cp-top">
        <ProviderSwitch
          id={s.provider}
          small
          onClick={() => {
            claude.openChooser();
            onOpen();
          }}
        />
        <FolderChip folder={s.folder} />
        {s.turns.length > 0 ? (
          <button className="cp-link" onClick={onOpen}>
            Ver conversa
          </button>
        ) : (
          s.history.length > 0 && (
            <button
              className="cp-link"
              onClick={() => {
                claude.toggleHistory(true);
                onOpen();
              }}
            >
              Histórico
            </button>
          )
        )}
      </div>
      <button className="cp-preview" onClick={onOpen} disabled={!last} data-busy={s.busy || undefined}>
        {s.busy && <IconSpark className="claude-spin" />}
        <span>{preview || (s.folder ? `Pergunte sobre o código de ${folderName(s.folder)}` : `Pergunte qualquer coisa ao ${providerName(s.provider)}`)}</span>
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
  /** Lista de IAs aberta por cima da conversa (sempre, enquanto nenhuma estiver conectada). */
  const connect = !s.provider || s.choosing;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [s.turns]);

  return (
    <div className="cv">
      <header className="settings-head">
        <button
          className="icon-btn"
          onClick={() => {
            claude.openChooser(false);
            claude.toggleHistory(false);
            onBack();
          }}
          aria-label="Voltar"
        >
          <IconChevronLeft />
        </button>
        {connect ? (
          <h1>Conectar minha IA</h1>
        ) : s.showHistory ? (
          <>
            <h1>Histórico</h1>
            <button className="icon-btn cv-close" onClick={() => claude.toggleHistory(false)} aria-label="Voltar para a conversa" title="Voltar para a conversa">
              <IconClose />
            </button>
          </>
        ) : (
          <>
            <ProviderSwitch id={s.provider} onClick={() => claude.openChooser()} />
            <FolderChip folder={s.folder} />
            <button className="icon-btn" onClick={() => claude.toggleHistory(true)} aria-label="Histórico" title="Histórico de conversas">
              <IconHistory />
            </button>
            <button className="icon-btn cv-new" onClick={claude.newChat} disabled={s.turns.length === 0} aria-label="Nova conversa" title="Nova conversa">
              <IconPlus />
            </button>
          </>
        )}
        {connect && s.provider && (
          <button className="icon-btn cv-close" onClick={() => claude.openChooser(false)} aria-label="Voltar para a conversa" title="Voltar para a conversa">
            <IconClose />
          </button>
        )}
      </header>

      {connect ? (
        <ConnectList
          current={s.provider}
          onPick={(id) => {
            if (id === s.provider) claude.openChooser(false);
            else claude.setProvider(id);
          }}
        />
      ) : s.showHistory ? (
        <HistoryList items={s.history} current={s.chatId} />
      ) : (
        <>
      <UsageStrip provider={s.provider} context={s.context} limits={s.provider ? s.limits[s.provider] : undefined} />

      <div
        ref={listRef}
        className="cv-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {s.turns.length === 0 ? <EmptyChat folder={s.folder} recent={s.recentFolders} name={providerName(s.provider)} /> : s.turns.map((t) => <TurnView key={t.id} turn={t} />)}
      </div>

      <Composer variant="box" registerFocus />
        </>
      )}
    </div>
  );
}

function EmptyChat({ folder, recent, name }: { folder: string | null; recent: string[]; name: string }) {
  const others = recent.filter((f) => f !== folder).slice(0, 3);
  return (
    <div className="cv-empty">
      <IconSpark className="cv-empty-mark" />
      <p>{folder ? `${name} pode ler o código de ${folderName(folder)} para responder (só leitura).` : "Pergunta livre. Escolha uma pasta para perguntar sobre um projeto."}</p>
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
        <span className="cv-typing" aria-label="A IA está respondendo">
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

/* ───────── Contexto usado ───────── */

const thousands = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} mi` : `${Math.round(n / 1000)} mil`);

const LIMIT_LABEL: Record<string, string> = {
  five_hour: "5 horas",
  daily: "Dia",
  seven_day: "Semana",
  seven_day_opus: "Semana (Opus)",
  seven_day_sonnet: "Semana (Sonnet)",
};

/** O que cada IA informa de limite (para dizer quando não há o que mostrar). */
const NO_LIMITS: Partial<Record<string, string>> = {
  gemini: "O Gemini não informa o limite diário",
  cursor: "O Cursor não informa os limites",
};

const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" });

function resetLabel(at: number | null) {
  if (!at) return "";
  const d = new Date(at * 1000);
  const soon = d.getTime() - Date.now() < 20 * 3600_000;
  return `zera ${soon ? "às " + timeFmt.format(d) : dayFmt.format(d).replace(".", "")}`;
}

const level = (pct: number) => (pct >= 85 ? "high" : pct >= 60 ? "mid" : undefined);

function Meter({ label, pct, text, title }: { label: string; pct: number | null; text: string; title?: string }) {
  return (
    <span className="cv-meter" data-level={pct === null ? undefined : level(pct)} title={title}>
      <em>{label}</em>
      {pct !== null && (
        <i aria-hidden>
          <b style={{ transform: `scaleX(${Math.min(100, pct) / 100})` }} />
        </i>
      )}
      {text}
    </span>
  );
}

/** Faixa abaixo do cabeçalho: contexto da conversa e limites do plano. */
function UsageStrip({ provider, context, limits }: { provider: ProviderId | null; context: ClaudeState["context"]; limits?: LimitWindow[] }) {
  const now = Date.now() / 1000;
  return (
    <div className="cv-usage">
      {context?.window ? (
        <Meter
          label="Contexto"
          pct={Math.round((context.tokens / context.window) * 100)}
          text={`${Math.min(100, Math.round((context.tokens / context.window) * 100))}%`}
          title={`Contexto usado: ${thousands(context.tokens)} de ${thousands(context.window)} tokens`}
        />
      ) : (
        <Meter label="Contexto" pct={null} text={context ? `${thousands(context.tokens)} tokens` : "—"} title="Aparece depois da primeira resposta" />
      )}
      {limits && limits.length > 0
        ? limits.map((w) => {
            // Janela que já zerou desde a última leitura: começa do zero.
            const expired = w.resetsAt !== null && w.resetsAt < now;
            const pct = expired ? 0 : Math.round(w.used * 100);
            return <Meter key={w.kind} label={LIMIT_LABEL[w.kind] ?? w.kind} pct={pct} text={`${pct}%`} title={expired ? "Já zerou" : resetLabel(w.resetsAt)} />;
          })
        : provider && <span className="cv-meter cv-meter--note">{NO_LIMITS[provider] ?? "Limites aparecem depois da primeira resposta"}</span>}
    </div>
  );
}

/* ───────── Histórico ───────── */

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const histTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const histDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

function groupOf(ts: number) {
  const today = dayStart(new Date());
  if (ts >= today) return "Hoje";
  if (ts >= today - 86_400_000) return "Ontem";
  if (ts >= today - 6 * 86_400_000) return "Últimos 7 dias";
  return "Mais antigas";
}

function HistoryList({ items, current }: { items: Conversation[]; current: string | null }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const found = q
    ? items.filter((c) => c.title.toLowerCase().includes(q) || c.turns.some((t) => turnText(t).toLowerCase().includes(q)))
    : items;

  const groups: { label: string; items: Conversation[] }[] = [];
  for (const c of found) {
    const label = groupOf(c.updatedAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(c);
    else groups.push({ label, items: [c] });
  }

  return (
    <div className="hist">
      {items.length > 0 && (
        <label className="hist-search">
          <IconSearch />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nas conversas" spellCheck={false} onFocus={focusIsland} onPointerDown={focusIsland} />
        </label>
      )}
      <div className="hist-list">
        {items.length === 0 ? (
          <div className="cv-empty">
            <IconHistory className="cv-empty-mark" />
            <p>As conversas aparecem aqui depois da primeira resposta. Dá para reabrir e continuar de onde parou.</p>
          </div>
        ) : found.length === 0 ? (
          <p className="hist-none">Nada encontrado para “{query.trim()}”.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label}>
              <h2>{g.label}</h2>
              {g.items.map((c) => (
                <div key={c.id} className="hist-row" data-current={c.id === current || undefined}>
                  <button className="hist-open" onClick={() => claude.openConversation(c.id)} title="Abrir e continuar esta conversa">
                    <ProviderLogo id={c.provider} className="hist-logo" />
                    <span className="hist-text">
                      <strong>{c.title}</strong>
                      <span>
                        {providerName(c.provider)}
                        {c.folder ? ` · ${folderName(c.folder)}` : ""} · {c.updatedAt >= dayStart(new Date()) ? histTime.format(c.updatedAt) : histDate.format(c.updatedAt).replace(".", "")}
                      </span>
                    </span>
                  </button>
                  <button className="icon-btn hist-del" onClick={() => claude.deleteConversation(c.id)} aria-label="Apagar conversa" title="Apagar conversa">
                    <IconTrash />
                  </button>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** Logo + nome da IA conectada; clicar abre a lista para trocar. */
function ProviderSwitch({ id, onClick, small }: { id: ProviderId | null; onClick: () => void; small?: boolean }) {
  if (!id) return null;
  return (
    <button className="ai-switch" data-small={small || undefined} onClick={onClick} title="Trocar de IA">
      <ProviderLogo id={id} />
      <span>{providerName(id)}</span>
      <IconChevronRight className="ai-switch-chev" />
    </button>
  );
}

/* ───────── Conectar minha IA ───────── */

function ConnectList({ current, onPick }: { current: ProviderId | null; onPick: (id: ProviderId) => void }) {
  const p = useProviders();
  /** IA com o aviso de instalação aberto. */
  const [confirm, setConfirm] = useState<ProviderId | null>(null);

  useEffect(() => {
    void providers.refresh();
    return () => {
      providers.stopWaiting();
      providers.clearInstall();
    };
  }, []);

  return (
    <div className="ai-list">
      <p className="ai-intro">Use a IA que você já assina. O login é feito na página oficial de cada uma; a ilha nunca vê a sua senha.</p>
      {PROVIDERS.map((def) => (
        <ProviderRow key={def.id} def={def} current={current === def.id} confirming={confirm === def.id} setConfirm={setConfirm} onPick={onPick} />
      ))}
      {p.loginError && <p className="ai-error">{p.loginError}</p>}
    </div>
  );
}

function ProviderRow({
  def,
  current,
  confirming,
  setConfirm,
  onPick,
}: {
  def: ProviderDef;
  current: boolean;
  confirming: boolean;
  setConfirm: (id: ProviderId | null) => void;
  onPick: (id: ProviderId) => void;
}) {
  const p = useProviders();
  const st = p.status[def.id];
  const install = p.install?.provider === def.id ? p.install : null;
  const busyInstall = !!p.install && !p.install.finished;
  const waiting = p.waitingLogin === def.id;

  let action: ReactNode;
  if (!def.ready) {
    action = <span className="ai-tag">Em breve</span>;
  } else if (current) {
    action = (
      <span className="ai-tag ai-tag--on">
        <IconCheck /> Em uso
      </span>
    );
  } else if (!st) {
    action = <span className="ai-tag">{p.loading ? "Verificando…" : "Indisponível"}</span>;
  } else if (!st.installed) {
    action = (
      <button className="btn btn--secondary btn--sm" onClick={() => setConfirm(confirming ? null : def.id)} disabled={busyInstall}>
        Instalar
      </button>
    );
  } else if (waiting) {
    action = (
      <button className="btn btn--ghost btn--sm" onClick={() => void providers.refresh()} title="Conferir de novo">
        Aguardando login…
      </button>
    );
  } else if (st.loggedIn) {
    action = (
      <button className="btn btn--primary btn--sm" onClick={() => onPick(def.id)}>
        Usar
      </button>
    );
  } else {
    action = (
      <button className="btn btn--primary btn--sm" onClick={() => void providers.login(def.id, onPick)}>
        Entrar
      </button>
    );
  }

  const sub = st?.installed && st.loggedIn && st.plan ? `${def.account} · plano ${st.plan}` : def.account;
  // A IA em uso também pode ser escolhida de novo (volta para a conversa).
  if (current) {
    action = (
      <button className="ai-tag ai-tag--on" onClick={() => onPick(def.id)}>
        <IconCheck /> Em uso
      </button>
    );
  }

  return (
    <div className="ai-row" data-ready={def.ready || undefined}>
      <div className="ai-row-main">
        <span className="ai-mark" aria-hidden>
          <ProviderLogo id={def.id} />
        </span>
        <div className="ai-row-text">
          <strong>{def.name}</strong>
          <span>{sub}</span>
        </div>
        {action}
      </div>

      {confirming && !install && st && !st.installed && (
        <div className="ai-box">
          <p>Para usar o {def.name}, vamos instalar:</p>
          <ul>
            {st.needs.map((n) => (
              <li key={n}>{needLabel(n)}</li>
            ))}
            <li>{def.installs}</li>
          </ul>
          {st.needs.length > 0 && <p className="ai-note">O Windows pode pedir permissão uma vez: é só clicar em Sim.</p>}
          <div className="ai-box-actions">
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(null)}>
              Cancelar
            </button>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => {
                setConfirm(null);
                providers.install(def.id);
              }}
            >
              Instalar tudo
            </button>
          </div>
        </div>
      )}

      {install && (
        <div className="ai-box">
          <ul className="ai-steps">
            {install.steps.map((step) => (
              <li key={step.step} data-status={step.status}>
                <i aria-hidden>{step.status === "done" ? <IconCheck /> : step.status === "running" ? <IconSpark className="claude-spin" /> : null}</i>
                {step.label}
              </li>
            ))}
          </ul>
          {install.error && <p className="ai-error">{install.error}</p>}
          {install.finished && !install.error && <p className="ai-note">Pronto! Agora é só entrar com a sua conta.</p>}
          {install.finished && install.error && (
            <div className="ai-box-actions">
              <button className="btn btn--secondary btn--sm" onClick={() => providers.install(def.id)}>
                Tentar de novo
              </button>
            </div>
          )}
        </div>
      )}

      {waiting && <p className="ai-note ai-note--row">{def.loginHint}</p>}
    </div>
  );
}

function Composer({ variant, onSent, registerFocus }: { variant: "line" | "box"; onSent?: () => void; registerFocus?: boolean }) {
  const busy = useClaudeBusy();
  const name = providerName(useClaude().provider);
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
        placeholder={busy ? "Aguardando a resposta…" : `Pergunte ao ${name}`}
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

/** Marca do compacto enquanto a IA responde. */
export function ClaudeBusyMark() {
  return <IconSpark className="claude-spin claude-spin--compact" aria-label="IA respondendo" />;
}
