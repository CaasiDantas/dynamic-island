//! "Conectar minha IA": cada IA é usada pelo programa oficial dela, com o login
//! da própria pessoa (assinatura), nunca chave de API.
//!
//! - Claude  → Claude Code (`claude`), instalador oficial da Anthropic.
//! - ChatGPT → Codex CLI (`codex`), pelo npm.
//! - Gemini  → Gemini CLI (`gemini`), pelo npm.
//! - Cursor  → Cursor CLI (`agent`), instalador oficial do Cursor.
//!
//! O que vem pelo npm instala o Node.js pelo winget se faltar.
//!
//! Aqui ficam: descobrir o que está instalado e logado, instalar com progresso,
//! abrir o login oficial numa janela própria e mandar perguntas. As respostas
//! saem no mesmo canal do Claude (`island://claude`), então a tela do chat é uma só.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::claude::{self, emit, ClaudeEvent, ClaudeRuns, LimitWindow};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

/// Instruções que vão na frente da primeira pergunta (Codex e Cursor não têm "prompt de sistema" por linha de comando).
const PREAMBLE: &str = "[Instrucoes: voce responde dentro de uma Dynamic Island pequena no topo da tela do Windows. \
Responda em portugues do Brasil, de forma direta e curta, com markdown simples (paragrafos curtos, listas, blocos de codigo). \
Evite tabelas e titulos grandes. Nao altere arquivos.]\n\n";

/// O Gemini junta a entrada padrão (a pergunta) com o texto do `-p` logo depois.
const GEMINI_HINT: &str = "Responda em portugues do Brasil, de forma direta e curta, com markdown simples. Nao altere arquivos.";

/* ───────── Onde os programas estão ───────── */

/// PATH lido do registro depois de uma instalação: o processo da ilha nasceu com o
/// PATH antigo, e o Node/CLI recém-instalados só aparecem no registro.
static FRESH_PATH: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Pastas do PATH do processo + as que surgiram no registro depois de instalar algo.
pub(crate) fn path_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Ok(fresh) = FRESH_PATH.lock() {
        for d in fresh.iter() {
            if !dirs.contains(d) {
                dirs.push(d.clone());
            }
        }
    }
    dirs
}

/// Relê o PATH do usuário e da máquina no registro (sem reiniciar o app).
fn refresh_path() {
    let mut dirs = Vec::new();
    for key in [r"HKCU\Environment", r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"] {
        let Ok(out) = hidden(Command::new("reg")).args(["query", key, "/v", "Path"]).output() else { continue };
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let line = line.trim();
            let Some(rest) = line.strip_prefix("Path").or_else(|| line.strip_prefix("PATH")) else { continue };
            let value = rest.trim_start().splitn(2, char::is_whitespace).nth(1).unwrap_or("").trim();
            dirs.extend(value.split(';').filter(|s| !s.trim().is_empty()).map(|s| PathBuf::from(expand_env(s.trim()))));
        }
    }
    if let Ok(mut fresh) = FRESH_PATH.lock() {
        *fresh = dirs;
    }
}

/// Troca %VAR% pelo valor (o registro guarda o PATH sem expandir).
fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                out.push_str(&std::env::var(name).unwrap_or_else(|_| format!("%{name}%")));
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn hidden(mut cmd: Command) -> Command {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Encerra o processo e tudo o que ele abriu (os CLIs do npm rodam node → programa).
pub(crate) fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = hidden(Command::new("taskkill")).args(["/PID", &child.id().to_string(), "/T", "/F"]).output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default()
}

fn find_in(dirs: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    names.iter().flat_map(|n| dirs.iter().map(move |d| d.join(n))).find(|p| p.is_file())
}

fn find_file(names: &[&str]) -> Option<PathBuf> {
    find_in(&path_dirs(), names)
}

fn find_node() -> Option<PathBuf> {
    find_file(&["node.exe"]).or_else(|| {
        let pf = std::env::var_os("ProgramFiles").map(PathBuf::from)?;
        Some(pf.join(r"nodejs\node.exe")).filter(|p| p.is_file())
    })
}

/// Como abrir um CLI: o .exe direto, node + script (npm), um .cmd ou um .ps1.
enum Launcher {
    Exe(PathBuf),
    Node { node: PathBuf, script: PathBuf },
    Cmd(PathBuf),
    Ps1(PathBuf),
}

