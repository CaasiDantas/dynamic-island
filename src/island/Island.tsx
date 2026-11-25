import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { islandSize, radiusCss, toRem, type IslandBox, type IslandMode } from "../lib/layout";
import { onGlobalHotkey, onIslandHover, onTrayOpenSettings, isTauri, setHitRegion } from "../lib/native";
import type { Settings } from "../lib/settings";
import { CompactView } from "./CompactView";
import { RestView, useRestActivities } from "./RestView";
import { ExpandedView } from "./ExpandedView";
import { SettingsView } from "./SettingsView";
import { PomodoroView } from "../features/pomodoro/PomodoroUI";
import { usePomodoroActive, usePomodoroFinishSeq } from "../features/pomodoro/store";
import { perfActions, useCommitCount } from "../perf/hooks";
import { getPage, pageAt, setPage, stepPage, usePage, type PageId } from "./pages";
import { requestSettings, useSettingsNav, type SettingsSection } from "./settingsNav";
import { PaletteView, focusPalette, type PaletteCtx } from "../features/palette/Palette";
import { ToastHost } from "./toast";
import { todo } from "../features/todo/store";
import { useLyricsOn } from "../features/media/lyrics";
import { useLyricsSupported } from "../features/media/store";
import { ClaudeView } from "../features/claude/ClaudeUI";
import { TodoView, focusTodoInput } from "../features/todo/TodoUI";
import { useTodoOpenSeq, useTodoShowSeq, useTodoWide } from "../features/todo/store";
import { IslandGlow } from "./IslandGlow";
import { PillView } from "../features/pills/PillView";
import { holdPill, openPill, pillIsActionable, pillShown, usePillActive } from "../features/pills/store";
import { isPickingFolder, useClaudeDoneSeq } from "../features/claude/store";
import { perf } from "../perf/monitor";
import { setHwWatch } from "../features/monitor/store";

/**
 * Saída do mouse → espera curta antes de recolher. Evita fechar quando o cursor
 * só "raspa" a borda; se ele voltar nesse intervalo, o recolhimento é cancelado.
 * A entrada não tem espera: expande no mesmo evento.
 */
const HOVER_CLOSE_DELAY = 180;
/**
 * Repouso → fechada: espera curta para o cursor só passando pelo topo
 * (ex.: indo até uma aba) não fazer a ilha crescer por cima dela.
 */
const REST_HOVER_DELAY = 120;
/** Altura mínima da área de mouse no repouso: o fio tem só 5 px. */
const REST_HIT_MIN = 10;
/** Ajustes/Pomodoro abertos e o cursor foi embora: fecha depois de um tempo. */
const PANEL_IDLE_CLOSE = 6000;
/** Ilha expandida sozinha para avisar (ex.: fim do Pomodoro) e ninguém interagiu. */
const ALERT_IDLE_CLOSE = 8000;
/** Resposta do Claude chegou com a ilha fechada: tempo para ler antes de recolher. */
const CLAUDE_ALERT_CLOSE = 15000;
/** Igual à duração do recolhimento no CSS (--dur em data-direction="shrink"). */
const SHRINK_DURATION = 460;

const area = (b: IslandBox) => b.w * b.h;

interface Props {
  settings: Settings;
  /** Escala atual da interface (px por unidade); vem do App, evita ler estilo computado. */
  scale: number;
  onSettingsChange: (patch: Partial<Settings>) => void;
}

/*
 * O conteúdo de cada estado não depende do estado da cápsula, então é
 * memoizado: trocar de estado re-renderiza só a casca, não as vistas.
 */
const RestContent = memo(RestView);
const CompactContent = memo(CompactView);
const ExpandedContent = memo(ExpandedView);
const SettingsContent = memo(SettingsView);
const PomodoroContent = memo(PomodoroView);
const ClaudeContent = memo(ClaudeView);
const TodoContent = memo(TodoView);
const PaletteContent = memo(PaletteView);

