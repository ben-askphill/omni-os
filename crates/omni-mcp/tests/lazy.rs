//! `omni-mcp lazy` in front of a stand-in server: a shell script that writes down every line it is sent and answers
//! from a fixed list. What is checked here is what no recorded scenario can show: that the server is not started
//! before it is needed, what it is told once it is, and how the front ends. `goldens.rs` replays every recorded
//! scenario with a real server behind the front.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(15);
const BIN: &str = env!("CARGO_BIN_EXE_omni-mcp");

const INITIALIZE: &str = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"roots":{}},"clientInfo":{"name":"test","version":"1"}}}"#;
const INITIALIZED: &str = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
const LIST: &str = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#;
const PING: &str = r#"{"jsonrpc":"2.0","id":3,"method":"ping"}"#;
const CALL: &str = r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"look","arguments":{}}}"#;
const OWN_LIST: &str = r#"{"jsonrpc":"2.0","id":"omni-mcp-lazy/tools","method":"tools/list"}"#;

/// The server's answers as the front's record holds them, and as the stand-in gives them.
const HELLO: &str =
    r#"{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"stand-in","version":"1"}}"#;
const TOOLS: &str = r#"{"tools":[{"name":"look","inputSchema":{"type":"object"}}]}"#;

/// What the server answers a method it does not have, and Claude Code's opening question, which is one.
const NOT_FOUND: &str = r#"{"code":-32601,"message":"Method not found"}"#;
const DISCOVER: &str = r#"{"jsonrpc":"2.0","id":"server-discover-probe-1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#;

fn record(tools: &str) -> String {
    format!(r#"{{"initialize":{{"2025-06-18":{HELLO}}},"tools":{tools},"refused":{{"server/discover":{NOT_FOUND}}}}}"#)
}

/// The stand-in server. `started` appears when it runs and `seen` holds each line it read. It answers `initialize`,
/// both `tools/list` requests and `ping`, asks the client for its roots before it answers a call, and exits with 7
/// when asked to `quit`. `ended` appears when its input closed.
fn stand_in(tools: &str) -> String {
    format!(
        r#": > "$DIR/started"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$DIR/seen"
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{{"result":{HELLO},"jsonrpc":"2.0","id":1}}' ;;
    *'"id":"omni-mcp-lazy/tools"'*) printf '%s\n' '{{"result":{tools},"jsonrpc":"2.0","id":"omni-mcp-lazy/tools"}}' ;;
    *'"method":"tools/list"'*) printf '%s\n' '{{"result":{tools},"jsonrpc":"2.0","id":2}}' ;;
    *'"method":"ping"'*) printf '%s\n' '{{"result":{{}},"jsonrpc":"2.0","id":3}}' ;;
    *'"method":"tools/call"'*)
      printf '%s\n' '{{"method":"roots/list","jsonrpc":"2.0","id":0}}'
      IFS= read -r roots
      printf '%s\n' "$roots" >> "$DIR/seen"
      printf '%s\n' '{{"result":{{"content":[{{"type":"text","text":"looked"}}]}},"jsonrpc":"2.0","id":5}}' ;;
    *'"method":"quit"'*) exit 7 ;;
  esac
done
: > "$DIR/ended"
"#
    )
}

static RUNS: AtomicUsize = AtomicUsize::new(0);

struct Front {
    dir: PathBuf,
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<String>,
}

impl Front {
    /// The front with a record and a server command, in a folder of its own.
    fn with(record: &str, server: &[&str]) -> Self {
        let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
            "lazy-{}-{}",
            std::process::id(),
            RUNS.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("answers.json"), record).unwrap();
        let mut child = Command::new(BIN)
            .arg("lazy")
            .arg(dir.join("answers.json"))
            .args(server)
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("DIR", &dir)
            .current_dir(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (found, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = found.send(line);
            }
        });
        Self { dir, stdin: child.stdin.take(), child, lines }
    }

    /// In front of the stand-in server, whose tool list may differ from the record's.
    fn new(recorded_tools: &str, server_tools: &str) -> Self {
        let front = Self::with(&record(recorded_tools), &["sh", "server.sh"]);
        std::fs::write(front.dir.join("server.sh"), stand_in(server_tools)).unwrap();
        front
    }

    fn send(&mut self, text: &str) {
        let stdin = self.stdin.as_mut().unwrap();
        stdin.write_all(text.as_bytes()).and_then(|()| stdin.write_all(b"\n")).and_then(|()| stdin.flush()).unwrap();
    }

    fn line(&self) -> String {
        self.lines.recv_timeout(TIMEOUT).expect("a line from the front")
    }

    fn started(&self) -> bool {
        self.dir.join("started").exists()
    }

    /// Whether the server saw its input close, waited for.
    fn ended(&self) -> bool {
        let deadline = Instant::now() + TIMEOUT;
        while !self.dir.join("ended").exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        self.dir.join("ended").exists()
    }

    /// What the server was sent, once it holds this many lines.
    fn seen(&self, count: usize) -> Vec<String> {
        let read = |file: &Path| std::fs::read_to_string(file).unwrap_or_default().lines().map(str::to_owned).collect::<Vec<_>>();
        let deadline = Instant::now() + TIMEOUT;
        while read(&self.dir.join("seen")).len() < count && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        read(&self.dir.join("seen"))
    }

    /// Closes stdin where it is still open, and gives the front's exit code and the lines it had still to hand over.
    fn end(mut self) -> (Option<i32>, Vec<String>) {
        self.stdin = None;
        let deadline = Instant::now() + TIMEOUT;
        let mut status = None;
        while status.is_none() && Instant::now() < deadline {
            status = self.child.try_wait().unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        if status.is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        let rest = std::iter::from_fn(|| self.lines.recv_timeout(Duration::from_millis(200)).ok()).collect();
        let _ = std::fs::remove_dir_all(&self.dir);
        (status.and_then(|status| status.code()), rest)
    }
}