impl Launcher {
    fn from_path(p: PathBuf) -> Launcher {
        match p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
            Some("cmd") | Some("bat") => Launcher::Cmd(p),
            Some("ps1") => Launcher::Ps1(p),
            _ => Launcher::Exe(p),
        }
    }

    fn command(&self) -> Command {
        match self {
            Launcher::Exe(p) => Command::new(p),
            Launcher::Node { node, script } => {
                let mut c = Command::new(node);
                c.arg(script);
                c
            }
            // O Rust escapa os argumentos de .cmd/.bat com segurança quando chama o arquivo direto.
            Launcher::Cmd(p) => Command::new(p),
            Launcher::Ps1(p) => {
                let mut c = Command::new("powershell");
                c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(p);
                c
            }
        }
    }
}

/// CLI instalado pelo npm: roda `node <script do bin>` (encerrar fica confiável) ou cai no atalho .cmd.
fn npm_launcher(package: &str, bin: &str) -> Option<Launcher> {
    let cmd_name = format!("{bin}.cmd");
    let mut prefixes: Vec<PathBuf> = path_dirs().into_iter().filter(|d| d.join(&cmd_name).is_file()).collect();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        prefixes.push(PathBuf::from(appdata).join("npm"));
    }
    for prefix in prefixes {
        let pkg = prefix.join("node_modules").join(package);
        if let Some(script) = package_bin(&pkg, bin) {
            if let Some(node) = find_node() {
                return Some(Launcher::Node { node, script });
            }
        }
        let cmd = prefix.join(&cmd_name);
        if cmd.is_file() {
            return Some(Launcher::Cmd(cmd));
        }
    }
    None
}

/// Script do comando no package.json do pacote (campo "bin").
fn package_bin(pkg: &Path, bin: &str) -> Option<PathBuf> {
    let v: Value = serde_json::from_slice(&std::fs::read(pkg.join("package.json")).ok()?).ok()?;
    let rel = match &v["bin"] {
        Value::String(s) => s.clone(),
        Value::Object(map) => map.get(bin).or_else(|| map.values().next())?.as_str()?.to_string(),
        _ => return None,
    };
    Some(pkg.join(rel)).filter(|p| p.is_file())
}

fn find_codex() -> Option<Launcher> {
    find_file(&["codex.exe"]).map(Launcher::Exe).or_else(|| npm_launcher("@openai/codex", "codex"))
}

fn find_gemini() -> Option<Launcher> {
    npm_launcher("@google/gemini-cli", "gemini")
}

/// O instalador do Cursor põe o `agent` em ~/.local/bin (ou numa pasta própria em AppData).
fn find_cursor() -> Option<Launcher> {
    const NAMES: [&str; 6] = ["cursor-agent.exe", "cursor-agent.cmd", "cursor-agent.ps1", "agent.exe", "agent.cmd", "agent.ps1"];
    let mut dirs = vec![home().join(r".local\bin")];
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        dirs.push(local.join("cursor-agent"));
        dirs.push(local.join(r"Programs\cursor-agent"));
        dirs.push(local.join(r"cursor-agent\bin"));
    }
    dirs.extend(path_dirs());
    find_in(&dirs, &NAMES).map(Launcher::from_path)
}

fn launcher_for(provider: &str) -> Option<Launcher> {
    match provider {
        "claude" => claude::find_claude().map(Launcher::Exe),
        "codex" => find_codex(),
        "gemini" => find_gemini(),
        "cursor" => find_cursor(),
        _ => None,
    }
}

