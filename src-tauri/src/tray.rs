//! Ícone na bandeja do Windows (perto do relógio).
//!
//! Clique esquerdo: mostra/esconde a ilha. Clique direito: menu com
//! mostrar/esconder, configurações, iniciar com o Windows e sair.

use std::sync::atomic::Ordering;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::IslandState;

const ID_TOGGLE: &str = "toggle";
const ID_SETTINGS: &str = "settings";
const ID_AUTOSTART: &str = "autostart";
const ID_QUIT: &str = "quit";

/// Item "Mostrar/Esconder" guardado para trocar o texto conforme o estado.
struct TrayItems {
    toggle: MenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

/// Estado do "iniciar com o Windows" para os ajustes. None = versão de desenvolvimento (não se aplica).
#[tauri::command]
pub fn autostart_state() -> Option<bool> {
    (!cfg!(debug_assertions)).then(autostart::is_enabled)
}

/// Liga/desliga pelos ajustes e mantém a marca do menu da bandeja igual.
#[tauri::command]
pub fn autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    if cfg!(debug_assertions) {
        return Err("só na versão instalada".into());
    }
    if on { autostart::enable()? } else { autostart::disable()? }
    let now = autostart::is_enabled();
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.autostart.set_checked(now);
    }
    Ok(now)
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, ID_TOGGLE, "Esconder ilha", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, "Configurações", true, None::<&str>)?;
    // Em desenvolvimento o exe é o de debug, que depende do servidor do Vite: não registra.
    let installed = !cfg!(debug_assertions);
    if installed {
        autostart::ensure_default();
    }
    let autostart_label = if installed { "Iniciar com o Windows" } else { "Iniciar com o Windows (só na versão instalada)" };
    let autostart = CheckMenuItem::with_id(app, ID_AUTOSTART, autostart_label, installed, installed && autostart::is_enabled(), None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Sair", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &sep, &autostart, &sep2, &quit])?;

    app.manage(TrayItems { toggle, autostart: autostart.clone() });

    let mut builder = TrayIconBuilder::with_id("island")
        .tooltip("Dynamic Island")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            ID_TOGGLE => set_visible(app, !is_visible(app)),
            ID_SETTINGS => {
                set_visible(app, true);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_focus();
                }
                let _ = app.emit("island://open-settings", ());
            }
            ID_AUTOSTART => {
                let want = !autostart::is_enabled();
                let ok = if want { autostart::enable() } else { autostart::disable() };
                // O menu já inverteu a marca; se falhou, mostra o estado real.
                if let Err(err) = ok {
                    eprintln!("iniciar com o Windows falhou: {err}");
                }
                let _ = autostart.set_checked(autostart::is_enabled());
                let _ = app.emit("island://autostart", autostart::is_enabled());
            }
            ID_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                set_visible(app, !is_visible(app));
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn is_visible(app: &AppHandle) -> bool {
    !app.state::<IslandState>().hidden.load(Ordering::Relaxed)
}

/// Mostra ou esconde a ilha sem fechar o app (Pomodoro, mídia e Claude seguem rodando).
pub fn set_visible(app: &AppHandle, visible: bool) {
    app.state::<IslandState>().hidden.store(!visible, Ordering::Relaxed);
    if let Some(w) = app.get_webview_window("main") {
        let _ = if visible { w.show() } else { w.hide() };
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.toggle.set_text(if visible { "Esconder ilha" } else { "Mostrar ilha" });
    }
}

/// Entrada em HKCU\...\Run: o Windows abre o exe ao entrar na conta.
#[cfg(windows)]
mod autostart {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD, REG_SZ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const NAME: &str = "Dynamic Island";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn is_enabled() -> bool {
        let (key, name) = (wide(KEY), wide(NAME));
        // SAFETY: só consulta se o valor existe; nenhum buffer de saída.
        unsafe {
            RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut())
                == ERROR_SUCCESS
        }
    }

    pub fn enable() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let cmd = wide(&format!("\"{}\"", exe.display()));
        let (key, name) = (wide(KEY), wide(NAME));
        // SAFETY: strings UTF-16 terminadas em zero; o tamanho inclui o terminador.
        let res = unsafe {
            RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, cmd.as_ptr().cast(), (cmd.len() * 2) as u32)
        };
        if res == ERROR_SUCCESS { Ok(()) } else { Err(format!("erro {res}")) }
    }

    /// Chave própria do app, só para lembrar que o padrão já foi aplicado.
    const APP_KEY: &str = r"Software\Dynamic Island";
    const DEFAULT_APPLIED: &str = "AutostartDefaultApplied";

    /// Primeira execução da versão instalada: liga o "iniciar com o Windows".
    /// Depois disso vale a escolha do usuário no menu. Se já estiver ligado,
    /// regrava o caminho (o exe pode ter mudado de pasta numa reinstalação).
    pub fn ensure_default() {
        let (key, name) = (wide(APP_KEY), wide(DEFAULT_APPLIED));
        // SAFETY: só consulta se o valor existe; nenhum buffer de saída.
        let applied = unsafe {
            RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut())
                == ERROR_SUCCESS
        };
        if !applied || is_enabled() {
            let _ = enable();
        }
        if !applied {
            let one: u32 = 1;
            // SAFETY: valor DWORD de 4 bytes; RegSetKeyValueW cria a chave se faltar.
            unsafe {
                RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_DWORD, (&one as *const u32).cast(), 4);
            }
        }
    }

    pub fn disable() -> Result<(), String> {
        let (key, name) = (wide(KEY), wide(NAME));
        // SAFETY: apaga só o nosso valor.
        let res = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) };
        if res == ERROR_SUCCESS || res == 2 { Ok(()) } else { Err(format!("erro {res}")) }
    }
}

#[cfg(not(windows))]
mod autostart {
    pub fn ensure_default() {}
    pub fn is_enabled() -> bool {
        false
    }
    pub fn enable() -> Result<(), String> {
        Err("só no Windows".into())
    }
    pub fn disable() -> Result<(), String> {
        Ok(())
    }
}
