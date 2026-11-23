import { memo, type CSSProperties } from "react";
import type { IslandMode } from "../lib/layout";
import { useMedia } from "../features/media/store";
import { useArtPalette } from "../features/media/artColors";
import { usePomodoro } from "../features/pomodoro/store";
import { usePage } from "./pages";

/**
 * Degradê de fundo da ilha aberta: uma luz discreta que sobe da borda
 * de baixo e some antes do topo. Uma camada por fonte de cor; trocar de
 * página ou de estado só cruza a opacidade delas (compositor). As cores de
 * cada camada só mudam quando a fonte muda (ex.: outra capa).
 */
type Source = "art" | "focus" | "break" | "calm";

export const IslandGlow = memo(function IslandGlow({ mode }: { mode: IslandMode }) {
  const page = usePage();
  const media = useMedia();
  const palette = useArtPalette(media?.artwork);
  const pomo = usePomodoro();

  const pomoPhase = pomo.status === "running" || pomo.status === "paused" ? pomo.phase : pomo.next;
  const pomoSource: Source = pomoPhase === "focus" ? "focus" : "break";

  let source: Source | null = null;
  let level = 0;
  if (mode === "expanded") {
    if (page === "media") {
      source = palette ? "art" : "calm";
      level = palette ? (media?.playing ? 1 : 0.7) : 0.55;
    } else if (page === "pomodoro") {
      source = pomoSource;
      level = pomo.status === "running" ? 0.85 : 0.6;
    } else {
      source = "calm";
      level = 0.7;
    }
  } else if (mode === "pomodoro") {
    source = pomoSource;
    level = 0.55;
  } else if (mode === "claude" || mode === "todo") {
    source = "calm";
    level = 0.5;
  } else if (mode === "settings" || mode === "palette") {
    source = "calm";
    level = 0.3;
  }

  const artStyle = palette ? ({ "--g1": palette[0], "--g2": palette[1], "--g3": palette[2] } as CSSProperties) : undefined;

  // Intensidade escolhida nos ajustes (--glow-strength) multiplica o nível de cada camada.
  const op = (s: Source) => (source === s ? `calc(${level} * var(--glow-strength))` : 0);
  return (
    <div className="glow" aria-hidden>
      <i className="glow-layer glow--art" style={{ ...artStyle, opacity: op("art") }} />
      <i className="glow-layer glow--focus" style={{ opacity: op("focus") }} />
      <i className="glow-layer glow--break" style={{ opacity: op("break") }} />
      <i className="glow-layer glow--calm" style={{ opacity: op("calm") }} />
    </div>
  );
});
