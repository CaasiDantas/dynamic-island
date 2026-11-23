//! Mídia do Windows via SMTC (GlobalSystemMediaTransportControls).
//!
//! É o mesmo controle de mídia da bandeja de volume do Windows: enxerga o
//! Spotify, o YouTube aberto no navegador e qualquer player que publique a
//! sessão. Nada de login ou API externa.
//!
//! Uma única thread é dona dos objetos WinRT: lê o estado uma vez por segundo
//! e só avisa o frontend quando algo mudou. Os comandos (tocar/pausar,
//! próxima, anterior) chegam por um canal e são executados nessa mesma thread.

use std::sync::mpsc::{self, Sender};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Serialize, Clone, PartialEq, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    /// Nome amigável do app (Spotify, Chrome, Edge...).
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub position_ms: f64,
    pub duration_ms: f64,
    /// Horário (Unix, ms) em que `position_ms` foi medida pelo app.
    pub updated_at: f64,
    pub can_prev: bool,
    pub can_next: bool,
    pub can_toggle: bool,
    /// Capa como data URL; só muda quando a faixa muda.
    pub artwork: Option<String>,
}

pub enum MediaCmd {
    Toggle,
    Next,
    Prev,
    /// Pula para a posição (ms desde o início da faixa).
    Seek(f64),
    /// Reenvia o estado atual (o frontend pede ao montar).
    Refresh,
}

pub struct MediaBridge(Sender<MediaCmd>);

#[tauri::command]
pub fn media_control(bridge: State<'_, MediaBridge>, action: String, value: Option<f64>) -> Result<(), String> {
    let cmd = match action.as_str() {
        "seek" => MediaCmd::Seek(value.ok_or("seek sem posição")?.max(0.0)),
        "toggle" => MediaCmd::Toggle,
        "next" => MediaCmd::Next,
        "prev" => MediaCmd::Prev,
        "refresh" => MediaCmd::Refresh,
        other => return Err(format!("ação de mídia desconhecida: {other}")),
    };
    bridge.0.send(cmd).map_err(|_| "leitor de mídia parado".to_string())
}

pub fn start(app: AppHandle) -> MediaBridge {
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("media-smtc".into())
        .spawn(move || imp::run(app, rx))
        .expect("falha ao iniciar a thread de mídia");
    MediaBridge(tx)
}

