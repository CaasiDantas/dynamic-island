import { useCommitCount } from "../perf/hooks";
import { useEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode, type SVGProps } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri, quitApp, setGlobalHotkey } from "../lib/native";
import { checkForUpdate, installUpdate, updatesSupported, useUpdate } from "../features/update/store";
import {
  ACCENT_PRESETS,
  SURFACE_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_HOTKEY,
  type CompactFace,
  type RestStyle,
  type IslandSize,
  type IslandStyle,
  type PageId,
  type Settings,
  type ThemeMode,
} from "../lib/settings";
import { applyAppearance, savedThemes, useSavedThemes } from "../lib/theme";
import { captureHotkey, LOCAL_KEYS } from "../lib/keys";
import { useSortable } from "../lib/useSortable";
import {
  IconBell,
  IconDownload,
  IconChevronLeft,
  IconClose,
  IconEye,
  IconEyeOff,
  IconGrid,
  IconGrip,
  IconKeyboard,
  IconLayout,
  IconMonitor,
  IconMoon,
  IconPalette,
  IconPower,
  IconReset,
  IconSliders,
  IconStar,
  IconSun,
} from "./icons";
import { setSourceEnabled, useNotifySources } from "../features/notify/store";
import { PAGE_DEFS } from "./pages";
import { ColorPicker } from "./ColorPicker";
import { consumeIntent, setSettingsSection, useSettingsNav, type SettingsSection } from "./settingsNav";
import { ShortcutsManager } from "../features/shortcuts/ShortcutsUI";
import { toast } from "./toast";
import { focusIsland } from "../features/claude/store";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const SECTIONS: { id: SettingsSection; label: string; icon: Icon }[] = [
  { id: "appearance", label: "Aparência", icon: IconPalette },
  { id: "island", label: "Ilha", icon: IconLayout },
  { id: "pages", label: "Páginas", icon: IconGrid },
  { id: "shortcuts", label: "Atalhos", icon: IconStar },
  { id: "keyboard", label: "Teclado", icon: IconKeyboard },
  { id: "notifications", label: "Notificações", icon: IconBell },
  { id: "general", label: "Geral", icon: IconSliders },
];

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onBack: () => void;
}

export function SettingsView({ settings, onChange, onBack }: Props) {
  useCommitCount("SettingsView");
  const nav = useSettingsNav();
  const current = SECTIONS.find((s) => s.id === nav.section) ?? SECTIONS[0];

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Seções dos ajustes">
        <div className="settings-nav-head">
          <button className="icon-btn icon-btn--ghost" onClick={onBack} aria-label="Voltar" title="Voltar (Esc)">
            <IconChevronLeft />
          </button>
          <h1>Ajustes</h1>
        </div>
        {SECTIONS.map((s) => (
          <button key={s.id} className="nav-item" aria-current={s.id === current.id ? "page" : undefined} onClick={() => setSettingsSection(s.id)}>
            <s.icon />
            {s.label}
          </button>
        ))}
        <VersionTag />
      </nav>

      <section className="settings-main" key={current.id}>
        <h2 className="settings-title">{current.label}</h2>
        <div className="settings-body scroll-y">
          {current.id === "appearance" && <AppearanceSection settings={settings} onChange={onChange} />}
          {current.id === "island" && <IslandSection settings={settings} onChange={onChange} />}
          {current.id === "pages" && <PagesSection settings={settings} onChange={onChange} />}
          {current.id === "shortcuts" && <ShortcutsSection seq={nav.seq} />}
          {current.id === "keyboard" && <KeyboardSection settings={settings} onChange={onChange} />}
          {current.id === "notifications" && <NotifySection />}
          {current.id === "general" && <GeneralSection settings={settings} onChange={onChange} />}
        </div>
      </section>
    </div>
  );
}

type SectionProps = { settings: Settings; onChange: (patch: Partial<Settings>) => void };

/* ═════════ Aparência ═════════ */

const THEMES: { id: ThemeMode; label: string; icon: Icon }[] = [
  { id: "dark", label: "Escuro", icon: IconMoon },
  { id: "light", label: "Claro", icon: IconSun },
  { id: "system", label: "Sistema", icon: IconMonitor },
];

