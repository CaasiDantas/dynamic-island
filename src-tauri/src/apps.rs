//! Aplicativos do Windows para a página Atalhos.
//!
//! - Lista: os mesmos apps do Menu Iniciar (inclui os da Microsoft Store,
//!   como o WhatsApp), via `Get-StartApps`. Cada um vira o destino
//!   `shell:AppsFolder\<AppID>`, que o Windows sabe abrir.
//! - Ícone: o mesmo que o Explorer mostra, pedido ao Shell
//!   (IShellItemImageFactory) e devolvido como PNG em data URL.
//! - Abrir: ShellExecute no destino (app da lista ou um .exe escolhido).
//!
//! O Shell quer apartamento STA: ícones saem de uma thread própria, dona
//! dos objetos COM, que atende os pedidos em fila.

use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Clone, Debug)]
pub struct AppEntry {
    pub name: String,
    /// `shell:AppsFolder\<AppID>`.
    pub target: String,
}

type IconReq = (String, Sender<Option<String>>);

pub struct AppsBridge(Mutex<Sender<IconReq>>);

pub fn start() -> AppsBridge {
    let (tx, rx) = mpsc::channel::<IconReq>();
    thread::Builder::new()
        .name("app-icons".into())
        .spawn(move || imp::icon_worker(rx))
        .expect("falha ao iniciar a thread de ícones");
    AppsBridge(Mutex::new(tx))
}

/// Destinos que a ilha aceita abrir: app do Menu Iniciar ou arquivo executável/atalho.
fn allowed(target: &str) -> bool {
    let lower = target.to_lowercase();
    lower.starts_with("shell:appsfolder\\") || [".exe", ".lnk", ".appref-ms", ".bat", ".cmd"].iter().any(|ext| lower.ends_with(ext))
}

#[tauri::command]
pub async fn apps_list() -> Result<Vec<AppEntry>, String> {
    tauri::async_runtime::spawn_blocking(imp::start_apps).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn app_icon(bridge: State<'_, AppsBridge>, target: String) -> Result<Option<String>, String> {
    if !allowed(&target) {
        return Ok(None);
    }
    let (tx, rx) = mpsc::channel();
    bridge.0.lock().map_err(|_| "ícones indisponíveis")?.send((target, tx)).map_err(|_| "ícones indisponíveis")?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_launch(target: String) -> Result<(), String> {
    if !allowed(&target) {
        return Err("destino não permitido".into());
    }
    imp::launch(&target)
}

#[derive(Deserialize)]
struct StartApp {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "AppID")]
    app_id: String,
}

/// Itens do Menu Iniciar que não são apps (desinstaladores, manuais, sites).
fn is_noise(a: &StartApp) -> bool {
    let n = a.name.to_lowercase();
    let id = a.app_id.to_lowercase();
    ["uninstall", "desinstalar", "readme", "leia-me", "help", "ajuda", "release notes", "documentation"].iter().any(|k| n.contains(k))
        || id.starts_with("http")
        || [".chm", ".txt", ".pdf", ".html", ".htm", ".url", ".ini", ".log"].iter().any(|e| id.ends_with(e))
}

fn parse_start_apps(json: &str) -> Vec<AppEntry> {
    // Com um item só o PowerShell devolve objeto em vez de lista.
    let items: Vec<StartApp> = serde_json::from_str::<Vec<StartApp>>(json)
        .or_else(|_| serde_json::from_str::<StartApp>(json).map(|a| vec![a]))
        .unwrap_or_default();
    let mut out: Vec<AppEntry> = items
        .into_iter()
        .filter(|a| !a.name.trim().is_empty() && !a.app_id.trim().is_empty() && !is_noise(a))
        .map(|a| AppEntry { name: a.name.trim().to_string(), target: format!("shell:AppsFolder\\{}", a.app_id.trim()) })
        .collect();
    out.sort_by_key(|a| a.name.to_lowercase());
    out.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    out
}

