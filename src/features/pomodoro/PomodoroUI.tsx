import { Waveform } from "../media/Waveform";
import type { ReactNode } from "react";
import { IconCheck, IconChevronLeft, IconGear, IconMinus, IconNext, IconPause, IconPlay, IconPlus, IconReset, IconStop } from "../../island/icons";
import { useCommitCount } from "../../perf/hooks";
import { useMediaPlaying } from "../media/store";
import { PrivacyDots } from "../monitor/MonitorUI";
import {
  PHASE_LABEL,
  formatClock,
  pomodoro,
  usePomodoro,
  usePomodoroConfig,
  useRemaining,
  type PomodoroConfig,
  type PomodoroState,
} from "./store";

/** Fração de tempo que ainda falta (1 = cheio, 0 = acabou): o anel vai se esvaziando. */
export const leftOf = (s: PomodoroState, remaining: number) =>
  s.status === "done" ? 0 : s.totalMs > 0 ? remaining / s.totalMs : 1;

/** Anel de tempo restante. A transição de 1 s deixa o esvaziamento contínuo entre os ticks. */
export function Ring({ progress, size = 1, stroke = 2.6 }: { progress: number; size?: number; stroke?: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="pomo-ring" viewBox="0 0 24 24" style={{ width: `${size}rem`, height: `${size}rem` }} aria-hidden>
      <circle cx="12" cy="12" r={r} className="pomo-ring-track" strokeWidth={stroke} />
      <circle
        cx="12"
        cy="12"
        r={r}
        className="pomo-ring-fill"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
      />
    </svg>
  );
}

// ═════════ Compacto: tempo ao vivo + barra crescendo ═════════

export function CompactTimer() {
  useCommitCount("CompactTimer");
  const s = usePomodoro();
  const remaining = useRemaining(s);
  const playing = useMediaPlaying();
  const done = s.status === "done";
  const time = !done && <time className="pomo-compact-time">{formatClock(remaining)}</time>;
  return (
    <div className="pomo-compact" data-status={s.status} data-phase={s.phase}>
      <div className="pomo-compact-side">
        {done ? (
          <span className="pomo-done-mark">
            <IconCheck />
          </span>
        ) : (
          <Ring progress={leftOf(s, remaining)} size={1.125} stroke={3.2} />
        )}
        {/* Com música: o tempo vem para perto do anel e a direita fica com as barrinhas. */}
        {playing && !done ? time : <span className="pomo-compact-label">{done ? `${PHASE_LABEL[s.phase]} concluído` : PHASE_LABEL[s.phase]}</span>}
      </div>
      <div className="pomo-compact-side">
        {playing ? (
          <Waveform />
        ) : (
          time
        )}
        <PrivacyDots />
      </div>
    </div>
  );
}

// ═════════ Página do expandido ═════════

const endFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

