import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type SVGProps } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/native";
import { useCommitCount } from "../../perf/hooks";
import {
  IconBook,
  IconCalendar,
  IconCart,
  IconChat,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconDoc,
  IconGlobe,
  IconGrip,
  IconHome,
  IconMail,
  IconMusic,
  IconPencil,
  IconPlus,
  IconSearch,
  IconStar,
  IconTrash,
  IconVideo,
} from "../../island/icons";
import { toast } from "../../island/toast";
import { requestSettings } from "../../island/settingsNav";
import { useSortable } from "../../lib/useSortable";
import { focusIsland } from "../claude/store";
import {
  GLYPHS,
  SUGGESTIONS,
  appIcon,
  faviconOf,
  hostOf,
  isApp,
  listApps,
  nameFromPath,
  nameFromUrl,
  normalizeUrl,
  shortcuts,
  subtitleOf,
  useShortcuts,
  type AppEntry,
  type GlyphId,
  type Shortcut,
  type ShortcutIcon,
} from "./store";

const GLYPH_ICONS: Record<GlyphId, ComponentType<SVGProps<SVGSVGElement>>> = {
  globe: IconGlobe,
  mail: IconMail,
  code: IconCode,
  chat: IconChat,
  video: IconVideo,
  music: IconMusic,
  doc: IconDoc,
  cart: IconCart,
  star: IconStar,
  home: IconHome,
  book: IconBook,
  calendar: IconCalendar,
};

const GLYPH_NAMES: Record<GlyphId, string> = {
  globe: "Globo",
  mail: "E-mail",
  code: "Código",
  chat: "Conversa",
  video: "Vídeo",
  music: "Música",
  doc: "Documento",
  cart: "Compras",
  star: "Favorito",
  home: "Início",
  book: "Leitura",
  calendar: "Agenda",
};

/** Favicons que falharam nesta sessão: não tenta de novo (evita piscar). */
const brokenFavicons = new Set<string>();

/** Ícone do atalho: favicon do site (cai para a inicial se não carregar), inicial ou símbolo. */
export const ShortcutIconView = memo(function ShortcutIconView({
  name,
  url,
  icon,
  image,
}: {
  name: string;
  url: string;
  icon: ShortcutIcon;
  /** Ícone do app (data URL). */
  image?: string | null;
}) {
  const fav = icon === "site" ? faviconOf(url) : null;
  const [failed, setFailed] = useState(() => (fav ? brokenFavicons.has(fav) : false));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setFailed(fav ? brokenFavicons.has(fav) : false);
    setLoaded(false);
  }, [fav]);

  if (icon === "app") {
    return (
      <span className="sc-icon sc-icon--app" data-loaded={image ? "" : undefined} aria-hidden>
        <span className="sc-letter">{(name.trim()[0] ?? "?").toUpperCase()}</span>
        {image && <img src={image} alt="" draggable={false} decoding="async" />}
      </span>
    );
  }
  if (icon !== "site" && icon !== "letter") {
    const Glyph = GLYPH_ICONS[icon] ?? IconGlobe;
    return (
      <span className="sc-icon sc-icon--glyph" aria-hidden>
        <Glyph />
      </span>
    );
  }
  const letter = (name.trim()[0] ?? hostOf(url)[0] ?? "?").toUpperCase();
  return (
    <span className="sc-icon" data-loaded={(fav && !failed && loaded) || undefined} aria-hidden>
      <span className="sc-letter">{letter}</span>
      {fav && !failed && (
        <img
          src={fav}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={(e) => {
            // Alguns sites devolvem 1×1 ou imagem vazia: trata como falha.
            if (e.currentTarget.naturalWidth < 8) {
              brokenFavicons.add(fav);
              setFailed(true);
            } else setLoaded(true);
          }}
          onError={() => {
            brokenFavicons.add(fav);
            setFailed(true);
          }}
        />
      )}
    </span>
  );
});

/* ═════════ Página do expandido ═════════ */

