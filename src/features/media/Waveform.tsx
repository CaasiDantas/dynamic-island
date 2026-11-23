import { useEffect, useRef, type CSSProperties } from "react";
import { useArtPalette } from "./artColors";
import { registerBars, registerLine } from "./spectrum";
import { useArtwork } from "./store";

/** Cor da capa (tom do meio) para as barras; sem capa, o destaque do tema. */
function useArtTint(): CSSProperties | undefined {
  const art = useArtwork();
  const palette = useArtPalette(art);
  return palette ? ({ "--wave-art": palette[1] } as CSSProperties) : undefined;
}

/**
 * Barras do visualizador ligadas ao som real (ver spectrum.ts).
 * `bars`: 5 na fechada/cabeçalho, 3 na gota.
 */
export function Waveform({ bars = 5, className = "" }: { bars?: 3 | 4 | 5; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const tint = useArtTint();
  useEffect(() => registerBars(Array.from(ref.current!.children) as HTMLElement[]), [bars]);
  return (
    <span ref={ref} className={`wave ${className}`} style={tint} data-art={tint ? "" : undefined} aria-label="Tocando">
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

/** Trecho do fio: uma faixa que respira com o volume da música. */
export function WaveLine() {
  const ref = useRef<HTMLSpanElement>(null);
  const tint = useArtTint();
  useEffect(() => registerLine(ref.current!), []);
  return <span ref={ref} className="wave-line" style={tint} data-art={tint ? "" : undefined} aria-label="Tocando" />;
}

/** Miniatura da capa (fechada e gota). Sem capa, um disco neutro. */
export function ArtThumb({ className = "" }: { className?: string }) {
  const art = useArtwork();
  return (
    <span className={`art-thumb ${className}`} aria-hidden>
      {art ? <img src={art} alt="" draggable={false} /> : <span className="artwork-rings" />}
    </span>
  );
}
