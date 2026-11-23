import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode, type SVGProps } from "react";
import { useCommitCount } from "../../perf/hooks";
import {
  IconExternal,
  IconMoon,
  IconNext,
  IconPause,
  IconPlay,
  IconPlus,
  IconPrev,
  IconReturn,
  IconSearch,
  IconSpark,
  IconStop,
  IconSun,
  IconTimer,
} from "../../island/icons";
import { PAGE_DEFS, useVisiblePages, type PageId } from "../../island/pages";
import type { SettingsSection } from "../../island/settingsNav";
import { resolveMode } from "../../lib/theme";
import type { Settings } from "../../lib/settings";
import { focusIsland, claude } from "../claude/store";
import { media, useMedia } from "../media/store";
import { pomodoro, usePomodoro, PHASE_LABEL } from "../pomodoro/store";
import { hostOf, nameFromUrl, normalizeUrl, shortcuts, subtitleOf, useShortcuts } from "../shortcuts/store";
import { ShortcutIconView } from "../shortcuts/ShortcutsUI";
import { toast } from "../../island/toast";

export interface PaletteCtx {
  goPage: (id: PageId) => void;
  openSettings: (section: SettingsSection, intent?: { kind: "new-shortcut"; url?: string; app?: boolean }) => void;
  openClaude: () => void;
  newTask: () => void;
  close: () => void;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Command {
  id: string;
  group: "Páginas" | "Ações" | "Atalhos" | "Ajustes" | "Sugestão";
  title: string;
  hint?: string;
  keywords?: string;
  icon: Icon | (() => ReactNode);
  run: () => void;
  /** Sempre aparece quando há busca (não depende da pontuação). */
  pinned?: boolean;
}

const SECTION_LABELS: [SettingsSection, string, string][] = [
  ["appearance", "Aparência", "tema cor escuro claro destaque"],
  ["island", "Ilha", "estilo notch tamanho flutuante"],
  ["pages", "Páginas", "abas ordem ocultar"],
  ["shortcuts", "Atalhos", "sites favoritos gerenciar"],
  ["keyboard", "Teclado", "atalho global tecla"],
  ["notifications", "Notificações", "avisos whatsapp zoho"],
  ["general", "Geral", "comportamento encerrar topo"],
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pontuação simples e previsível: começo do título > começo de palavra > iniciais > contém. */
function score(c: Command, q: string) {
  const title = fold(c.title);
  if (title.startsWith(q)) return 4;
  const words = title.split(/[\s:·—-]+/);
  if (words.some((w) => w.startsWith(q))) return 3;
  if (words.map((w) => w[0] ?? "").join("").startsWith(q)) return 2.5;
  if (title.includes(q)) return 2;
  if (c.keywords && fold(c.keywords).includes(q)) return 1;
  if (c.hint && fold(c.hint).includes(q)) return 0.5;
  return 0;
}

let focusInput: (() => void) | null = null;
/** O painel só deixa de ser inerte depois do próximo render. */
export const focusPalette = () => window.setTimeout(() => focusInput?.(), 60);

export function PaletteView({ ctx, openSeq }: { ctx: PaletteCtx; openSeq: number }) {
  useCommitCount("PaletteView");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pages = useVisiblePages();
  const list = useShortcuts();
  const m = useMedia();
  const pomo = usePomodoro();

  useEffect(() => {
    setQuery("");
    setActive(0);
  }, [openSeq]);

  useEffect(() => {
    const fn = () => {
      focusIsland();
      inputRef.current?.focus({ preventScroll: true });
    };
    focusInput = fn;
    return () => {
      if (focusInput === fn) focusInput = null;
    };
  }, []);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    pages.forEach((id, i) =>
      out.push({ id: `page:${id}`, group: "Páginas", title: PAGE_DEFS[id].title, hint: `Ctrl+${i + 1}`, keywords: PAGE_DEFS[id].keywords, icon: PAGE_DEFS[id].icon, run: () => ctx.goPage(id) }),
    );

    if (pomo.status === "running") out.push({ id: "pomo:pause", group: "Ações", title: "Pausar Pomodoro", keywords: "timer foco", icon: IconPause, run: () => pomodoro.pause() });
    else if (pomo.status === "paused") out.push({ id: "pomo:resume", group: "Ações", title: "Retomar Pomodoro", keywords: "timer foco", icon: IconPlay, run: () => pomodoro.resume() });
    else out.push({ id: "pomo:start", group: "Ações", title: `Iniciar ${PHASE_LABEL[pomo.next].toLowerCase()}`, keywords: "pomodoro timer começar", icon: IconTimer, run: () => pomodoro.start(pomo.next) });
    if (pomo.status === "running" || pomo.status === "paused")
      out.push({ id: "pomo:stop", group: "Ações", title: "Encerrar Pomodoro", keywords: "parar timer", icon: IconStop, run: () => pomodoro.stop() });

    if (m) {
      if (m.canToggle) out.push({ id: "media:toggle", group: "Ações", title: m.playing ? "Pausar música" : "Tocar música", hint: m.title, keywords: "mídia play pause", icon: m.playing ? IconPause : IconPlay, run: media.toggle });
      if (m.canNext) out.push({ id: "media:next", group: "Ações", title: "Próxima faixa", keywords: "música pular", icon: IconNext, run: media.next });
      if (m.canPrev) out.push({ id: "media:prev", group: "Ações", title: "Faixa anterior", keywords: "música voltar", icon: IconPrev, run: media.prev });
    }

    out.push({ id: "todo:new", group: "Ações", title: "Nova tarefa", keywords: "to-do lembrete adicionar", icon: IconPlus, run: ctx.newTask });
    out.push({ id: "claude:open", group: "Ações", title: "Conversar com o Claude", keywords: "ia pergunta chat", icon: IconSpark, run: ctx.openClaude });
    const dark = resolveMode(ctx.settings.theme) === "dark";
    out.push({
      id: "theme:toggle",
      group: "Ações",
      title: dark ? "Usar tema claro" : "Usar tema escuro",
      keywords: "aparência modo cor",
      icon: dark ? IconSun : IconMoon,
      run: () => ctx.onSettingsChange({ theme: dark ? "light" : "dark" }),
    });
    out.push({ id: "sc:add", group: "Ações", title: "Adicionar atalho de site", keywords: "favorito link", icon: IconPlus, run: () => ctx.openSettings("shortcuts", { kind: "new-shortcut" }) });
    out.push({ id: "sc:add-app", group: "Ações", title: "Adicionar atalho de aplicativo", keywords: "programa app exe abrir", icon: IconPlus, run: () => ctx.openSettings("shortcuts", { kind: "new-shortcut", app: true }) });

    list.forEach((s) =>
      out.push({
        id: `sc:${s.id}`,
        group: "Atalhos",
        title: s.name,
        hint: subtitleOf(s),
        icon: () => <ShortcutIconView name={s.name} url={s.url} icon={s.icon} image={s.image} />,
        run: () => void shortcuts.open(s),
      }),
    );

    SECTION_LABELS.forEach(([id, label, kw]) =>
      out.push({ id: `set:${id}`, group: "Ajustes", title: `Ajustes: ${label}`, keywords: kw, icon: IconReturn, run: () => ctx.openSettings(id) }),
    );
    return out;
  }, [pages, pomo.status, pomo.next, m, list, ctx]);

