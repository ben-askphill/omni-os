//! Runs the scenarios recorded from the Node servers (`packages/test-fixtures/native/mcp`) against this binary: a
//! scripted stand-in for Omni's API on a local port, the server as a child process, the scenario's lines on its
//! stdin, and what came back. The Node servers and their runner were removed once a release had carried this
//! binary, so the files are the contract now: a change in behaviour edits them by hand, here. The answers are
//! compared as the bytes the server wrote, key order and number format included.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use omni_core::js::{self, JsValue};

const TIMEOUT: Duration = Duration::from_secs(15);

/// A request the stand-in API saw, as the fixtures record one.
#[derive(Debug, Clone, PartialEq)]
struct Seen {
    method: String,
    url: String,
    /// `authorization`, `content-type` and `x-omni-thread`, in that order, where sent.
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    closed_by_client: Option<bool>,
}

#[derive(Default)]
struct Api {
    script: Mutex<VecDeque<JsValue>>,
    seen: Mutex<Vec<Seen>>,
}

fn field<'a>(value: &'a JsValue, key: &str) -> Option<&'a JsValue> {
    value.get(key)
}

fn text(value: Option<&JsValue>) -> Option<String> {
    value.and_then(JsValue::as_js_string).map(|s| s.to_string_lossy())
}

fn number(value: Option<&JsValue>) -> Option<u64> {
    value.and_then(JsValue::as_f64).map(|n| n as u64)
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
    let kept = ["authorization", "content-type", "x-omni-thread"];
    let headers = kept.iter().filter_map(|name| all.iter().find(|(n, _)| n == name).cloned()).collect();
    Some(Seen { method, url, headers, body, closed_by_client: None })
}

fn answer(api: &Api, mut stream: TcpStream) {
    let Some(request) = read_request(&mut stream) else { return };
    let entry = api.script.lock().unwrap().pop_front();
    let entry = entry
        .unwrap_or_else(|| js::parse(r#"{"status":500,"json":{"error":"The scenario scripted no answer for this request."}}"#).unwrap());
    let hang = field(&entry, "hang").is_some_and(JsValue::is_truthy);
    let at = {
        let mut seen = api.seen.lock().unwrap();
        seen.push(Seen { closed_by_client: hang.then_some(false), ..request });
        seen.len() - 1
    };
    if hang {
        // Never answers. The read ends when the server under test closes the request or exits.
        let mut rest = [0u8; 64];
        while matches!(stream.read(&mut rest), Ok(n) if n > 0) {}
        api.seen.lock().unwrap()[at].closed_by_client = Some(true);
        return;
    }
    if field(&entry, "drop").is_some_and(JsValue::is_truthy) {
        return;
    }
    if let Some(delay) = number(field(&entry, "delayMs")) {
        std::thread::sleep(Duration::from_millis(delay));
    }
    let (kind, body) = match text(field(&entry, "text")) {
        Some(text) => ("text/plain", text),
        None => ("application/json", field(&entry, "json").map_or_else(|| "{}".to_owned(), js::stringify)),
    };
    let status = number(field(&entry, "status")).unwrap_or(200);
    let head = format!("HTTP/1.1 {status} Scripted\r\ncontent-type: {kind}\r\nconnection: close\r\ncontent-length: {}\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(body.as_bytes()));
}

/// The stand-in API on a free local port. Its threads end with the test process.
fn serve(script: &[JsValue]) -> (Arc<Api>, u16) {
    let api = Arc::new(Api { script: Mutex::new(script.iter().cloned().collect()), seen: Mutex::default() });
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let shared = Arc::clone(&api);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let api = Arc::clone(&shared);
            std::thread::spawn(move || answer(&api, stream));
        }
    });
    (api, port)
}

