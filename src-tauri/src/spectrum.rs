//! Espectro do som que está saindo do PC, para o visualizador da música.
//!
//! Captura em loopback (WASAPI) a saída de áudio padrão: é o mesmo sinal que
//! vai para o fone/caixa, de qualquer app. A cada ~33 ms pega os últimos
//! 1024 samples, aplica FFT e reduz a `BARS` faixas de frequência (grave →
//! agudo), já normalizadas e suavizadas. O frontend só aplica a altura.
//!
//! Só roda enquanto o frontend pede (`spectrum_watch(true)`: música tocando
//! e alguma vista com barras na tela). Parado, a thread fica bloqueada no
//! canal e não toca no áudio.

use std::sync::mpsc::{self, Sender};
use std::thread;

use tauri::{AppHandle, State};

/// Barras do visualizador (grave → agudo).
pub const BARS: usize = 5;

pub struct SpectrumBridge(Sender<bool>);

#[tauri::command]
pub fn spectrum_watch(bridge: State<'_, SpectrumBridge>, on: bool) -> Result<(), String> {
    bridge.0.send(on).map_err(|_| "analisador de áudio parado".to_string())
}

pub fn start(app: AppHandle) -> SpectrumBridge {
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("audio-spectrum".into())
        .spawn(move || imp::run(app, rx))
        .expect("falha ao iniciar a thread do espectro");
    SpectrumBridge(tx)
}

const FFT_N: usize = 1024;

/// Limites das faixas em Hz: graves, médio-graves, médios, presença, agudos.
const BAND_EDGES: [f32; BARS + 1] = [45.0, 180.0, 550.0, 1600.0, 4500.0, 12000.0];

/// FFT radix-2 iterativa, no lugar.
fn fft(re: &mut [f32; FFT_N], im: &mut [f32; FFT_N]) {
    let n = FFT_N;
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f32::consts::PI / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let a = start + k;
                let b = a + len / 2;
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let next = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = next;
            }
        }
        len <<= 1;
    }
}

/// Últimos samples (mono) num anel; a janela da FFT é lida dele.
struct Ring {
    buf: Vec<f32>,
    pos: usize,
}

impl Ring {
    fn new() -> Self {
        Self { buf: vec![0.0; FFT_N], pos: 0 }
    }

    fn push(&mut self, v: f32) {
        self.buf[self.pos] = v;
        self.pos = (self.pos + 1) % FFT_N;
    }

    fn silence(&mut self, n: usize) {
        for _ in 0..n.min(FFT_N) {
            self.push(0.0);
        }
    }
}

/// FFT → energia por faixa → escala com ganho automático → suavização.
struct Analyzer {
    window: [f32; FFT_N],
    /// Pico recente de cada faixa (dB); desce devagar para o ganho se adaptar à música.
    peak: [f32; BARS],
    level: [f32; BARS],
}

