//! Runs the scenarios recorded from the TypeScript command (`packages/test-fixtures/native/cli`) against this binary:
//! a temp folder with the files and stand-in programs the scenario names, a scripted stand-in for Omni's API on a
//! local port, the command as a child process, and what it printed, asked the API and started. The TypeScript
//! command and its runner were removed once a release had carried this one, so the files are the contract now: a
//! change in behaviour edits them by hand, here. The requests are compared in the order they arrived.
#![cfg(unix)]

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use omni_core::js::{self, JsObject, JsValue};

const TIMEOUT: Duration = Duration::from_secs(30);

/// How many scenarios of one file run side by side. Several time a server that is slow to answer, so not all at once.
const WORKERS: usize = 12;

/// How many run at once in the whole process, where the test runner has several files going.
const AT_ONCE: usize = 16;

/// The headers both implementations must send the same. The rest (user-agent, accept-encoding) belong to the HTTP client.
const HEADERS: [&str; 3] = ["accept", "authorization", "content-type"];

fn field<'a>(value: &'a JsValue, key: &str) -> Option<&'a JsValue> {
    value.get(key)
}

fn text(value: Option<&JsValue>) -> Option<String> {
    value.and_then(JsValue::as_js_string).map(|s| s.to_string_lossy())
}

fn truthy(value: Option<&JsValue>) -> bool {
    value.is_some_and(JsValue::is_truthy)
}

fn list<'a>(value: &'a JsValue, key: &str) -> &'a [JsValue] {
    field(value, key).and_then(JsValue::as_array).unwrap_or_default()
}

fn entries<'a>(value: &'a JsValue, key: &str) -> Vec<(String, &'a JsValue)> {
    field(value, key).and_then(JsValue::as_object).map(|o| o.iter().map(|(k, v)| (k.to_string_lossy(), v)).collect()).unwrap_or_default()
}

/// A request the stand-in API saw, as the fixtures record one.
#[derive(Debug, Clone, PartialEq)]
struct Seen {
    method: String,
    url: String,
    /// `accept`, `authorization` and `content-type`, in that order, where sent.
    headers: Vec<(String, String)>,
    /// Parsed JSON, the raw text when it is not JSON, or null for no body.
    body: JsValue,
}

struct Api {
    scenario: JsValue,
    port: u16,
    /// When the scenario started, in milliseconds since 1970: what `{{now-100s}}` counts from.
    now: i64,
    dir: String,
    /// How often each route answered.
    calls: Mutex<Vec<usize>>,
    seen: Mutex<Vec<Seen>>,
    stop: AtomicBool,
}