fn until(what: &str, mut done: impl FnMut() -> bool) -> Result<(), String> {
    let deadline = Instant::now() + TIMEOUT;
    while !done() {
        if Instant::now() > deadline {
            return Err(format!("timed out waiting for {what}"));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    Ok(())
}

/// What the server under test did: the lines it wrote sorted by request id, the requests it made, its exit code.
struct Ran {
    responses: Vec<String>,
    requests: Vec<Seen>,
    exit: Option<i32>,
}

fn id_of(line: &str) -> String {
    js::parse(line).ok().and_then(|message| message.get("id").map(js::stringify)).unwrap_or_default()
}

static RUNS: AtomicUsize = AtomicUsize::new(0);

const BIN: &str = env!("CARGO_BIN_EXE_omni-mcp");

/// What a server answers to `initialize` in each protocol version and to `tools/list`, as the file `omni-mcp lazy`
/// reads. `apps/server/lazy-mcp.ts` asks the browser server the same way.
fn handshake(server: &str, env: &[(String, OsString)]) -> Result<String, String> {
    let mut initialize = Vec::new();
    let mut tools = JsValue::Null;
    for version in ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"] {
        let mut child = Command::new(BIN)
            .arg(server)
            .env_clear()
            .envs(env.iter().cloned())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let ask = format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"{version}","capabilities":{{}},"clientInfo":{{"name":"test","version":"0"}}}}}}
{{"jsonrpc":"2.0","id":2,"method":"tools/list"}}
"#
        );
        child.stdin.take().ok_or("no stdin")?.write_all(ask.as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let mut results = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| js::parse(line).ok()?.get("result").cloned())
            .collect::<Vec<_>>();
        if results.len() != 2 {
            return Err(format!("{server} answered the handshake with {:?}", String::from_utf8_lossy(&out.stdout)));
        }
        tools = results.pop().unwrap_or(JsValue::Null);
        initialize.push((version, results.pop().unwrap_or(JsValue::Null)));
    }
    Ok(js::stringify(&JsValue::object([("initialize", JsValue::object(initialize)), ("tools", tools)])))
}

