//! Claude via Claude Code instalado no PC (CLI em modo headless, `claude -p`).
//!
//! Nada de chave de API: usa o login do próprio Claude Code. Cada pergunta
//! abre um processo `claude.exe`, manda o texto pela entrada padrão e lê a
//! saída `stream-json` linha a linha numa thread própria. O frontend recebe
//! eventos já simplificados (texto, ferramenta em uso, fim) em `island://claude`.
//!
//! Ferramentas liberadas só de leitura (Read/Glob/Grep + busca na web): a
//! ilha pode responder sobre o código de uma pasta, nunca alterá-lo.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

const SYSTEM_PROMPT: &str = "Voce responde dentro de uma Dynamic Island pequena no topo da tela do Windows. \
Responda em portugues do Brasil, de forma direta e curta. Use markdown simples: paragrafos curtos, listas e blocos de codigo. \
Evite tabelas e titulos grandes.";

/// Com pasta: lê o código. Sem pasta: só web.
const TOOLS_WITH_FOLDER: &str = "Read,Glob,Grep,WebSearch,WebFetch";
const TOOLS_NO_FOLDER: &str = "WebSearch,WebFetch";

/// Processos em andamento, por id de pedido (o frontend escolhe o id).
#[derive(Default)]
pub struct ClaudeRuns(pub(crate) Mutex<HashMap<u64, Child>>);

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum ClaudeEvent {
    /// Sessão criada/retomada: o frontend guarda o id para as próximas perguntas.
    Session { id: u64, session_id: String },
    /// Pedaço de texto da resposta, na ordem em que chega.
    Text { id: u64, text: String },
    /// Claude usou uma ferramenta (ex.: leu um arquivo).
    Tool { id: u64, name: String, detail: String },
    /// Contexto ocupado na conversa (tokens) e o tamanho da janela, quando conhecido.
    Usage { id: u64, tokens: u64, window: Option<u64> },
    /// Limites de uso do plano (janela de 5 horas, semana...), quando a IA informa.
    Limits { id: u64, windows: Vec<LimitWindow> },
    /// Fim do pedido. `text` é a resposta final ou a mensagem de erro.
    Done { id: u64, ok: bool, cancelled: bool, text: String, session_id: Option<String> },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LimitWindow {
    /// "five_hour", "seven_day", "seven_day_opus"...
    pub kind: String,
    /// Quanto já foi usado, de 0 a 1.
    pub used: f64,
    /// Quando zera (segundos desde 1970), se informado.
    pub resets_at: Option<u64>,
}

pub(crate) fn emit(app: &AppHandle, event: ClaudeEvent) {
    let _ = app.emit("island://claude", event);
}

/// Acha o `claude.exe` nativo. O atalho do npm (`claude.cmd`) só repassa para ele,
/// e chamar o .exe direto evita janela de console e facilita encerrar o processo.
pub(crate) fn find_claude() -> Option<PathBuf> {
    for dir in crate::ai::path_dirs() {
        let exe = dir.join("claude.exe");
        if exe.is_file() {
            return Some(exe);
        }
        if dir.join("claude.cmd").is_file() {
            let inner = dir.join(r"node_modules\@anthropic-ai\claude-code\bin\claude.exe");
            if inner.is_file() {
                return Some(inner);
            }
        }
    }
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from)?;
    [
        home.join(r".local\bin\claude.exe"),
        home.join(r"AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe"),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

/// Pasta neutra para conversas sem pasta escolhida (o Claude Code guarda as sessões por pasta).
pub(crate) fn scratch_dir(app: &AppHandle, name: &str) -> PathBuf {
    let dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("dynamic-island"))
        .join(name);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub fn claude_ask(
    app: AppHandle,
    runs: State<'_, ClaudeRuns>,
    id: u64,
    prompt: String,
    folder: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let exe = find_claude().ok_or("Claude Code não encontrado. Conecte o Claude de novo para instalar.")?;

    let folder = folder.filter(|f| !f.trim().is_empty());
    let cwd = match &folder {
        Some(f) => {
            let p = PathBuf::from(f);
            if !p.is_dir() {
                return Err(format!("Pasta não encontrada: {f}"));
            }
            p
        }
        None => scratch_dir(&app, "claude"),
    };
    let tools = if folder.is_some() { TOOLS_WITH_FOLDER } else { TOOLS_NO_FOLDER };

    let mut cmd = Command::new(exe);
    cmd.current_dir(&cwd)
        .args(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
        // Sem servidores MCP: abre mais rápido e não expõe ferramentas extras.
        .arg("--strict-mcp-config")
        .args(["--tools", tools, "--allowedTools", tools])
        .args(["--append-system-prompt", SYSTEM_PROMPT]);
    if let Some(session) = session_id.as_deref().filter(|s| is_session_id(s)) {
        cmd.args(["--resume", session]);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Não consegui abrir o Claude Code: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("sem entrada padrão")?;
    let stdout = child.stdout.take().ok_or("sem saída padrão")?;
    let mut stderr = child.stderr.take().ok_or("sem saída de erro")?;

    // A pergunta vai pela entrada padrão: nada de escapar aspas na linha de comando.
    thread::spawn(move || {
        let _ = stdin.write_all(prompt.as_bytes());
    });

    let stderr_reader = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf);
        buf
    });

    runs.0.lock().map_err(|_| "estado do Claude travado")?.insert(id, child);

    thread::Builder::new()
        .name(format!("claude-{id}"))
        .spawn(move || read_stream(app, id, stdout, stderr_reader))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Encerra um pedido em andamento. O leitor percebe o fim da saída e avisa o frontend.
#[tauri::command]
pub fn claude_cancel(runs: State<'_, ClaudeRuns>, id: u64) {
    let child = runs.0.lock().ok().and_then(|mut map| map.remove(&id));
    if let Some(mut child) = child {
        crate::ai::kill_tree(&mut child);
    }
}

/// Dá foco de teclado à janela da ilha (ela nasce sem foco para não roubar o do app atual).
#[tauri::command]
pub fn focus_island(window: tauri::WebviewWindow) -> Result<(), String> {
    window.set_focus().map_err(|e| e.to_string())
}

pub(crate) fn is_session_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn read_stream(app: AppHandle, id: u64, stdout: std::process::ChildStdout, stderr_reader: thread::JoinHandle<String>) {
    let mut seen_tools = HashSet::new();
    let mut session: Option<String> = None;
    let mut finished = false;
    let mut window: Option<u64> = Some(200_000);

    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        match v["type"].as_str() {
            Some("system") if v["subtype"] == "init" => {
                // Modelos com contexto de 1 milhão vêm marcados com [1m].
                if let Some(model) = v["model"].as_str() {
                    window = Some(if model.contains("[1m]") { 1_000_000 } else { 200_000 });
                }
                if let Some(s) = v["session_id"].as_str() {
                    session = Some(s.to_string());
                    emit(&app, ClaudeEvent::Session { id, session_id: s.to_string() });
                }
            }
            Some("stream_event") => {
                let ev = &v["event"];
                if ev["type"] == "content_block_delta" && ev["delta"]["type"] == "text_delta" {
                    if let Some(text) = ev["delta"]["text"].as_str() {
                        emit(&app, ClaudeEvent::Text { id, text: text.to_string() });
                    }
                }
            }
            Some("assistant") => {
                // Contexto ocupado = tudo que entrou nesta chamada + o que saiu.
                let u = &v["message"]["usage"];
                let tokens = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]
                    .iter()
                    .filter_map(|k| u[*k].as_u64())
                    .sum::<u64>();
                if tokens > 0 {
                    emit(&app, ClaudeEvent::Usage { id, tokens, window });
                }
                // O texto já veio aos pedaços; daqui só interessam as ferramentas usadas.
                let Some(blocks) = v["message"]["content"].as_array() else { continue };
                for b in blocks.iter().filter(|b| b["type"] == "tool_use") {
                    let tool_id = b["id"].as_str().unwrap_or_default().to_string();
                    if !seen_tools.insert(tool_id) {
                        continue;
                    }
                    let name = b["name"].as_str().unwrap_or("ferramenta").to_string();
                    emit(&app, ClaudeEvent::Tool { id, detail: tool_detail(&b["input"]), name });
                }
            }
            Some("rate_limit_event") => {
                // Janelas do plano (5 horas e semana), com quanto já foi usado.
                let info = &v["rate_limit_info"];
                let mut windows = Vec::new();
                if let Some(map) = info["unifiedWindows"].as_object() {
                    for (kind, w) in map {
                        if let Some(used) = w["utilization"].as_f64() {
                            windows.push(LimitWindow { kind: kind.clone(), used, resets_at: w["resetsAt"].as_u64() });
                        }
                    }
                }
                if !windows.is_empty() {
                    emit(&app, ClaudeEvent::Limits { id, windows });
                }
            }
            Some("result") => {
                finished = true;
                let ok = v["subtype"] == "success" && v["is_error"] != true;
                let text = v["result"].as_str().unwrap_or_default().to_string();
                let session_id = v["session_id"].as_str().map(str::to_string).or(session.clone());
                emit(&app, ClaudeEvent::Done { id, ok, cancelled: false, text, session_id });
            }
            _ => {}
        }
    }

    // Fim da saída: tira o processo da lista (se ainda estiver lá, terminou sozinho).
    let still_running = app.state::<ClaudeRuns>().0.lock().ok().and_then(|mut map| map.remove(&id));
    let cancelled = still_running.is_none() && !finished;
    if let Some(mut child) = still_running {
        let _ = child.wait();
    }
    if !finished {
        let err = stderr_reader.join().unwrap_or_default().trim().to_string();
        let text = if cancelled {
            String::new()
        } else if err.is_empty() {
            "O Claude Code encerrou sem responder.".to_string()
        } else {
            err.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
        };
        emit(&app, ClaudeEvent::Done { id, ok: false, cancelled, text, session_id: session });
    }
}

/// Resumo curto do que a ferramenta recebeu: arquivo, padrão de busca, endereço...
pub(crate) fn tool_detail(input: &Value) -> String {
    for key in ["file_path", "path", "pattern", "query", "url"] {
        if let Some(s) = input[key].as_str() {
            let s = s.replace('\\', "/");
            // Caminhos longos: só as duas últimas partes.
            if key.ends_with("path") {
                let parts: Vec<&str> = s.rsplit('/').take(2).collect();
                return parts.into_iter().rev().collect::<Vec<_>>().join("/");
            }
            return s.chars().take(80).collect();
        }
    }
    String::new()
}