/* ───────── Estado de cada IA ───────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    id: &'static str,
    installed: bool,
    /// None = não deu para saber.
    logged_in: Option<bool>,
    /// Plano da conta, quando o programa informa (ex.: "max", "pro").
    plan: Option<String>,
    /// O que a instalação ainda vai baixar além do próprio programa.
    needs: Vec<&'static str>,
}

#[tauri::command(async)]
pub fn ai_providers() -> Vec<ProviderStatus> {
    refresh_path();
    let no_node = find_node().is_none();
    vec![claude_status(), codex_status(no_node), gemini_status(no_node), cursor_status()]
}

fn quiet_output(mut cmd: Command) -> Option<std::process::Output> {
    cmd.stdin(Stdio::null());
    hidden(cmd).output().ok()
}

fn claude_status() -> ProviderStatus {
    let exe = claude::find_claude();
    let (mut logged_in, mut plan) = (None, None);
    if let Some(exe) = &exe {
        let mut cmd = Command::new(exe);
        cmd.args(["auth", "status", "--json"]);
        if let Some(v) = quiet_output(cmd).and_then(|o| serde_json::from_slice::<Value>(&o.stdout).ok()) {
            logged_in = v["loggedIn"].as_bool();
            plan = v["subscriptionType"].as_str().map(str::to_string);
        }
    }
    ProviderStatus { id: "claude", installed: exe.is_some(), logged_in, plan, needs: vec![] }
}

fn codex_status(no_node: bool) -> ProviderStatus {
    let launcher = find_codex();
    let logged_in = launcher.as_ref().and_then(|l| {
        let mut cmd = l.command();
        cmd.args(["login", "status"]);
        quiet_output(cmd).map(|o| o.status.success())
    });
    let needs = if launcher.is_none() && no_node { vec!["Node.js"] } else { vec![] };
    ProviderStatus { id: "codex", installed: launcher.is_some(), logged_in, plan: None, needs }
}

/// O Gemini não tem comando de status: o login com o Google fica salvo em ~/.gemini.
fn gemini_status(no_node: bool) -> ProviderStatus {
    let installed = find_gemini().is_some();
    let gemini_dir = home().join(".gemini");
    let logged_in = installed.then(|| gemini_dir.join("oauth_creds.json").is_file() || std::env::var_os("GEMINI_API_KEY").is_some());
    let needs = if !installed && no_node { vec!["Node.js"] } else { vec![] };
    ProviderStatus { id: "gemini", installed, logged_in, plan: None, needs }
}

fn cursor_status() -> ProviderStatus {
    let launcher = find_cursor();
    let logged_in = launcher.as_ref().and_then(|l| {
        let mut cmd = l.command();
        cmd.arg("status");
        let out = quiet_output(cmd)?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).to_lowercase();
        if text.contains("not logged in") || text.contains("not authenticated") || text.contains("unauthenticated") {
            Some(false)
        } else if text.contains("logged in") || text.contains("authenticated") {
            Some(true)
        } else {
            None
        }
    });
    ProviderStatus { id: "cursor", installed: launcher.is_some(), logged_in, plan: None, needs: vec![] }
}

/* ───────── Instalação ───────── */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallEvent {
    provider: String,
    /// "node", o id da IA ou "end" (fim de tudo).
    step: String,
    status: &'static str,
    message: String,
}

fn install_emit(app: &AppHandle, provider: &str, step: &str, status: &'static str, message: impl Into<String>) {
    let _ = app.emit(
        "island://ai-install",
        InstallEvent { provider: provider.into(), step: step.into(), status, message: message.into() },
    );
}

/// Roda um passo da instalação escondido e devolve as últimas linhas se falhar.
fn run_step(mut cmd: Command) -> Result<(), String> {
    cmd.stdin(Stdio::null());
    let out = hidden(cmd).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(());
    }
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let tail: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).rev().take(3).collect();
    Err(tail.into_iter().rev().collect::<Vec<_>>().join("\n"))
}

fn powershell(script: &str) -> Command {
    let mut c = Command::new("powershell");
    c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
    c
}

#[tauri::command]
pub fn ai_install(app: AppHandle, provider: String) -> Result<(), String> {
    if !matches!(provider.as_str(), "claude" | "codex" | "gemini" | "cursor") {
        return Err("IA desconhecida".into());
    }
    thread::spawn(move || {
        let result = match provider.as_str() {
            "claude" => install_script(&app, "claude", "irm https://claude.ai/install.ps1 | iex", "Claude Code"),
            "cursor" => install_script(&app, "cursor", "irm 'https://cursor.com/install?win32=true' | iex", "Cursor CLI"),
            "codex" => install_npm(&app, "codex", "@openai/codex", "Codex"),
            _ => install_npm(&app, "gemini", "@google/gemini-cli", "Gemini CLI"),
        };
        match result {
            Ok(()) => install_emit(&app, &provider, "end", "done", ""),
            Err(e) => install_emit(&app, &provider, "end", "error", e),
        }
    });
    Ok(())
}

/// Instalador oficial em PowerShell (Claude, Cursor): não precisa de Node.
fn install_script(app: &AppHandle, id: &str, script: &str, name: &str) -> Result<(), String> {
    install_emit(app, id, id, "running", "");
    run_step(powershell(script)).map_err(|e| format!("Não consegui instalar o {name}.\n{e}"))?;
    refresh_path();
    if launcher_for(id).is_none() {
        return Err(format!("O {name} foi instalado, mas não achei o programa. Reinicie a ilha e tente de novo."));
    }
    install_emit(app, id, id, "done", "");
    Ok(())
}