export function ShortcutsPage() {
  useCommitCount("ShortcutsPage");
  const list = useShortcuts();
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ l: boolean; r: boolean }>({ l: false, r: false });

  // Fades das pontas só quando há mais itens que espaço (mede quando a lista muda e ao rolar).
  const measure = () => {
    const el = rowRef.current;
    if (!el) return;
    const l = el.scrollLeft > 2;
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((p) => (p.l === l && p.r === r ? p : { l, r }));
  };
  useLayoutEffect(measure, [list]);

  /** Rola uma "tela" de atalhos para o lado (as setas da barra). */
  const page = (dir: 1 | -1) => {
    const el = rowRef.current;
    if (el) el.scrollBy({ left: dir * (el.clientWidth - 48), behavior: "smooth" });
  };

  if (list.length === 0) {
    return (
      <div className="scp scp--empty">
        <div className="scp-empty-text">
          <strong>Sites e apps a um clique</strong>
          <span>Adicione atalhos para os sites e programas que você mais usa.</span>
        </div>
        <div className="scp-suggest">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.url}
              className="chip"
              onClick={() => {
                shortcuts.add(s);
                toast(`${s.name} adicionado`);
              }}
              title={`Adicionar ${hostOf(s.url)}`}
            >
              <IconPlus /> {s.name}
            </button>
          ))}
          <button className="chip" onClick={() => requestSettings("shortcuts", { kind: "new-shortcut" })}>
            Outro site…
          </button>
          <button className="chip chip--accent" onClick={() => requestSettings("shortcuts", { kind: "new-shortcut", app: true })}>
            Aplicativo…
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="scp">
      <div className="scp-bar">
        <span className="scp-count">
          {list.length} {list.length === 1 ? "atalho" : "atalhos"}
        </span>
        <div className="scp-tools">
          {(edges.l || edges.r) && (
            <>
              <button className="icon-btn icon-btn--ghost scp-nav" onClick={() => page(-1)} disabled={!edges.l} aria-label="Atalhos anteriores" title="Anteriores">
                <IconChevronLeft />
              </button>
              <button className="icon-btn icon-btn--ghost scp-nav" onClick={() => page(1)} disabled={!edges.r} aria-label="Mais atalhos" title="Mais">
                <IconChevronRight />
              </button>
            </>
          )}
          <button className="link-btn" onClick={() => requestSettings("shortcuts")}>
            Gerenciar
          </button>
        </div>
      </div>
      <div
        ref={rowRef}
        className="scp-row"
        data-fade-l={edges.l || undefined}
        data-fade-r={edges.r || undefined}
        onScroll={measure}
        onWheel={(e) => {
          // Roda do mouse rola na horizontal.
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {list.map((s) => (
          <button key={s.id} className="sc-tile" onClick={() => void shortcuts.open(s)} title={`${s.name} — ${subtitleOf(s)}`}>
            <ShortcutIconView name={s.name} url={s.url} icon={s.icon} image={s.image} />
            <span className="sc-name">{s.name}</span>
          </button>
        ))}
        {!shortcuts.full() && (
          <button className="sc-tile sc-tile--add" onClick={() => requestSettings("shortcuts", { kind: "new-shortcut" })} title="Adicionar atalho">
            <span className="sc-icon" aria-hidden>
              <IconPlus />
            </span>
            <span className="sc-name">Adicionar</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ═════════ Gerenciador (seção dos ajustes) ═════════ */

type Editing = { kind: "new"; url?: string; app?: boolean } | { kind: "edit"; id: string } | null;

export function ShortcutsManager({ initial }: { initial: Editing }) {
  const list = useShortcuts();
  const [editing, setEditing] = useState<Editing>(initial);
  const { containerRef, handleProps } = useSortable("y", list.length, shortcuts.move);

  useEffect(() => {
    if (initial) setEditing(initial);
  }, [initial]);

  if (editing) {
    const item = editing.kind === "edit" ? list.find((s) => s.id === editing.id) : undefined;
    const appMode = item ? isApp(item) : editing.kind === "new" && !!editing.app;
    const props = { item, onDone: () => setEditing(null) };
    return appMode ? (
      <AppForm key={item?.id ?? "new-app"} {...props} onSwitch={item ? undefined : () => setEditing({ kind: "new" })} />
    ) : (
      <ShortcutForm
        key={item?.id ?? "new"}
        {...props}
        initialUrl={editing.kind === "new" ? editing.url : undefined}
        onSwitch={item ? undefined : () => setEditing({ kind: "new", app: true })}
      />
    );
  }

  return (
    <div className="scm">
      <div className="scm-head">
        <p className="section-hint">Arraste pela alça para reordenar. Sites abrem no navegador padrão; apps, direto no Windows.</p>
        <button className="btn btn--ghost btn--sm" onClick={() => setEditing({ kind: "new", app: true })} disabled={shortcuts.full()}>
          <IconPlus /> App
        </button>
        <button className="btn btn--primary btn--sm" onClick={() => setEditing({ kind: "new" })} disabled={shortcuts.full()}>
          <IconPlus /> Site
        </button>
      </div>
      {list.length === 0 ? (
        <div className="empty-card">
          <strong>Nenhum atalho ainda</strong>
          <span>Adicione um site ou um aplicativo do seu PC.</span>
        </div>
      ) : (
        <ul className="sort-list card" ref={containerRef as React.RefObject<HTMLUListElement>}>
          {list.map((s, i) => (
            <li key={s.id} className="sort-row" data-sort-item>
              <span className="grip" tabIndex={0} role="button" aria-label={`Mover ${s.name} (Alt + setas)`} title="Arrastar para reordenar" {...handleProps(i)}>
                <IconGrip />
              </span>
              <ShortcutIconView name={s.name} url={s.url} icon={s.icon} image={s.image} />
              <span className="sort-text">
                <strong>{s.name}</strong>
                <em>{subtitleOf(s)}</em>
              </span>
              <button className="icon-btn icon-btn--ghost" onClick={() => setEditing({ kind: "edit", id: s.id })} aria-label={`Editar ${s.name}`} title="Editar">
                <IconPencil />
              </button>
              <button
                className="icon-btn icon-btn--ghost icon-btn--danger"
                onClick={() => {
                  const undo = shortcuts.remove(s.id);
                  toast(`${s.name} removido`, { label: "Desfazer", run: undo });
                }}
                aria-label={`Remover ${s.name}`}
                title="Remover"
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Site | Aplicativo, no topo do formulário de novo atalho. */
function KindSwitch({ value, onSwitch }: { value: "site" | "app"; onSwitch?: () => void }) {
  if (!onSwitch) return null;
  return (
    <div className="segmented scf-kind" role="radiogroup" aria-label="Tipo de atalho" style={{ "--count": 2, "--index": value === "site" ? 0 : 1 } as React.CSSProperties}>
      <span className="segmented-thumb" aria-hidden />
      <button role="radio" aria-checked={value === "site"} onClick={value === "site" ? undefined : onSwitch}>
        Site
      </button>
      <button role="radio" aria-checked={value === "app"} onClick={value === "app" ? undefined : onSwitch}>
        Aplicativo
      </button>
    </div>
  );
}

function ShortcutForm({ item, initialUrl, onDone, onSwitch }: { item?: Shortcut; initialUrl?: string; onDone: () => void; onSwitch?: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [url, setUrl] = useState(item?.url ?? initialUrl ?? "");
  const [icon, setIcon] = useState<ShortcutIcon>(item?.icon ?? "site");
  const [touched, setTouched] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      focusIsland();
      urlRef.current?.focus({ preventScroll: true });
    }, 80);
    return () => window.clearTimeout(t);
  }, []);

  const normalized = normalizeUrl(url);
  const finalName = name.trim() || (normalized ? nameFromUrl(normalized) : "");
  const error = touched && url.trim() && !normalized ? "Endereço inválido. Ex.: github.com" : null;

  const save = () => {
    setTouched(true);
    if (!normalized || !finalName) return;
    if (item) {
      shortcuts.update(item.id, { name: finalName, url: normalized, icon });
      toast("Atalho atualizado");
    } else {
      shortcuts.add({ name: finalName, url: normalized, icon });
      toast(`${finalName} adicionado`);
    }
    onDone();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    }
  };

  const ICON_OPTIONS: { id: ShortcutIcon; label: string }[] = [
    { id: "site", label: "Ícone do site" },
    { id: "letter", label: "Inicial" },
    ...GLYPHS.map((g) => ({ id: g as ShortcutIcon, label: GLYPH_NAMES[g] })),
  ];

  return (
    <div className="scf">
      <KindSwitch value="site" onSwitch={onSwitch} />
      <div className="scf-preview">
        <ShortcutIconView name={finalName || "?"} url={normalized ?? ""} icon={icon} />
        <span>
          <strong>{finalName || "Novo atalho"}</strong>
          <em>{normalized ? hostOf(normalized) : "endereço do site"}</em>
        </span>
      </div>

      <label className="field">
        <span>Endereço</span>
        <input
          ref={urlRef}
          className="input"
          value={url}
          placeholder="github.com"
          spellCheck={false}
          aria-invalid={!!error}
          onPointerDown={focusIsland}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={onKey}
        />
        {error && <em className="field-error">{error}</em>}
      </label>

      <label className="field">
        <span>Nome</span>
        <input
          className="input"
          value={name}
          placeholder={normalized ? nameFromUrl(normalized) : "Como vai aparecer na ilha"}
          maxLength={24}
          spellCheck={false}
          onPointerDown={focusIsland}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
        />
      </label>

      <div className="field">
        <span>Ícone</span>
        <div className="icon-pick" role="radiogroup" aria-label="Ícone do atalho">
          {ICON_OPTIONS.map((o) => (
            <button key={o.id} role="radio" aria-checked={icon === o.id} title={o.label} aria-label={o.label} onClick={() => setIcon(o.id)}>
              <ShortcutIconView name={finalName || "?"} url={normalized ?? ""} icon={o.id} />
            </button>
          ))}
        </div>
      </div>

      <footer className="form-foot">
        <button className="btn btn--ghost" onClick={onDone}>
          Cancelar
        </button>
        <button className="btn btn--primary" onClick={save} disabled={!normalized || !finalName}>
          {item ? "Salvar" : "Adicionar"}
        </button>
      </footer>
    </div>
  );
}

/* ═════════ Formulário de aplicativo ═════════ */

/** Ícone de um app da lista, pedido ao Windows só quando a linha aparece. */
function AppRowIcon({ target, name }: { target: string; name: string }) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void appIcon(target).then((i) => alive && setImg(i));
    return () => {
      alive = false;
    };
  }, [target]);
  return <ShortcutIconView name={name} url="" icon="app" image={img} />;
}

function AppForm({ item, onDone, onSwitch }: { item?: Shortcut; onDone: () => void; onSwitch?: () => void }) {
  const [apps, setApps] = useState<AppEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<AppEntry | null>(item ? { name: item.name, target: item.url } : null);
  const [name, setName] = useState(item?.name ?? "");
  const [image, setImage] = useState<string | null>(item?.image ?? null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    listApps()
      .then((list) => alive && setApps(list))
      .catch(() => alive && setError("Não consegui ler os apps instalados. Use Procurar…"));
    const t = window.setTimeout(() => {
      focusIsland();
      searchRef.current?.focus({ preventScroll: true });
    }, 80);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);

  // Ícone do escolhido, guardado junto do atalho.
  useEffect(() => {
    if (!picked) return;
    let alive = true;
    void appIcon(picked.target).then((i) => alive && setImage(i));
    return () => {
      alive = false;
    };
  }, [picked]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = apps ?? [];
    return (q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list).slice(0, 60);
  }, [apps, query]);

  const pick = (a: AppEntry) => {
    setPicked(a);
    setName(a.name);
  };

  const browse = async () => {
    if (!isTauri) return;
    try {
      const path = await invoke<string | null>("plugin:dialog|open", {
        options: { multiple: false, title: "Escolha o aplicativo", filters: [{ name: "Aplicativos", extensions: ["exe", "lnk", "appref-ms", "bat", "cmd"] }] },
      });
      if (typeof path === "string" && path) pick({ name: nameFromPath(path), target: path });
    } catch (err) {
      console.error("seletor de app falhou", err);
    }
  };

  const finalName = name.trim() || picked?.name || "";
  const save = () => {
    if (!picked || !finalName) return;
    const data = { name: finalName.slice(0, 24), url: picked.target, icon: "app" as const, kind: "app" as const, image };
    if (item) {
      shortcuts.update(item.id, data);
      toast("Atalho atualizado");
    } else {
      shortcuts.add(data);
      toast(`${data.name} adicionado`);
    }
    onDone();
  };

  return (
    <div className="scf">
      <KindSwitch value="app" onSwitch={onSwitch} />
      <div className="scf-preview">
        <ShortcutIconView name={finalName || "?"} url="" icon="app" image={picked ? image : null} />
        <span>
          <strong>{finalName || "Escolha um aplicativo"}</strong>
          <em>{picked ? (picked.target.toLowerCase().startsWith("shell:") ? "Menu Iniciar" : picked.target) : "da lista abaixo ou Procurar…"}</em>
        </span>
      </div>

      <div className="scf-search">
        <IconSearch />
        <input
          ref={searchRef}
          className="input input--bare"
          value={query}
          placeholder={apps ? `Buscar entre ${apps.length} apps` : "Carregando apps…"}
          spellCheck={false}
          onPointerDown={focusIsland}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered[0]) pick(filtered[0]);
          }}
        />
        <button className="btn btn--ghost btn--sm" onClick={() => void browse()}>
          Procurar…
        </button>
      </div>

      <ul className="app-list" aria-busy={!apps && !error}>
        {error ? (
          <li className="app-note">{error}</li>
        ) : !apps ? (
          Array.from({ length: 4 }, (_, i) => <li key={i} className="app-row app-row--skeleton" aria-hidden />)
        ) : filtered.length === 0 ? (
          <li className="app-note">Nenhum app com esse nome. Tente Procurar…</li>
        ) : (
          filtered.map((a) => (
            <li key={a.target}>
              <button className="app-row" aria-pressed={picked?.target === a.target} onClick={() => pick(a)}>
                <AppRowIcon target={a.target} name={a.name} />
                <span>{a.name}</span>
              </button>
            </li>
          ))
        )}
      </ul>

      <label className="field field--inline">
        <span>Nome</span>
        <input
          className="input"
          value={name}
          placeholder={picked?.name ?? "Como vai aparecer na ilha"}
          maxLength={24}
          spellCheck={false}
          onPointerDown={focusIsland}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </label>

      <footer className="form-foot">
        <button className="btn btn--ghost" onClick={onDone}>
          Cancelar
        </button>
        <button className="btn btn--primary" onClick={save} disabled={!picked || !finalName}>
          {item ? "Salvar" : "Adicionar"}
        </button>
      </footer>
    </div>
  );
}
