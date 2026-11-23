import { Waveform } from "../features/media/Waveform";
import { useUpdateAvailable } from "../features/update/store";
import { memo, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type WheelEvent } from "react";
import { useCommitCount } from "../perf/hooks";
import { useBattery, useClock } from "../hooks/useSystemSignals";
import { formatShortDate, formatTime } from "./format";
import { MediaPage } from "../features/media/MediaPage";
import { useMediaPlaying } from "../features/media/store";
import { PomodoroPage } from "../features/pomodoro/PomodoroUI";
import { ClaudePage } from "../features/claude/ClaudeUI";
import { TodoPage } from "../features/todo/TodoUI";
import { ShortcutsPage } from "../features/shortcuts/ShortcutsUI";
import { WeatherPage } from "../features/weather/WeatherUI";
import { HardwarePage } from "../features/monitor/MonitorUI";
import { IconGear, IconSearch } from "./icons";
import { PAGE_DEFS, setPage, stepPage, usePage, useVisiblePages, type PageId } from "./pages";

interface ExpandedProps {
  onOpenSettings: () => void;
  onOpenPomodoro: () => void;
  onOpenClaude: () => void;
  onOpenPalette: () => void;
}

// Cada página assina só os próprios dados: trocar de página re-renderiza a casca, não elas.
const MediaContent = memo(MediaPage);
const PomodoroContent = memo(PomodoroPage);
const ClaudeContent = memo(ClaudePage);
const TodoContent = memo(TodoPage);
const ShortcutsContent = memo(ShortcutsPage);
const WeatherContent = memo(WeatherPage);
const HardwareContent = memo(HardwarePage);

/**
 * Expandido: barra de abas (ícones) à esquerda, hora e ferramentas à direita,
 * e a página ativa ocupando o resto. Todas as páginas têm o mesmo tamanho; a
 * troca anima só opacidade e deslocamento (compositor).
 */
export function ExpandedView({ onOpenSettings, onOpenPomodoro, onOpenClaude, onOpenPalette }: ExpandedProps) {
  useCommitCount("ExpandedView");
  const page = usePage();
  const pages = useVisiblePages();
  const index = pages.indexOf(page);

  return (
    <div className="xp">
      <header className="xp-head">
        <TabBar pages={pages} page={page} />
        <div className="xp-tools">
          <HeadEq />
          <HeadClock />
          <span className="xp-sep" aria-hidden />
          <button className="icon-btn icon-btn--ghost" onClick={onOpenPalette} aria-label="Buscar (Ctrl+K)" title="Buscar  Ctrl+K">
            <IconSearch />
          </button>
          <SettingsButton onClick={onOpenSettings} />
        </div>
      </header>

      <div className="xp-pages">
        {pages.map((id, i) => (
          <Page key={id} id={id} active={i === index} side={i < index ? "left" : "right"}>
            {id === "media" ? (
              <MediaContent />
            ) : id === "pomodoro" ? (
              <PomodoroContent onConfig={onOpenPomodoro} />
            ) : id === "claude" ? (
              <ClaudeContent onOpen={onOpenClaude} />
            ) : id === "todo" ? (
              <TodoContent />
            ) : id === "weather" ? (
              <WeatherContent />
            ) : id === "hardware" ? (
              <HardwareContent />
            ) : (
              <ShortcutsContent />
            )}
          </Page>
        ))}
      </div>
    </div>
  );
}

/** Roda do mouse sobre as abas troca de página (uma por gesto). */
let lastWheel = 0;
function onTabsWheel(e: WheelEvent) {
  const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (Math.abs(d) < 4 || e.timeStamp - lastWheel < 220) return;
  lastWheel = e.timeStamp;
  stepPage(d > 0 ? 1 : -1);
}

/**
 * Abas com ícone e o nome da ativa ao lado. Todas têm a mesma largura, então
 * o indicador desliza só por transform, calculado no CSS a partir do índice.
 * Muitas páginas: a faixa rola na horizontal e a ativa é trazida para a vista.
 */
function TabBar({ pages, page }: { pages: PageId[]; page: PageId }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const index = Math.max(0, pages.indexOf(page));

  // Uma leitura de layout por troca de página (nunca por quadro).
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const btn = strip?.querySelector<HTMLElement>(`[data-tab="${page}"]`);
    if (!strip || !btn) return;
    strip.dataset.overflow = strip.scrollWidth > strip.clientWidth + 1 ? "true" : "false";
    const left = btn.offsetLeft;
    const right = left + btn.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left - 4;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 4;
  }, [page, pages]);

  return (
    <div className="tabs">
      <div ref={stripRef} className="tabs-strip" role="tablist" aria-label="Páginas" onWheel={onTabsWheel} style={{ "--i": index } as CSSProperties}>
        <span className="tabs-indicator" aria-hidden />
        {pages.map((id, i) => {
          const def = PAGE_DEFS[id];
          return (
            <button
              key={id}
              data-tab={id}
              role="tab"
              aria-selected={id === page}
              aria-label={def.title}
              title={`${def.title}  Ctrl+${i + 1}`}
              className="tab"
              onClick={() => setPage(id)}
            >
              <def.icon />
            </button>
          );
        })}
      </div>
      <span key={page} className="tabs-title">
        {PAGE_DEFS[page].title}
      </span>
    </div>
  );
}

function Page({ id, active, side, children }: { id: PageId; active: boolean; side: "left" | "right"; children: ReactNode }) {
  return (
    <section className="xp-page" data-page={id} data-active={active} data-side={side} inert={!active} aria-hidden={!active} role="tabpanel">
      {children}
    </section>
  );
}

/** Relógio do cabeçalho: re-renderiza só ele, uma vez por minuto. */
function HeadClock() {
  const now = useClock();
  const battery = useBattery();
  return (
    <div className="xp-clock">
      <span className="xp-date">{formatShortDate(now)}</span>
      <time className="xp-time" dateTime={now.toISOString()}>
        {formatTime(now)}
      </time>
      {battery && <BatteryRing level={battery.level} charging={battery.charging} />}
    </div>
  );
}

/** Ajustes com um ponto quando há atualização esperando. */
function SettingsButton({ onClick }: { onClick: () => void }) {
  const update = useUpdateAvailable();
  return (
    <button
      className="icon-btn icon-btn--ghost"
      data-badge={update || undefined}
      onClick={onClick}
      aria-label={update ? "Ajustes (atualização disponível)" : "Ajustes"}
      title={update ? "Atualização disponível  Ctrl+," : "Ajustes  Ctrl+,"}
    >
      <IconGear />
    </button>
  );
}

function HeadEq() {
  const playing = useMediaPlaying();
  return playing ? <Waveform bars={4} className="wave--head" /> : null;
}

export function BatteryRing({ level, charging, className = "" }: { level: number; charging: boolean; className?: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className={`xp-ring ${className}`}
      viewBox="0 0 24 24"
      data-low={(level < 0.2 && !charging) || undefined}
      data-charging={charging || undefined}
      aria-label={`Bateria ${Math.round(level * 100)}%${charging ? ", carregando" : ""}`}
    >
      <title>{`Bateria ${Math.round(level * 100)}%${charging ? " · carregando" : ""}`}</title>
      <circle cx="12" cy="12" r={r} className="xp-ring-track" />
      <circle cx="12" cy="12" r={r} className="xp-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - level)} />
    </svg>
  );
}
