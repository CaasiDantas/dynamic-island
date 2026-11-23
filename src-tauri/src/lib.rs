mod apps;
mod claude;
mod hotkey;
mod media;
mod monitor;
mod notify;
mod spectrum;
mod system;
mod tray;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent};

/// Área (em pixels lógicos, relativa à janela) ocupada pela cápsula.
/// Fora dela a janela deixa os cliques passarem para os apps de baixo.
#[derive(Default, Clone, Copy)]
struct HitRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// Posição (física) e escala da janela em cache, para a thread de hover
/// não precisar consultar a janela a cada leitura.
#[derive(Clone, Copy)]
struct WindowGeometry {
    x: f64,
    y: f64,
    scale: f64,
}

pub(crate) struct IslandState {
    hit: Mutex<HitRect>,
    geometry: Mutex<Option<WindowGeometry>>,
    /// Preferência "sempre no topo" (ajustes).
    on_top: AtomicBool,
    /// PC parado: 0 = em uso, 1 = parado (olhinhos), 2 = cochilando.
    idle: AtomicU8,
    /// Escondida pela bandeja: o frontend não pode reexibir ao reconfigurar.
    hidden: AtomicBool,
}

impl Default for IslandState {
    fn default() -> Self {
        Self { hit: Mutex::default(), geometry: Mutex::default(), on_top: AtomicBool::new(true), idle: AtomicU8::new(0), hidden: AtomicBool::new(false) }
    }
}

/// Recoloca a janela no topo da pilha "sempre no topo", sem ativá-la.
/// Depois que a ilha pega foco (caixa do Claude) e outro app é ativado, o
/// Windows pode deixá-la atrás dele; isso a traz de volta.
#[cfg(windows)]
fn reassert_topmost(window: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE};
    if !window.state::<IslandState>().on_top.load(Ordering::Relaxed) {
        return;
    }
    let Ok(hwnd) = window.hwnd() else { return };
    // SAFETY: hwnd é a janela viva da ilha; só muda a ordem Z, sem mover nem redimensionar.
    unsafe {
        SetWindowPos(hwnd.0 as _, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
    }
}

#[cfg(not(windows))]
fn reassert_topmost(_window: &WebviewWindow) {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayInfo {
    /// Largura do monitor em pixels lógicos (já descontado o DPI).
    width: f64,
    height: f64,
    scale_factor: f64,
}

fn target_monitor(window: &WebviewWindow) -> Result<tauri::Monitor, String> {
    window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or(window.current_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "nenhum monitor encontrado".into())
}

fn refresh_geometry(window: &WebviewWindow) {
    let (Ok(origin), Ok(scale)) = (window.inner_position(), window.scale_factor()) else {
        return;
    };
    if let Ok(mut geometry) = window.state::<IslandState>().geometry.lock() {
        *geometry = Some(WindowGeometry {
            x: origin.x as f64,
            y: origin.y as f64,
            scale,
        });
    }
}

#[tauri::command]
fn display_info(window: WebviewWindow) -> Result<DisplayInfo, String> {
    let monitor = target_monitor(&window)?;
    let scale = monitor.scale_factor();
    let size = monitor.size();
    Ok(DisplayInfo {
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        scale_factor: scale,
    })
}

/// Dimensiona a janela e a centraliza no topo do monitor principal.
#[tauri::command]
fn configure_island(window: WebviewWindow, width: f64, height: f64, top: f64) -> Result<(), String> {
    let monitor = target_monitor(&window)?;
    let scale = monitor.scale_factor();
    let origin = monitor.position();
    let physical_width = (width * scale).round() as i32;
    let x = origin.x + (monitor.size().width as i32 - physical_width) / 2;
    let y = origin.y + (top * scale).round() as i32;

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    if !window.state::<IslandState>().hidden.load(Ordering::Relaxed) {
        window.show().map_err(|e| e.to_string())?;
    }
    refresh_geometry(&window);
    Ok(())
}

#[tauri::command]
fn set_hit_region(state: State<'_, IslandState>, x: f64, y: f64, w: f64, h: f64) {
    if let Ok(mut hit) = state.hit.lock() {
        *hit = HitRect { x, y, w, h };
    }
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, state: State<'_, IslandState>, value: bool) -> Result<(), String> {
    state.on_top.store(value, Ordering::Relaxed);
    window.set_always_on_top(value).map_err(|e| e.to_string())
}

/// Nível atual de "PC parado" (o frontend pede ao abrir; depois chega por evento).
#[tauri::command]
fn idle_level(state: State<'_, IslandState>) -> u8 {
    state.idle.load(Ordering::Relaxed)
}

/// Sem mexer no mouse/teclado por tanto tempo: olhinhos aparecem / cochilam.
const IDLE_REST_MS: u32 = 30_000;
const IDLE_SLEEP_MS: u32 = 180_000;

/// Milissegundos desde a última entrada (mouse/teclado) em qualquer app.
#[cfg(windows)]
fn system_idle_ms() -> u32 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: as duas funções só leem contadores do sistema e escrevem na struct passada.
    unsafe {
        if GetLastInputInfo(&mut info) == 0 {
            return 0;
        }
        GetTickCount().wrapping_sub(info.dwTime)
    }
}