function AppearanceSection({ settings, onChange }: SectionProps) {
  const saved = useSavedThemes();
  const [themeName, setThemeName] = useState("");
  const isPreset = ACCENT_PRESETS.some((p) => p.color.toLowerCase() === settings.accent.toLowerCase());
  const isDefault =
    settings.theme === DEFAULT_APPEARANCE.theme &&
    settings.accent.toLowerCase() === DEFAULT_APPEARANCE.accent &&
    settings.surface === DEFAULT_APPEARANCE.surface &&
    settings.surfaceOpacity === DEFAULT_APPEARANCE.surfaceOpacity &&
    settings.glow === DEFAULT_APPEARANCE.glow;

  const appearance = { theme: settings.theme, accent: settings.accent, surface: settings.surface, surfaceOpacity: settings.surfaceOpacity, glow: settings.glow };

  return (
    <>
      <Group title="Tema">
        <Row label="Modo" hint="Sistema segue o Windows">
          <Segmented options={THEMES} value={settings.theme} onChange={(theme) => onChange({ theme })} label="Modo de cor" />
        </Row>
      </Group>

      <Group title="Cor principal" aside={<code className="mono-tag">{settings.accent.toUpperCase()}</code>}>
        <div className="pad">
          <div className="swatches" role="radiogroup" aria-label="Cores sugeridas">
            {ACCENT_PRESETS.map((a) => (
              <button
                key={a.color}
                role="radio"
                aria-checked={settings.accent.toLowerCase() === a.color}
                aria-label={a.name}
                title={a.name}
                className="swatch"
                style={{ "--swatch": a.color } as CSSProperties}
                onClick={() => onChange({ accent: a.color })}
              />
            ))}
            <span
              className="swatch swatch--custom"
              data-on={!isPreset || undefined}
              style={{ "--swatch": settings.accent } as CSSProperties}
              title="Cor personalizada"
              aria-hidden
            />
          </div>
          <ColorPicker
            value={settings.accent}
            onPreview={(accent) => applyAppearance({ ...appearance, accent })}
            onCommit={(accent) => onChange({ accent })}
          />
          <ThemePreview />
        </div>
      </Group>

      <Group title="Fundo da ilha" aside={<code className="mono-tag">{settings.surface ? settings.surface.toUpperCase() : "Automático"}</code>}>
        <div className="pad">
          <div className="swatches" role="radiogroup" aria-label="Fundos sugeridos">
            <button
              role="radio"
              aria-checked={!settings.surface}
              aria-label="Automático (segue o modo)"
              title="Automático (segue o modo)"
              className="swatch swatch--auto"
              onClick={() => onChange({ surface: "" })}
            />
            {SURFACE_PRESETS.map((a) => (
              <button
                key={a.color}
                role="radio"
                aria-checked={settings.surface.toLowerCase() === a.color}
                aria-label={a.name}
                title={a.name}
                className="swatch swatch--surface"
                style={{ "--swatch": a.color } as CSSProperties}
                onClick={() => onChange({ surface: a.color })}
              />
            ))}
          </div>
          <ColorPicker
            value={settings.surface || "#000000"}
            onPreview={(surface) => applyAppearance({ ...appearance, surface })}
            onCommit={(surface) => onChange({ surface })}
          />
          <p className="section-hint">O texto fica claro ou escuro sozinho, conforme o fundo.</p>
        </div>
      </Group>

      <Group title="Superfície">
        <Row label="Opacidade da ilha" hint={`${Math.round(settings.surfaceOpacity * 100)}%`}>
          <Slider min={70} max={100} value={Math.round(settings.surfaceOpacity * 100)} onChange={(v) => onChange({ surfaceOpacity: v / 100 })} label="Opacidade da ilha" />
        </Row>
        <Row label="Brilho de fundo" hint={settings.glow === 0 ? "Desligado" : `${Math.round(settings.glow * 100)}%`}>
          <Slider min={0} max={100} value={Math.round(settings.glow * 100)} onChange={(v) => onChange({ glow: v / 100 })} label="Intensidade do degradê de fundo" />
        </Row>
      </Group>

      <Group title="Temas salvos">
        <div className="pad">
          {saved.length > 0 && (
            <div className="theme-list">
              {saved.map((t, i) => (
                <span key={t.id} className="theme-chip">
                  <button
                    onClick={() => {
                      onChange({ theme: t.theme, accent: t.accent, surface: t.surface ?? "", surfaceOpacity: t.surfaceOpacity, glow: t.glow });
                      toast(`Tema “${t.name}” aplicado`);
                    }}
                    title={`Aplicar ${t.name}`}
                  >
                    <i style={{ "--swatch": t.accent } as CSSProperties} data-mode={t.theme} />
                    {t.name}
                  </button>
                  <button
                    className="theme-chip-x"
                    aria-label={`Excluir ${t.name}`}
                    title="Excluir"
                    onClick={() => {
                      savedThemes.remove(t.id);
                      toast(`“${t.name}” excluído`, { label: "Desfazer", run: () => savedThemes.restore(t, i) });
                    }}
                  >
                    <IconClose />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const t = savedThemes.add(themeName, appearance);
              setThemeName("");
              toast(`Tema “${t.name}” salvo`);
            }}
          >
            <input
              className="input"
              value={themeName}
              placeholder="Nome do tema atual"
              maxLength={24}
              spellCheck={false}
              onPointerDown={focusIsland}
              onChange={(e) => setThemeName(e.target.value)}
            />
            <button className="btn btn--secondary" type="submit">
              Salvar
            </button>
          </form>
        </div>
      </Group>

      <div className="section-foot">
        <button
          className="btn btn--ghost"
          disabled={isDefault}
          onClick={() => {
            const prev = appearance;
            onChange({ ...DEFAULT_APPEARANCE });
            toast("Aparência padrão restaurada", { label: "Desfazer", run: () => onChange(prev) });
          }}
        >
          <IconReset /> Restaurar padrão
        </button>
      </div>
    </>
  );
}

/** Amostra dos componentes com a cor atual: mostra a harmonia antes de sair dos ajustes. */
function ThemePreview() {
  return (
    <div className="preview" aria-hidden>
      <span className="btn btn--primary btn--sm">Primário</span>
      <span className="btn btn--secondary btn--sm">Secundário</span>
      <span className="chip chip--accent">Selecionado</span>
      <span className="switch" role="presentation" aria-checked="true">
        <span className="switch-knob" />
      </span>
      <span className="preview-bar">
        <i />
      </span>
      <span className="preview-link">Link</span>
    </div>
  );
}

/* ═════════ Ilha ═════════ */

const STYLES: { id: IslandStyle; label: string }[] = [
  { id: "notch", label: "Notch" },
  { id: "floating", label: "Flutuante" },
];

const FACES: { id: CompactFace; label: string }[] = [
  { id: "clock", label: "Relógio" },
  { id: "minimal", label: "Mínima" },
];

const RESTS: { id: RestStyle; label: string }[] = [
  { id: "drop", label: "Gota" },
  { id: "line", label: "Fio" },
  { id: "off", label: "Desligado" },
];

const REST_HINT: Record<RestStyle, string> = {
  drop: "Notch baixinho; mouse em cima mostra a ilha, clique abre",
  line: "Linha fina na borda; mouse em cima mostra a ilha, clique abre",
  off: "Sempre no tamanho fechado",
};

const SIZES: { id: IslandSize; label: string }[] = [
  { id: "compact", label: "Compacta" },
  { id: "default", label: "Padrão" },
  { id: "wide", label: "Ampla" },
];

function IslandSection({ settings, onChange }: SectionProps) {
  return (
    <>
      <Group title="Forma">
        <Row label="Estilo" hint={settings.style === "notch" ? "Colada no topo da tela" : "Solta, abaixo do topo"}>
          <Segmented options={STYLES} value={settings.style} onChange={(style) => onChange({ style })} label="Estilo da ilha" />
        </Row>
        <Row label="Tamanho">
          <Segmented options={SIZES} value={settings.size} onChange={(size) => onChange({ size })} label="Tamanho da ilha" />
        </Row>
        {settings.style === "floating" && (
          <Row label="Distância do topo" hint={`${settings.topOffset}px`}>
            <Slider min={0} max={32} value={settings.topOffset} onChange={(topOffset) => onChange({ topOffset })} label="Distância do topo da tela" />
          </Row>
        )}
      </Group>
      <Group title="Fechada">
        <Row label="Parada" hint={REST_HINT[settings.restShape]}>
          <Segmented options={RESTS} value={settings.restShape} onChange={(restShape) => onChange({ restShape })} label="Forma da ilha parada" />
        </Row>
        <Row label="Conteúdo" hint={settings.compactFace === "clock" ? "Hora no centro" : "Só indicadores"}>
          <Segmented options={FACES} value={settings.compactFace} onChange={(compactFace) => onChange({ compactFace })} label="Conteúdo da ilha fechada" />
        </Row>
        {settings.compactFace === "clock" && (
          <Row label="Clima ao lado da hora" hint="Música tocando ocupa o lugar dele">
            <Switch checked={settings.compactWeather} onChange={(compactWeather) => onChange({ compactWeather })} label="Clima ao lado da hora" />
          </Row>
        )}
      </Group>
      <Group title="Clima">
        <Row label="Cidade" hint={settings.weatherCity ? "Fixa" : "Automática, pela sua conexão"}>
          <CityField value={settings.weatherCity} onCommit={(weatherCity) => onChange({ weatherCity })} />
        </Row>
      </Group>
    </>
  );
}

/** Só aplica ao sair do campo ou com Enter: cada troca de cidade busca o clima de novo. */
function CityField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="input input--city"
      value={draft}
      placeholder="Automática"
      maxLength={48}
      spellCheck={false}
      aria-label="Cidade do clima"
      onPointerDown={focusIsland}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

/* ═════════ Páginas ═════════ */

function PagesSection({ settings, onChange }: SectionProps) {
  const order = settings.pageOrder;
  const move = (from: number, to: number) => {
    const next = [...order];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    onChange({ pageOrder: next });
  };
  const { containerRef, handleProps } = useSortable("y", order.length, move);
  const visibleCount = order.filter((p) => !settings.hiddenPages.includes(p)).length;

  const toggle = (id: PageId) => {
    const hidden = settings.hiddenPages.includes(id) ? settings.hiddenPages.filter((p) => p !== id) : [...settings.hiddenPages, id];
    onChange({ hiddenPages: hidden, startPage: hidden.includes(settings.startPage as PageId) ? "last" : settings.startPage });
  };

  const startOptions = useMemo(
    () => [{ id: "last", label: "Última usada" }, ...order.filter((p) => !settings.hiddenPages.includes(p)).map((p) => ({ id: p, label: PAGE_DEFS[p].title }))],
    [order, settings.hiddenPages],
  );

  return (
    <>
      <p className="section-hint">A ordem aqui é a ordem das abas. Arraste pela alça ou use Alt + setas.</p>
      <ul className="sort-list card" ref={containerRef as React.RefObject<HTMLUListElement>}>
        {order.map((id, i) => {
          const def = PAGE_DEFS[id];
          const hidden = settings.hiddenPages.includes(id);
          const last = !hidden && visibleCount === 1;
          return (
            <li key={id} className="sort-row" data-sort-item data-muted={hidden || undefined}>
              <span className="grip" tabIndex={0} role="button" aria-label={`Mover ${def.title} (Alt + setas)`} title="Arrastar para reordenar" {...handleProps(i)}>
                <IconGrip />
              </span>
              <span className="sort-icon">
                <def.icon />
              </span>
              <span className="sort-text">
                <strong>{def.title}</strong>
                <em>{hidden ? "Oculta" : `Ctrl+${order.filter((p) => !settings.hiddenPages.includes(p)).indexOf(id) + 1}`}</em>
              </span>
              <button
                className="icon-btn icon-btn--ghost"
                onClick={() => toggle(id)}
                disabled={last}
                aria-pressed={!hidden}
                aria-label={hidden ? `Mostrar ${def.title}` : `Ocultar ${def.title}`}
                title={last ? "Pelo menos uma página fica visível" : hidden ? "Mostrar" : "Ocultar"}
              >
                {hidden ? <IconEyeOff /> : <IconEye />}
              </button>
            </li>
          );
        })}
      </ul>
      <Group title="Ao abrir">
        <Row label="Página inicial">
          <select className="select" value={settings.startPage} onChange={(e) => onChange({ startPage: e.target.value as Settings["startPage"] })} aria-label="Página ao abrir a ilha">
            {startOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
      </Group>
    </>
  );
}

/* ═════════ Atalhos ═════════ */

function ShortcutsSection({ seq }: { seq: number }) {
  // Pedido vindo de fora (ex.: "Adicionar" na página): abre direto no formulário.
  const [initial, setInitial] = useState<Parameters<typeof ShortcutsManager>[0]["initial"]>(null);
  useEffect(() => {
    const i = consumeIntent();
    if (i?.kind === "new-shortcut") setInitial({ kind: "new", url: i.url, app: i.app });
    else if (i?.kind === "edit-shortcut") setInitial({ kind: "edit", id: i.id });
  }, [seq]);
  return <ShortcutsManager initial={initial} />;
}

/* ═════════ Teclado ═════════ */

function KeyboardSection({ settings, onChange }: SectionProps) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    focusIsland();
    // Enquanto grava, o atalho atual sai do ar (senão a própria combinação abriria a paleta).
    const previous = settings.hotkey;
    let replaced = false;
    void setGlobalHotkey(null);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey) {
        setRecording(false);
        setHint(null);
        return;
      }
      const r = captureHotkey(e);
      if (r.kind === "partial") return setHint(r.label);
      if (r.kind === "invalid") return setHint(r.reason);
      replaced = true;
      setRecording(false);
      setHint(null);
      void setGlobalHotkey(r.hotkey).then((ok) => {
        if (ok) {
          onChange({ hotkey: r.hotkey });
          toast(`Atalho global: ${r.hotkey.label}`);
        } else {
          setHint(`${r.hotkey.label} já é usado por outro app`);
          // Volta a registrar o anterior.
          void setGlobalHotkey(previous);
        }
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (!replaced) void setGlobalHotkey(previous);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao começar/parar de gravar
  }, [recording]);

  return (
    <>
      <Group title="Atalho global">
        <Row label="Abrir a paleta" hint="Funciona em qualquer app">
          <div className="hotkey">
            <button className="kbd-btn" data-recording={recording || undefined} onClick={() => setRecording((r) => !r)} aria-label="Gravar atalho global">
              {recording ? hint ?? "Pressione a combinação…" : settings.hotkey ? <Kbd keys={settings.hotkey.label} /> : "Desligado"}
            </button>
            {settings.hotkey && !recording && (
              <button
                className="icon-btn icon-btn--ghost"
                aria-label="Desligar atalho global"
                title="Desligar"
                onClick={() => {
                  void setGlobalHotkey(null);
                  onChange({ hotkey: null });
                }}
              >
                <IconClose />
              </button>
            )}
          </div>
        </Row>
        {!recording && hint && <p className="field-error pad-x">{hint}</p>}
        {settings.hotkey?.label !== DEFAULT_HOTKEY.label && !recording && (
          <div className="pad-x pad-b">
            <button
              className="link-btn"
              onClick={() =>
                void setGlobalHotkey(DEFAULT_HOTKEY).then((ok) => {
                  if (ok) onChange({ hotkey: DEFAULT_HOTKEY });
                  else setHint(`${DEFAULT_HOTKEY.label} já é usado por outro app`);
                })
              }
            >
              Usar o padrão ({DEFAULT_HOTKEY.label})
            </button>
          </div>
        )}
      </Group>
      <Group title="Dentro da ilha">
        {LOCAL_KEYS.map((k) => (
          <Row key={k.keys} label={k.label}>
            <Kbd keys={k.keys} />
          </Row>
        ))}
      </Group>
    </>
  );
}

export function Kbd({ keys }: { keys: string }) {
  return (
    <span className="kbd">
      {keys.split("+").map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

/* ═════════ Notificações ═════════ */

/** Cada app/site que já mandou aviso aparece aqui com um liga/desliga. */
function NotifySection() {
  const sources = useNotifySources();
  return (
    <Group title="Apps que podem avisar">
      {sources.length === 0 ? (
        <div className="empty-card empty-card--flat">
          <strong>Nenhum app avisou ainda</strong>
          <span>WhatsApp e Zoho Mail já vêm ligados. Os outros aparecem aqui no primeiro aviso.</span>
        </div>
      ) : (
        sources.map((s) => (
          <Row key={s.key} label={s.label} hint={s.label.toLowerCase() !== s.key ? s.key : undefined}>
            <Switch checked={s.enabled} onChange={(on) => setSourceEnabled(s.key, on)} label={`Avisos de ${s.label}`} />
          </Row>
        ))
      )}
    </Group>
  );
}

/* ═════════ Geral ═════════ */

function GeneralSection({ settings, onChange }: SectionProps) {
  return (
    <>
      <Group title="Comportamento">
        {/* Com gota/fio o mouse só mostra a ilha fechada; abrir é sempre com clique. */}
        {settings.restShape === "off" && (
          <Row label="Abrir ao passar o mouse">
            <Switch checked={settings.expandOnHover} onChange={(expandOnHover) => onChange({ expandOnHover })} label="Abrir ao passar o mouse" />
          </Row>
        )}
        <Row label="Sempre no topo">
          <Switch checked={settings.alwaysOnTop} onChange={(alwaysOnTop) => onChange({ alwaysOnTop })} label="Sempre no topo" />
        </Row>
        <Row label="Reduzir animações" hint="Transições curtas e sem mola">
          <Switch checked={settings.reduceMotion} onChange={(reduceMotion) => onChange({ reduceMotion })} label="Reduzir animações" />
        </Row>
      </Group>
      <Group title="Aplicativo">
        <AutostartRow />
        <UpdateRow />
        <Row label="Encerrar a Dynamic Island" hint="Abra de novo pelo menu Iniciar">
          <button className="btn btn--danger btn--sm" onClick={() => quitApp()}>
            <IconPower /> Encerrar
          </button>
        </Row>
      </Group>
      <p className="section-hint">Dica: clique direito na ilha abre os ajustes.</p>
    </>
  );
}

function VersionTag() {
  const { current, status } = useUpdate();
  const pending = status.kind === "available" || status.kind === "downloading";
  return (
    <button className="settings-version" data-badge={pending || undefined} onClick={() => setSettingsSection("general")} title="Versão e atualizações">
      Dynamic Island {current || ""}
    </button>
  );
}

/** "Iniciar com o Windows": o mesmo valor do menu da bandeja. */
function AutostartRow() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    void invoke<boolean | null>("autostart_state").then(setOn).catch(() => {});
    const off = listen<boolean>("island://autostart", (e) => setOn(e.payload));
    return () => void off.then((f) => f());
  }, []);
  if (on === null) {
    return (
      <Row label="Iniciar com o Windows" hint="Disponível na versão instalada">
        <Switch checked={false} onChange={() => {}} label="Iniciar com o Windows" />
      </Row>
    );
  }
  return (
    <Row label="Iniciar com o Windows" hint="Abre sozinha quando você liga o PC">
      <Switch
        checked={on}
        onChange={(v) => {
          setOn(v);
          void invoke<boolean>("autostart_set", { on: v })
            .then(setOn)
            .catch(() => setOn(!v));
        }}
        label="Iniciar com o Windows"
      />
    </Row>
  );
}

function UpdateRow() {
  const { current, status } = useUpdate();
  if (!updatesSupported) {
    return <Row label="Atualizações" hint="Verificadas automaticamente na versão instalada" children={null} />;
  }
  let hint = `Versão ${current} · verifica sozinha a cada 6 horas`;
  let action: ReactNode = (
    <button className="btn btn--ghost btn--sm" onClick={() => void checkForUpdate(true)}>
      Procurar
    </button>
  );
  if (status.kind === "checking") {
    hint = "Procurando versão nova…";
    action = (
      <button className="btn btn--ghost btn--sm" disabled>
        Procurando…
      </button>
    );
  } else if (status.kind === "uptodate") {
    hint = `Versão ${current} · você está na mais recente`;
  } else if (status.kind === "error") {
    hint = status.message;
  } else if (status.kind === "available") {
    hint = `Versão ${status.version} disponível (você tem a ${current})`;
    action = (
      <button className="btn btn--primary btn--sm" onClick={() => void installUpdate()}>
        <IconDownload /> Atualizar
      </button>
    );
  } else if (status.kind === "downloading") {
    const pct = status.progress == null ? null : Math.round(status.progress * 100);
    hint = pct == null ? `Baixando a versão ${status.version}…` : `Baixando a versão ${status.version}… ${pct}%`;
    action = (
      <span className="update-progress" aria-label="Progresso do download">
        <i style={{ transform: `scaleX(${status.progress ?? 0.15})` }} />
      </span>
    );
  }
  return (
    <Row label="Atualizações" hint={hint}>
      {action}
    </Row>
  );
}

/* ═════════ Peças ═════════ */

function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="group">
      <header className="group-head">
        <h3>{title}</h3>
        {aside}
      </header>
      <div className="card">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <div className="row-control">{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; icon?: Icon }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ "--count": options.length, "--index": index } as CSSProperties}>
      <span className="segmented-thumb" aria-hidden />
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={o.id === value} onClick={() => onChange(o.id)}>
          {o.icon && <o.icon />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({ min, max, value, onChange, label }: { min: number; max: number; value: number; onChange: (v: number) => void; label: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={1}
      value={value}
      aria-label={label}
      style={{ "--fill": `${fill}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
