//! Notificações dos outros apps (WhatsApp, Zoho Mail...), lidas da central
//! de notificações do Windows. Sem login e sem API de cada serviço: a ilha
//! vê o mesmo aviso que o Windows mostra no canto da tela.
//!
//! Uma thread consulta a lista a cada segundo e só manda evento para as
//! notificações novas. A primeira leitura é a base: o que já estava na
//! central ao abrir o app não aparece de novo. O filtro (quais apps mostrar)
//! fica no frontend, que conhece as escolhas do usuário.

use std::thread;

use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotifyEvent {
    pub id: u32,
    /// Nome do app como o Windows mostra (ex.: "WhatsApp", "Microsoft Edge").
    pub app: String,
    /// AppUserModelId: identifica o app e permite abri-lo.
    pub app_id: String,
    /// Linhas de texto do aviso, na ordem (título, corpo, atribuição...).
    pub texts: Vec<String>,
    /// Ícone do app como data URL (guardado em cache por app).
    pub logo: Option<String>,
}

pub fn start(app: AppHandle) {
    thread::Builder::new()
        .name("notifications".into())
        .spawn(move || imp::run(app))
        .expect("falha ao iniciar a thread de notificações");
}

/// Abre o app que mandou o aviso (clique na pílula).
#[tauri::command]
pub fn notify_open(app_id: String) -> Result<(), String> {
    if app_id.is_empty() || app_id.contains(['"', '\0', '\n']) {
        return Err("app inválido".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(format!(r"shell:AppsFolder\{app_id}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
mod imp {
    pub fn run(_app: tauri::AppHandle) {}
}

#[cfg(windows)]
mod imp {
    use std::collections::{HashMap, HashSet};
    use std::thread;
    use std::time::Duration;

    use tauri::{AppHandle, Emitter};
    use windows::Foundation::Size;
    use windows::Storage::Streams::DataReader;
    use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
    use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::NotifyEvent;
    use crate::media::{base64, sniff_mime};

    const TICK: Duration = Duration::from_secs(1);
    /// Sem permissão: tenta de novo de vez em quando (o usuário pode liberar nos ajustes do Windows).
    const DENIED_RETRY: Duration = Duration::from_secs(15);

    pub fn run(app: AppHandle) {
        // SAFETY: inicia COM/WinRT nesta thread, dona de todos os objetos abaixo.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };

        let listener = loop {
            match access() {
                Some(l) => break l,
                None => thread::sleep(DENIED_RETRY),
            }
        };

        let mut known: Option<HashSet<u32>> = None;
        let mut logos: HashMap<String, Option<String>> = HashMap::new();

        loop {
            if let Ok(list) = listener.GetNotificationsAsync(NotificationKinds::Toast).and_then(|op| op.join()) {
                let mut now = HashSet::new();
                let size = list.Size().unwrap_or(0);
                for i in 0..size {
                    let Ok(n) = list.GetAt(i) else { continue };
                    let Ok(id) = n.Id() else { continue };
                    now.insert(id);
                    if let Some(seen) = &known {
                        if !seen.contains(&id) {
                            if let Some(ev) = read(&n, id, &mut logos) {
                                let _ = app.emit("island://notify", ev);
                            }
                        }
                    }
                }
                known = Some(now);
            }
            thread::sleep(TICK);
        }
    }

    fn access() -> Option<UserNotificationListener> {
        let listener = UserNotificationListener::Current().ok()?;
        let mut status = listener.GetAccessStatus().ok()?;
        if status == UserNotificationListenerAccessStatus::Unspecified {
            status = listener.RequestAccessAsync().ok()?.join().ok()?;
        }
        (status == UserNotificationListenerAccessStatus::Allowed).then_some(listener)
    }

    fn read(n: &UserNotification, id: u32, logos: &mut HashMap<String, Option<String>>) -> Option<NotifyEvent> {
        let info = n.AppInfo().ok()?;
        let app_id = info.AppUserModelId().map(|s| s.to_string()).unwrap_or_default();
        let display = info.DisplayInfo().ok();
        let app = display.as_ref().and_then(|d| d.DisplayName().ok()).map(|s| s.to_string()).unwrap_or_default();

        let binding = n.Notification().ok()?.Visual().ok()?.GetBinding(&KnownNotificationBindings::ToastGeneric().ok()?).ok()?;
        let elements = binding.GetTextElements().ok()?;
        let texts: Vec<String> = (0..elements.Size().unwrap_or(0))
            .filter_map(|i| elements.GetAt(i).ok()?.Text().ok())
            .map(|t| t.to_string().trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        if texts.is_empty() {
            return None;
        }

        let logo = logos
            .entry(app_id.clone())
            .or_insert_with(|| display.as_ref().and_then(logo_of))
            .clone();
        Some(NotifyEvent { id, app, app_id, texts, logo })
    }

    fn logo_of(display: &windows::ApplicationModel::AppDisplayInfo) -> Option<String> {
        let stream = display.GetLogo(Size { Width: 64.0, Height: 64.0 }).ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 1_000_000 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.join().ok()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(format!("data:{};base64,{}", sniff_mime(&bytes), base64(&bytes)))
    }
}