fn is_hex(text: &str, len: usize) -> bool {
    text.len() == len && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A version 4 UUID in lower case, as `crypto.randomUUID()` writes one.
fn is_random_id(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    let [a, b, c, d, e] = parts.as_slice() else { return false };
    is_hex(a, 8)
        && is_hex(b, 4)
        && is_hex(c, 4)
        && c.starts_with('4')
        && is_hex(d, 4)
        && d.starts_with(['8', '9', 'a', 'b'])
        && is_hex(e, 12)
}

/// The ids the command makes up itself (a new thread's, a message's) are random: the record holds a placeholder.
fn without_random_ids(body: JsValue) -> JsValue {
    let JsValue::Object(mut object) = body else { return body };
    for key in ["id", "request_id"] {
        if text(object.get(key)).is_some_and(|id| is_random_id(&id)) {
            object.set(key, JsValue::str("{uuid}"));
        }
    }
    JsValue::Object(object)
}

/// `{{now-100s}}` and its like: how far from now, in milliseconds.
fn placeholder(text: &str) -> Option<i64> {
    let inner = text.strip_prefix("{{now")?.strip_suffix("}}")?;
    let sign = match inner.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let digits = inner[1..].bytes().take_while(u8::is_ascii_digit).count();
    let unit = match &inner[1 + digits..] {
        "ms" => 1,
        "s" => 1000,
        "m" => 60_000,
        "h" => 3_600_000,
        "d" => 86_400_000,
        _ => return None,
    };
    Some(sign * inner[1..=digits].parse::<i64>().ok()? * unit)
}

/// `new Date(ms).toISOString()`.
fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms).expect("a time in range").format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// The scenario's times, as the server would have written them `now`, and its paths under the temp folder.
fn filled(value: &JsValue, now: i64, dir: &str) -> JsValue {
    match value {
        JsValue::String(s) => {
            let text = s.to_string_lossy();
            match placeholder(&text) {
                Some(offset) => JsValue::str(&iso(now + offset)),
                None if text.contains("{dir}") => JsValue::str(&text.replace("{dir}", dir)),
                None => value.clone(),
            }
        }
        JsValue::Array(items) => JsValue::Array(items.iter().map(|v| filled(v, now, dir)).collect()),
        JsValue::Object(object) => {
            let mut out = JsObject::new();
            for (key, v) in object.iter() {
                out.set(key.clone(), filled(v, now, dir));
            }
            JsValue::Object(out)
        }
        other => other.clone(),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Reads one HTTP request off the connection: its line, its headers and a body sized by `content-length`.
fn read_request(stream: &mut TcpStream) -> Option<Seen> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte).ok()? == 0 {
            return None;
        }
        head.push(byte[0]);
    }
    // Node hands a header's bytes over as Latin-1, so that is how they are recorded.
    let head: String = head.iter().map(|&b| char::from(b)).collect();
    let mut lines = head.split("\r\n");
    let mut request = lines.next()?.split(' ');
    let (method, url) = (request.next()?.to_owned(), request.next()?.to_owned());
    let all: Vec<(String, String)> =
        lines.filter_map(|line| line.split_once(':')).map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_owned())).collect();
    let length = all.iter().find(|(name, _)| name == "content-length").and_then(|(_, value)| value.parse::<usize>().ok()).unwrap_or(0);
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body).ok()?;
    let headers = HEADERS.iter().filter_map(|name| all.iter().find(|(n, _)| n == name).cloned()).collect();
    let body = String::from_utf8_lossy(&body);
    let body = if body.is_empty() { JsValue::Null } else { js::parse(&body).map_or_else(|_| JsValue::str(&body), without_random_ids) };
    // The nonce of a proof is random: the record holds a placeholder.
    let url = match url.strip_prefix("/api/auth/proof?nonce=") {
        Some(nonce) if is_hex(nonce, 32) => "/api/auth/proof?nonce={nonce}".to_owned(),
        _ => url,
    };
    Some(Seen { method, url, headers, body })
}

fn reason(status: u64) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Scripted",
    }
}

impl Api {
    /// The scripted answer to a request: its route's next reply, a proof where the scenario has a token to sign one
    /// with, or a 500 that says nothing was scripted.
    fn reply(&self, method: &str, url: &str) -> JsValue {
        for (i, route) in list(&self.scenario, "routes").iter().enumerate() {
            let path = text(field(route, "path")).unwrap_or_default();
            let hit = if truthy(field(route, "prefix")) { url.starts_with(&path) } else { url == path };
            if text(field(route, "method")).as_deref() != Some(method) || !hit {
                continue;
            }
            let replies = list(route, "replies");
            let mut calls = self.calls.lock().unwrap();
            let n = calls[i];
            calls[i] += 1;
            // One per call in turn. The last one repeats.
            return replies[n.min(replies.len() - 1)].clone();
        }
        if let (Some(token), "GET", Some(nonce)) =
            (text(field(&self.scenario, "proof")), method, url.strip_prefix("/api/auth/proof?nonce="))
        {
            let proof = if token == "wrong" {
                "deadbeef".to_owned()
            } else {
                let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, token.as_bytes());
                hex(ring::hmac::sign(&key, format!("omni-proof:{}:{nonce}", self.port).as_bytes()).as_ref())
            };
            return JsValue::object([("json", JsValue::object([("proof", JsValue::str(&proof))]))]);
        }
        js::parse(r#"{"status":500,"json":{"error":"The scenario scripted no answer for this request."}}"#).unwrap()
    }