/** Estados "fechados" (repouso ou fechada): o clique e os atalhos abrem a ilha a partir deles. */
const isClosed = (m: IslandMode) => m === "rest" || m === "compact";

const isPanel = (m: IslandMode) => m === "settings" || m === "pomodoro" || m === "claude" || m === "todo" || m === "palette";

/** Digitando na ilha (janela com foco e cursor numa caixa de texto): não recolher pelo hover. */
function isTyping(root: HTMLElement | null) {
  const el = document.activeElement;
  return document.hasFocus() && !!root && root.contains(el) && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement);
}

export function Island({ settings, scale, onSettingsChange }: Props) {
  const restOn = settings.restShape !== "off";
  const restShape = settings.restShape === "line" ? "line" : "drop";
  const [mode, setModeState] = useState<IslandMode>(restOn ? "rest" : "compact");
  const active = usePomodoroActive();
  const islandRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<IslandMode>(mode);
  const settingsRef = useRef(settings);
  const scaleRef = useRef(scale);
  const insideRef = useRef(false);
  /** Único timer de hover/auto-recolhimento: sempre limpo antes de agendar outro. */
  const hoverTimer = useRef<number | undefined>(undefined);
  settingsRef.current = settings;
  scaleRef.current = scale;

  useCommitCount("Island");

  // Tamanho atual e direção da mudança (crescer usa mola com sobra; recolher, mola firme).
  // Letra ligada na página de música: a ilha aberta alarga (676) para a coluna da letra.
  const page = usePage();
  const lyricsOn = useLyricsOn();
  const lyricsSupported = useLyricsSupported();
  const wide = page === "media" && lyricsOn && lyricsSupported;
  // Hardware só é amostrado com a aba aberta na tela.
  useEffect(() => setHwWatch(mode === "expanded" && page === "hardware"), [mode, page]);
  const restActivities = useRestActivities();
  const board = useTodoWide();
  const box = islandSize(mode, active, wide, restShape, restActivities.length, board);
  const prevBox = useRef(box);
  const direction = useRef<"grow" | "shrink">("grow");
  if (box !== prevBox.current) direction.current = area(box) >= area(prevBox.current) ? "grow" : "shrink";

  const setMode = useCallback((requested: IslandMode) => {
    // "Fechar" com o cursor longe volta ao repouso (gota/fio), quando ligado.
    const next = requested === "compact" && settingsRef.current.restShape !== "off" && !insideRef.current ? "rest" : requested;
    const prev = modeRef.current;
    if (prev === next) return;
    const start = settingsRef.current.startPage;
    if (next === "expanded" && (isClosed(prev) || prev === "pill") && start !== "last" && getPage() !== start) setPage(start);
    perf.modeRequested(prev, next);
    modeRef.current = next;
    setModeState(next);
  }, []);

  const clearHoverTimer = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);

  const handleHover = useCallback(
    (inside: boolean) => {
      perf.markEvent(inside ? "hover-entrada" : "hover-saída");
      insideRef.current = inside;
      // Voltou durante a espera (ou saiu de novo): cancela o que estava pendente.
      clearHoverTimer();
      const current = modeRef.current;
      // Notificação na tela: segura enquanto o cursor está em cima (o clique abre o app).
      if (current === "pill" && pillIsActionable()) {
        holdPill(inside);
        return;
      }
      const restOn = settingsRef.current.restShape !== "off";
      if (inside) {
        // Repouso: o mouse mostra a ilha fechada; abrir de vez é com clique.
        if (current === "rest") {
          hoverTimer.current = window.setTimeout(() => {
            if (insideRef.current && modeRef.current === "rest") setMode("compact");
          }, REST_HOVER_DELAY);
        } else if ((current === "compact" || current === "pill") && !restOn && settingsRef.current.expandOnHover) {
          setMode("expanded");
        }
        return;
      }
      // Escolhendo pasta ou digitando: fecha pelo blur/Esc, não pelo hover.
      if (isPickingFolder() || isTyping(islandRef.current)) return;
      if (current === "compact" && restOn) {
        hoverTimer.current = window.setTimeout(() => setMode("rest"), HOVER_CLOSE_DELAY);
      } else if (current === "expanded") {
        hoverTimer.current = window.setTimeout(() => setMode("compact"), HOVER_CLOSE_DELAY);
      } else if (isPanel(current)) {
        hoverTimer.current = window.setTimeout(() => setMode("compact"), PANEL_IDLE_CLOSE);
      }
    },
    [setMode, clearHoverTimer],
  );

  // Hover vem do Rust na janela desktop (fora da cápsula a janela não recebe mouse).
  useEffect(() => onIslandHover(handleHover), [handleHover]);

  // Fim de uma fase do Pomodoro: expande para avisar; recolhe sozinha se ninguém interagir.
  const finishSeq = usePomodoroFinishSeq();
  const lastFinish = useRef(finishSeq);
  useEffect(() => {
    if (finishSeq === lastFinish.current) return;
    lastFinish.current = finishSeq;
    setPage("pomodoro");
    if (isClosed(modeRef.current)) setMode("expanded");
    if (!insideRef.current && modeRef.current === "expanded") {
      clearHoverTimer();
      hoverTimer.current = window.setTimeout(() => {
        if (!insideRef.current && modeRef.current === "expanded") setMode("compact");
      }, ALERT_IDLE_CLOSE);
    }
  }, [finishSeq, setMode, clearHoverTimer]);

  // Resposta do Claude concluída com a ilha fechada: abre a conversa para avisar.
  const claudeDone = useClaudeDoneSeq();
  const lastClaudeDone = useRef(claudeDone);
  useEffect(() => {
    if (claudeDone === lastClaudeDone.current) return;
    lastClaudeDone.current = claudeDone;
    const m = modeRef.current;
    if (!isClosed(m) && m !== "expanded" && m !== "pill") return;
    setMode("claude");
    if (!insideRef.current) {
      clearHoverTimer();
      hoverTimer.current = window.setTimeout(() => {
        if (!insideRef.current && modeRef.current === "claude" && !isTyping(islandRef.current)) setMode("compact");
      }, CLAUDE_ALERT_CLOSE);
    }
  }, [claudeDone, setMode, clearHoverTimer]);

  // Pílula de aviso: só aparece com a ilha fechada; some sozinha quando o aviso acaba.
  const pillActive = usePillActive();
  // Também reavalia a cada troca de modo: um aviso que chegou com a ilha aberta aparece quando ela fecha.
  useEffect(() => {
    if (pillActive && isClosed(mode)) setMode("pill");
    else if (!pillActive && mode === "pill") setMode("compact");
    else if (mode === "pill") pillShown();
  }, [pillActive, mode, setMode]);

  // Ligou/desligou o repouso nos ajustes: troca na hora entre gota/fio e fechada.
  useEffect(() => {
    if (isClosed(modeRef.current)) setMode(restOn && !insideRef.current ? "rest" : "compact");
  }, [restOn, setMode]);

  // Área de clique enviada ao Rust uma vez por mudança de tamanho (nunca por quadro):
  // ao crescer, já usa o tamanho final; ao encolher, espera a animação terminar.
  const sendHitRegion = useCallback((b: IslandBox) => {
    const el = frameRef.current;
    if (!el) return;
    const w = b.w * scaleRef.current;
    const h = Math.max(b.h * scaleRef.current, modeRef.current === "rest" ? REST_HIT_MIN : 0);
    setHitRegion({ x: (window.innerWidth - w) / 2, y: el.offsetTop, w, h });
  }, []);

  // Rolagem presa de antes (ou que escapou do onScroll) é desfeita a cada troca de estado.
  useEffect(() => {
    const el = islandRef.current;
    if (el && (el.scrollTop || el.scrollLeft)) el.scrollTo(0, 0);
  }, [mode]);

  const boxRef = useRef(box);
  boxRef.current = box;
  useEffect(() => {
    const grew = area(box) >= area(prevBox.current);
    prevBox.current = box;
    if (grew) {
      sendHitRegion(box);
      return;
    }
    const timer = window.setTimeout(() => sendHitRegion(box), SHRINK_DURATION);
    return () => window.clearTimeout(timer);
  }, [box, sendHitRegion]);

  // A janela muda de tamanho quando a escala muda (monitor/preferência).
  useEffect(() => {
    const onResize = () => sendHitRegion(boxRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sendHitRegion]);

  // Esc recolhe/volta; perder o foco fecha os painéis.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = modeRef.current;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        clearHoverTimer();
        setMode(isPanel(m) ? "expanded" : "compact");
        return;
      }
      if (ctrl && !e.altKey && e.code === "KeyK") {
        e.preventDefault();
        togglePaletteRef.current();
        return;
      }
      if (ctrl && e.code === "Comma") {
        e.preventDefault();
        clearHoverTimer();
        setMode("settings");
        return;
      }
      const typing = isTyping(islandRef.current);
      if (m === "expanded" || isClosed(m)) {
        if (ctrl && /^Digit[1-9]$/.test(e.code)) {
          e.preventDefault();
          pageAt(Number(e.code.slice(5)) - 1);
          if (isClosed(m)) setMode("expanded");
        } else if (ctrl && (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp")) {
          e.preventDefault();
          stepPage(e.shiftKey || e.key === "PageUp" ? -1 : 1);
        } else if (m === "expanded" && !typing && !ctrl && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          stepPage(e.key === "ArrowLeft" ? -1 : 1);
        }
      }
    };
    const onBlur = () => {
      if (isPickingFolder()) return;
      const m = modeRef.current;
      clearHoverTimer();
      if (m === "settings" || m === "pomodoro" || m === "palette") {
        setMode("compact");
      } else if ((m === "expanded" || m === "claude" || m === "todo") && !insideRef.current) {
        // Saiu digitando para outro app: recolhe como se o cursor tivesse saído.
        hoverTimer.current = window.setTimeout(() => setMode("compact"), m === "expanded" ? HOVER_CLOSE_DELAY : PANEL_IDLE_CLOSE);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [setMode, clearHoverTimer]);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  // Diagnóstico: início/fim reais da transição de altura (muda em toda troca de estado).
  useEffect(() => {
    const el = islandRef.current;
    if (!el) return;
    perfActions.setMode = setMode as (m: "compact" | "expanded" | "settings") => void;
    const isHeight = (e: TransitionEvent) => e.target === el && e.propertyName === "height";
    const onStart = (e: TransitionEvent) => isHeight(e) && perf.transitionStarted(e.timeStamp);
    const onEnd = (e: TransitionEvent) => isHeight(e) && perf.transitionEnded(e.timeStamp, false);
    const onCancel = (e: TransitionEvent) => isHeight(e) && perf.transitionEnded(e.timeStamp, true);
    el.addEventListener("transitionstart", onStart);
    el.addEventListener("transitionend", onEnd);
    el.addEventListener("transitioncancel", onCancel);
    return () => {
      el.removeEventListener("transitionstart", onStart);
      el.removeEventListener("transitionend", onEnd);
      el.removeEventListener("transitioncancel", onCancel);
    };
  }, [setMode]);

  // Callbacks estáveis: mantêm a memoização das vistas válida.
  const openSettings = useCallback(() => {
    clearHoverTimer();
    setMode("settings");
  }, [setMode, clearHoverTimer]);
  // Bandeja → Configurações: abre o painel; recolhe sozinho se o cursor não chegar até ele.
  useEffect(
    () =>
      onTrayOpenSettings(() => {
        openSettings();
        if (!insideRef.current) {
          hoverTimer.current = window.setTimeout(() => {
            if (!insideRef.current && modeRef.current === "settings") setMode("compact");
          }, PANEL_IDLE_CLOSE);
        }
      }),
    [openSettings, setMode],
  );
  const openPomodoro = useCallback(() => {
    clearHoverTimer();
    setMode("pomodoro");
  }, [setMode, clearHoverTimer]);
  const openClaude = useCallback(() => {
    clearHoverTimer();
    setMode("claude");
  }, [setMode, clearHoverTimer]);
  const openTodo = useCallback(() => {
    clearHoverTimer();
    setMode("todo");
    focusTodoInput();
  }, [setMode, clearHoverTimer]);

  // Lembrete clicado: abre na página de tarefas, com a tarefa em destaque.
  const todoShowSeq = useTodoShowSeq();
  const lastTodoShow = useRef(todoShowSeq);
  useEffect(() => {
    if (todoShowSeq === lastTodoShow.current) return;
    lastTodoShow.current = todoShowSeq;
    clearHoverTimer();
    setPage("todo");
    setMode("expanded");
  }, [todoShowSeq, setMode, clearHoverTimer]);
  const backToExpanded = useCallback(() => setMode("expanded"), [setMode]);

  // Paleta de comandos: Ctrl+K, botão de busca ou atalho global. De novo fecha.
  const [paletteSeq, setPaletteSeq] = useState(0);
  const openPalette = useCallback(() => {
    clearHoverTimer();
    setPaletteSeq((n) => n + 1);
    setMode("palette");
    focusPalette();
  }, [setMode, clearHoverTimer]);
  const togglePaletteRef = useRef(openPalette);
  togglePaletteRef.current = () => (modeRef.current === "palette" ? setMode(insideRef.current ? "expanded" : "compact") : openPalette());

  useEffect(
    () =>
      onGlobalHotkey(() => {
        togglePaletteRef.current();
        // Aberta pelo teclado com o cursor longe: recolhe se ninguém usar.
        if (modeRef.current === "palette" && !insideRef.current) {
          clearHoverTimer();
          hoverTimer.current = window.setTimeout(() => {
            if (!insideRef.current && modeRef.current === "palette" && !isTyping(islandRef.current)) setMode("compact");
          }, PANEL_IDLE_CLOSE * 2);
        }
      }),
    [setMode, clearHoverTimer],
  );

  // Pedido de abrir os ajustes numa seção (ex.: "Gerenciar" atalhos).
  const settingsNav = useSettingsNav();
  const lastSettingsSeq = useRef(settingsNav.seq);
  useEffect(() => {
    if (settingsNav.seq === lastSettingsSeq.current) return;
    lastSettingsSeq.current = settingsNav.seq;
    clearHoverTimer();
    setMode("settings");
  }, [settingsNav.seq, setMode, clearHoverTimer]);

  const settingsForPalette = useRef(settings);
  settingsForPalette.current = settings;
  const paletteCtx = useMemo<PaletteCtx>(
    () => ({
      goPage: (id: PageId) => {
        setPage(id);
        setMode("expanded");
      },
      openSettings: (section: SettingsSection, intent) => requestSettings(section, intent ?? null),
      openClaude: () => {
        clearHoverTimer();
        setMode("claude");
      },
      newTask: () => {
        todo.open({ kind: "new" });
        openTodo();
      },
      close: () => setMode(insideRef.current ? "expanded" : "compact"),
      get settings() {
        return settingsForPalette.current;
      },
      onSettingsChange,
    }),
    [setMode, clearHoverTimer, openTodo, onSettingsChange],
  );

  // Clique na pílula de lembrete: abre a lista de tarefas.
  const todoOpenSeq = useTodoOpenSeq();
  const lastTodoOpen = useRef(todoOpenSeq);
  useEffect(() => {
    if (todoOpenSeq === lastTodoOpen.current) return;
    lastTodoOpen.current = todoOpenSeq;
    openTodo();
  }, [todoOpenSeq, openTodo]);

  const frameStyle = { width: toRem(box.w) } as CSSProperties;
  const shellStyle = { height: toRem(box.h), borderRadius: radiusCss(box, settings.style) } as CSSProperties;

  return (
    <div className="stage">
      {/* Moldura: anima a largura e carrega as "orelhas" do notch, que ficam fora do recorte da ilha. */}
      <div ref={frameRef} className="island-frame" data-style={settings.style} data-mode={mode} data-rest={restShape} data-direction={direction.current} style={frameStyle}>
      <span className="ear ear--l" aria-hidden />
      <span className="ear ear--r" aria-hidden />
      <div
        ref={islandRef}
        className="island"
        data-mode={mode}
        data-active={active || undefined}
        style={shellStyle}
        role="region"
        aria-label="Dynamic Island"
        onClick={() => {
          if (modeRef.current === "pill" && pillIsActionable()) {
            openPill();
            return;
          }
          if (isClosed(modeRef.current) || modeRef.current === "pill") {
            perf.markEvent("clique");
            clearHoverTimer();
            setMode("expanded");
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          perf.markEvent("clique-direito");
          openSettings();
        }}
        onScroll={(e) => {
          // A cápsula nunca rola: foco/seleção de texto podem rolar um overflow:hidden e deslocar tudo.
          const el = e.currentTarget;
          if (el.scrollTop || el.scrollLeft) el.scrollTo(0, 0);
        }}
        onMouseEnter={isTauri ? undefined : () => handleHover(true)}
        onMouseLeave={isTauri ? undefined : () => handleHover(false)}
      >
        <IslandGlow mode={mode} />
        <span className="island-sheen" aria-hidden />
        <span className="island-edge" aria-hidden />
        <View mode="rest" current={mode} box={islandSize("rest", active, false, restShape, restActivities.length)}>
          <RestContent shape={restShape} activities={restActivities} />
        </View>
        <View mode="compact" current={mode} box={islandSize("compact", active)}>
          <CompactContent face={settings.compactFace} weather={settings.compactWeather} />
        </View>
        <View mode="expanded" current={mode} box={islandSize("expanded", active, wide)}>
          <ExpandedContent onOpenSettings={openSettings} onOpenPomodoro={openPomodoro} onOpenClaude={openClaude} onOpenPalette={openPalette} />
        </View>
        <View mode="settings" current={mode} box={islandSize("settings", active)}>
          <SettingsContent settings={settings} onChange={onSettingsChange} onBack={backToExpanded} />
        </View>
        <View mode="pomodoro" current={mode} box={islandSize("pomodoro", active)}>
          <PomodoroContent onBack={backToExpanded} />
        </View>
        <View mode="pill" current={mode} box={islandSize("pill", active)}>
          <PillView />
        </View>
        <View mode="claude" current={mode} box={islandSize("claude", active)}>
          <ClaudeContent onBack={backToExpanded} />
        </View>
        <View mode="todo" current={mode} box={islandSize("todo", active, false, "drop", 0, board)}>
          <TodoContent onBack={backToExpanded} />
        </View>
        <View mode="palette" current={mode} box={islandSize("palette", active)}>
          <PaletteContent ctx={paletteCtx} openSeq={paletteSeq} />
        </View>
        {!isClosed(mode) && mode !== "pill" && <ToastHost />}
      </div>
      </div>
    </div>
  );
}

/**
 * Cada estado tem seu conteúdo em tamanho final, ancorado no topo central.
 * A cápsula anima o próprio tamanho e "revela" o conteúdo, sem reflow.
 */
function View({ mode, current, box, children }: { mode: IslandMode; current: IslandMode; box: IslandBox; children: ReactNode }) {
  const active = mode === current;
  return (
    <div
      className={`view view--${mode}`}
      data-active={active}
      inert={!active}
      aria-hidden={!active}
      style={{ width: toRem(box.w), height: toRem(box.h) }}
    >
      {children}
    </div>
  );
}
