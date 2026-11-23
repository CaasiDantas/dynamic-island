import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { useCommitCount } from "../../perf/hooks";
import { IconLyrics, IconMute, IconNext, IconPause, IconPlay, IconPrev, IconSpeaker } from "../../island/icons";
import { useVolume, volume } from "./volume";
import { toggleLyrics, useLyricsOn } from "./lyrics";
import { LyricsPanel } from "./LyricsPanel";
import { formatDuration, hasLyricsSupport, media, positionOf, useMedia, type MediaInfo } from "./store";

/** Página de música do expandido: capa, faixa, barra com seek e controles. */
export function MediaPage() {
  useCommitCount("MediaPage");
  const m = useMedia();
  const lyricsOn = useLyricsOn();
  const supported = hasLyricsSupport(m);
  const showLyrics = lyricsOn && supported;

  if (!m) {
    return (
      <div className="mp mp--empty">
        <div className="mp-art" aria-hidden>
          <span className="artwork-rings" />
        </div>
        <div className="mp-text">
          <strong>Nada tocando</strong>
          <span>Abra o Spotify ou um vídeo no navegador</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mp" data-lyrics={showLyrics || undefined}>
      <div className="mp-main">
      <div className="mp-top">
        <div className="mp-art" aria-hidden>
          {m.artwork ? <img src={m.artwork} alt="" draggable={false} /> : <span className="artwork-rings" />}
        </div>
        <div className="mp-text">
          <strong title={m.title}>{m.title}</strong>
          <span>{m.artist || m.album}</span>
        </div>
        <span className="mp-app">{m.app}</span>
      </div>

      {m.durationMs > 0 ? <Seekbar m={m} /> : <div className="mp-seek mp-seek--off" aria-hidden />}

      <div className="mp-controls">
        {supported && (
          <button
            className="mp-btn mp-btn--lyrics"
            data-on={lyricsOn || undefined}
            onClick={toggleLyrics}
            aria-pressed={lyricsOn}
            aria-label={lyricsOn ? "Esconder letra" : "Mostrar letra"}
            title={lyricsOn ? "Esconder letra" : "Mostrar letra"}
          >
            <IconLyrics />
          </button>
        )}
        <button className="mp-btn" disabled={!m.canPrev} onClick={media.prev} aria-label="Anterior">
          <IconPrev />
        </button>
        <button className="mp-btn mp-btn--main" disabled={!m.canToggle} onClick={media.toggle} aria-label={m.playing ? "Pausar" : "Tocar"}>
          {m.playing ? <IconPause /> : <IconPlay />}
        </button>
        <button className="mp-btn" disabled={!m.canNext} onClick={media.next} aria-label="Próxima">
          <IconNext />
        </button>
        <VolumeControl narrow={showLyrics} />
      </div>
      </div>
      {showLyrics && <LyricsPanel m={m} />}
    </div>
  );
}

/**
 * Volume do Windows: ícone (liga/desliga o mudo) + trilho igual ao da faixa.
 * A roda do mouse em cima ajusta de 4 em 4. Com a letra aberta a coluna
 * fica estreita: só o ícone (clique = mudo, roda = volume).
 */
function VolumeControl({ narrow }: { narrow: boolean }) {
  const v = useVolume();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  if (!v) return null;

  const level = v.muted ? 0 : v.level;
  const ratioAt = (e: PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) < 1) return;
    volume.set(level + (e.deltaY < 0 ? 4 : -4));
  };

  return (
    <div className="mp-vol" data-narrow={narrow || undefined} onWheel={onWheel}>
      <button
        className="mp-btn mp-btn--vol"
        onClick={volume.toggleMute}
        aria-pressed={v.muted}
        aria-label={v.muted ? "Ativar som" : "Silenciar"}
        title={`${v.muted ? "Sem som" : `Volume ${v.level}%`} · roda do mouse ajusta`}
      >
        {level === 0 ? <IconMute /> : <IconSpeaker />}
      </button>
      {!narrow && (
        <div
          ref={trackRef}
          className="mp-track mp-track--vol"
          data-dragging={dragging || undefined}
          role="slider"
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={level}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            volume.set(ratioAt(e) * 100);
          }}
          onPointerMove={(e) => dragging && volume.set(ratioAt(e) * 100)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
        >
          <span className="mp-fill" style={{ transform: `scaleX(${level / 100})` }} />
        </div>
      )}
    </div>
  );
}

/** Re-renderiza uma vez por segundo, só enquanto toca. */
function useSecondTick(m: MediaInfo) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!m.playing) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [m.playing, m.updatedAt]);
}

/**
 * Tempo corrido · barra · tempo restante. Clicar ou arrastar na barra pula
 * para o ponto. A barra anda por transform (compositor); durante o arraste
 * a posição fica local e só é enviada ao soltar.
 */
function Seekbar({ m }: { m: MediaInfo }) {
  useSecondTick(m);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const ratioAt = (e: PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const pos = drag !== null ? drag * m.durationMs : positionOf(m);
  const ratio = Math.min(1, pos / m.durationMs);

  return (
    <div className="mp-seek">
      <span className="mp-time">{formatDuration(pos)}</span>
      <div
        ref={trackRef}
        className="mp-track"
        data-dragging={drag !== null || undefined}
        role="slider"
        aria-label="Posição da faixa"
        aria-valuemin={0}
        aria-valuemax={Math.round(m.durationMs / 1000)}
        aria-valuenow={Math.round(pos / 1000)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(ratioAt(e));
        }}
        onPointerMove={(e) => drag !== null && setDrag(ratioAt(e))}
        onPointerUp={(e) => {
          if (drag === null) return;
          media.seek(ratioAt(e) * m.durationMs);
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <span
          key={m.title}
          className="mp-fill"
          style={{ transform: `scaleX(${ratio})` }}
          data-playing={(m.playing && drag === null) || undefined}
        />
      </div>
      <span className="mp-time mp-time--end">-{formatDuration(Math.max(0, m.durationMs - pos))}</span>
    </div>
  );
}
