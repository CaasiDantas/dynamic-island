import { useMemo } from "react";
import { useCommitCount } from "../perf/hooks";
import { useMediaPlaying } from "../features/media/store";
import { usePomodoro, usePomodoroActive, useRemaining } from "../features/pomodoro/store";
import { Ring, leftOf } from "../features/pomodoro/PomodoroUI";
import { startOfDay, useTasks } from "../features/todo/store";
import { useClaudeBusy } from "../features/claude/store";
import type { RestShape } from "../lib/layout";
import { ArtThumb, WaveLine, Waveform } from "../features/media/Waveform";

/**
 * Ilha em repouso: gota (notch baixinho) ou fio (linha na borda).
 * Cobre o mínimo das janelas de baixo e só dá um sinal de cada atividade:
 * Pomodoro, música, lembrete de hoje pendente e Claude trabalhando
 * (nessa ordem de prioridade, no máximo 3).
 *
 * Gota: os sinais ficam lado a lado e ela alarga para caber.
 * Fio: a linha se divide em um trecho por atividade.
 */
export type RestActivity = "pomodoro" | "music" | "task" | "claude";

export const REST_MAX = 3;

/** Muda de dia sozinho: o lembrete "de hoje" é recalculado a cada leitura das tarefas. */
function useTaskDue() {
  const tasks = useTasks();
  const tomorrow = startOfDay(Date.now(), 1);
  return tasks.some((t) => !t.done && t.remindAt != null && t.remindAt < tomorrow);
}

/** Atividades que aparecem no repouso, já na ordem e cortadas no máximo. */
export function useRestActivities(): RestActivity[] {
  const pomodoro = usePomodoroActive();
  const music = useMediaPlaying();
  const task = useTaskDue();
  const claude = useClaudeBusy();
  const list: RestActivity[] = [];
  if (pomodoro) list.push("pomodoro");
  if (music) list.push("music");
  if (task) list.push("task");
  if (claude) list.push("claude");
  const key = list.slice(0, REST_MAX).join();
  // Mesma lista enquanto o conteúdo não muda: a vista memoizada não re-renderiza à toa.
  return useMemo(() => (key ? (key.split(",") as RestActivity[]) : []), [key]);
}

export function RestView({ shape, activities }: { shape: RestShape; activities: RestActivity[] }) {
  useCommitCount("RestView");
  return (
    <div className={`rest rest--${shape}`} data-count={activities.length}>
      {activities.map((a) => (
        <span key={a} className={`rest-item rest-item--${a}`}>
          <Signal kind={a} shape={shape} />
        </span>
      ))}
    </div>
  );
}

function Signal({ kind, shape }: { kind: RestActivity; shape: RestShape }) {
  if (kind === "pomodoro") return <PomodoroSignal shape={shape} />;
  if (kind === "music") {
    return shape === "line" ? (
      <WaveLine />
    ) : (
      <span className="rest-music">
        <ArtThumb className="rest-art" />
        <Waveform bars={3} />
      </span>
    );
  }
  // Tarefa e Claude: ponto (gota) ou trecho colorido (fio).
  return <span className="rest-dot" aria-label={kind === "task" ? "Lembrete para hoje" : "Claude trabalhando"} />;
}

/** Componente separado: só ele re-renderiza a cada segundo do Pomodoro. */
function PomodoroSignal({ shape }: { shape: RestShape }) {
  const s = usePomodoro();
  const left = leftOf(s, useRemaining(s));
  return (
    <span className="rest-pomo" data-phase={s.phase}>
      {shape === "line" ? <span className="rest-fill" style={{ transform: `scaleX(${left})` }} aria-hidden /> : <Ring progress={left} size={0.625} stroke={4} />}
    </span>
  );
}