/// Nome amigável a partir do AppUserModelId da sessão.
fn app_name(id: &str) -> String {
    let lower = id.to_lowercase();
    const KNOWN: &[(&str, &str)] = &[
        ("spotify", "Spotify"),
        ("msedge", "Edge"),
        ("chrome", "Chrome"),
        ("firefox", "Firefox"),
        ("308046b0af4a39cb", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("vivaldi", "Vivaldi"),
        ("zunemusic", "Media Player"),
        ("vlc", "VLC"),
        ("deezer", "Deezer"),
        ("tidal", "TIDAL"),
        ("applemusic", "Apple Music"),
        ("amazonmusic", "Amazon Music"),
    ];
    if let Some((_, name)) = KNOWN.iter().find(|(key, _)| lower.contains(key)) {
        return (*name).to_string();
    }
    let base = id.rsplit(['\\', '/', '!']).next().unwrap_or(id);
    let base = base.strip_suffix(".exe").or_else(|| base.strip_suffix(".EXE")).unwrap_or(base);
    base.to_string()
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Tipo da imagem pelos primeiros bytes (alguns apps não informam).
pub(crate) fn sniff_mime(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        [b'B', b'M', ..] => "image/bmp",
        _ => "image/jpeg",
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::mpsc::{Receiver, RecvTimeoutError};
    use std::thread;
    use std::time::Duration;

    use tauri::{AppHandle, Emitter};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;

    use super::{app_name, base64, sniff_mime, MediaCmd, MediaInfo};

    const POLL: Duration = Duration::from_millis(1000);
    /// Depois de um comando, lê de novo logo para o botão responder rápido.
    const FAST_POLL: Duration = Duration::from_millis(150);
    /// A capa às vezes chega depois do título: tenta algumas vezes por faixa.
    const ART_TRIES: u8 = 6;
    /// Diferença entre a época do Windows (1601) e a Unix (1970), em 100 ns.
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;

    pub fn run(app: AppHandle, rx: Receiver<MediaCmd>) {
        let manager = loop {
            match Manager::RequestAsync().and_then(|op| op.join()) {
                Ok(manager) => break manager,
                Err(_) => {
                    // Serviço de mídia indisponível agora: tenta de novo sem travar nada.
                    if wait(&rx, Duration::from_secs(5)).is_err() {
                        return;
                    }
                }
            }
        };

        let mut sent: Option<MediaInfo> = None;
        let mut force = true;
        let mut art_key = String::new();
        let mut art: Option<String> = None;
        let mut art_tries = 0u8;
        let mut fast_left = 0u8;

        loop {
            let picked = pick_session(&manager);
            let session = picked.as_ref().map(|(s, _, _)| s.clone());
            let info = picked.and_then(|(_, props, mut info)| {
                let key = format!("{}|{}|{}", info.app, info.title, info.artist);
                if key != art_key {
                    art_key = key;
                    art = None;
                    art_tries = 0;
                }
                if art.is_none() && art_tries < ART_TRIES {
                    art_tries += 1;
                    art = thumbnail(&props);
                }
                info.artwork = art.clone();
                Some(info)
            });

            if force || info != sent {
                let _ = app.emit("island://media", &info);
                sent = info;
                force = false;
            }

            let timeout = if fast_left > 0 {
                fast_left -= 1;
                FAST_POLL
            } else {
                POLL
            };
            match wait(&rx, timeout) {
                Ok(Some(MediaCmd::Refresh)) => force = true,
                Ok(Some(cmd)) => {
                    if let Some(s) = &session {
                        let op = match cmd {
                            MediaCmd::Toggle => s.TryTogglePlayPauseAsync(),
                            MediaCmd::Next => s.TrySkipNextAsync(),
                            MediaCmd::Prev => s.TrySkipPreviousAsync(),
                            // A posição pedida é absoluta, em unidades de 100 ns, a partir do StartTime.
                            MediaCmd::Seek(ms) => {
                                let start = s.GetTimelineProperties().and_then(|t| t.StartTime()).map(|t| t.Duration).unwrap_or(0);
                                s.TryChangePlaybackPositionAsync(start + (ms * 10_000.0) as i64)
                            }
                            MediaCmd::Refresh => unreachable!(),
                        };
                        let _ = op.and_then(|op| op.join());
                    }
                    fast_left = 4;
                }
                Ok(None) => {}
                Err(()) => return,
            }
        }
    }

    /// Espera um comando ou o tempo acabar. Err = app encerrando.
    fn wait(rx: &Receiver<MediaCmd>, timeout: Duration) -> Result<Option<MediaCmd>, ()> {
        match rx.recv_timeout(timeout) {
            Ok(cmd) => Ok(Some(cmd)),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => {
                // Sem remetente: o app está fechando.
                thread::yield_now();
                Err(())
            }
        }
    }

    /// Escolhe a sessão a mostrar: a "atual" do Windows se estiver tocando;
    /// senão outra que esteja tocando; senão a primeira com algo para mostrar.
    /// Sessões sem título (alguns players) são ignoradas.
    fn pick_session(manager: &Manager) -> Option<(Session, Properties, MediaInfo)> {
        let mut candidates: Vec<Session> = Vec::new();
        if let Ok(current) = manager.GetCurrentSession() {
            candidates.push(current);
        }
        if let Ok(sessions) = manager.GetSessions() {
            for session in sessions {
                if !candidates.iter().any(|c| c == &session) {
                    candidates.push(session);
                }
            }
        }
        let mut fallback = None;
        for session in candidates {
            let Some(props) = session.TryGetMediaPropertiesAsync().and_then(|op| op.join()).ok() else {
                continue;
            };
            let Some(info) = read(&session, &props) else { continue };
            if info.playing {
                return Some((session, props, info));
            }
            fallback.get_or_insert((session, props, info));
        }
        fallback
    }

    fn read(session: &Session, props: &Properties) -> Option<MediaInfo> {
        let title = props.Title().ok()?.to_string();
        if title.trim().is_empty() {
            return None;
        }
        let playback = session.GetPlaybackInfo().ok()?;
        let controls = playback.Controls().ok();
        let timeline = session.GetTimelineProperties().ok();

        let ticks_to_ms = |t: i64| t as f64 / 10_000.0;
        let (position_ms, duration_ms, updated_at) = timeline
            .and_then(|t| {
                let start = t.StartTime().ok()?.Duration;
                let end = t.EndTime().ok()?.Duration;
                let pos = t.Position().ok()?.Duration;
                let updated = t.LastUpdatedTime().ok()?.UniversalTime;
                Some((
                    ticks_to_ms(pos - start).max(0.0),
                    ticks_to_ms(end - start).max(0.0),
                    ticks_to_ms(updated - EPOCH_DIFF),
                ))
            })
            .unwrap_or((0.0, 0.0, 0.0));

        Some(MediaInfo {
            app: app_name(&session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default()),
            title,
            artist: props.Artist().map(|s| s.to_string()).unwrap_or_default(),
            album: props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default(),
            playing: playback.PlaybackStatus().map(|s| s == Status::Playing).unwrap_or(false),
            position_ms,
            duration_ms,
            updated_at,
            can_prev: controls.as_ref().and_then(|c| c.IsPreviousEnabled().ok()).unwrap_or(false),
            can_next: controls.as_ref().and_then(|c| c.IsNextEnabled().ok()).unwrap_or(false),
            can_toggle: controls.as_ref().and_then(|c| c.IsPlayPauseToggleEnabled().ok()).unwrap_or(true),
            artwork: None,
        })
    }

    fn thumbnail(props: &Properties) -> Option<String> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 4_000_000 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.join().ok()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        let declared = stream.ContentType().map(|s| s.to_string()).unwrap_or_default();
        let mime = if declared.starts_with("image/") { declared.as_str() } else { sniff_mime(&bytes) };
        Some(format!("data:{mime};base64,{}", base64(&bytes)))
    }
}

#[cfg(not(windows))]
mod imp {
    use std::sync::mpsc::Receiver;
    use tauri::{AppHandle, Emitter};

    use super::{MediaCmd, MediaInfo};

    pub fn run(app: AppHandle, rx: Receiver<MediaCmd>) {
        while let Ok(_) = rx.recv() {
            let _ = app.emit("island://media", None::<MediaInfo>);
        }
    }
}