/// CLI pelo npm (Codex, Gemini): instala o Node.js antes, se faltar.
fn install_npm(app: &AppHandle, id: &str, package: &str, name: &str) -> Result<(), String> {
    if find_node().is_none() {
        install_emit(app, id, "node", "running", "");
        let mut winget = Command::new("winget");
        winget.args([
            "install", "-e", "--id", "OpenJS.NodeJS.LTS", "--silent",
            "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity",
        ]);
        run_step(winget).map_err(|e| format!("Não consegui instalar o Node.js pelo winget.\n{e}"))?;
        refresh_path();
        if find_node().is_none() {
            return Err("O Node.js foi instalado, mas não achei o programa. Reinicie a ilha e tente de novo.".into());
        }
        install_emit(app, id, "node", "done", "");
    }

    install_emit(app, id, id, "running", "");
    let node = find_node().ok_or("Node.js não encontrado")?;
    let npm = node.parent().map(|d| d.join("npm.cmd")).filter(|p| p.is_file()).ok_or("npm não encontrado junto do Node.js")?;
    let mut cmd = Command::new(&npm);
    cmd.args(["install", "-g", package]);
    // O npm chama o node pelo PATH: garante a pasta do Node mesmo que o PATH do processo seja antigo.
    if let Some(dir) = node.parent() {
        let path = std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(path_dirs())).unwrap_or_default();
        cmd.env("PATH", path);
    }
    run_step(cmd).map_err(|e| format!("Não consegui instalar o {name}.\n{e}"))?;
    refresh_path();
    if launcher_for(id).is_none() {
        return Err(format!("O {name} foi instalado, mas não achei o programa. Reinicie a ilha e tente de novo."));
    }
    install_emit(app, id, id, "done", "");
    Ok(())
}

/* ───────── Login ───────── */

/// Abre o login oficial numa janela de terminal própria. Claude, Codex e Cursor
/// têm comando de login (a janela fecha sozinha no fim); o Gemini pede o login
/// na primeira vez que abre ("Entrar com o Google").
#[tauri::command]
pub fn ai_login(provider: String) -> Result<(), String> {
    let launcher = launcher_for(&provider).ok_or("Essa IA ainda não está instalada")?;
    let mut cmd = launcher.command();
    match provider.as_str() {
        "claude" => {
            cmd.args(["auth", "login"]);
        }
        "codex" | "cursor" => {
            cmd.arg("login");
        }
        "gemini" => {}
        _ => return Err("IA desconhecida".into()),
    }
    // Abre na pasta de dados da IA, não em System32 (o Gemini pergunta se confia na pasta).
    cmd.current_dir(home());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NEW_CONSOLE);
    cmd.spawn().map_err(|e| format!("Não consegui abrir o login: {e}"))?;
    Ok(())
}

/* ───────── Perguntas ───────── */

