//! Sinais do sistema para as pílulas de aviso: carregador, Caps Lock,
//! volume e saída de áudio (fone conectado/desconectado).
//!
//! Uma thread lê tudo a cada 100 ms (chamadas baratas, sem tocar na janela)
//! e só manda evento quando algum valor muda. A primeira leitura é só a
//! base: abrir o app não dispara pílula nenhuma.

use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SysEvent {
    /// Carregador conectado/desconectado.
    Power { plugged: bool, percent: Option<u8> },
    CapsLock { on: bool },
    /// Volume mudou (0..=100) ou mudo ligado/desligado.
    Volume { level: u8, muted: bool },
    /// Saída de áudio padrão trocou (ex.: fone conectado).
    AudioOutput { name: String, headphones: bool },
}

pub fn start(app: AppHandle) {
    thread::Builder::new()
        .name("system-signals".into())
        .spawn(move || imp::run(app))
        .expect("falha ao iniciar a thread de sinais do sistema");
}

fn emit(app: &AppHandle, ev: SysEvent) {
    let _ = app.emit("island://sys", ev);
}

/// Até quando (ms Unix) mudanças de volume são da própria ilha: sem pílula.
static QUIET_UNTIL: AtomicU64 = AtomicU64::new(0);
const QUIET_MS: u64 = 700;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
    pub level: u8,
    pub muted: bool,
}

/// Volume atual da saída padrão (página de música).
#[tauri::command]
pub async fn volume_get() -> Option<VolumeState> {
    imp::endpoint_volume(|v| imp::read(v)).flatten()
}

/// Ajusta o volume (0..=100) e/ou o mudo da saída padrão, sem pílula de aviso.
#[tauri::command]
pub async fn volume_set(level: Option<f32>, muted: Option<bool>) -> Result<(), String> {
    QUIET_UNTIL.store(now_ms() + QUIET_MS, Ordering::Relaxed);
    imp::endpoint_volume(|v| imp::write(v, level.map(|l| (l / 100.0).clamp(0.0, 1.0)), muted))
        .ok_or_else(|| "saída de áudio indisponível".to_string())?
}

/// Nome de saída que parece fone (o Windows não diz o tipo de forma confiável).
fn looks_like_headphones(name: &str) -> bool {
    let n = name.to_lowercase();
    ["fone", "headphone", "headset", "airpods", "buds", "earphone", "auricular", "hands-free", "earbud"]
        .iter()
        .any(|k| n.contains(k))
}

#[cfg(not(windows))]
mod imp {
    pub struct Endpoint;
    pub fn run(_app: tauri::AppHandle) {}
    pub fn endpoint_volume<T>(_f: impl FnOnce(&Endpoint) -> T) -> Option<T> {
        None
    }
    pub fn read(_v: &Endpoint) -> Option<super::VolumeState> {
        None
    }
    pub fn write(_v: &Endpoint, _level: Option<f32>, _muted: Option<bool>) -> Result<(), String> {
        Err("sem suporte".into())
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CAPITAL};

    const TICK: Duration = Duration::from_millis(100);
    /// Troca de saída de áudio é rara: confere com menos frequência.
    const DEVICE_CHECK: Duration = Duration::from_secs(2);

    struct Audio {
        enumerator: IMMDeviceEnumerator,
        id: String,
        volume: Option<IAudioEndpointVolume>,
    }

    impl Audio {
        fn new() -> Option<Self> {
            // SAFETY: COM já iniciado nesta thread (MTA) em `run`.
            let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()?;
            Some(Self { enumerator, id: String::new(), volume: None })
        }

        /// Relê a saída padrão. Devolve o nome se ela mudou.
        fn refresh_device(&mut self) -> Option<String> {
            // SAFETY: chamadas COM na thread que iniciou o COM; a string do id é liberada logo após copiar.
            unsafe {
                let Ok(device) = self.enumerator.GetDefaultAudioEndpoint(eRender, eConsole) else {
                    self.id.clear();
                    self.volume = None;
                    return None;
                };
                let id = match device.GetId() {
                    Ok(p) => {
                        let s = p.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(p.0 as _));
                        s
                    }
                    Err(_) => String::new(),
                };
                if id == self.id && self.volume.is_some() {
                    return None;
                }
                self.id = id;
                self.volume = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok();
                let name = device
                    .OpenPropertyStore(STGM_READ)
                    .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
                    .map(|v| v.to_string())
                    .unwrap_or_default();
                Some(name)
            }
        }

