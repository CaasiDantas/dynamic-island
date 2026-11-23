import { useEffect, useState, useSyncExternalStore } from "react";
import { positionOf, type MediaInfo } from "./store";

/**
 * Letras sincronizadas do LRCLIB (lrclib.net): gratuito, sem login.
 * Busca uma vez por faixa e guarda em cache (memória + localStorage).
 */

export interface LyricLine {
  /** Início da linha, em ms desde o começo da faixa. */
  t: number;
  text: string;
}

export interface Lyrics {
  synced: LyricLine[] | null;
  plain: string[] | null;
  instrumental: boolean;
}

export type LyricsStatus = "loading" | "ready" | "none" | "error";

const API = "https://lrclib.net/api";
const CACHE_KEY = "island.lyrics.v2";
const CACHE_MAX = 40;

/* ───────── Liga/desliga (lembrado entre sessões) ───────── */

const ON_KEY = "island.lyricsOn.v1";
let lyricsOn = (() => {
  try {
    return localStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
})();
const onListeners = new Set<() => void>();

export function toggleLyrics() {
  lyricsOn = !lyricsOn;
  try {
    localStorage.setItem(ON_KEY, lyricsOn ? "1" : "0");
  } catch {
    /* sem armazenamento */
  }
  onListeners.forEach((l) => l());
}

export function useLyricsOn() {
  return useSyncExternalStore(
    (l) => {
      onListeners.add(l);
      return () => onListeners.delete(l);
    },
    () => lyricsOn,
  );
}

/* ───────── Busca ───────── */

/** Limpa títulos de vídeo: "Artista - Música (Official Video) [4K]" → artista e música. */
export function cleanTrack(m: Pick<MediaInfo, "title" | "artist" | "app">) {
  let title = m.title;
  let artist = m.artist;
  const noise = /\s*[([](?:official|oficial|lyrics?|letra|video|vídeo|audio|áudio|clipe|clip|visualizer|hd|4k|live|ao vivo|remaster(?:ed)?)[^)\]]*[)\]]/gi;
  title = title.replace(noise, "").replace(/\s*\|.*$/, "").trim();
  // Navegador: o "artista" costuma ser o canal e o título vem como "Artista - Música".
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && (!artist || /vevo|topic|official|records|music/i.test(artist) || m.app !== "Spotify")) {
    artist = dash[1];
    title = dash[2];
  }
  artist = artist.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();
  title = title.replace(/\s+(?:ft\.?|feat\.?)\s.+$/i, "").trim();
  return { title, artist };
}

function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) out.push({ t: Math.round((Number(s[1]) * 60 + Number(s[2])) * 1000), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

interface ApiTrack {
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  duration?: number;
}

function toLyrics(t: ApiTrack): Lyrics | null {
  const synced = t.syncedLyrics ? parseLrc(t.syncedLyrics) : null;
  const plain = t.plainLyrics ? t.plainLyrics.split(/\r?\n/) : null;
  if (!synced?.length && !plain?.length && !t.instrumental) return null;
  return { synced: synced?.length ? synced : null, plain, instrumental: !!t.instrumental };
}

/** Artistas a tentar, do mais provável ao menos: completo, só o primeiro, o canal/artista original. */
function artistCandidates(artist: string, original: string) {
  const first = artist.split(/\s*(?:,|&|\/|\bfeat\.?(?=\s)|\bft\.?(?=\s)|\s+e\s+|\s+x\s+|\s+and\s+)\s*/i)[0]?.trim() ?? "";
  const channel = original.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").replace(/\s*(?:oficial|official)$/i, "").trim();
  return [...new Set([artist, first, channel].filter(Boolean))];
}

async function getExact(title: string, artist: string, signal: AbortSignal): Promise<Lyrics | null> {
  const res = await fetch(`${API}/get?${new URLSearchParams({ track_name: title, artist_name: artist })}`, { signal });
  if (res.ok) return toLyrics((await res.json()) as ApiTrack);
  if (res.status === 404) return null;
  throw new Error(`LRCLIB ${res.status}`);
}

async function fetchLyrics(title: string, artists: string[], durationMs: number, signal: AbortSignal): Promise<Lyrics | null> {
  for (const artist of artists) {
    const found = await getExact(title, artist, signal);
    if (found) return found;
  }
  // Sem par exato: busca livre e prefere a com letra sincronizada e duração mais próxima.
  const q = `${title} ${artists[artists.length > 1 ? 1 : 0] ?? ""}`.trim();
  const search = await fetch(`${API}/search?${new URLSearchParams({ q })}`, { signal });
  if (!search.ok) throw new Error(`LRCLIB ${search.status}`);
  const list = (await search.json()) as ApiTrack[];
  const secs = durationMs / 1000;
  const best = list
    .filter((t) => t.syncedLyrics || t.plainLyrics)
    .sort((a, b) => {
      const sync = Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics);
      if (sync) return sync;
      return secs ? Math.abs((a.duration ?? 0) - secs) - Math.abs((b.duration ?? 0) - secs) : 0;
    })[0];
  return best ? toLyrics(best) : null;
}

const memory = new Map<string, Lyrics | null>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as [string, Lyrics | null][];
    } catch {
      return [];
    }
  })(),
);