fn run(scenario: &JsValue) -> Result<Ran, String> {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "scenario-{}-{}",
        std::process::id(),
        RUNS.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let result = run_in(scenario, &dir);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn run_in(scenario: &JsValue, dir: &Path) -> Result<Ran, String> {
    let token_file = dir.join("api-token");
    let script = field(scenario, "api").and_then(JsValue::as_array).unwrap_or_default();
    let (api, port) = serve(script);

    // Nothing of the machine's own Omni reaches the server under test.
    let server = text(field(scenario, "server")).ok_or("a scenario names its server")?;
    let mut env: Vec<(String, OsString)> = vec![
        ("PATH".to_owned(), std::env::var_os("PATH").unwrap_or_default()),
        ("HOME".to_owned(), dir.into()),
        ("OMNI_URL".to_owned(), format!("http://127.0.0.1:{port}").into()),
    ];
    if let Some(token) = text(field(scenario, "tokenFile")) {
        std::fs::write(&token_file, token).map_err(|e| e.to_string())?;
        env.push(("OMNI_TOKEN_FILE".to_owned(), token_file.clone().into()));
    }
    if let Some(set) = field(scenario, "env").and_then(JsValue::as_object) {
        for (name, value) in set.iter() {
            env.push((name.to_string_lossy(), text(Some(value)).unwrap_or_default().into()));
        }
    }
    let mut command = Command::new(BIN);
    if field(scenario, "lazy").is_some_and(JsValue::is_truthy) {
        // The same server behind `omni-mcp lazy`, with a record of what it answers in this scenario's environment.
        let answers = dir.join("answers.json");
        std::fs::write(&answers, handshake(&server, &env)?).map_err(|e| e.to_string())?;
        command.arg("lazy").arg(answers).arg(BIN);
    }
    command.arg(&server).env_clear().envs(env);
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let lines: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = Arc::clone(&lines);
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                sink.lock().unwrap().push(line);
            }
        }
    });
    let answered = |id: &str| lines.lock().unwrap().iter().any(|line| id_of(line) == id);

    let outcome = (|| {
        let silent: Vec<String> =
            field(scenario, "silent").and_then(JsValue::as_array).unwrap_or_default().iter().map(js::stringify).collect();
        let mut wanted: Vec<String> = Vec::new();
        for step in field(scenario, "steps").and_then(JsValue::as_array).unwrap_or_default() {
            if let Some(message) = field(step, "send") {
                let id = message.get("id").map(js::stringify);
                if let (Some(id), Some(JsValue::String(_))) = (id, message.get("method"))
                    && !silent.contains(&id)
                {
                    wanted.push(id);
                }
                writeln!(stdin, "{}", js::stringify(message)).map_err(|e| e.to_string())?;
            } else if let Some(raw) = text(field(step, "raw")) {
                writeln!(stdin, "{raw}").map_err(|e| e.to_string())?;
            } else if let Some(count) = number(field(step, "waitRequests")) {
                until(&format!("{count} API requests"), || api.seen.lock().unwrap().len() as u64 >= count)?;
            } else if let Some(id) = field(step, "waitResponse") {
                let id = js::stringify(id);
                until(&format!("the answer to {id}"), || answered(&id))?;
            } else if let Some(token) = text(field(step, "writeTokenFile")) {
                std::fs::write(&token_file, token).map_err(|e| e.to_string())?;
            } else if let Some(pause) = number(field(step, "sleepMs")) {
                std::thread::sleep(Duration::from_millis(pause));
            } else {
                return Err(format!("a step the runner does not know: {}", js::stringify(step)));
            }
        }
        until(&format!("answers to {}", wanted.join(", ")), || wanted.iter().all(|id| answered(id)))?;
        if let Some(settle) = number(field(scenario, "settleMs")) {
            std::thread::sleep(Duration::from_millis(settle));
        }
        // Read before stdin closes: after it, the server exits and every open request closes with it.
        Ok(api.seen.lock().unwrap().clone())
    })();
    drop(stdin);
    let mut exit = None;
    let exited = until("the server to exit when its stdin closed", || {
        exit = child.try_wait().ok().flatten();
        exit.is_some()
    });
    if exited.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = reader.join();
    let requests = outcome.map_err(|why| format!("{why}\nstdout so far: {:?}", lines.lock().unwrap()))?;
    exited?;
    let mut responses = lines.lock().unwrap().clone();
    // By id as JSON text, compared by UTF-16 code unit, which is how the TypeScript runner sorts.
    responses.sort_by(|a, b| id_of(a).encode_utf16().cmp(id_of(b).encode_utf16()));
    Ok(Ran { responses, requests, exit: exit.and_then(|status| status.code()) })
}

/// The request as the fixture wrote it down, to compare with what was seen.
fn recorded(request: &JsValue) -> Seen {
    let headers = field(request, "headers").and_then(JsValue::as_object);
    let headers = ["authorization", "content-type", "x-omni-thread"]
        .iter()
        .filter_map(|name| headers.and_then(|h| h.get(name)).map(|value| ((*name).to_owned(), text(Some(value)).unwrap_or_default())))
        .collect();
    let body = match field(request, "body") {
        None | Some(JsValue::Null) => Vec::new(),
        Some(body) => js::stringify(body).into_bytes(),
    };
    Seen {
        method: text(field(request, "method")).unwrap_or_default(),
        url: text(field(request, "url")).unwrap_or_default(),
        headers,
        body,
        closed_by_client: match field(request, "closedByClient") {
            Some(JsValue::Bool(closed)) => Some(*closed),
            _ => None,
        },
    }
}

