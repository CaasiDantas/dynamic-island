import { perfActions } from "./hooks";
import { perf, report } from "./monitor";

/**
 * Controle remoto do diagnóstico, só em desenvolvimento: o plugin do Vite
 * repassa comandos HTTP (`/__perf/cmd?...`) pelo canal de HMR que já existe.
 * Permite ligar/zerar o medidor e disparar ações durante os testes.
 */
export function installPerfRemote() {
  if (!import.meta.hot) return;
  import.meta.hot.on("perf:cmd", (cmd: { action: string; mode?: string; key?: string; value?: string }) => {
    switch (cmd.action) {
      case "enable":
        perf.setEnabled(true);
        break;
      case "disable":
        perf.setEnabled(false);
        break;
      case "reset":
        perf.reset();
        report({ kind: "reset" });
        break;
      case "mark":
        report({ kind: "mark", label: cmd.value ?? "" });
        break;
      case "probe": {
        // Medidas da janela real (zoom, escala, tamanho da cápsula), gravadas mesmo com o medidor desligado.
        const rect = (sel: string) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null;
        };
        const vv = window.visualViewport;
        void fetch("/__perf", {
          method: "POST",
          body: JSON.stringify({
            t: Date.now(),
            kind: "probe",
            tauri: "__TAURI_INTERNALS__" in window,
            dpr: window.devicePixelRatio,
            inner: [window.innerWidth, window.innerHeight],
            outer: [window.outerWidth, window.outerHeight],
            vv: vv && { scale: vv.scale, w: vv.width, h: vv.height, ox: vv.offsetLeft, oy: vv.offsetTop },
            rootFont: document.documentElement.style.fontSize,
            mode: document.querySelector(".island")?.getAttribute("data-mode"),
            frame: rect(".island-frame"),
            island: rect(".island"),
            time: rect(".compact-time"),
            focused: document.hasFocus(),
            todo: (() => {
              try {
                return (JSON.parse(localStorage.getItem("island.todo.v1") ?? "[]") as { text: string; done: boolean; doneAt: number | null }[]).map((t) => [t.text, t.done, t.doneAt]);
              } catch {
                return null;
              }
            })(),
            motion: document.documentElement.dataset.motion,
            prefersReduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            eq: (() => {
              const bars = document.querySelectorAll<HTMLElement>(".view--compact .wave i");
              if (!bars.length) return null;
              return { transforms: Array.from(bars, (b) => b.style.transform) };
            })(),
          }),
        });
        break;
      }
      case "todoopen":
        void import("../features/todo/store").then(({ todo }) => {
          if (cmd.value === "edit") {
            const first = (JSON.parse(localStorage.getItem("island.todo.v1") ?? "[]") as { id: string; done: boolean }[]).find((t) => !t.done);
            if (first) todo.open({ kind: "edit", id: first.id });
          } else todo.open(cmd.value === "history" || cmd.value === "calendar" ? { kind: cmd.value } : { kind: "new" });
        });
        break;
      case "todoclear":
        void import("../features/todo/store").then(({ todo }) => {
          for (const id of JSON.parse(localStorage.getItem("island.todo.v1") ?? "[]").map((t: { id: string }) => t.id)) todo.remove(id);
        });
        break;
      case "todo":
        void import("../features/todo/store").then(({ todo }) => {
          todo.add("Pagar boleto da internet", Date.now() + Number(cmd.value ?? 20) * 1000);
          todo.add("Revisar PR da automação", null);
          todo.add("Ligar para o despachante", Date.now() + 3 * 3600_000);
          todo.add("Comprar café", null);
          todo.add("Mandar relatório semanal", null);
          const all = JSON.parse(localStorage.getItem("island.todo.v1") ?? "[]") as { id: string; text: string }[];
          const done = all.find((t) => t.text === "Mandar relatório semanal");
          if (done) todo.toggle(done.id);
        });
        break;
      case "notify":
        void import("../features/notify/store").then((m) => m.debugNotify(cmd.value || undefined));
        break;
      case "lyrics":
        void import("../features/media/lyrics").then((m) => m.toggleLyrics());
        break;
      case "page":
        void import("../island/pages").then((m) => m.setPage(cmd.value as never));
        break;
      case "mode":
        perfActions.setMode?.(cmd.mode as "compact" | "expanded" | "settings");
        break;
      case "setting": {
        let value: unknown = cmd.value;
        if (value === "true") value = true;
        else if (value === "false") value = false;
        else if (value !== undefined && /^-?\d+(\.\d+)?$/.test(String(value))) value = Number(value);
        if (cmd.key) perfActions.setSetting?.(cmd.key, value);
        break;
      }
    }
  });
}