function remember(key: string, value: Lyrics | null) {
  memory.delete(key);
  memory.set(key, value);
  while (memory.size > CACHE_MAX) memory.delete(memory.keys().next().value!);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...memory]));
  } catch {
    /* cheio ou indisponível: fica só em memória */
  }
}

/** Letra da faixa atual. Só busca quando `enabled` (painel de letras aberto). */
export function useLyrics(m: MediaInfo | null, enabled: boolean): { status: LyricsStatus; lyrics: Lyrics | null } {
  const track = m ? cleanTrack(m) : null;
  const key = track ? `${track.artist.toLowerCase()}|${track.title.toLowerCase()}` : "";
  const [result, setResult] = useState<{ key: string; status: LyricsStatus; lyrics: Lyrics | null }>({ key: "", status: "loading", lyrics: null });

  useEffect(() => {
    if (!enabled || !track || !key) return;
    if (memory.has(key)) {
      const l = memory.get(key) ?? null;
      setResult({ key, status: l ? "ready" : "none", lyrics: l });
      return;
    }
    const ctrl = new AbortController();
    setResult({ key, status: "loading", lyrics: null });
    fetchLyrics(track.title, artistCandidates(track.artist, m?.artist ?? ""), m?.durationMs ?? 0, ctrl.signal)
      .then((l) => {
        remember(key, l);
        setResult({ key, status: l ? "ready" : "none", lyrics: l });
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) setResult({ key, status: "error", lyrics: null });
        console.warn("letra falhou", err);
      });
    return () => ctrl.abort();
    // A duração chega junto com a faixa; buscar de novo só quando a faixa muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return result.key === key ? result : { status: "loading", lyrics: null };
}

/**
 * Índice da linha atual. Em vez de checar a cada quadro, agenda um timer
 * para o instante exato da próxima linha; pausa, seek e troca de faixa
 * (mudanças em `m`) recalculam.
 */
export function useLyricIndex(lines: LyricLine[] | null, m: MediaInfo | null) {
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    if (!lines?.length || !m) {
      setIndex(-1);
      return;
    }
    let timer: number | undefined;
    // Pequeno adiantamento: a linha acende junto com a voz, não depois.
    const LEAD = 150;
    const tick = () => {
      const pos = positionOf(m) + LEAD;
      let i = -1;
      while (i + 1 < lines.length && lines[i + 1].t <= pos) i++;
      setIndex(i);
      if (m.playing && i + 1 < lines.length) {
        timer = window.setTimeout(tick, Math.max(30, lines[i + 1].t - pos));
      }
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [lines, m]);

  return index;
}
