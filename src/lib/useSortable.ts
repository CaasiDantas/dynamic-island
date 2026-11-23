import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Reordenar por arrastar e soltar, sem biblioteca e sem re-render durante o
 * gesto: as posições são medidas uma vez no início, e os itens se movem por
 * transform direto no DOM (compositor). Só ao soltar o React recebe a troca.
 *
 * Itens: elementos com `data-sort-item` dentro do container. A alça recebe
 * `handleProps(index)`; Alt+↑/↓ (ou ←/→) move pelo teclado.
 */
export function useSortable(axis: "x" | "y", count: number, onMove: (from: number, to: number) => void) {
  const containerRef = useRef<HTMLElement | null>(null);
  const drag = useRef<{
    from: number;
    to: number;
    start: number;
    items: HTMLElement[];
    mids: number[];
    size: number;
    raf: number;
    delta: number;
  } | null>(null);

  const apply = () => {
    const d = drag.current;
    if (!d) return;
    d.raf = 0;
    const { from, items, mids, size, delta } = d;
    const center = mids[from] + delta;
    let to = from;
    while (to < mids.length - 1 && center > mids[to + 1]) to++;
    while (to > 0 && center < mids[to - 1]) to--;
    d.to = to;
    const t = (v: number) => (axis === "x" ? `translate3d(${v}px,0,0)` : `translate3d(0,${v}px,0)`);
    items.forEach((el, i) => {
      if (i === from) el.style.transform = t(delta);
      else if (from < to && i > from && i <= to) el.style.transform = t(-size);
      else if (from > to && i < from && i >= to) el.style.transform = t(size);
      else el.style.transform = "";
    });
  };

  const end = useCallback(
    (commit: boolean) => {
      const d = drag.current;
      if (!d) return;
      cancelAnimationFrame(d.raf);
      drag.current = null;
      containerRef.current?.removeAttribute("data-sorting");
      d.items.forEach((el) => {
        el.style.transform = "";
        el.removeAttribute("data-dragging");
      });
      if (commit && d.to !== d.from) onMove(d.from, d.to);
    },
    [onMove],
  );

  const handleProps = (index: number) => ({
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0 || !containerRef.current) return;
      const items = [...containerRef.current.querySelectorAll<HTMLElement>(":scope > [data-sort-item]")];
      if (items.length < 2) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rects = items.map((el) => el.getBoundingClientRect());
      const mids = rects.map((r) => (axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2));
      // Passo entre itens (tamanho + espaçamento); as listas ordenáveis têm itens do mesmo tamanho.
      const size = mids[1] - mids[0];
      drag.current = { from: index, to: index, start: axis === "x" ? e.clientX : e.clientY, items, mids, size, raf: 0, delta: 0 };
      containerRef.current.setAttribute("data-sorting", "");
      items[index].setAttribute("data-dragging", "");
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      d.delta = (axis === "x" ? e.clientX : e.clientY) - d.start;
      if (!d.raf) d.raf = requestAnimationFrame(apply);
    },
    onPointerUp() {
      end(true);
    },
    onPointerCancel() {
      end(false);
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      if (!e.altKey) return;
      const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
      const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
      if (!back && !fwd) return;
      e.preventDefault();
      const to = index + (fwd ? 1 : -1);
      if (to >= 0 && to < count) onMove(index, to);
    },
  });

  return { containerRef, handleProps };
}
