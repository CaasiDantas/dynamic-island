//! Monitor do sistema: uso de hardware (aba "Hardware") e privacidade
//! (câmera e microfone em uso, pontinhos na ilha fechada).
//!
//! Uma thread acorda a cada segundo:
//! - privacidade: lê o registro de consentimento do Windows (o mesmo que
//!   acende o ícone de câmera/microfone na bandeja) e só emite quando muda;
//! - hardware: só amostra enquanto a aba está aberta (`hw_watch(true)`),
//!   então a ilha fechada não gasta nada com isso.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Privacy {
    pub camera: bool,
    pub mic: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HwStats {
    /// 0..=100
    pub cpu: Option<f32>,
    pub gpu: Option<f32>,
    pub ram_used: u64,
    pub ram_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
    /// Bytes por segundo.
    pub net_up: Option<f64>,
    pub net_down: Option<f64>,
}

#[derive(Default)]
pub struct MonitorCtl {
    watch: Arc<AtomicBool>,
    privacy: Arc<std::sync::Mutex<Privacy>>,
}

pub fn start(app: AppHandle) -> MonitorCtl {
    let ctl = MonitorCtl::default();
    let watch = ctl.watch.clone();
    let privacy = ctl.privacy.clone();
    thread::Builder::new()
        .name("monitor".into())
        .spawn(move || imp::run(app, watch, privacy))
        .expect("falha ao iniciar a thread do monitor");
    ctl
}

/// A aba de hardware abriu/fechou: liga/desliga a amostragem.
#[tauri::command]
pub fn hw_watch(ctl: State<'_, MonitorCtl>, on: bool) {
    ctl.watch.store(on, Ordering::Relaxed);
}

/// Estado atual de câmera/microfone (o frontend pede ao abrir; depois chega por evento).
#[tauri::command]
pub fn privacy_state(ctl: State<'_, MonitorCtl>) -> Privacy {
    ctl.privacy.lock().map(|p| *p).unwrap_or_default()
}

#[cfg(not(windows))]
mod imp {
    use super::Privacy;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};
    pub fn run(_app: tauri::AppHandle, _watch: Arc<AtomicBool>, _privacy: Arc<Mutex<Privacy>>) {}
}