  const q = fold(query.trim());
  const results = useMemo(() => {
    if (!q) return commands.filter((c) => c.group !== "Ajustes");
    const found = commands
      .map((c) => ({ c, s: score(c, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);

    const extra: Command[] = [];
    const url = /\.|^localhost|:/.test(query.trim()) ? normalizeUrl(query) : null;
    if (url) {
      extra.push({ id: "x:open", group: "Sugestão", title: `Abrir ${hostOf(url)}`, hint: "no navegador", icon: IconExternal, pinned: true, run: () => void shortcuts.open({ url }) });
      if (!list.some((s) => s.url === url))
        extra.push({
          id: "x:add",
          group: "Sugestão",
          title: `Adicionar ${nameFromUrl(url) || hostOf(url)} aos atalhos`,
          icon: IconPlus,
          pinned: true,
          run: () => {
            shortcuts.add({ name: nameFromUrl(url) || hostOf(url), url, icon: "site" });
            toast("Atalho adicionado");
          },
        });
    } else if (query.trim().length > 2) {
      extra.push({
        id: "x:ask",
        group: "Sugestão",
        title: `Perguntar ao Claude: “${query.trim()}”`,
        icon: IconSpark,
        pinned: true,
        run: () => {
          claude.ask(query.trim());
          ctx.openClaude();
        },
      });
    }
    return url ? [...extra, ...found] : [...found, ...extra];
  }, [commands, q, query, list, ctx]);

  const safeActive = Math.min(active, Math.max(0, results.length - 1));

  // Mantém o item ativo visível rolando só a lista (nunca a ilha).
  useEffect(() => {
    const listEl = listRef.current;
    const el = listEl?.querySelector<HTMLElement>(`[data-index="${safeActive}"]`);
    if (!listEl || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < listEl.scrollTop + 28) listEl.scrollTop = Math.max(0, top - 28);
    else if (bottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight + 6;
  }, [safeActive, results]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    c.run();
    if (!c.id.startsWith("page:") && !c.id.startsWith("set:") && c.id !== "claude:open" && c.id !== "x:ask" && c.id !== "todo:new" && c.id !== "sc:add") ctx.close();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setActive((safeActive + 1) % Math.max(1, results.length));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setActive((safeActive - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[safeActive]);
    }
  };

  let lastGroup = "";
  return (
    <div className="pal">
      <div className="pal-input">
        <IconSearch />
        <input
          ref={inputRef}
          value={query}
          placeholder="Buscar páginas, ações, atalhos…"
          spellCheck={false}
          aria-label="Buscar comandos"
          aria-controls="pal-list"
          aria-activedescendant={results[safeActive] ? `pal-${results[safeActive].id}` : undefined}
          onPointerDown={focusIsland}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        <kbd className="pal-esc">Esc</kbd>
      </div>

      <div ref={listRef} id="pal-list" className="pal-list scroll-y" role="listbox" aria-label="Resultados">
        {results.length === 0 ? (
          <div className="pal-empty">
            <strong>Nada encontrado</strong>
            <span>Tente outro nome, ou digite um endereço como github.com</span>
          </div>
        ) : (
          results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const IconC = c.icon;
            return (
              <div key={c.id} role="presentation">
                {header && <div className="pal-group">{header}</div>}
                <button
                  id={`pal-${c.id}`}
                  role="option"
                  aria-selected={i === safeActive}
                  data-index={i}
                  className="pal-item"
                  onMouseMove={() => i !== safeActive && setActive(i)}
                  onClick={() => run(c)}
                  tabIndex={-1}
                >
                  <span className="pal-icon">
                    <IconC />
                  </span>
                  <span className="pal-title">{c.title}</span>
                  {c.hint && <span className="pal-hint">{c.hint}</span>}
                </button>
              </div>
            );
          })
        )}
      </div>

      <footer className="pal-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navegar
        </span>
        <span>
          <kbd>Enter</kbd> abrir
        </span>
        <span>
          <kbd>Esc</kbd> fechar
        </span>
      </footer>
    </div>
  );
}