    fn answer(&self, mut stream: TcpStream) {
        // The raw address: the nonce went into the record's placeholder, and the proof signs the real one.
        let mut peek = [0u8; 256];
        let asked = stream.peek(&mut peek).map(|n| String::from_utf8_lossy(&peek[..n]).into_owned()).unwrap_or_default();
        let Some(request) = read_request(&mut stream) else { return };
        let raw_url =
            asked.split(' ').nth(1).filter(|_| request.url.ends_with("{nonce}")).map_or_else(|| request.url.clone(), str::to_owned);
        let method = request.method.clone();
        self.seen.lock().unwrap().push(request);
        let reply = self.reply(&method, &raw_url);
        if truthy(field(&reply, "hang")) {
            // Never answers. The read ends when the command gives up or exits.
            let mut rest = [0u8; 64];
            while matches!(stream.read(&mut rest), Ok(n) if n > 0) {}
            return;
        }
        if truthy(field(&reply, "drop")) {
            return;
        }
        if let Some(raw) = text(field(&reply, "raw")) {
            let _ = stream.write_all(raw.as_bytes());
            return;
        }
        if let Some(delay) = field(&reply, "delayMs").and_then(JsValue::as_f64) {
            std::thread::sleep(Duration::from_millis(delay as u64));
        }
        let scripted = text(field(&reply, "text"));
        let body = match text(field(&reply, "wire")).filter(|name| !name.is_empty()) {
            Some(name) => {
                let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/test-fixtures/wire").join(name);
                std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            }
            None => scripted.clone().unwrap_or_else(|| {
                js::stringify(&filled(field(&reply, "json").unwrap_or(&JsValue::Object(JsObject::new())), self.now, &self.dir))
            }),
        };
        let status = field(&reply, "status").and_then(JsValue::as_f64).map_or(200, |n| n as u64);
        let kind = text(field(&reply, "contentType"))
            .unwrap_or_else(|| if scripted.is_some() { "text/plain" } else { "application/json" }.to_owned());
        let mut headers = vec![("content-type".to_owned(), kind), ("connection".to_owned(), "close".to_owned())];
        for (name, value) in entries(&reply, "headers") {
            headers.retain(|(n, _)| !n.eq_ignore_ascii_case(&name));
            headers.push((name, text(Some(value)).unwrap_or_default()));
        }
        // No body goes with these two, whatever was scripted: Node's server leaves it out as well.
        let bodiless = matches!(status, 204 | 304);
        if !bodiless {
            headers.push(("content-length".to_owned(), body.len().to_string()));
        }
        let mut head = format!("HTTP/1.1 {status} {}\r\n", reason(status));
        for (name, value) in headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");
        let _ = stream.write_all(head.as_bytes()).and_then(|()| if bodiless { Ok(()) } else { stream.write_all(body.as_bytes()) });
    }
}

/// The stand-in API on a free local port, until `stop` is set and one more connection wakes it.
fn serve(scenario: &JsValue, now: i64, dir: &str) -> Arc<Api> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let api = Arc::new(Api {
        scenario: scenario.clone(),
        port: listener.local_addr().unwrap().port(),
        now,
        dir: dir.to_owned(),
        calls: Mutex::new(vec![0; list(scenario, "routes").len()]),
        seen: Mutex::default(),
        stop: AtomicBool::new(false),
    });
    let shared = Arc::clone(&api);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if shared.stop.load(Ordering::Relaxed) {
                break;
            }
            let api = Arc::clone(&shared);
            std::thread::spawn(move || api.answer(stream));
        }
    });
    api
}

/// A port nothing listens on, so a connection is refused. On Linux the socket that found it stays bound and never
/// listens, and no other scenario is handed the port for as long as it lives.
fn closed_port() -> (Option<rustix::fd::OwnedFd>, u16) {
    use rustix::net::{AddressFamily, SocketType, bind, getsockname, socket};
    let held = socket(AddressFamily::INET, SocketType::STREAM, None).expect("a socket");
    bind(&held, &SocketAddr::from(([127, 0, 0, 1], 0))).expect("a free port");
    let address: SocketAddr = getsockname(&held).expect("the socket's address").try_into().expect("an IP address");
    // Linux refuses a connection to a bound socket that does not listen. A Mac drops the packet, and the command
    // would wait out its time limit. There the socket closes first and the port is only very likely still free.
    (cfg!(target_os = "linux").then_some(held), address.port())
}