        fn read_volume(&self) -> Option<(u8, bool)> {
            let vol = self.volume.as_ref()?;
            // SAFETY: interface viva, mesma thread.
            unsafe {
                let level = vol.GetMasterVolumeLevelScalar().ok()?;
                let muted = vol.GetMute().ok()?.as_bool();
                Some(((level * 100.0).round().clamp(0.0, 100.0) as u8, muted))
            }
        }
    }

    pub type Endpoint = IAudioEndpointVolume;

    /// Abre o controle de volume da saída padrão nesta thread (comandos rodam no pool do Tauri).
    pub fn endpoint_volume<T>(f: impl FnOnce(&Endpoint) -> T) -> Option<T> {
        // SAFETY: COM iniciado (MTA) nesta thread antes de criar os objetos; tudo é solto ao sair.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
            let vol = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok()?;
            Some(f(&vol))
        }
    }

    pub fn read(vol: &Endpoint) -> Option<super::VolumeState> {
        // SAFETY: interface viva, mesma thread.
        unsafe {
            let level = vol.GetMasterVolumeLevelScalar().ok()?;
            let muted = vol.GetMute().ok()?.as_bool();
            Some(super::VolumeState { level: (level * 100.0).round().clamp(0.0, 100.0) as u8, muted })
        }
    }

    pub fn write(vol: &Endpoint, level: Option<f32>, muted: Option<bool>) -> Result<(), String> {
        // SAFETY: interface viva, mesma thread; contexto de evento nulo.
        unsafe {
            if let Some(l) = level {
                vol.SetMasterVolumeLevelScalar(l, std::ptr::null()).map_err(|e| e.to_string())?;
            }
            if let Some(m) = muted {
                vol.SetMute(m, std::ptr::null()).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    fn power() -> Option<(bool, Option<u8>)> {
        let mut s = SYSTEM_POWER_STATUS::default();
        // SAFETY: só escreve na struct passada.
        unsafe { GetSystemPowerStatus(&mut s) }.ok()?;
        // 128 = sem bateria (desktop): não há o que avisar.
        if s.BatteryFlag & 128 != 0 || s.ACLineStatus == 255 {
            return None;
        }
        let percent = (s.BatteryLifePercent <= 100).then_some(s.BatteryLifePercent);
        Some((s.ACLineStatus == 1, percent))
    }

    fn caps_on() -> bool {
        // SAFETY: só lê o estado da tecla; o bit baixo é o "ligado" do Caps Lock.
        unsafe { GetKeyState(VK_CAPITAL.0 as i32) & 1 != 0 }
    }

    pub fn run(app: AppHandle) {
        // SAFETY: inicia COM nesta thread, que é dona de todos os objetos de áudio.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let mut audio = Audio::new();
        if let Some(a) = audio.as_mut() {
            a.refresh_device();
        }

        let mut last_power = power();
        let mut last_caps = caps_on();
        let mut last_volume = audio.as_ref().and_then(Audio::read_volume);
        let mut last_device_check = Instant::now();

        loop {
            thread::sleep(TICK);

            let p = power();
            if let (Some((plugged, percent)), Some((was, _))) = (p, last_power) {
                if plugged != was {
                    emit(&app, SysEvent::Power { plugged, percent });
                }
            }
            last_power = p.or(last_power);

            let caps = caps_on();
            if caps != last_caps {
                last_caps = caps;
                emit(&app, SysEvent::CapsLock { on: caps });
            }

            if let Some(a) = audio.as_mut() {
                if last_device_check.elapsed() >= DEVICE_CHECK {
                    last_device_check = Instant::now();
                    if let Some(name) = a.refresh_device() {
                        let headphones = looks_like_headphones(&name);
                        emit(&app, SysEvent::AudioOutput { name, headphones });
                        // Volume do novo dispositivo vira a nova base (sem pílula de volume junto).
                        last_volume = a.read_volume();
                        continue;
                    }
                }
                let v = a.read_volume();
                if v.is_some() && v != last_volume {
                    if last_volume.is_some() && now_ms() > QUIET_UNTIL.load(Ordering::Relaxed) {
                        let (level, muted) = v.unwrap();
                        emit(&app, SysEvent::Volume { level, muted });
                    }
                    last_volume = v;
                }
            }
        }
    }
}