/// PNG mínimo (RGBA 8 bits, deflate "stored"): o ícone tem poucos KB, não precisa comprimir.
fn png_rgba(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
    fn crc32(data: &[u8]) -> u32 {
        let mut c = 0xFFFF_FFFFu32;
        for &b in data {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        !c
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = out.len();
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        let crc = crc32(&out[start..]);
        out.extend_from_slice(&crc.to_be_bytes());
    }

    let mut raw = Vec::with_capacity((w as usize * 4 + 1) * h as usize);
    for row in rgba.chunks_exact(w as usize * 4) {
        raw.push(0); // filtro "none"
        raw.extend_from_slice(row);
    }
    let mut z = vec![0x78, 0x01];
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in &raw {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    let mut blocks = raw.chunks(65535).peekable();
    while let Some(block) = blocks.next() {
        z.push(if blocks.peek().is_none() { 1 } else { 0 });
        let len = block.len() as u16;
        z.extend_from_slice(&len.to_le_bytes());
        z.extend_from_slice(&(!len).to_le_bytes());
        z.extend_from_slice(block);
    }
    z.extend_from_slice(&((b << 16) | a).to_be_bytes());

    let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&w.to_be_bytes());
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &z);
    chunk(&mut out, b"IEND", &[]);
    out
}

#[cfg(windows)]
mod imp {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::sync::mpsc::Receiver;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, ShellExecuteW, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    use super::{parse_start_apps, png_rgba, AppEntry, IconReq};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    /// Tamanho pedido ao Shell; a interface mostra em ~32 px (nítido em 2×).
    const ICON_PX: i32 = 64;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn start_apps() -> Result<Vec<AppEntry>, String> {
        let out = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("não consegui listar os apps: {e}"))?;
        Ok(parse_start_apps(String::from_utf8_lossy(&out.stdout).trim()))
    }

    pub fn launch(target: &str) -> Result<(), String> {
        let (op, file) = (wide("open"), wide(target));
        // SAFETY: strings UTF-16 terminadas em zero, válidas durante a chamada.
        let res = unsafe { ShellExecuteW(None, PCWSTR(op.as_ptr()), PCWSTR(file.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        // ShellExecute devolve > 32 quando deu certo.
        if res.0 as usize > 32 { Ok(()) } else { Err(format!("o Windows não abriu o app (código {})", res.0 as usize)) }
    }

    pub fn icon_worker(rx: Receiver<IconReq>) {
        // SAFETY: esta thread é STA e dona de todos os objetos do Shell daqui.
        let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        while let Ok((target, reply)) = rx.recv() {
            let _ = reply.send(icon(&target));
        }
    }

    fn icon(target: &str) -> Option<String> {
        let path = wide(target);
        // SAFETY: COM STA iniciado na thread; o HBITMAP devolvido é nosso e é apagado no fim.
        unsafe {
            let factory: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None).ok()?;
            let hbm = factory.GetImage(SIZE { cx: ICON_PX, cy: ICON_PX }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK).ok()?;
            let obj = HGDIOBJ(hbm.0);
            let mut bm = BITMAP::default();
            let ok = GetObjectW(obj, std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) != 0;
            let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
            let result = if ok && w > 0 && h > 0 && w <= 512 && h <= 512 {
                let mut info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: w,
                        biHeight: -h, // de cima para baixo
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut px = vec![0u8; (w * h * 4) as usize];
                let dc = CreateCompatibleDC(None);
                let lines = GetDIBits(dc, hbm, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
                let _ = DeleteDC(dc);
                (lines == h).then(|| {
                    let any_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
                    for p in px.chunks_exact_mut(4) {
                        // BGRA pré-multiplicado → RGBA direto.
                        let a = if any_alpha { p[3] } else { 255 };
                        let un = |c: u8| if a == 0 { 0 } else { ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 };
                        let (b, g, r) = (p[0], p[1], p[2]);
                        p[0] = if any_alpha { un(r) } else { r };
                        p[1] = if any_alpha { un(g) } else { g };
                        p[2] = if any_alpha { un(b) } else { b };
                        p[3] = a;
                    }
                    let png = png_rgba(w as u32, h as u32, &px);
                    format!("data:image/png;base64,{}", crate::media::base64(&png))
                })
            } else {
                None
            };
            let _ = DeleteObject(obj);
            result
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::sync::mpsc::Receiver;

    use super::{AppEntry, IconReq};

    pub fn start_apps() -> Result<Vec<AppEntry>, String> {
        Ok(Vec::new())
    }
    pub fn launch(_target: &str) -> Result<(), String> {
        Err("só no Windows".into())
    }
    pub fn icon_worker(rx: Receiver<IconReq>) {
        while let Ok((_, reply)) = rx.recv() {
            let _ = reply.send(None);
        }
    }
}
