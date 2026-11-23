//! Atalho de teclado global (funciona com qualquer app em foco).
//!
//! Usa `RegisterHotKey` do Windows numa thread própria com fila de
//! mensagens: o atalho só existe enquanto essa thread vive, e trocar a
//! combinação é um pedido enviado para ela (o registro precisa acontecer
//! na mesma thread que recebe o WM_HOTKEY). Ao disparar, avisa o frontend
//! com o evento `island://hotkey`.

use std::sync::Mutex;
use std::sync::mpsc::{Sender, channel};

use tauri::{AppHandle, State};

/// Pedido de troca: (modificadores MOD_*, tecla virtual; 0 = desligar) e onde responder.
type Request = (u32, u32, Sender<bool>);

#[derive(Default)]
pub struct HotkeyCtl {
    inner: Mutex<Option<(u32, Sender<Request>)>>,
}

#[cfg(windows)]
pub fn start(app: AppHandle) -> HotkeyCtl {
    use std::thread;
    use tauri::Emitter;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOD_NOREPEAT, RegisterHotKey, UnregisterHotKey};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, PM_NOREMOVE, PeekMessageW, WM_APP, WM_HOTKEY};

    const ID: i32 = 1;
    let (tx, rx) = channel::<Request>();
    let (ready_tx, ready_rx) = channel::<u32>();

    thread::spawn(move || {
        // SAFETY: chamadas Win32 sobre a fila de mensagens desta própria thread;
        // MSG é uma struct C simples, zerada é um valor válido.
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            // Cria a fila antes de anunciar o id da thread (PostThreadMessage precisa dela).
            PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
            let _ = ready_tx.send(GetCurrentThreadId());
            let mut registered = false;
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                if msg.message == WM_HOTKEY && msg.wParam == ID as usize {
                    let _ = app.emit("island://hotkey", ());
                } else if msg.message == WM_APP {
                    while let Ok((mods, vk, reply)) = rx.try_recv() {
                        if registered {
                            UnregisterHotKey(std::ptr::null_mut(), ID);
                            registered = false;
                        }
                        let ok = vk == 0 || {
                            registered = RegisterHotKey(std::ptr::null_mut(), ID, mods | MOD_NOREPEAT, vk) != 0;
                            registered
                        };
                        let _ = reply.send(ok);
                    }
                }
            }
        }
    });

    let thread_id = ready_rx.recv().unwrap_or(0);
    HotkeyCtl { inner: Mutex::new((thread_id != 0).then_some((thread_id, tx))) }
}

#[cfg(not(windows))]
pub fn start(_app: AppHandle) -> HotkeyCtl {
    HotkeyCtl::default()
}

/// Troca o atalho global. Devolve false se o Windows recusar (combinação já usada por outro app).
#[tauri::command]
pub fn set_global_hotkey(state: State<'_, HotkeyCtl>, mods: u32, vk: u32) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_APP};
        let Ok(guard) = state.inner.lock() else { return false };
        let Some((thread_id, tx)) = guard.as_ref() else { return false };
        let (reply_tx, reply_rx) = channel();
        if tx.send((mods & 0xF, vk, reply_tx)).is_err() {
            return false;
        }
        // SAFETY: só enfileira uma mensagem para a thread do atalho.
        unsafe { PostThreadMessageW(*thread_id, WM_APP, 0, 0) };
        reply_rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = (state, mods, vk);
        false
    }
}
