import { memo, useLayoutEffect, useRef } from "react";
import { useCommitCount } from "../../perf/hooks";
import { media, type MediaInfo } from "./store";
import { useLyricIndex, useLyrics, type LyricLine } from "./lyrics";

/**
 * Coluna de letras: a linha atual acesa e centralizada, as outras apagadas.
 * A lista desliza por transform (compositor); a posição da linha é medida
 * uma vez por troca de linha, nunca por quadro.
 */
export function LyricsPanel({ m }: { m: MediaInfo }) {
  useCommitCount("LyricsPanel");
  const { status, lyrics } = useLyrics(m, true);

  let body;
  if (status === "loading") body = <p className="ly-note">Procurando a letra…</p>;
  else if (status === "error") body = <p className="ly-note">Não consegui buscar a letra agora.</p>;
  else if (!lyrics) body = <p className="ly-note">Letra não encontrada para esta faixa.</p>;
  else if (lyrics.instrumental && !lyrics.synced) body = <p className="ly-note">♪ Instrumental</p>;
  else if (lyrics.synced) body = <SyncedLines lines={lyrics.synced} m={m} />;
  else
    body = (
      <div className="ly-plain">
        {lyrics.plain!.map((l, i) => (
          <p key={i}>{l || "\u00a0"}</p>
        ))}
      </div>
    );

  return <div className="ly">{body}</div>;
}

function SyncedLines({ lines, m }: { lines: LyricLine[]; m: MediaInfo }) {
  const index = useLyricIndex(lines, m);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const list = listRef.current;
    if (!box || !list) return;
    const line = list.children[Math.max(0, index)] as HTMLElement | undefined;
    if (!line) return;
    const y = box.clientHeight / 2 - (line.offsetTop + line.offsetHeight / 2);
    list.style.transform = `translateY(${y}px)`;
  }, [index, lines]);

  return (
    <div ref={boxRef} className="ly-box">
      <div ref={listRef} className="ly-list">
        {lines.map((l, i) => (
          <Line key={i} line={l} state={i === index ? "now" : i < index ? "past" : "next"} />
        ))}
      </div>
    </div>
  );
}

const Line = memo(function Line({ line, state }: { line: LyricLine; state: "now" | "past" | "next" }) {
  return (
    <p className="ly-line" data-state={state} onClick={() => media.seek(line.t)} title="Ir para este trecho">
      {line.text || "♪"}
    </p>
  );
});