#[cfg(windows)]
mod imp {
    use super::{HwStats, Privacy};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Emitter};
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, FILETIME};
    use windows_sys::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, IF_TYPE_SOFTWARE_LOOPBACK, MIB_IF_TABLE2};
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows_sys::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER,
        PDH_HQUERY, PDH_MORE_DATA,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_QWORD,
    };
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::GetSystemTimes;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn run(app: AppHandle, watch: Arc<AtomicBool>, privacy: Arc<Mutex<Privacy>>) {
        let mut hw = Sampler::default();
        let mut last_privacy: Option<Privacy> = None;
        loop {
            let p = Privacy { camera: in_use("webcam"), mic: in_use("microphone") };
            if last_privacy != Some(p) {
                last_privacy = Some(p);
                if let Ok(mut slot) = privacy.lock() {
                    *slot = p;
                }
                let _ = app.emit("island://privacy", p);
            }

            if watch.load(Ordering::Relaxed) {
                let stats = hw.sample();
                let _ = app.emit("island://hw", stats);
            } else if hw.started {
                // Aba fechada: a próxima abertura recomeça as diferenças do zero
                // (o contador da GPU fica aberto, é barato e evita reabrir).
                hw.started = false;
                hw.cpu = None;
                hw.net = None;
            }
            thread::sleep(Duration::from_secs(1));
        }
    }

    /* ───────── Privacidade ───────── */

    const CONSENT: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

    /// Algum app está usando o recurso agora? Cada app tem uma subchave com
    /// LastUsedTimeStart/Stop; Stop = 0 com Start preenchido = em uso.
    fn in_use(capability: &str) -> bool {
        let Some(root) = open(HKEY_CURRENT_USER, &format!(r"{CONSENT}\{capability}")) else { return false };
        let mut busy = false;
        for name in subkeys(root) {
            if name == "NonPackaged" {
                if let Some(np) = open(root, &name) {
                    busy = subkeys(np).iter().any(|n| active(np, n));
                    unsafe { RegCloseKey(np) };
                }
            } else {
                busy = active(root, &name);
            }
            if busy {
                break;
            }
        }
        unsafe { RegCloseKey(root) };
        busy
    }

    fn open(parent: HKEY, path: &str) -> Option<HKEY> {
        let path = wide(path);
        let mut key: HKEY = std::ptr::null_mut();
        // SAFETY: caminho terminado em zero; a chave aberta é fechada por quem chamou.
        let ok = unsafe { RegOpenKeyExW(parent, path.as_ptr(), 0, KEY_READ, &mut key) } == ERROR_SUCCESS;
        ok.then_some(key)
    }

    fn subkeys(key: HKEY) -> Vec<String> {
        let mut out = Vec::new();
        let mut buf = [0u16; 512];
        for i in 0.. {
            let mut len = buf.len() as u32;
            // SAFETY: buffer e tamanho válidos; ponteiros opcionais nulos.
            let r = unsafe {
                RegEnumKeyExW(key, i, buf.as_mut_ptr(), &mut len, std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut())
            };
            if r != ERROR_SUCCESS {
                break;
            }
            out.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
        out
    }

    fn qword(key: HKEY, sub: &str, value: &str) -> Option<u64> {
        let sub = wide(sub);
        let value = wide(value);
        let mut data = 0u64;
        let mut size = 8u32;
        // SAFETY: lê um QWORD para `data`, com o tamanho informado.
        let r = unsafe { RegGetValueW(key, sub.as_ptr(), value.as_ptr(), RRF_RT_REG_QWORD, std::ptr::null_mut(), (&mut data as *mut u64).cast(), &mut size) };
        (r == ERROR_SUCCESS).then_some(data)
    }

    fn active(key: HKEY, sub: &str) -> bool {
        qword(key, sub, "LastUsedTimeStop") == Some(0) && qword(key, sub, "LastUsedTimeStart").is_some_and(|s| s > 0)
    }

    /* ───────── Hardware ───────── */

    #[derive(Default)]
    struct Sampler {
        started: bool,
        cpu: Option<(u64, u64)>,
        net: Option<(u64, u64, Instant)>,
        gpu: Option<Gpu>,
        gpu_failed: bool,
    }

    impl Sampler {
        fn sample(&mut self) -> HwStats {
            self.started = true;
            let (ram_used, ram_total) = memory();
            let (disk_used, disk_total) = disk();
            let (net_up, net_down) = self.net_rate();
            HwStats { cpu: self.cpu_usage(), gpu: self.gpu_usage(), ram_used, ram_total, disk_used, disk_total, net_up, net_down }
        }

        fn cpu_usage(&mut self) -> Option<f32> {
            let ft = |f: FILETIME| ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64;
            let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
            // SAFETY: três FILETIME válidos.
            if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
                return None;
            }
            // O tempo de kernel já inclui o ocioso.
            let (idle, total) = (ft(idle), ft(kernel) + ft(user));
            let prev = self.cpu.replace((idle, total))?;
            let (di, dt) = (idle.saturating_sub(prev.0), total.saturating_sub(prev.1));
            (dt > 0).then(|| (100.0 * (1.0 - di as f64 / dt as f64)).clamp(0.0, 100.0) as f32)
        }

        fn net_rate(&mut self) -> (Option<f64>, Option<f64>) {
            let Some((rx, tx)) = net_octets() else { return (None, None) };
            let now = Instant::now();
            let Some((prx, ptx, at)) = self.net.replace((rx, tx, now)) else { return (None, None) };
            let secs = now.duration_since(at).as_secs_f64().max(0.001);
            (Some(tx.saturating_sub(ptx) as f64 / secs), Some(rx.saturating_sub(prx) as f64 / secs))
        }

        fn gpu_usage(&mut self) -> Option<f32> {
            if self.gpu.is_none() && !self.gpu_failed {
                self.gpu = Gpu::open();
                self.gpu_failed = self.gpu.is_none();
            }
            self.gpu.as_mut()?.read()
        }
    }

    fn memory() -> (u64, u64) {
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        // SAFETY: estrutura com dwLength preenchido.
        if unsafe { GlobalMemoryStatusEx(&mut m) } == 0 {
            return (0, 0);
        }
        (m.ullTotalPhys - m.ullAvailPhys, m.ullTotalPhys)
    }

    /// Disco do sistema (onde o Windows está).
    fn disk() -> (u64, u64) {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let path = wide(&format!(r"{drive}\"));
        let (mut free, mut total) = (0u64, 0u64);
        // SAFETY: caminho terminado em zero; ponteiros válidos.
        if unsafe { GetDiskFreeSpaceExW(path.as_ptr(), std::ptr::null_mut(), &mut total, &mut free) } == 0 {
            return (0, 0);
        }
        (total - free, total)
    }

    /// Bytes recebidos/enviados somando as placas de rede físicas ativas.
    fn net_octets() -> Option<(u64, u64)> {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        // SAFETY: a tabela é alocada pelo Windows e liberada com FreeMibTable.
        if unsafe { GetIfTable2(&mut table) } != ERROR_SUCCESS || table.is_null() {
            return None;
        }
        let (mut rx, mut tx) = (0u64, 0u64);
        unsafe {
            let n = (*table).NumEntries as usize;
            let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), n);
            for row in rows {
                let flags = row.InterfaceAndOperStatusFlags._bitfield;
                let hardware = flags & 0b01 != 0;
                let filter = flags & 0b10 != 0;
                if hardware && !filter && row.Type != IF_TYPE_SOFTWARE_LOOPBACK && row.OperStatus == IfOperStatusUp {
                    rx += row.InOctets;
                    tx += row.OutOctets;
                }
            }
            FreeMibTable(table.cast());
        }
        Some((rx, tx))
    }

    /// Uso da GPU pelo contador do Windows (o mesmo do Gerenciador de Tarefas):
    /// soma da utilização 3D de todos os processos.
    struct Gpu {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
    }

    impl Gpu {
        fn open() -> Option<Self> {
            let mut query: PDH_HQUERY = std::ptr::null_mut();
            let mut counter: PDH_HCOUNTER = std::ptr::null_mut();
            let path = wide(r"\GPU Engine(*engtype_3D)\Utilization Percentage");
            // SAFETY: handles de saída válidos; o query vive enquanto a thread do monitor.
            unsafe {
                if PdhOpenQueryW(std::ptr::null(), 0, &mut query) != 0 {
                    return None;
                }
                if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) != 0 {
                    return None;
                }
                PdhCollectQueryData(query);
            }
            Some(Self { query, counter })
        }

        fn read(&mut self) -> Option<f32> {
            // SAFETY: query/counter abertos em `open`; buffer dimensionado pelo próprio PDH.
            unsafe {
                if PdhCollectQueryData(self.query) != 0 {
                    return None;
                }
                let (mut size, mut count) = (0u32, 0u32);
                let r = PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, std::ptr::null_mut());
                if r != PDH_MORE_DATA {
                    return if r == 0 { Some(0.0) } else { None };
                }
                let item = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
                let mut buf: Vec<PDH_FMT_COUNTERVALUE_ITEM_W> = Vec::with_capacity(size as usize / item + 1);
                if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, buf.as_mut_ptr()) != 0 {
                    return None;
                }
                buf.set_len(count as usize);
                let total: f64 = buf.iter().filter(|i| i.FmtValue.CStatus <= 1).map(|i| i.FmtValue.Anonymous.doubleValue).sum();
                Some(total.clamp(0.0, 100.0) as f32)
            }
        }
    }
}

