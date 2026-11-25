/**
 * Comandos do modo demonstração, usados pelo gravador (promo/record.mjs)
 * via `window.__demo`. Cada um mexe nas stores reais: a interface que
 * aparece no vídeo é a mesma do app.
 */
import { DEMO, DEMO_TRACK, demoArtwork } from "./seed";
import { __demoSetMedia, type MediaInfo } from "../features/media/store";
import { toggleLyrics } from "../features/media/lyrics";
import { __demoSetClaude, type Turn } from "../features/claude/store";
import { __demoNotify } from "../features/notify/store";
import { pillFromSys, showPill } from "../features/pills/store";
import { pomodoro } from "../features/pomodoro/store";
import { todo } from "../features/todo/store";
import { setPage, type PageId } from "../island/pages";
import { perfActions } from "../perf/hooks";
import { __demoSetHw, __demoSetPrivacy } from "../features/monitor/store";

let art: string | null = null;
let track: MediaInfo | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const demo = {
  /** Números de exemplo para a aba Hardware (no app real vêm do Rust). */
  hw(cpu = 34, gpu = 93) {
    const GB = 1024 ** 3;
    __demoSetHw({ cpu, gpu, ramUsed: 12.4 * GB, ramTotal: 15.9 * GB, diskUsed: 146 * GB, diskTotal: 238 * GB, netUp: 150_000, netDown: 1_075_000 });
  },
  privacy: (camera = true, mic = false) => __demoSetPrivacy({ camera, mic }),
  mode: (m: string) => perfActions.setMode?.(m as never),
  page: (p: PageId) => setPage(p),
  setting: (key: string, value: unknown) => perfActions.setSetting?.(key, value),

  /** Começa a "tocar" a faixa fictícia no Spotify. */
  play(positionMs = DEMO_TRACK.startMs) {
    art ??= demoArtwork();
    track = {
      app: "Spotify",
      title: DEMO_TRACK.title,
      artist: DEMO_TRACK.artist,
      album: DEMO_TRACK.album,
      playing: true,
      positionMs,
      durationMs: DEMO_TRACK.durationMs,
      updatedAt: Date.now(),
      canPrev: true,
      canNext: true,
      canToggle: true,
      artwork: art,
    };
    __demoSetMedia(track);
  },
  stop: () => __demoSetMedia(null),
  lyrics: (on: boolean) => {
    const cur = localStorage.getItem("island.lyricsOn.v1") === "1";
    if (cur !== on) toggleLyrics();
  },

  pomodoro: () => pomodoro.start("focus"),

  pill: (kind: "power" | "caps" | "volume" | "audio" | "unplug") => {
    if (kind === "power") showPill(pillFromSys({ kind: "power", plugged: true, percent: 82 }));
    else if (kind === "unplug") showPill(pillFromSys({ kind: "power", plugged: false, percent: 82 }));
    else if (kind === "caps") showPill(pillFromSys({ kind: "capsLock", on: true }));
    else if (kind === "volume") showPill(pillFromSys({ kind: "volume", level: 64, muted: false }));
    else showPill(pillFromSys({ kind: "audioOutput", name: "Fone Bluetooth", headphones: true }));
  },
  volume: (level: number) => showPill(pillFromSys({ kind: "volume", level, muted: false })),

  whatsapp: () => __demoNotify("WhatsApp", ["Ana Clara", "O layout novo ficou incrível, manda pro time!"]),
  zoho: () => __demoNotify("Microsoft Edge", ["Zoho Mail", "Marcos Lima · Proposta aprovada, podemos começar segunda"]),

  /** Lembrete real: agenda uma tarefa para daqui a `ms` e deixa o timer da store disparar. */
  reminder: (ms = 1500) => todo.add("Ligar para o Rafael", Date.now() + ms),
  todoOpen: (kind: "new" | "history" | "calendar") => todo.open({ kind }),

  /** Conversa com o Claude, escrita aos poucos como a resposta real em streaming. */
  async claude() {
    const folder = "D:\\projetos\\dynamic-island";
    const user: Turn = { id: 1, role: "user", parts: [{ kind: "text", text: "Como a ilha sabe quando recolher?" }], status: "done" };
    const answer =
      "Ela segue o **cursor**: o Rust acompanha o mouse e avisa quando ele sai da cápsula.\n\n" +
      "Aí a ilha espera **180 ms** e volta ao modo compacto. Painéis como este esperam **6 s**, e nada fecha enquanto você digita.";
    const base = { folder, busy: true, sessionId: "demo", provider: "claude" as const };
    __demoSetClaude({ ...base, turns: [user, { id: 2, role: "assistant", parts: [], status: "streaming" }] });
    await sleep(700);
    const tools: Turn["parts"] = [
      { kind: "tool", name: "Grep", detail: "HOVER_CLOSE_DELAY" },
      { kind: "tool", name: "Read", detail: "src/island/Island.tsx" },
    ];
    __demoSetClaude({ ...base, turns: [user, { id: 2, role: "assistant", parts: tools.slice(0, 1), status: "streaming" }] });
    await sleep(650);
    __demoSetClaude({ ...base, turns: [user, { id: 2, role: "assistant", parts: tools, status: "streaming" }] });
    await sleep(700);
    for (let i = 6; i <= answer.length; i += 6) {
      __demoSetClaude({ ...base, turns: [user, { id: 2, role: "assistant", parts: [...tools, { kind: "text", text: answer.slice(0, i) }], status: "streaming" }] });
      await sleep(45);
    }
    __demoSetClaude({ ...base, busy: false, turns: [user, { id: 2, role: "assistant", parts: [...tools, { kind: "text", text: answer }], status: "done" }] });
  },
};

if (DEMO) (window as unknown as { __demo: typeof demo }).__demo = demo;