function formatSpan(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/**
 * Esquerda: fase, tempo grande, horário em que termina e barra.
 * Direita: ação principal e a rodada inteira (focos, pausas e a pausa longa).
 */
export function PomodoroPage({ onConfig }: { onConfig: () => void }) {
  useCommitCount("PomodoroPage");
  const s = usePomodoro();
  const cfg = usePomodoroConfig();
  const remaining = useRemaining(s);
  const active = s.status === "running" || s.status === "paused";
  const shownPhase = s.status === "idle" ? s.next : s.phase;
  const elapsed = s.status === "done" ? 1 : active && s.totalMs > 0 ? 1 - remaining / s.totalMs : 0;
  const cycleNo = Math.min(cfg.cycles, s.phase === "focus" && s.status !== "done" ? s.focusDone + 1 : Math.max(1, s.focusDone));

  let label: string;
  let big: string;
  let sub: ReactNode;
  if (s.status === "idle") {
    label = `${PHASE_LABEL[shownPhase]} · ${minutesOf(cfg, shownPhase)} min`;
    big = formatClock(minutesOf(cfg, shownPhase) * 60_000);
    sub = <span className="pp-sub">pronto para começar</span>;
  } else if (s.status === "done") {
    label = `${PHASE_LABEL[s.phase]} concluído`;
    big = formatClock(0);
    sub = (
      <span className="pp-sub">
        próximo: <em>{PHASE_LABEL[s.next].toLowerCase()} de {minutesOf(cfg, s.next)} min</em>
      </span>
    );
  } else {
    label = s.phase === "focus" ? `Foco · ${cycleNo} de ${cfg.cycles}` : PHASE_LABEL[s.phase];
    big = formatClock(remaining);
    sub =
      s.status === "paused" ? (
        <span className="pp-sub">pausado</span>
      ) : (
        <span className="pp-sub">
          {endFmt.format(new Date(Date.now() + remaining))} <em>até terminar</em>
        </span>
      );
  }

  const roundMin = cfg.cycles * cfg.focusMin + (cfg.cycles - 1) * cfg.shortMin + cfg.longMin;

  return (
    <div className="pp" data-phase={shownPhase} data-status={s.status}>
      <div className="pp-left">
        <span className="pp-label">{label}</span>
        <time className="pp-big">{big}</time>
        {sub}
        <div className="pp-bar" aria-hidden>
          <span style={{ transform: `scaleX(${elapsed})` }} data-running={s.status === "running" || undefined} />
        </div>
      </div>

      <div className="pp-right">
        <div className="pp-head">
          <span className="pp-head-title">Esta rodada</span>
          <PrimaryAction status={s.status} next={s.next} />
          {s.status === "idle" ? (
            <button className="pp-icon" onClick={onConfig} aria-label="Configurar Pomodoro" title="Configurar">
              <IconGear />
            </button>
          ) : s.status === "done" ? (
            <button className="pp-text" onClick={() => pomodoro.dismiss()}>
              Depois
            </button>
          ) : (
            <button className="pp-icon" onClick={() => pomodoro.stop()} aria-label="Encerrar rodada" title="Encerrar rodada">
              <IconReset />
            </button>
          )}
        </div>
        <Round s={s} cfg={cfg} elapsed={elapsed} />
        <span className="pp-foot">
          {formatSpan(roundMin)} · {cfg.cycles} {cfg.cycles === 1 ? "sessão" : "sessões"}
        </span>
      </div>
    </div>
  );
}

function PrimaryAction({ status, next }: { status: PomodoroState["status"]; next: PomodoroState["phase"] }) {
  if (status === "running")
    return (
      <button className="pp-pill" onClick={() => pomodoro.pause()}>
        Pausar
      </button>
    );
  if (status === "paused")
    return (
      <button className="pp-pill" onClick={() => pomodoro.resume()}>
        Retomar
      </button>
    );
  return (
    <button className="pp-pill" onClick={() => pomodoro.start(next)}>
      {next === "focus" ? "Iniciar" : `Iniciar ${PHASE_LABEL[next].toLowerCase()}`}
    </button>
  );
}

/**
 * A rodada: barras para cada foco e para a pausa longa, pontinhos para as
 * pausas curtas. O ponto brilhante acompanha a fase atual por transform.
 */
function Round({ s, cfg, elapsed }: { s: PomodoroState; cfg: PomodoroConfig; elapsed: number }) {
  const steps = cfg.cycles * 2; // F S F S ... F L
  const indexOf = (phase: PomodoroState["phase"], focusDone: number) =>
    phase === "focus" ? 2 * focusDone : phase === "short" ? 2 * focusDone - 1 : steps - 1;
  // Em "done", o foco que acabou já entrou em focusDone: a fase concluída é o passo anterior.
  const current =
    s.status === "idle"
      ? indexOf(s.next, s.focusDone)
      : s.status === "done"
        ? s.phase === "focus"
          ? 2 * s.focusDone - 2
          : indexOf(s.phase, s.focusDone)
        : indexOf(s.phase, s.focusDone);
  const live = s.status === "running" || s.status === "paused";

  return (
    <div className="pp-round" aria-hidden>
      <div className="pp-steps">
        {Array.from({ length: steps }, (_, k) => {
          const isBar = k % 2 === 0 || k === steps - 1;
          const fill = k < current ? 1 : k === current ? (s.status === "done" ? 1 : live ? elapsed : 0) : 0;
          if (!isBar) return <i key={k} className="pp-dot" data-on={fill > 0 || undefined} data-now={(live && k === current) || undefined} />;
          return (
            <span key={k} className="pp-seg" data-long={k === steps - 1 || undefined}>
              <span className="pp-seg-fill" style={{ transform: `scaleX(${fill})` }} />
              {live && k === current && (
                <span className="pp-glow-track" style={{ transform: `translateX(${fill * 100}%)` }}>
                  <i className="pp-glow" />
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div className="pp-steps pp-labels">
        {Array.from({ length: steps }, (_, k) => {
          const isBar = k % 2 === 0 || k === steps - 1;
          if (!isBar) return <i key={k} className="pp-dot pp-dot--ghost" />;
          return (
            <span key={k} className="pp-seg pp-seg--label" data-long={k === steps - 1 || undefined}>
              {k === steps - 1 ? "Longa" : k / 2 + 1}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const minutesOf = (cfg: PomodoroConfig, phase: PomodoroState["phase"]) =>
  phase === "focus" ? cfg.focusMin : phase === "short" ? cfg.shortMin : cfg.longMin;

// ═════════ Tela do Pomodoro: configurar e controlar ═════════

export function PomodoroView({ onBack }: { onBack: () => void }) {
  useCommitCount("PomodoroView");
  const s = usePomodoro();
  const cfg = usePomodoroConfig();
  const remaining = useRemaining(s);
  const active = s.status === "running" || s.status === "paused";
  const heroMs = active ? remaining : minutesOf(cfg, s.status === "done" || s.status === "idle" ? s.next : s.phase) * 60_000;
  const heroPhase = active ? s.phase : s.next;

  return (
    <div className="pomo-view" data-phase={active ? s.phase : s.next}>
      <header className="settings-head">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          <IconChevronLeft />
        </button>
        <h1>Pomodoro</h1>
        <span className="pomo-dots" aria-label={`${s.focusDone} de ${cfg.cycles} focos no ciclo`}>
          {Array.from({ length: cfg.cycles }, (_, i) => (
            <i key={i} data-on={i < s.focusDone || undefined} />
          ))}
        </span>
      </header>

      <div className="pomo-hero" data-status={s.status}>
        <Ring progress={active ? leftOf(s, remaining) : 1} size={4.25} stroke={1.8} />
        <div className="pomo-hero-text">
          <span className="pomo-hero-phase">
            {PHASE_LABEL[heroPhase]}
            {s.status === "paused" ? " · pausado" : ""}
          </span>
          <time className="pomo-hero-time">{formatClock(heroMs)}</time>
        </div>
      </div>

      {active ? (
        <div className="pomo-controls">
          {s.status === "running" ? (
            <button className="pomo-primary-btn pomo-primary-btn--lg" onClick={() => pomodoro.pause()}>
              <IconPause /> Pausar
            </button>
          ) : (
            <button className="pomo-primary-btn pomo-primary-btn--lg" onClick={() => pomodoro.resume()}>
              <IconPlay /> Retomar
            </button>
          )}
          <button className="pomo-secondary-btn" onClick={() => pomodoro.skip()}>
            <IconNext /> Pular
          </button>
          <button className="pomo-secondary-btn pomo-secondary-btn--danger" onClick={() => pomodoro.stop()}>
            <IconStop /> Encerrar
          </button>
        </div>
      ) : (
        <>
          <div className="pomo-grid">
            <Stepper label="Foco" unit="min" value={cfg.focusMin} min={1} max={120} step={5} onChange={(focusMin) => pomodoro.setConfig({ focusMin })} />
            <Stepper label="Pausa" unit="min" value={cfg.shortMin} min={1} max={60} step={1} onChange={(shortMin) => pomodoro.setConfig({ shortMin })} />
            <Stepper label="Pausa longa" unit="min" value={cfg.longMin} min={1} max={90} step={5} onChange={(longMin) => pomodoro.setConfig({ longMin })} />
            <Stepper label="Ciclos" unit="focos" value={cfg.cycles} min={1} max={8} step={1} onChange={(cycles) => pomodoro.setConfig({ cycles })} />
          </div>
          <div className="pomo-toggles">
            <ToggleChip label="Seguir automático" on={cfg.autoStart} onChange={(autoStart) => pomodoro.setConfig({ autoStart })} />
            <ToggleChip label="Som ao terminar" on={cfg.sound} onChange={(sound) => pomodoro.setConfig({ sound })} />
          </div>
          <button className="pomo-primary-btn pomo-primary-btn--block" onClick={() => pomodoro.start(s.next)}>
            <IconPlay /> Iniciar {PHASE_LABEL[s.next].toLowerCase()}
          </button>
        </>
      )}
    </div>
  );
}

function Stepper({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  // Passo grande arredonda para o múltiplo (25 → 30 → 35), sem sair dos limites.
  const down = () => onChange(Math.max(min, value - step > 0 && value % step ? value - (value % step) : value - step));
  const up = () => onChange(Math.min(max, value % step ? value + (step - (value % step)) : value + step));
  return (
    <div className="pomo-stepper">
      <span className="pomo-stepper-label">{label}</span>
      <div className="pomo-stepper-row">
        <button onClick={down} disabled={value <= min} aria-label={`Diminuir ${label}`}>
          <IconMinus />
        </button>
        <span className="pomo-stepper-value">
          {value}
          <small>{unit}</small>
        </span>
        <button onClick={up} disabled={value >= max} aria-label={`Aumentar ${label}`}>
          <IconPlus />
        </button>
      </div>
    </div>
  );
}

function ToggleChip({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="pomo-chip" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="pomo-chip-dot" />
      {label}
    </button>
  );
}
