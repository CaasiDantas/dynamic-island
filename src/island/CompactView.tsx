import { useCommitCount } from "../perf/hooks";
import { useBattery, useClock, useOnline } from "../hooks/useSystemSignals";
import { useNotifications } from "../lib/sources";
import { useMediaPlaying } from "../features/media/store";
import { IconWifiOff } from "./icons";
import { ArtThumb, Waveform } from "../features/media/Waveform";
import { formatTime } from "./format";
import { CompactTimer } from "../features/pomodoro/PomodoroUI";
import { usePomodoroActive } from "../features/pomodoro/store";
import { useClaudeBusy } from "../features/claude/store";
import { ClaudeBusyMark } from "../features/claude/ClaudeUI";
import { useWeatherNow } from "../features/weather/store";
import { WeatherGlyph } from "../features/weather/WeatherUI";
import { PrivacyDots } from "../features/monitor/MonitorUI";
import { BatteryRing } from "./ExpandedView";
import type { CompactFace } from "../lib/settings";

/**
 * Ilha fechada em repouso: hora | clima, e os pontinhos de privacidade
 * (câmera verde, microfone laranja) quando algum app usa.
 *
 * Música tocando vira uma "atividade ao vivo": capa à esquerda e o
 * visualizador do som real à direita, com a hora no meio. Claude
 * trabalhando, sem rede ou bateria fraca/carregando aparecem à esquerda.
 * No modo "mínima" a hora e o clima somem.
 */
export function CompactView({ face, weather }: { face: CompactFace; weather: boolean }) {
  useCommitCount("CompactView");
  // Atividade ao vivo tem prioridade no espaço compacto.
  const pomodoroActive = usePomodoroActive();
  return pomodoroActive ? <CompactTimer /> : <CompactIdle face={face} weather={weather} />;
}

function CompactIdle({ face, weather }: { face: CompactFace; weather: boolean }) {
  const now = useClock();
  const online = useOnline();
  const battery = useBattery();
  const playing = useMediaPlaying();
  const notifications = useNotifications();
  const claudeBusy = useClaudeBusy();
  const wx = useWeatherNow();
  const minimal = face === "minimal";
  const showWeather = !minimal && weather && !!wx && online;
  const batteryAlert = battery && (battery.level < 0.2 || battery.charging);

  return (
    <div className="compact" data-face={face} data-playing={playing || undefined}>
      <div className="compact-side">
        {playing && <ArtThumb className="compact-art" />}
        {claudeBusy ? (
          <ClaudeBusyMark />
        ) : !online ? (
          <span className="signal signal--warn" title="Sem conexão">
            <IconWifiOff />
          </span>
        ) : battery && (batteryAlert || (!minimal && !showWeather && !playing)) ? (
          <BatteryRing level={battery.level} charging={battery.charging} className="compact-ring" />
        ) : null}
      </div>

      {!minimal ? (
        <div className="compact-center">
          <time className="compact-time" dateTime={now.toISOString()}>
            {formatTime(now)}
          </time>
          {!playing && showWeather && wx && (
            <>
              <span className="compact-sep" aria-hidden />
              <span className="compact-wx" title={wx.desc}>
                <WeatherGlyph kind={wx.kind} night={wx.night} />
                <span>{Math.round(wx.temp)}°</span>
              </span>
            </>
          )}
        </div>
      ) : (
        <span />
      )}

      <div className="compact-side compact-side--end">
        {notifications.length > 0 && (
          <span className="badge" aria-label={`${notifications.length} notificações`}>
            {notifications.length}
          </span>
        )}
        {playing && <Waveform />}
        <PrivacyDots />
      </div>
    </div>
  );
}