#[tauri::command]
pub fn ai_ask(
    app: AppHandle,
    runs: State<'_, ClaudeRuns>,
    provider: String,
    id: u64,
    prompt: String,
    folder: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    if provider == "claude" {
        return claude::claude_ask(app, runs, id, prompt, folder, session_id);
    }
    let (name, parser): (&'static str, Parser) = match provider.as_str() {
        "codex" => ("Codex", parse_codex),
        "gemini" => ("Gemini", parse_gemini),
        "cursor" => ("Cursor", parse_cursor),
        _ => return Err("Escolha uma IA para conversar.".into()),
    };
    let launcher = launcher_for(&provider).ok_or_else(|| format!("{name} não encontrado. Conecte de novo para instalar."))?;

    let folder = folder.filter(|f| !f.trim().is_empty());
    let cwd = match &folder {
        Some(f) if Path::new(f).is_dir() => PathBuf::from(f),
        Some(f) => return Err(format!("Pasta não encontrada: {f}")),
        None => claude::scratch_dir(&app, &provider),
    };
    let session = session_id.filter(|s| claude::is_session_id(s));

    let mut cmd = launcher.command();
    cmd.current_dir(&cwd);
    // Pergunta pela entrada padrão quando o programa aceita (nada de escapar aspas na linha de comando).
    let stdin_text = match provider.as_str() {
        "codex" => {
            // Só leitura: a ilha pode responder sobre o código, nunca alterá-lo.
            cmd.args(["exec", "--json", "--skip-git-repo-check", "--color", "never", "--sandbox", "read-only"]);
            if let Some(s) = &session {
                cmd.args(["resume", s]);
            }
            cmd.arg("-");
            Some(if session.is_some() { prompt } else { format!("{PREAMBLE}{prompt}") })
        }
        "gemini" => {
            // Modo padrão sem terminal: ferramentas que alteram algo são negadas.
            cmd.args(["--output-format", "stream-json", "--approval-mode", "default", "--skip-trust", "-p", GEMINI_HINT]);
            if let Some(s) = &session {
                cmd.args(["--resume", s]);
            }
            Some(prompt)
        }
        _ => {
            // Cursor: modo "ask" é só leitura; a pergunta vai como argumento.
            cmd.args(["-p", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask", "--trust"]);
            if let Some(s) = &session {
                cmd.args(["--resume", s]);
            }
            cmd.arg(if session.is_some() { prompt } else { format!("{PREAMBLE}{prompt}") });
            None
        }
    };

    cmd.stdin(if stdin_text.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = hidden(cmd).spawn().map_err(|e| format!("Não consegui abrir o {name}: {e}"))?;
    if let (Some(text), Some(mut stdin)) = (stdin_text, child.stdin.take()) {
        thread::spawn(move || {
            let _ = stdin.write_all(text.as_bytes());
        });
    }
    let stdout = child.stdout.take().ok_or("sem saída padrão")?;
    let mut stderr = child.stderr.take().ok_or("sem saída de erro")?;
    let stderr_reader = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf);
        buf
    });

    runs.0.lock().map_err(|_| "estado da IA travado")?.insert(id, child);
    thread::Builder::new()
        .name(format!("{provider}-{id}"))
        .spawn(move || read_stream(app, id, name, parser, stdout, stderr_reader))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Estado de uma resposta enquanto o JSONL chega.
#[derive(Default)]
struct Run {
    id: u64,
    session: Option<String>,
    finished: bool,
    wrote_text: bool,
    last_error: Option<String>,
}

impl Run {
    fn text(&mut self, app: &AppHandle, text: String) {
        if text.is_empty() {
            return;
        }
        self.wrote_text = true;
        emit(app, ClaudeEvent::Text { id: self.id, text });
    }

    fn session(&mut self, app: &AppHandle, s: Option<&str>) {
        if let Some(s) = s.filter(|s| self.session.as_deref() != Some(*s)) {
            self.session = Some(s.to_string());
            emit(app, ClaudeEvent::Session { id: self.id, session_id: s.to_string() });
        }
    }

    fn tool(&self, app: &AppHandle, name: &str, detail: String) {
        emit(app, ClaudeEvent::Tool { id: self.id, name: name.to_string(), detail });
    }

    fn done(&mut self, app: &AppHandle, ok: bool, text: String) {
        self.finished = true;
        emit(app, ClaudeEvent::Done { id: self.id, ok, cancelled: false, text, session_id: self.session.clone() });
    }
}

type Parser = fn(&AppHandle, &mut Run, &Value);

/// Lê a saída linha a linha, entrega cada evento ao leitor da IA e avisa o fim.
fn read_stream(
    app: AppHandle,
    id: u64,
    name: &str,
    parser: Parser,
    stdout: std::process::ChildStdout,
    stderr_reader: thread::JoinHandle<String>,
) {
    let mut run = Run { id, ..Run::default() };
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        parser(&app, &mut run, &v);
    }

    let still_running = app.state::<ClaudeRuns>().0.lock().ok().and_then(|mut map| map.remove(&id));
    let cancelled = still_running.is_none() && !run.finished;
    if let Some(mut child) = still_running {
        let _ = child.wait();
    }
    if !run.finished {
        let err = stderr_reader.join().unwrap_or_default();
        let text = if cancelled {
            String::new()
        } else if let Some(e) = run.last_error.take() {
            e
        } else {
            let tail: Vec<&str> = err.lines().map(str::trim).filter(|l| !l.is_empty()).rev().take(4).collect();
            if tail.is_empty() {
                format!("O {name} encerrou sem responder.")
            } else {
                tail.into_iter().rev().collect::<Vec<_>>().join("\n")
            }
        };
        emit(&app, ClaudeEvent::Done { id, ok: false, cancelled, text, session_id: run.session });
    }
}