#[cfg(not(windows))]
fn system_idle_ms() -> u32 {
    0
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Posição do cursor em pixels físicos da tela.
#[cfg(windows)]
fn cursor_position(_window: &WebviewWindow) -> Option<(f64, f64)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut point = POINT { x: 0, y: 0 };
    // SAFETY: GetCursorPos só escreve no POINT passado; não toca na janela.
    let ok = unsafe { GetCursorPos(&mut point) } != 0;
    ok.then_some((point.x as f64, point.y as f64))
}

#[cfg(not(windows))]
fn cursor_position(window: &WebviewWindow) -> Option<(f64, f64)> {
    window.cursor_position().ok().map(|p| (p.x, p.y))
}

/// Algum botão do mouse está pressionado agora?
#[cfg(windows)]
fn mouse_button_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
    // SAFETY: GetAsyncKeyState só lê o estado da tecla/botão.
    unsafe {
        [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON]
            .iter()
            .any(|&vk| (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0)
    }
}

#[cfg(not(windows))]
fn mouse_button_down() -> bool {
    false
}

/// Acompanha o cursor e alterna o click-through da janela: só a cápsula
/// recebe o mouse. Também avisa o frontend quando o cursor entra/sai dela.
/// A janela só é tocada quando o estado muda, então o laço é praticamente
/// gratuito e não disputa a thread principal com as animações.
fn spawn_hover_tracker(window: WebviewWindow) {
    thread::spawn(move || {
        let mut inside_before: Option<bool> = None;
        let mut tick: u32 = 0;
        loop {
            thread::sleep(Duration::from_millis(16));

            // PC parado: confere a cada ~0,5 s e só avisa quando o nível muda.
            tick = tick.wrapping_add(1);
            if tick % 30 == 0 {
                let idle = system_idle_ms();
                let level = if idle >= IDLE_SLEEP_MS { 2 } else if idle >= IDLE_REST_MS { 1 } else { 0 };
                let state = window.state::<IslandState>();
                if state.idle.swap(level, Ordering::Relaxed) != level {
                    let _ = window.emit("island://idle", level);
                }
            }

            let state = window.state::<IslandState>();
            if state.hidden.load(Ordering::Relaxed) {
                continue;
            }
            let hit = match state.hit.lock() {
                Ok(hit) => *hit,
                Err(_) => continue,
            };
            let geometry = match state.geometry.lock() {
                Ok(geometry) => *geometry,
                Err(_) => continue,
            };
            let (Some(geometry), Some((cx, cy))) = (geometry, cursor_position(&window)) else {
                continue;
            };

            let lx = (cx - geometry.x) / geometry.scale;
            let ly = (cy - geometry.y) / geometry.scale;
            const TOLERANCE: f64 = 2.0;
            let over = hit.w > 0.0
                && lx >= hit.x - TOLERANCE
                && lx <= hit.x + hit.w + TOLERANCE
                && ly >= hit.y - TOLERANCE
                && ly <= hit.y + hit.h + TOLERANCE;
            // Arrastando algo que começou dentro (ex.: slider dos ajustes): continua
            // "dentro" até soltar o botão, para a ilha não recolher no meio do gesto.
            let inside = over || (inside_before == Some(true) && mouse_button_down());

            if inside_before != Some(inside) {
                let _ = window.set_ignore_cursor_events(!inside);
                let _ = window.emit("island://hover", inside);
                if inside {
                    reassert_topmost(&window);
                }
                inside_before = Some(inside);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Precisa vir primeiro: a segunda cópia fecha antes de criar janela.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::set_visible(app, true)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Atualização pelo próprio app (Releases do GitHub, assinadas).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(IslandState::default())
        .manage(claude::ClaudeRuns::default())
        .setup(|app| {
            app.manage(media::start(app.handle().clone()));
            app.manage(spectrum::start(app.handle().clone()));
            app.manage(apps::start());
            app.manage(hotkey::start(app.handle().clone()));
            system::start(app.handle().clone());
            notify::start(app.handle().clone());
            app.manage(monitor::start(app.handle().clone()));
            tray::create(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                refresh_geometry(&window);
                let tracked = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        // O app que ganhou o foco termina de subir logo depois: espera um pouco.
                        let w = tracked.clone();
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(120));
                            reassert_topmost(&w);
                        });
                        return;
                    }
                    let state = tracked.state::<IslandState>();
                    let Ok(mut geometry) = state.geometry.lock() else { return };
                    let Some(current) = geometry.as_mut() else { return };
                    match event {
                        WindowEvent::Moved(position) => {
                            current.x = position.x as f64;
                            current.y = position.y as f64;
                        }
                        WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                            current.scale = *scale_factor;
                        }
                        _ => {}
                    }
                });
                spawn_hover_tracker(window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            display_info,
            configure_island,
            set_hit_region,
            set_always_on_top,
            quit_app,
            idle_level,
            media::media_control,
            spectrum::spectrum_watch,
            apps::apps_list,
            tray::autostart_state,
            tray::autostart_set,
            apps::app_icon,
            apps::app_launch,
            system::volume_get,
            system::volume_set,
            notify::notify_open,
            claude::claude_ask,
            claude::claude_cancel,
            claude::focus_island,
            hotkey::set_global_hotkey,
            monitor::hw_watch,
            monitor::privacy_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