fn sh(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// A stand-in program as a shell script that needs nothing on PATH.
fn program_script(program: &JsValue) -> String {
    let mut lines = vec!["#!/bin/sh".to_owned()];
    if truthy(field(program, "record")) {
        lines.push(r#"for a in "$@"; do printf '%s\n' "$a"; done > "$0.args""#.to_owned());
    }
    if let Some(stdout) = text(field(program, "stdout")).filter(|t| !t.is_empty()) {
        lines.push(format!("printf '%s' {}", sh(&stdout)));
    }
    if let Some(stderr) = text(field(program, "stderr")).filter(|t| !t.is_empty()) {
        lines.push(format!("printf '%s' {} >&2", sh(&stderr)));
    }
    lines.push(format!("exit {}", field(program, "exit").and_then(JsValue::as_f64).map_or(0, |n| n as i64)));
    format!("{}\n", lines.join("\n"))
}

fn is_disk_line(line: &str) -> bool {
    ["ok", "warn", "FAIL"].iter().any(|level| {
        let Some(rest) = line.strip_prefix(level).filter(|rest| rest.starts_with(' ')) else { return false };
        rest.trim_start_matches(' ').strip_prefix("disk").is_some_and(|rest| rest.starts_with(' '))
    })
}

/// `omni doctor` reads how full this machine's disks are, which no record can hold: its disk lines are left out. A
/// full disk fails the command on its own, so the exit code is what the other checks give.
fn without_disks(stdout: String, exit: Option<i32>) -> (String, Option<i32>) {
    // Only a run that got as far as its checks: a wrong command line or the help text has none.
    let report = stdout.starts_with('{') || ["ok ", "warn ", "FAIL "].iter().any(|level| stdout.starts_with(level));
    if !matches!(exit, Some(0 | 1)) || !report {
        return (stdout, exit);
    }
    if stdout.starts_with('{') {
        let Ok(JsValue::Object(mut report)) = js::parse(&stdout) else { return (stdout, exit) };
        let Some(checks) = report.get("checks").and_then(JsValue::as_array) else { return (stdout, exit) };
        let checks: Vec<JsValue> = checks.iter().filter(|c| text(field(c, "name")).as_deref() != Some("disk")).cloned().collect();
        let ok = !checks.iter().any(|c| text(field(c, "level")).as_deref() == Some("fail"));
        report.set("ok", JsValue::Bool(ok));
        report.set("checks", JsValue::Array(checks));
        return (format!("{}\n", js::stringify_pretty(&JsValue::Object(report))), Some(i32::from(!ok)));
    }
    let lines: Vec<&str> = stdout.split('\n').filter(|line| !is_disk_line(line)).collect();
    let failed = lines.iter().any(|line| line.starts_with("FAIL"));
    (lines.join("\n"), Some(i32::from(failed)))
}

/// What the command did.
#[derive(Debug, PartialEq)]
struct Ran {
    stdout: String,
    stderr: String,
    exit: Option<i32>,
    requests: Vec<Seen>,
    /// The arguments each recording program was started with, by its name.
    launched: BTreeMap<String, Vec<String>>,
}

static RUNS: AtomicUsize = AtomicUsize::new(0);

fn run(scenario: &JsValue) -> Result<Ran, String> {
    // The system's temp folder, not Cargo's: `omni open .` reads the folders above it, and a checkout can sit in one
    // named `worktrees`. The real path: the command prints its working folder as the system names it.
    let dir = std::env::temp_dir().join(format!("omni-cli-scenario-{}-{}", std::process::id(), RUNS.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dir = dir.canonicalize().map_err(|e| e.to_string())?;
    let result = run_in(scenario, &dir);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn drain(mut from: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut all = Vec::new();
        let _ = from.read_to_end(&mut all);
        all
    })
}

fn run_in(scenario: &JsValue, dir: &Path) -> Result<Ran, String> {
    let io = |e: std::io::Error| e.to_string();
    let now_at = SystemTime::now();
    let now = i64::try_from(now_at.duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis()).map_err(|e| e.to_string())?;
    let dir_text = dir.to_str().ok_or("the temp folder's path is not UTF-8")?.to_owned();
    let bin = dir.join("bin");
    std::fs::create_dir(&bin).map_err(io)?;
    for folder in list(scenario, "dirs") {
        std::fs::create_dir_all(dir.join(text(Some(folder)).unwrap_or_default())).map_err(io)?;
    }
    for (path, spec) in entries(scenario, "files") {
        let file = dir.join(path);
        std::fs::create_dir_all(file.parent().ok_or("a file needs a folder")?).map_err(io)?;
        std::fs::write(&file, text(field(spec, "text")).unwrap_or_default()).map_err(io)?;
        if let Some(mode) = text(field(spec, "mode")).filter(|m| !m.is_empty()) {
            let mode = u32::from_str_radix(&mode, 8).map_err(|e| e.to_string())?;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).map_err(io)?;
        }
        if let Some(ago) = field(spec, "agoMs").and_then(JsValue::as_f64) {
            let at = now_at - Duration::from_millis(ago as u64);
            let times = std::fs::FileTimes::new().set_accessed(at).set_modified(at);
            std::fs::File::options().write(true).open(&file).and_then(|f| f.set_times(times)).map_err(io)?;
        }
    }
    let programs = entries(scenario, "programs");
    for (name, program) in &programs {
        std::fs::write(bin.join(name), program_script(program)).map_err(io)?;
        std::fs::set_permissions(bin.join(name), std::fs::Permissions::from_mode(0o755)).map_err(io)?;
    }

    let api = serve(scenario, now, &dir_text);
    let address = text(field(scenario, "address")).unwrap_or_else(|| "url".to_owned());
    let held = address.starts_with("closed").then(closed_port);
    let port = held.as_ref().map_or(api.port, |(_, port)| *port);
    let url = format!("http://127.0.0.1:{port}");
    let placed = |text: &str| text.replace("{dir}", &dir_text).replace("{url}", &url).replace("{port}", &port.to_string());
    let recorded = |text: &str| text.replace(&url, "{url}").replace(&dir_text, "{dir}");

    // Nothing of the machine's own Omni reaches the command, and the only programs it finds are the scenario's.
    let mut command = Command::new(env!("CARGO_BIN_EXE_omni"));
    command.args(list(scenario, "args").iter().map(|a| text(Some(a)).unwrap_or_default()));
    command.current_dir(text(field(scenario, "cwd")).filter(|c| !c.is_empty()).map_or_else(|| dir.to_path_buf(), |cwd| dir.join(cwd)));
    command.env_clear().env("PATH", &bin).env("HOME", dir);
    match address.as_str() {
        "none" => {}
        "url" | "closed-url" => {
            command.env("OMNI_URL", &url);
        }
        _ => {
            command.env("OMNI_INSTALL_PORT", port.to_string());
        }
    }
    for (name, value) in entries(scenario, "env") {
        command.env(name, placed(&text(Some(value)).unwrap_or_default()));
    }
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(io)?;
    let out = drain(child.stdout.take().ok_or("no stdout")?);
    let err = drain(child.stderr.take().ok_or("no stderr")?);
    // A command that does not read its input closes the pipe: that is no failure.
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let _ = stdin.write_all(text(field(scenario, "stdin")).unwrap_or_default().as_bytes());
    drop(stdin);

    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        match child.try_wait().map_err(io)? {
            Some(status) => break Some(status),
            None if Instant::now() > deadline => break None,
            None => std::thread::sleep(Duration::from_millis(5)),
        }
    };
    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let stdout = String::from_utf8_lossy(&out.join().map_err(|_| "reading stdout failed")?).into_owned();
    let stderr = String::from_utf8_lossy(&err.join().map_err(|_| "reading stderr failed")?).into_owned();
    api.stop.store(true, Ordering::Relaxed);
    let _ = TcpStream::connect(("127.0.0.1", api.port));
    drop(held);
    let Some(status) = status else {
        return Err(format!("the command did not exit\nstderr: {stderr}\nstdout: {stdout}"));
    };

    // A started program outlives the command: its arguments are there a moment later.
    if programs.iter().any(|(_, program)| truthy(field(program, "record"))) {
        std::thread::sleep(Duration::from_millis(300));
    }
    let mut launched = BTreeMap::new();
    for entry in std::fs::read_dir(&bin).map_err(io)?.flatten() {
        let file = entry.file_name().to_string_lossy().into_owned();
        let Some(name) = file.strip_suffix(".args") else { continue };
        // A browser is `open` on a Mac and `xdg-open` elsewhere.
        let name = if matches!(name, "open" | "xdg-open") { "browser" } else { name };
        let args = recorded(&std::fs::read_to_string(entry.path()).map_err(io)?);
        let mut lines: Vec<String> = args.split('\n').map(str::to_owned).collect();
        lines.pop();
        launched.insert(name.to_owned(), lines);
    }
    let (stdout, exit) = match list(scenario, "args").first().and_then(|a| text(Some(a))).as_deref() {
        Some("doctor") => without_disks(stdout, status.code()),
        _ => (stdout, status.code()),
    };
    let seen = api.seen.lock().unwrap().clone();
    let requests = seen.into_iter().map(|seen| {
        let body = match &seen.body {
            JsValue::String(text) => JsValue::str(&recorded(&text.to_string_lossy())),
            other => other.clone(),
        };
        Seen { url: recorded(&seen.url), body, ..seen }
    });
    Ok(Ran { stdout: recorded(&stdout), stderr: recorded(&stderr), exit, requests: requests.collect(), launched })
}

/// What the scenario's record says the command did.
fn expected(scenario: &JsValue) -> Ran {
    let expected = field(scenario, "expected").expect("a recorded scenario says what it expects");
    let request = |request: &JsValue| {
        let headers = field(request, "headers");
        Seen {
            method: text(field(request, "method")).unwrap_or_default(),
            url: text(field(request, "url")).unwrap_or_default(),
            headers: HEADERS.iter().filter_map(|name| Some(((*name).to_owned(), text(headers?.get(name))?))).collect(),
            body: field(request, "body").cloned().unwrap_or(JsValue::Null),
        }
    };
    Ran {
        stdout: text(field(expected, "stdout")).unwrap_or_default(),
        stderr: text(field(expected, "stderr")).unwrap_or_default(),
        exit: field(expected, "exit").and_then(JsValue::as_f64).map(|code| code as i32),
        requests: list(expected, "requests").iter().map(request).collect(),
        launched: entries(expected, "launched")
            .into_iter()
            .map(|(name, args)| (name, args.as_array().unwrap_or_default().iter().map(|a| text(Some(a)).unwrap_or_default()).collect()))
            .collect(),
    }
}

/// Why the run differs from what the scenario expects, if it does.
fn differences(want: &Ran, got: &Ran) -> Vec<String> {
    let mut out = Vec::new();
    if want.stdout != got.stdout {
        out.push(format!("stdout\n  expected {:?}\n  got      {:?}", want.stdout, got.stdout));
    }
    if want.stderr != got.stderr {
        out.push(format!("stderr\n  expected {:?}\n  got      {:?}", want.stderr, got.stderr));
    }
    if want.exit != got.exit {
        out.push(format!("exit code: expected {:?}, got {:?}", want.exit, got.exit));
    }
    let show = |seen: Option<&Seen>| seen.map(|s| format!("{} {} {:?} {}", s.method, s.url, s.headers, js::stringify(&s.body)));
    for i in 0..want.requests.len().max(got.requests.len()) {
        let (want, got) = (want.requests.get(i), got.requests.get(i));
        // Bodies as JSON text: key order and number format are part of what the server reads.
        if show(want) != show(got) {
            out.push(format!("request {i}\n  expected {:?}\n  got      {:?}", show(want), show(got)));
        }
    }
    if want.launched != got.launched {
        out.push(format!("started programs\n  expected {:?}\n  got      {:?}", want.launched, got.launched));
    }
    out
}

/// A place among the scenarios running at once, in every test of this file together. Each holds a listener, the
/// command's three pipes and its connections, and a Mac starts a process with room for 256 open files.
struct Turn;

static RUNNING: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());