/// `codex exec --json`: o texto chega inteiro em `item.completed` (sem pedaços).
fn parse_codex(app: &AppHandle, run: &mut Run, v: &Value) {
    match v["type"].as_str() {
        Some("thread.started") => run.session(app, v["thread_id"].as_str()),
        Some("item.started") => {
            let item = &v["item"];
            match item["type"].as_str() {
                Some("command_execution") => run.tool(app, "command", short(item["command"].as_str().unwrap_or(""))),
                Some("web_search") => run.tool(app, "WebSearch", short(item["query"].as_str().unwrap_or(""))),
                Some("mcp_tool_call") => run.tool(app, "tool", short(item["tool"].as_str().unwrap_or(""))),
                _ => {}
            }
        }
        Some("item.completed") => {
            let item = &v["item"];
            match item["type"].as_str() {
                Some("agent_message") => {
                    if let Some(text) = item["text"].as_str().filter(|t| !t.trim().is_empty()) {
                        let text = if run.wrote_text { format!("\n\n{text}") } else { text.to_string() };
                        run.text(app, text);
                    }
                }
                Some("error") => run.last_error = item["message"].as_str().map(str::to_string),
                _ => {}
            }
        }
        Some("turn.completed") => {
            // O arquivo da sessão tem o contexto exato e os limites do plano; o JSONL não.
            let extras = run.session.as_deref().and_then(codex_session_extras);
            match extras.as_ref().and_then(|e| e.context) {
                Some((tokens, window)) => emit(app, ClaudeEvent::Usage { id: run.id, tokens, window }),
                None => {
                    let u = &v["usage"];
                    let tokens = u["input_tokens"].as_u64().unwrap_or(0) + u["output_tokens"].as_u64().unwrap_or(0);
                    if tokens > 0 {
                        emit(app, ClaudeEvent::Usage { id: run.id, tokens, window: None });
                    }
                }
            }
            if let Some(windows) = extras.map(|e| e.limits).filter(|w| !w.is_empty()) {
                emit(app, ClaudeEvent::Limits { id: run.id, windows });
            }
            run.done(app, true, String::new());
        }
        Some("turn.failed") => {
            let text = v["error"]["message"].as_str().map(str::to_string).or(run.last_error.clone()).unwrap_or_else(|| "O Codex não conseguiu responder.".into());
            run.done(app, false, text);
        }
        Some("error") => run.last_error = v["message"].as_str().map(str::to_string),
        _ => {}
    }
}

/// `gemini --output-format stream-json`: texto em pedaços (`message` com `delta`).
fn parse_gemini(app: &AppHandle, run: &mut Run, v: &Value) {
    match v["type"].as_str() {
        Some("init") => run.session(app, v["session_id"].as_str()),
        Some("message") if v["role"] == "assistant" => {
            if let Some(text) = v["content"].as_str() {
                run.text(app, text.to_string());
            }
        }
        Some("tool_use") => {
            let name = v["tool_name"].as_str().unwrap_or("tool");
            let label = match name {
                "read_file" | "read_many_files" => "Read",
                "glob" | "list_directory" => "Glob",
                "search_file_content" | "grep" => "Grep",
                "google_web_search" => "WebSearch",
                "web_fetch" => "WebFetch",
                _ => "tool",
            };
            let detail = claude::tool_detail(&v["parameters"]);
            run.tool(app, label, if label == "tool" && detail.is_empty() { name.to_string() } else { detail });
        }
        Some("error") if v["severity"] == "error" => run.last_error = v["message"].as_str().map(str::to_string),
        Some("result") => {
            let s = &v["stats"];
            let tokens = s["input_tokens"].as_u64().unwrap_or(0) + s["output_tokens"].as_u64().unwrap_or(0);
            if tokens > 0 {
                emit(app, ClaudeEvent::Usage { id: run.id, tokens, window: None });
            }
            if v["status"] == "success" {
                run.done(app, true, String::new());
            } else {
                let text = v["error"]["message"].as_str().map(str::to_string).or(run.last_error.clone()).unwrap_or_else(|| "O Gemini não conseguiu responder.".into());
                run.done(app, false, text);
            }
        }
        _ => {}
    }
}

