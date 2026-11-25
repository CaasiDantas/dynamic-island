import { useCallback, useEffect, useMemo, useState } from "react";
import { Island } from "./island/Island";
import { computeScale, windowSize } from "./lib/layout";
import { configureWindow, getDisplayInfo, isTauri, setAlwaysOnTop, setGlobalHotkey, type DisplayInfo } from "./lib/native";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import { applyAppearance, useSystemDark } from "./lib/theme";
import { configurePages } from "./island/pages";
import { configureWeather } from "./features/weather/store";
import { perfActions, useCommitCount, usePerfEnabled } from "./perf/hooks";
import { PerfHud } from "./perf/PerfHud";
import { startNotifications } from "./features/notify/store";
import { DEMO } from "./demo/seed";

/** Gravação do vídeo: ilha desenhada maior para os closes ficarem nítidos. */
const DEMO_SCALE = DEMO ? Number(new URLSearchParams(location.search).get("scale") ?? 1) : 1;

const DISPLAY_POLL_MS = 3000;
/** Altura extra da janela para o painel de diagnóstico (px lógicos). */
const PERF_HUD_HEIGHT = 190;

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [display, setDisplay] = useState<DisplayInfo | null>(null);
  const perfEnabled = usePerfEnabled();
  useCommitCount("App");

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(startNotifications, []);

  useEffect(() => {
    perfActions.setSetting = (key, value) => updateSettings({ [key]: value } as Partial<Settings>);
  }, [updateSettings]);

  // Monitor: lê na abertura e acompanha mudanças de resolução / escala do Windows.
  useEffect(() => {
    let alive = true;
    const read = () =>
      getDisplayInfo()
        .then((info) => {
          if (!alive) return;
          setDisplay((prev) =>
            prev && prev.width === info.width && prev.height === info.height && prev.scaleFactor === info.scaleFactor
              ? prev
              : info,
          );
        })
        .catch((err) => console.error("display_info falhou", err));
    read();
    const timer = window.setInterval(read, DISPLAY_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const scale = useMemo(() => (display ? computeScale(display.width, settings.size) * DEMO_SCALE : 1), [display, settings.size]);

  // Tudo no CSS é em rem: mudar a fonte raiz escala a interface inteira.
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * scale}px`;
  }, [scale]);

  // Tamanho da janela como valores: muda junto com a escala OU com as medidas da ilha (layout.ts).
  const { width: winW, height: winH } = windowSize(scale);
  useEffect(() => {
    if (!display) return;
    const [width, height] = [winW, winH];
    // Notch: colada na borda de cima. Flutuante: respeita a distância escolhida.
    const top = settings.style === "notch" ? 0 : settings.topOffset;
    configureWindow(width, height + (perfEnabled ? PERF_HUD_HEIGHT : 0), top).catch((err) => console.error("configure_island falhou", err));
  }, [display, winW, winH, settings.style, settings.topOffset, perfEnabled]);

  useEffect(() => {
    setAlwaysOnTop(settings.alwaysOnTop).catch((err) => console.error("set_always_on_top falhou", err));
  }, [settings.alwaysOnTop]);

  // Tema: tokens de cor gerados da cor escolhida; "Sistema" acompanha o Windows ao vivo.
  const systemDark = useSystemDark();
  useEffect(() => {
    applyAppearance(settings);
  }, [settings.theme, settings.accent, settings.surface, settings.surfaceOpacity, settings.glow, settings.edgeLight, systemDark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ordem e visibilidade das abas.
  useEffect(() => configurePages(settings.pageOrder, settings.hiddenPages), [settings.pageOrder, settings.hiddenPages]);
  useEffect(() => configureWeather(settings.weatherCity), [settings.weatherCity]);

  // Atalho global (registrado no Rust); o gravador dos ajustes já testa antes de salvar.
  const hotkeyKey = settings.hotkey ? `${settings.hotkey.mods}:${settings.hotkey.vk}` : "";
  useEffect(() => {
    setGlobalHotkey(settings.hotkey).then(
      (ok) => !ok && console.warn("atalho global recusado pelo Windows", settings.hotkey?.label),
      (err) => console.error("set_global_hotkey falhou", err),
    );
  }, [hotkeyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = document.documentElement;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.dataset.motion = settings.reduceMotion || prefersReduced ? "reduced" : "full";
    // Indicadores em loop (barrinhas, olhos, faísca) só param se o Windows pedir menos movimento;
    // o "Reduzir animações" do app encurta as transições de abrir/fechar.
    root.dataset.loops = prefersReduced ? "off" : "on";
    root.dataset.host = isTauri ? "desktop" : "browser";
  }, [settings.reduceMotion]);

  return (
    <>
      <Island settings={settings} scale={scale} onSettingsChange={updateSettings} />
      {perfEnabled && <PerfHud />}
    </>
  );
}