impl Turn {
    fn take() -> Self {
        let (running, freed) = &RUNNING;
        let mut running = freed.wait_while(running.lock().unwrap(), |n| *n >= AT_ONCE).unwrap();
        *running += 1;
        Self
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        let (running, freed) = &RUNNING;
        *running.lock().unwrap() -= 1;
        freed.notify_one();
    }
}

fn check(scenarios: &[JsValue]) {
    let next = AtomicUsize::new(0);
    let failures: Mutex<Vec<(usize, String)>> = Mutex::default();
    std::thread::scope(|scope| {
        for _ in 0..WORKERS.min(scenarios.len()) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(scenario) = scenarios.get(i) else { break };
                    let turn = Turn::take();
                    let why = match run(scenario) {
                        Ok(ran) => differences(&expected(scenario), &ran),
                        Err(why) => vec![why],
                    };
                    drop(turn);
                    if !why.is_empty() {
                        let name = text(field(scenario, "name")).unwrap_or_default();
                        failures.lock().unwrap().push((i, format!("{name}:\n{}", why.join("\n"))));
                    }
                }
            });
        }
    });
    let mut failures = failures.into_inner().unwrap();
    failures.sort();
    let failures: Vec<String> = failures.into_iter().map(|(_, why)| why).collect();
    assert!(failures.is_empty(), "{} of {} scenarios differ from the record:\n{}", failures.len(), scenarios.len(), failures.join("\n"));
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/test-fixtures/native/cli")
}