impl Analyzer {
    fn new() -> Self {
        let mut window = [0.0; FFT_N];
        for (i, w) in window.iter_mut().enumerate() {
            *w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_N - 1) as f32).cos();
        }
        Self { window, peak: [-50.0; BARS], level: [0.0; BARS] }
    }

    fn reset(&mut self) {
        self.peak = [-50.0; BARS];
        self.level = [0.0; BARS];
    }

    /// Alturas 0..=100 de cada barra.
    fn compute(&mut self, ring: &Ring, rate: f32) -> [u8; BARS] {
        let mut re = [0.0f32; FFT_N];
        let mut im = [0.0f32; FFT_N];
        for i in 0..FFT_N {
            re[i] = ring.buf[(ring.pos + i) % FFT_N] * self.window[i];
        }
        fft(&mut re, &mut im);

        let bin_hz = rate / FFT_N as f32;
        let mut out = [0u8; BARS];
        for b in 0..BARS {
            let lo = ((BAND_EDGES[b] / bin_hz).floor() as usize).max(1);
            let hi = ((BAND_EDGES[b + 1] / bin_hz).ceil() as usize).clamp(lo + 1, FFT_N / 2);
            let energy: f32 = (lo..hi).map(|k| re[k] * re[k] + im[k] * im[k]).sum::<f32>() / (hi - lo) as f32;
            let db = 10.0 * (energy + 1e-12).log10();

            // Ganho automático: o pico acompanha a música (sobe na hora, desce ~3 dB/s).
            self.peak[b] = if db > self.peak[b] { db } else { (self.peak[b] - 0.1).max(-50.0) };
            let floor = self.peak[b] - 30.0;
            let target = if db < -70.0 { 0.0 } else { ((db - floor) / (self.peak[b] - floor)).clamp(0.0, 1.0).powf(1.6) };

            // Sobe rápido (batida), desce mais devagar (não pisca).
            let k = if target > self.level[b] { 0.65 } else { 0.28 };
            self.level[b] += (target - self.level[b]) * k;
            out[b] = (self.level[b] * 100.0).round() as u8;
        }
        out
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::mpsc::{Receiver, TryRecvError};
    use std::thread;
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Emitter};
    use windows::core::GUID;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
        AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

    use super::{Analyzer, Ring, BARS};

    const TICK: Duration = Duration::from_millis(33);
    const DEVICE_CHECK: Duration = Duration::from_secs(2);
    const REOPEN_DELAY: Duration = Duration::from_secs(1);
    /// Buffer do WASAPI: 200 ms (em unidades de 100 ns).
    const BUFFER_HNS: i64 = 2_000_000;

    const FORMAT_PCM: u16 = 1;
    const FORMAT_FLOAT: u16 = 3;
    const FORMAT_EXTENSIBLE: u16 = 0xFFFE;
    const SUBTYPE_FLOAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
    const SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);

    #[derive(Clone, Copy)]
    enum Sample {
        F32,
        I16,
    }

    struct Capture {
        client: IAudioClient,
        capture: IAudioCaptureClient,
        channels: usize,
        rate: f32,
        sample: Sample,
        device_id: String,
    }

    impl Drop for Capture {
        fn drop(&mut self) {
            // SAFETY: cliente vivo, mesma thread que o iniciou.
            let _ = unsafe { self.client.Stop() };
        }
    }

    fn default_id(enumerator: &IMMDeviceEnumerator) -> Option<String> {
        // SAFETY: COM iniciado nesta thread; a string é liberada depois de copiada.
        unsafe {
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
            let p = device.GetId().ok()?;
            let s = p.to_string().unwrap_or_default();
            CoTaskMemFree(Some(p.0 as _));
            Some(s)
        }
    }

    fn open(enumerator: &IMMDeviceEnumerator) -> Option<Capture> {
        // SAFETY: chamadas COM nesta thread (MTA); o formato devolvido pelo WASAPI
        // é lido sem alinhamento (struct empacotada) e liberado com CoTaskMemFree.
        unsafe {
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
            let device_id = default_id(enumerator).unwrap_or_default();
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).ok()?;
            let fmt_ptr = client.GetMixFormat().ok()?;
            let fmt: WAVEFORMATEX = std::ptr::read_unaligned(fmt_ptr);
            let bits = fmt.wBitsPerSample;
            let sample = match fmt.wFormatTag {
                FORMAT_FLOAT if bits == 32 => Some(Sample::F32),
                FORMAT_PCM if bits == 16 => Some(Sample::I16),
                FORMAT_EXTENSIBLE => {
                    let ext: WAVEFORMATEXTENSIBLE = std::ptr::read_unaligned(fmt_ptr as *const WAVEFORMATEXTENSIBLE);
                    let sub = ext.SubFormat;
                    if sub == SUBTYPE_FLOAT && bits == 32 {
                        Some(Sample::F32)
                    } else if sub == SUBTYPE_PCM && bits == 16 {
                        Some(Sample::I16)
                    } else {
                        None
                    }
                }
                _ => None,
            };
            let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, BUFFER_HNS, 0, fmt_ptr, None);
            CoTaskMemFree(Some(fmt_ptr as _));
            let sample = sample?;
            init.ok()?;
            let capture: IAudioCaptureClient = client.GetService().ok()?;
            client.Start().ok()?;
            Some(Capture {
                client,
                capture,
                channels: (fmt.nChannels as usize).max(1),
                rate: fmt.nSamplesPerSec as f32,
                sample,
                device_id,
            })
        }
    }

    impl Capture {
        /// Lê tudo o que chegou desde a última vez. Devolve quantos frames vieram.
        fn drain(&self, ring: &mut Ring) -> Result<usize, ()> {
            let mut total = 0;
            // SAFETY: o ponteiro do GetBuffer vale até o ReleaseBuffer e tem
            // `frames * channels` samples no formato negociado.
            unsafe {
                loop {
                    let n = self.capture.GetNextPacketSize().map_err(|_| ())?;
                    if n == 0 {
                        break;
                    }
                    let mut data = std::ptr::null_mut();
                    let mut frames = 0u32;
                    let mut flags = 0u32;
                    self.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).map_err(|_| ())?;
                    let count = frames as usize;
                    let ch = self.channels;
                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                        ring.silence(count);
                    } else {
                        match self.sample {
                            Sample::F32 => {
                                let s = std::slice::from_raw_parts(data as *const f32, count * ch);
                                for f in s.chunks_exact(ch) {
                                    ring.push(f.iter().sum::<f32>() / ch as f32);
                                }
                            }
                            Sample::I16 => {
                                let s = std::slice::from_raw_parts(data as *const i16, count * ch);
                                for f in s.chunks_exact(ch) {
                                    ring.push(f.iter().map(|&v| v as f32 / 32768.0).sum::<f32>() / ch as f32);
                                }
                            }
                        }
                    }
                    self.capture.ReleaseBuffer(frames).map_err(|_| ())?;
                    total += count;
                }
            }
            Ok(total)
        }
    }

    fn emit(app: &AppHandle, bars: &[u8; BARS]) {
        let _ = app.emit("island://spectrum", bars);
    }

    pub fn run(app: AppHandle, rx: Receiver<bool>) {
        // SAFETY: esta thread é dona de todos os objetos de áudio daqui.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        // SAFETY: COM iniciado acima.
        let Ok(enumerator) = (unsafe { CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) }) else {
            // Sem áudio no sistema: só consome os pedidos.
            while rx.recv().is_ok() {}
            return;
        };

        let mut analyzer = Analyzer::new();
        let mut ring = Ring::new();
        loop {
            // Parado: espera alguém pedir.
            match rx.recv() {
                Ok(true) => {}
                Ok(false) => continue,
                Err(_) => return,
            }

            let mut capture: Option<Capture> = None;
            let mut last_open: Option<Instant> = None;
            let mut last_check = Instant::now();
            let mut last_tick = Instant::now();
            let mut sent = [255u8; BARS];

            'watch: loop {
                loop {
                    match rx.try_recv() {
                        Ok(true) => {}
                        Ok(false) => break 'watch,
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Disconnected) => return,
                    }
                }

                if capture.is_none() && last_open.is_none_or(|t| t.elapsed() >= REOPEN_DELAY) {
                    last_open = Some(Instant::now());
                    capture = open(&enumerator);
                }
                // Saída padrão trocou (ex.: fone): reabre no novo dispositivo.
                if last_check.elapsed() >= DEVICE_CHECK {
                    last_check = Instant::now();
                    if let Some(c) = &capture {
                        if default_id(&enumerator).is_some_and(|id| id != c.device_id) {
                            capture = None;
                        }
                    }
                }

                let elapsed = last_tick.elapsed();
                last_tick = Instant::now();
                let rate = capture.as_ref().map_or(48_000.0, |c| c.rate);
                let got = match &capture {
                    Some(c) => c.drain(&mut ring).unwrap_or_else(|_| {
                        capture = None;
                        0
                    }),
                    None => 0,
                };
                // Sem som tocando o loopback não entrega nada: completa com silêncio.
                if got == 0 {
                    ring.silence((elapsed.as_secs_f32() * rate) as usize);
                }

                let bars = analyzer.compute(&ring, rate);
                if bars != sent {
                    emit(&app, &bars);
                    sent = bars;
                }
                thread::sleep(TICK);
            }

            drop(capture);
            analyzer.reset();
            ring.silence(super::FFT_N);
            emit(&app, &[0; BARS]);
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::sync::mpsc::Receiver;
    use tauri::AppHandle;

    pub fn run(_app: AppHandle, rx: Receiver<bool>) {
        while rx.recv().is_ok() {}
    }
}