/// Why the run differs from what the scenario expects, if it does.
fn differences(scenario: &JsValue, ran: &Ran) -> Vec<String> {
    let mut out = Vec::new();
    let expected = field(scenario, "expected").expect("a recorded scenario says what it expects");
    let responses: Vec<String> =
        field(expected, "responses").and_then(JsValue::as_array).unwrap_or_default().iter().map(js::stringify).collect();
    if responses != ran.responses {
        for i in 0..responses.len().max(ran.responses.len()) {
            let (want, got) = (responses.get(i), ran.responses.get(i));
            if want != got {
                out.push(format!("answer {i}\n  expected {want:?}\n  got      {got:?}"));
            }
        }
    }
    let requests: Vec<Seen> = field(expected, "requests").and_then(JsValue::as_array).unwrap_or_default().iter().map(recorded).collect();
    if requests != ran.requests {
        for i in 0..requests.len().max(ran.requests.len()) {
            let (want, got) = (requests.get(i), ran.requests.get(i));
            if want != got {
                let show = |seen: Option<&Seen>| {
                    seen.map(|s| {
                        format!(
                            "{} {} {:?} {:?} closed {:?}",
                            s.method,
                            s.url,
                            s.headers,
                            String::from_utf8_lossy(&s.body),
                            s.closed_by_client
                        )
                    })
                };
                out.push(format!("request {i}\n  expected {:?}\n  got      {:?}", show(want), show(got)));
            }
        }
    }
    let exit = field(expected, "exit").and_then(JsValue::as_f64).map(|code| code as i32);
    if exit != ran.exit {
        out.push(format!("exit code: expected {exit:?}, got {:?}", ran.exit));
    }
    out
}

fn check(scenarios: &[JsValue]) {
    // Each scenario has its own server and its own API, and several wait out a retry, so they run side by side.
    let failures: Vec<String> = std::thread::scope(|scope| {
        let runs: Vec<_> = scenarios
            .iter()
            .map(|scenario| {
                scope.spawn(move || {
                    let name = text(field(scenario, "name")).unwrap_or_default();
                    let why = match run(scenario) {
                        Ok(ran) => differences(scenario, &ran),
                        Err(why) => vec![why],
                    };
                    (!why.is_empty()).then(|| format!("{name}:\n{}", why.join("\n")))
                })
            })
            .collect();
        runs.into_iter().filter_map(|run| run.join().expect("a scenario thread")).collect()
    });
    assert!(failures.is_empty(), "{} of {} scenarios differ from the record:\n{}", failures.len(), scenarios.len(), failures.join("\n"));
}

fn fixture(server: &str) -> Vec<JsValue> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/test-fixtures/native/mcp").join(format!("{server}.json"));
    let file =
        js::parse(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).expect("the fixture is JSON");
    let scenarios = field(&file, "scenarios").and_then(JsValue::as_array).expect("a list of scenarios").to_vec();
    assert!(scenarios.iter().all(|s| text(field(s, "server")).as_deref() == Some(server)), "{server}.json holds only {server} scenarios");
    scenarios
}

#[test]
fn ask_matches_the_record_of_the_node_server() {
    let scenarios = fixture("ask");
    assert_eq!(scenarios.len(), 32);
    check(&scenarios);
}

#[test]
fn render_matches_the_record_of_the_node_server() {
    let scenarios = fixture("render");
    assert_eq!(scenarios.len(), 15);
    check(&scenarios);
}

/// No Node server came before this one: its scenarios were written for it (`packages/test-fixtures/native/mcp/steps.json`).
#[test]
fn steps_matches_its_record() {
    let scenarios = fixture("steps");
    assert_eq!(scenarios.len(), 4);
    check(&scenarios);
}

/// No Node server came before this one either (`packages/test-fixtures/native/mcp/memory.json`).
#[test]
fn memory_matches_its_record() {
    let scenarios = fixture("memory");
    assert_eq!(scenarios.len(), 5);
    check(&scenarios);
}

/// Written for this binary too (`packages/test-fixtures/native/mcp/team.json`).
#[test]
fn team_matches_its_record() {
    let scenarios = fixture("team");
    assert_eq!(scenarios.len(), 4);
    check(&scenarios);
}

#[test]
fn threads_matches_the_record_of_the_node_server() {
    let scenarios = fixture("threads");
    assert_eq!(scenarios.len(), 14);
    check(&scenarios);
}

