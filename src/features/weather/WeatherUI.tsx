import { useClock } from "../../hooks/useSystemSignals";
import { IconDrop, IconReset, IconThermo, IconWind } from "../../island/icons";
import { refreshWeather, useWeather, type WeatherKind } from "./store";

/**
 * Ícone do tempo em cores naturais (sol amarelo, nuvem azul-clara): é a
 * única parte da interface que não segue a cor de destaque, de propósito,
 * para ser lida de relance.
 */
export function WeatherGlyph({ kind, night, className }: { kind: WeatherKind; night: boolean; className?: string }) {
  const sky = kind === "clear" || kind === "partly";
  const cloud = kind !== "clear";
  const lowCloud = kind !== "partly" && kind !== "clear";
  return (
    <svg className={`wx-glyph ${className ?? ""}`} viewBox="0 0 32 32" aria-hidden data-kind={kind}>
      {sky &&
        (night ? (
          <path className="wx-moon" d={kind === "clear" ? "M20 6.5a10 10 0 1 0 6.3 15.8A8.2 8.2 0 0 1 20 6.5z" : "M13.5 4.5a6.6 6.6 0 1 0 6 9.6 5.4 5.4 0 0 1-6-9.6z"} />
        ) : kind === "clear" ? (
          <g className="wx-sun">
            <circle cx="16" cy="16" r="6.2" />
            <path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3M7.2 7.2l2.1 2.1M22.7 22.7l2.1 2.1M7.2 24.8l2.1-2.1M22.7 9.3l2.1-2.1" />
          </g>
        ) : (
          <g className="wx-sun">
            <circle cx="12" cy="11.5" r="4.6" />
            <path d="M12 2.8v2M3.3 11.5h2M5.8 5.3l1.4 1.4M18.2 5.3l-1.4 1.4" />
          </g>
        ))}
      {cloud && (
        <path
          className="wx-cloud"
          d={lowCloud ? "M9.5 23.5h13.2a5.3 5.3 0 0 0 .6-10.6 7.2 7.2 0 0 0-13.8 1.4 4.6 4.6 0 0 0 0 9.2z" : "M12 26h11.5a4.8 4.8 0 0 0 .5-9.6 6.4 6.4 0 0 0-12.3 1.3A4.2 4.2 0 0 0 12 26z"}
        />
      )}
      {(kind === "drizzle" || kind === "rain") && (
        <path className="wx-rain" d={kind === "rain" ? "M11 26.5l-1.2 2.6M16 26.5l-1.2 2.6M21 26.5l-1.2 2.6" : "M12.5 26.5l-.8 1.8M19.5 26.5l-.8 1.8"} />
      )}
      {kind === "storm" && <path className="wx-bolt" d="M17 22.5l-3 4.6h3.4l-1.6 3.6 4.6-5.6h-3.3l1.5-2.6z" />}
      {kind === "snow" && (
        <g className="wx-snow">
          <circle cx="11.5" cy="27.5" r="1.1" />
          <circle cx="16.5" cy="29" r="1.1" />
          <circle cx="21.5" cy="27.5" r="1.1" />
        </g>
      )}
      {kind === "fog" && <path className="wx-fog" d="M8 27h16M11 30h10" />}
    </svg>
  );
}

const ARROWS = ["↓", "↙", "←", "↖", "↑", "↗", "→", "↘"];
/** O vento "vem de" windDeg; a seta aponta para onde ele vai. */
const windArrow = (deg: number) => ARROWS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const ago = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return min < 1 ? "agora" : min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)} h`;
};

export function WeatherPage() {
  const { data, status } = useWeather();
  const now = useClock();

  if (!data) {
    return (
      <div className="wx wx--empty">
        {status === "error" ? (
          <>
            <strong>Clima indisponível</strong>
            <span>Sem conexão com o serviço de clima.</span>
            <button className="chip" onClick={refreshWeather}>
              <IconReset /> Tentar de novo
            </button>
          </>
        ) : (
          <>
            <span className="wx-skeleton" />
            <span>Buscando o clima…</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="wx">
      <div className="wx-main">
        <span className="wx-city" title={`Atualizado ${ago(now.getTime() - data.updatedAt)}`}>
          {data.city || "Sua região"}
        </span>
        <div className="wx-now">
          <WeatherGlyph kind={data.kind} night={data.night} className="wx-glyph--big" />
          <span className="wx-temp">{Math.round(data.temp)}°</span>
        </div>
        <span className="wx-desc">{data.desc}</span>
      </div>

      <span className="wx-divider" aria-hidden />

      <ul className="wx-stats">
        <li className="stat-card">
          <IconWind className="stat-icon" />
          <span className="stat-label">Vento</span>
          <span className="stat-value">
            {Math.round(data.wind)} km/h <span className="wx-arrow">{windArrow(data.windDeg)}</span>
          </span>
        </li>
        <li className="stat-card">
          <IconThermo className="stat-icon" />
          <span className="stat-label">Sensação</span>
          <span className="stat-value">{Math.round(data.feels)}°</span>
        </li>
        <li className="stat-card">
          <IconDrop className="stat-icon" />
          <span className="stat-label">Umidade</span>
          <span className="stat-value">{Math.round(data.humidity)}%</span>
        </li>
      </ul>
    </div>
  );
}