fn fixture(name: &str) -> Vec<JsValue> {
    let path = fixtures().join(format!("{name}.json"));
    let file =
        js::parse(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).expect("the fixture is JSON");
    field(&file, "scenarios").and_then(JsValue::as_array).expect("a list of scenarios").to_vec()
}

/// The fixture files and how many scenarios each holds: a file or a scenario that goes missing fails here.
const FIXTURES: [(&str, usize); 10] = [
    ("basics", 47),
    ("connection", 52),
    ("doctor", 27),
    ("http", 26),
    ("new", 25),
    ("open", 22),
    ("send", 18),
    ("show", 23),
    ("status", 32),
    ("threads", 14),
];

fn replay(name: &str) {
    let scenarios = fixture(name);
    let count = FIXTURES.iter().find(|(file, _)| *file == name).map(|(_, count)| *count);
    assert_eq!(Some(scenarios.len()), count, "{name}.json");
    check(&scenarios);
}

#[test]
fn every_fixture_file_is_replayed() {
    let mut files: Vec<String> = std::fs::read_dir(fixtures())
        .expect("the fixture folder")
        .flatten()
        .filter_map(|entry| entry.file_name().to_string_lossy().strip_suffix(".json").map(str::to_owned))
        .collect();
    files.sort();
    assert_eq!(files, FIXTURES.map(|(name, _)| name));
}