/// `agent -p --output-format stream-json --stream-partial-output`: só os eventos
/// `assistant` com `timestamp_ms` e sem `model_call_id` são texto novo; os outros repetem.
fn parse_cursor(app: &AppHandle, run: &mut Run, v: &Value) {
    match v["type"].as_str() {
        Some("system") => run.session(app, v["session_id"].as_str()),
        Some("assistant") => {
            if v.get("timestamp_ms").is_none() || v.get("model_call_id").is_some() {
                return;
            }
            let text: String = v["message"]["content"]
                .as_array()
                .map(|blocks| blocks.iter().filter_map(|b| b["text"].as_str()).collect())
                .unwrap_or_default();
            run.text(app, text);
        }
        Some("tool_call") if v["subtype"] == "started" => {
            let Some((kind, call)) = v["tool_call"].as_object().and_then(|m| m.iter().next()) else { return };
            let label = match kind.as_str() {
                "readToolCall" => "Read",
                "globToolCall" | "lsToolCall" => "Glob",
                "grepToolCall" => "Grep",
                "shellToolCall" => "command",
                _ => "tool",
            };
            let detail = claude::tool_detail(&call["args"]);
            let detail = if detail.is_empty() { call["name"].as_str().unwrap_or(kind).to_string() } else { detail };
            run.tool(app, label, detail);
        }
        Some("result") => {
            run.session(app, v["session_id"].as_str());
            let ok = v["is_error"] != true;
            // Sem texto em pedaços (versão antiga): usa a resposta final.
            let text = if run.wrote_text { String::new() } else { v["result"].as_str().unwrap_or_default().to_string() };
            run.done(app, ok, text);
        }
        _ => {}
    }
}

/* ───────── Codex: contexto e limites pelo arquivo da sessão ───────── */

struct CodexExtras {
    context: Option<(u64, Option<u64>)>,
    limits: Vec<LimitWindow>,
}

/// O Codex grava cada sessão em ~/.codex/sessions/AAAA/MM/DD/rollout-...-<id>.jsonl.
/// O último `token_count` traz o contexto (com o tamanho da janela do modelo) e os
/// limites do plano (`rate_limits.primary`/`secondary`, em %).
fn codex_session_extras(thread_id: &str) -> Option<CodexExtras> {
    let root = std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".codex")).join("sessions");
    let file = find_session_file(&root, thread_id, 0)?;
    let text = std::fs::read_to_string(file).ok()?;
    let mut extras = CodexExtras { context: None, limits: Vec::new() };
    for line in text.lines().rev() {
        if !line.contains("token_count") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let payload = if v["payload"].is_object() { &v["payload"] } else { &v };
        let info = &payload["info"];
        if extras.context.is_none() && info.is_object() {
            let last = &info["last_token_usage"];
            let tokens = last["input_tokens"].as_u64().unwrap_or(0) + last["output_tokens"].as_u64().unwrap_or(0);
            if tokens > 0 {
                extras.context = Some((tokens, info["model_context_window"].as_u64()));
            }
        }
        let rl = &payload["rate_limits"];
        if extras.limits.is_empty() && rl.is_object() {
            for key in ["primary", "secondary"] {
                let w = &rl[key];
                let Some(pct) = w["used_percent"].as_f64() else { continue };
                let minutes = w["window_minutes"].as_u64().unwrap_or(0);
                let kind = match minutes {
                    0 => key.to_string(),
                    m if m <= 360 => "five_hour".to_string(),
                    m if m <= 1440 => "daily".to_string(),
                    _ => "seven_day".to_string(),
                };
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                let resets_at = w["resets_at"].as_u64().or_else(|| w["resets_in_seconds"].as_u64().map(|s| now + s));
                extras.limits.push(LimitWindow { kind, used: pct / 100.0, resets_at });
            }
        }
        if extras.context.is_some() && !extras.limits.is_empty() {
            break;
        }
    }
    Some(extras)
}

/// Procura o arquivo da sessão (pastas por data; as mais novas primeiro).
fn find_session_file(dir: &Path, thread_id: &str, depth: u8) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort();
    entries.reverse();
    for p in entries {
        if p.is_dir() && depth < 4 {
            if let Some(f) = find_session_file(&p, thread_id, depth + 1) {
                return Some(f);
            }
        } else if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.contains(thread_id) && n.ends_with(".jsonl")) {
            return Some(p);
        }
    }
    None
}

fn short(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() > 80 { format!("{}…", s.chars().take(79).collect::<String>()) } else { s.to_string() }
}
