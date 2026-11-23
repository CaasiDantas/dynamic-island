import { useEffect, useRef } from "react";
import { perf, report } from "./monitor";

const f1 = (n: number) => n.toFixed(1).padStart(5);

/**
 * Painel de diagnóstico. Atualiza o texto direto no DOM a cada 500 ms
 * (sem estado React), para não interferir no que está medindo.
 */
export function PerfHud() {
  const pre = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let ticks = 0;
    const timer = window.setInterval(() => {
      const s = perf.stats(1000);
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      const last = perf.transitions[perf.transitions.length - 1];
      const r = perf.renders;
      const lines = [
        `FPS ${f1(s.fps)}  médio ${f1(s.avgFps)}  tela ~${s.refreshHz.toFixed(0)} Hz`,
        `frame ${f1(s.frameMs)} ms  p95 ${f1(s.p95)}  p99 ${f1(s.p99)}  pior(1s) ${f1(s.worst)}`,
        `piores sessão: ${s.worstSession.map((w) => w.toFixed(1)).join(" ") || "—"}`,
        `quadros perdidos (>1,5×): 1s ${s.dropped}  sessão ${s.sessionDropped}`,
        `quadros longos (LoAF): ${perf.loafCount}  máx ${perf.loafMaxMs.toFixed(0)} ms`,
        `commits: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}`,
        last
          ? `últ. transição ${last.from}→${last.to} (${last.trigger}): espera ${last.requestDelayMs ?? "—"} · início ${last.startLatencyMs ?? "—"} · dur ${last.durationMs ?? "—"} ms`
          : "últ. transição —",
        last
          ? `   ${last.frames} quadros · ${last.avgFps} fps · pior ${last.worstFrameMs} ms · perdidos ${last.droppedFrames}${last.cancelled ? " · interrompida" : ""}`
          : "",
        heap ? `heap JS ${(heap / 1048576).toFixed(1)} MB` : "",
        "rAF = cadência do thread principal; não mede a composição do DWM.",
      ];
      if (pre.current) pre.current.textContent = lines.filter(Boolean).join("\n");

      if (++ticks % 2 === 0) {
        report({
          kind: "second",
          fps: round(s.fps),
          frameMs: round(s.frameMs),
          p95: round(s.p95),
          p99: round(s.p99),
          worst: round(s.worst),
          dropped: s.dropped,
          refreshHz: round(s.refreshHz),
          loaf: perf.loafCount,
          loafMaxMs: round(perf.loafMaxMs),
          heapMB: heap ? round(heap / 1048576) : null,
          renders: { ...r },
        });
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="perf-hud" aria-hidden>
      <pre ref={pre}>medindo…</pre>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