#[test]
fn basics_match_the_record_of_the_typescript_command() {
    replay("basics");
}

#[test]
fn connection_matches_the_record_of_the_typescript_command() {
    replay("connection");
}

#[test]
fn doctor_matches_the_record_of_the_typescript_command() {
    replay("doctor");
}

#[test]
fn http_matches_the_record_of_the_typescript_command() {
    replay("http");
}

#[test]
fn new_matches_the_record_of_the_typescript_command() {
    replay("new");
}

#[test]
fn open_matches_the_record_of_the_typescript_command() {
    replay("open");
}

#[test]
fn send_matches_the_record_of_the_typescript_command() {
    replay("send");
}

#[test]
fn show_matches_the_record_of_the_typescript_command() {
    replay("show");
}

#[test]
fn status_matches_the_record_of_the_typescript_command() {
    replay("status");
}

#[test]
fn threads_match_the_record_of_the_typescript_command() {
    replay("threads");
}

/// Where this binary knowingly differs from the TypeScript command (docs/internals/rust-port.md), so no shared
/// record can hold it.
#[test]
fn a_name_every_javascript_object_has_is_no_option() {
    // The TypeScript command looks an option up on a plain object, so it takes --constructor and --toString for
    // switches it knows and goes on to ask the server.
    let scenario = js::parse(r#"{ "name": "an inherited name", "args": ["threads", "--constructor"], "address": "closed-port" }"#).unwrap();
    let ran = run(&scenario).unwrap();
    assert_eq!(ran.exit, Some(64));
    assert!(ran.stderr.starts_with("omni threads: unknown option --constructor\n\nomni threads ["), "{}", ran.stderr);
    assert_eq!(ran.stdout, "");
}

#[test]
fn a_link_with_a_malformed_id_is_one_line() {
    // The TypeScript command prints the URIError with its stack.
    let scenario =
        js::parse(r##"{ "name": "a malformed link", "args": ["show", "#/t/%zz"], "env": { "OMNI_TOKEN": "test-token" } }"##).unwrap();
    let ran = run(&scenario).unwrap();
    assert_eq!(ran.stderr, "omni show: #/t/%zz is not a link this command can read: its id is not valid percent-encoding.\n");
    assert_eq!((ran.exit, ran.stdout.as_str(), ran.requests.len()), (Some(3), "", 0));
}