fn answer(id: &str, result: &str) -> String {
    format!(r#"{{"result":{result},"jsonrpc":"2.0","id":{id}}}"#)
}

#[test]
fn the_handshake_is_answered_from_the_record_and_starts_no_server() {
    let mut front = Front::new(TOOLS, TOOLS);
    // As Claude Code opens: a method the server said it does not have, then the handshake.
    front.send(DISCOVER);
    assert_eq!(front.line(), format!(r#"{{"jsonrpc":"2.0","id":"server-discover-probe-1","error":{NOT_FOUND}}}"#));
    for line in [
        INITIALIZE,
        INITIALIZED,
        LIST,
        PING,
        r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}}"#,
        "not json",
    ] {
        front.send(line);
    }
    assert_eq!([front.line(), front.line(), front.line()], [answer("1", HELLO), answer("2", TOOLS), answer("3", "{}")]);
    assert!(!front.started());
    assert_eq!(front.end(), (Some(0), vec![]));
}

#[test]
fn a_method_the_record_does_not_say_the_server_lacks_is_the_servers_to_answer() {
    // A record made before the server was asked, or of a server that has the method.
    let mut front = Front::with(&format!(r#"{{"initialize":{{"2025-06-18":{HELLO}}},"tools":{TOOLS}}}"#), &["sh", "server.sh"]);
    std::fs::write(front.dir.join("server.sh"), stand_in(TOOLS)).unwrap();
    front.send(DISCOVER);
    assert_eq!(front.seen(1), [DISCOVER]);
    assert_eq!(front.end(), (Some(0), vec![]));
}

#[test]
fn the_first_call_starts_the_server_and_says_the_handshake_again_to_it() {
    let mut front = Front::new(TOOLS, TOOLS);
    for line in [INITIALIZE, INITIALIZED, LIST] {
        front.send(line);
    }
    assert_eq!([front.line(), front.line()], [answer("1", HELLO), answer("2", TOOLS)]);
    assert!(!front.started());

    front.send(CALL);
    // The server's own question reaches the client, and the client's answer reaches the server.
    assert_eq!(front.line(), r#"{"method":"roots/list","jsonrpc":"2.0","id":0}"#);
    let roots = r#"{"jsonrpc":"2.0","id":0,"result":{"roots":[]}}"#;
    front.send(roots);
    assert_eq!(front.line(), answer("5", r#"{"content":[{"type":"text","text":"looked"}]}"#));
    // The client's own handshake, byte for byte, then the front's question about the tools, then the call.
    assert_eq!(front.seen(5), [INITIALIZE, INITIALIZED, OWN_LIST, CALL, roots]);

    // From here on it is a pipe: the server answers what the record could have.
    front.send(PING);
    assert_eq!(front.line(), answer("3", "{}"));
    assert_eq!(front.seen(6).last().map(String::as_str), Some(PING));
    // Neither answer to the handshake said again reached the client, and the server ending ends the front.
    assert_eq!(front.end(), (Some(0), vec![]));
}

#[test]
fn messages_sent_in_one_write_all_arrive() {
    let mut front = Front::new(TOOLS, TOOLS);
    front.send(&[INITIALIZE, INITIALIZED, LIST, CALL, r#"{"jsonrpc":"2.0","id":0,"result":{"roots":[]}}"#, PING].join("\n"));
    let lines = [front.line(), front.line(), front.line(), front.line(), front.line()];
    assert_eq!(lines[..2], [answer("1", HELLO), answer("2", TOOLS)]);
    assert_eq!(lines[2], r#"{"method":"roots/list","jsonrpc":"2.0","id":0}"#);
    assert_eq!(lines[4], answer("3", "{}"));
    assert_eq!(front.end(), (Some(0), vec![]));
}

#[test]
fn a_request_the_record_does_not_cover_goes_to_the_server() {
    // A protocol version nobody asked the server about: the server answers for itself, and is told nothing twice.
    let other = INITIALIZE.replace("2025-06-18", "1999-01-01");
    let mut front = Front::new(TOOLS, TOOLS);
    front.send(&other);
    assert_eq!(front.line(), answer("1", HELLO));
    assert_eq!(front.seen(1), [other]);
    assert_eq!(front.end(), (Some(0), vec![]));

    // A page of the tool list.
    let page = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"cursor":"next"}}"#;
    let mut front = Front::new(TOOLS, TOOLS);
    for line in [INITIALIZE, INITIALIZED, page] {
        front.send(line);
    }
    assert_eq!([front.line(), front.line()], [answer("1", HELLO), answer("2", TOOLS)]);
    assert_eq!(front.seen(4), [INITIALIZE, INITIALIZED, OWN_LIST, page]);
    assert_eq!(front.end(), (Some(0), vec![]));

    // A call with no handshake before it: nothing to say again.
    let mut front = Front::new(TOOLS, TOOLS);
    front.send(r#"{"jsonrpc":"2.0","id":9,"method":"quit"}"#);
    assert_eq!(front.end(), (Some(7), vec![]));
}

#[test]
fn a_server_with_other_tools_than_the_record_has_the_client_ask_again() {
    let other = r#"{"tools":[]}"#;
    let mut front = Front::new(TOOLS, other);
    for line in [INITIALIZE, INITIALIZED, LIST, PING] {
        front.send(line);
    }
    assert_eq!([front.line(), front.line(), front.line()], [answer("1", HELLO), answer("2", TOOLS), answer("3", "{}")]);
    // The first message for the server. Its tools are found to differ, and the client is told they changed.
    front.send(r#"{"jsonrpc":"2.0","id":4,"method":"resources/list"}"#);
    assert_eq!(front.line(), r#"{"method":"notifications/tools/list_changed","jsonrpc":"2.0"}"#);
    // Asking again now reaches the server.
    front.send(LIST);
    assert_eq!(front.line(), answer("2", other));
    assert_eq!(front.end(), (Some(0), vec![]));
}

#[test]
fn the_front_exits_with_the_servers_code() {
    let mut front = Front::new(TOOLS, TOOLS);
    front.send(INITIALIZE);
    assert_eq!(front.line(), answer("1", HELLO));
    front.send(r#"{"jsonrpc":"2.0","id":9,"method":"quit"}"#);
    assert_eq!(front.seen(3).len(), 3);
    // Its stdin is still open: the server ending is what ended it.
    let stdin = front.stdin.take();
    let (code, rest) = front.end();
    drop(stdin);
    assert_eq!((code, rest), (Some(7), vec![]));
}

#[test]
fn a_front_that_is_killed_closes_the_servers_input() {
    let mut front = Front::new(TOOLS, TOOLS);
    front.send(INITIALIZE);
    assert_eq!(front.line(), answer("1", HELLO));
    front.send(r#"{"jsonrpc":"2.0","id":4,"method":"resources/list"}"#);
    assert_eq!(front.seen(3).len(), 3);
    // As a harness ends a server it gave up on. A stdio server ends when its input closes, and the browser one does.
    front.child.kill().unwrap();
    assert!(front.ended());
    let stdin = front.stdin.take();
    assert_eq!(front.end(), (None, vec![]));
    drop(stdin);
}

#[test]
fn a_server_that_does_not_start_fails_the_call_that_needed_it() {
    let mut front = Front::with(&record(TOOLS), &["/no/such/server"]);
    for line in [INITIALIZE, LIST, CALL] {
        front.send(line);
    }
    assert_eq!([front.line(), front.line()], [answer("1", HELLO), answer("2", TOOLS)]);
    let error = front.line();
    assert!(error.starts_with(r#"{"jsonrpc":"2.0","id":5,"error":{"code":-32603,"message":"The server did not start: "#), "{error}");
    let stdin = front.stdin.take();
    let (code, rest) = front.end();
    drop(stdin);
    assert_eq!((code, rest), (Some(1), vec![]));
}

#[test]
fn it_refuses_to_start_without_a_record() {
    for text in ["", "{}", r#"{"initialize":{},"tools":{"tools":[]}}"#, r#"{"initialize":{"2025-06-18":{}},"tools":{}}"#] {
        let front = Front::with(text, &["sh", "server.sh"]);
        assert_eq!(front.end(), (Some(2), vec![]), "{text:?}");
    }
    let out = Command::new(BIN).args(["lazy", "answers.json"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(String::from_utf8_lossy(&out.stderr), "usage: omni-mcp lazy <answers.json> <command> [args...]\n");
}