/// The front may change nothing a client sees: every recorded scenario again, with the server behind `omni-mcp lazy`.
/// One thing does change, and one scenario turns on it: the server starts at the first call, so what it reads once
/// at its start (the token file here) it reads then, not when the thread started. That scenario swaps the file in
/// between and counts on the old token, so it is left out.
#[test]
fn every_server_behind_the_lazy_front_still_matches_the_record() {
    let swaps_the_token = |scenario: &JsValue| {
        field(scenario, "steps").and_then(JsValue::as_array).unwrap_or_default().iter().any(|step| field(step, "writeTokenFile").is_some())
    };
    let mut left_out = 0;
    for server in ["ask", "render", "steps", "threads", "memory", "team"] {
        let all = fixture(server);
        let count = all.len();
        let behind: Vec<JsValue> = all
            .into_iter()
            .filter(|scenario| !swaps_the_token(scenario))
            .map(|scenario| match scenario {
                JsValue::Object(mut scenario) => {
                    scenario.set("lazy", JsValue::Bool(true));
                    JsValue::Object(scenario)
                }
                other => other,
            })
            .collect();
        left_out += count - behind.len();
        check(&behind);
    }
    assert_eq!(left_out, 1, "only the rotated token scenario depends on when the server starts");
}

/// Where this binary knowingly differs from the Node servers (docs/internals/rust-port.md), so no shared record can hold it.
#[test]
fn an_answer_with_no_text_is_an_error_with_a_short_message() {
    // The Node server answered the same error code with the SDK's 3,341-character dump of the result schema.
    let scenario = js::parse(
        r#"{
          "name": "an answer with no text",
          "server": "ask",
          "env": { "OMNI_THREAD_ID": "thread-1", "OMNI_TOKEN": "tok-1" },
          "api": [{ "json": { "id": "q1" } }, { "json": { "state": "answered" } }],
          "steps": [{ "send": { "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "ask_user_question", "arguments": {
            "questions": [{ "question": "Which one?", "options": [{ "label": "A", "description": "First" }, { "label": "B", "description": "Second" }] }] } } } }],
          "expected": {
            "responses": [{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32602, "message": "MCP error -32602: Invalid tools/call result: the tool answered without text" } }],
            "requests": [
              { "method": "POST", "url": "/api/threads/thread-1/questions", "headers": { "authorization": "Bearer tok-1", "content-type": "application/json", "x-omni-thread": "thread-1" },
                "body": { "questions": [{ "question": "Which one?", "options": [{ "label": "A", "description": "First" }, { "label": "B", "description": "Second" }] }] } },
              { "method": "GET", "url": "/api/threads/thread-1/questions/q1?wait=25", "headers": { "authorization": "Bearer tok-1", "content-type": "application/json", "x-omni-thread": "thread-1" }, "body": null }
            ],
            "exit": 0
          }
        }"#,
    )
    .unwrap();
    check(&[scenario]);
}

#[test]
fn a_call_that_reuses_a_running_id_does_not_stop_the_first() {
    // Both answer under the one id. The SDK did the same: the later call takes the id over for cancelling, no more.
    let call = r#"{ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": "read_referenced_thread", "arguments": { "thread_id": "ref-1" } } }"#;
    let scenario = js::parse(&format!(
        r#"{{
          "name": "one id, two calls",
          "server": "threads",
          "env": {{ "OMNI_THREAD_ID": "thread-1", "OMNI_TOKEN": "tok-1" }},
          "api": [{{ "delayMs": 300, "json": {{ "state": "ok" }} }}, {{ "delayMs": 300, "json": {{ "state": "ok" }} }}],
          "steps": [{{ "send": {call} }}, {{ "waitRequests": 1 }}, {{ "send": {call} }}, {{ "waitRequests": 2 }}],
          "settleMs": 800
        }}"#
    ))
    .unwrap();
    let ran = run(&scenario).unwrap();
    let answer = r#"{"result":{"content":[{"type":"text","text":"{\n  \"state\": \"ok\"\n}"}]},"jsonrpc":"2.0","id":7}"#;
    assert_eq!(ran.responses, [answer, answer]);
}

#[test]
fn without_a_server_name_it_says_how_to_run_it() {
    let out = Command::new(BIN).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(
        String::from_utf8_lossy(&out.stderr),
        "usage: omni-mcp <ask|render|steps|threads|memory|team|lazy <answers.json> <command> [args...]>\n"
    );
}
