//! `omni-mcp lazy <answers> <command> [args...]`: stands in front of a stdio MCP server that is costly to keep
//! running and that most threads never call, which is the browser server (docs/internals/rust-port.md). It answers
//! the handshake from a record of that server's own answers and starts the server at the first message the record
//! does not cover. From then on it is a pipe in both directions, so a client cannot tell it from the server.

use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdout, Command, ExitStatus, Stdio};
use std::sync::mpsc;

use omni_core::js::{self, JsObject, JsString, JsValue};

use crate::protocol::{self, IdKey, Message};

const USAGE: &str = "usage: omni-mcp lazy <answers.json> <command> [args...]";

/// The id of the one request this sends the server for itself. A client numbers its requests, or names them after
/// itself, so it has no request of this name to mix it up with.
const OWN_LIST: &str = "omni-mcp-lazy/tools";

/// What the server answered when it was asked: `initialize` per protocol version a client can ask for, `tools/list`,
/// and its error for each method it said it does not have.
struct Answers {
    initialize: JsObject,
    tools: JsValue,
    refused: JsObject,
}

/// An answer from the record: a result, or the server's own error.
enum Answer {
    Result(JsValue),
    Error(JsValue),
}

impl Answers {
    fn read(file: &str) -> Result<Self, String> {
        let text = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
        let record = js::parse(&text).map_err(|e| e.to_string())?;
        let initialize = record.get("initialize").and_then(JsValue::as_object).filter(|answers| !answers.is_empty());
        let tools = record.get("tools").filter(|tools| tools.get("tools").and_then(JsValue::as_array).is_some());
        let refused = record.get("refused").and_then(JsValue::as_object).cloned().unwrap_or_default();
        match (initialize, tools) {
            (Some(initialize), Some(tools)) => Ok(Self { initialize: initialize.clone(), tools: tools.clone(), refused }),
            _ => Err("not a record of a server's initialize and tools/list answers".to_owned()),
        }
    }

    /// The server's own answer to a request, where the record has it: a method it does not have, a plain
    /// `initialize` in a protocol version it was asked in, `ping`, and the whole tool list. Anything else is the
    /// server's to answer.
    fn to(&self, method: &JsString, params: Option<&JsValue>) -> Option<Answer> {
        // No params make a server know a method it does not have. A harness may open with one: Claude Code asks
        // `server/discover` before `initialize`.
        if let Some(error) = self.refused.get_js(method) {
            return Some(Answer::Error(error.clone()));
        }
        if protocol::asks_for_a_task(params) {
            return None;
        }
        let result = match method.to_string_lossy().as_str() {
            "ping" => Some(JsValue::Object(JsObject::new())),
            "initialize" => {
                protocol::initialize(params).ok()?;
                self.initialize.get_js(params?.get("protocolVersion")?.as_js_string()?).cloned()
            }
            "tools/list" => {
                protocol::list(params).ok()?;
                params.is_none_or(|params| params.get("cursor").is_none()).then(|| self.tools.clone())
            }
            _ => None,
        };
        result.map(Answer::Result)
    }
}

/// The handshake this answered for the server, to say again to the server once it runs.
struct Hello {
    /// The client's `initialize`, as the bytes it sent.
    line: Vec<u8>,
    id: IdKey,
    /// The answer the client got.
    said: String,
    /// The client's `notifications/initialized`, when it sent one.
    ready: Option<Vec<u8>>,
}

fn write(line: &[u8]) -> std::io::Result<()> {
    let mut out = std::io::stdout().lock();
    out.write_all(line)?;
    out.flush()
}

fn say(mut line: String) {
    line.push('\n');
    // A closed stdout means the harness is gone, and stdin closing ends the process.
    let _ = write(line.as_bytes());
}

fn exit_code(status: std::io::Result<ExitStatus>) -> i32 {
    let Ok(status) = status else { return 1 };
    #[cfg(unix)]
    let signal = std::os::unix::process::ExitStatusExt::signal(&status);
    #[cfg(not(unix))]
    let signal: Option<i32> = None;
    // A shell's code for a process a signal ended.
    status.code().unwrap_or_else(|| signal.map_or(1, |signal| 128 + signal))
}

/// Whether a line from the server is its answer to the request with this id, and the result it carries if so.
fn answer_to(line: &[u8], id: &IdKey) -> Option<Option<String>> {
    let message = js::parse_bytes(line).ok()?;
    if message.get("method").is_some() || message.get("id").and_then(IdKey::of).as_ref() != Some(id) {
        return None;
    }
    Some(message.get("result").map(js::stringify))
}

/// Hands the server's output to the client. The answers to the two requests this sent for itself stay here: the
/// client has them already, from the record. Everything after them is copied as it comes.
fn forward(from: ChildStdout, hello: Option<(IdKey, String)>, tools: &str, started: &mpsc::Sender<()>) {
    let mut from = BufReader::new(from);
    // A client that is gone cannot be written to. The server is still read, so it never blocks on a full pipe.
    let mut gone = false;
    let mut pass = |bytes: &[u8]| gone = gone || write(bytes).is_err();
    if let Some((id, said)) = hello {
        let own = IdKey::Text(JsString::from(OWN_LIST));
        let (mut greeted, mut listed) = (false, false);
        let mut line = Vec::new();
        while !(greeted && listed) {
            line.clear();
            if !matches!(from.read_until(b'\n', &mut line), Ok(n) if n > 0) {
                return;
            }
            if let (false, Some(result)) = (greeted, answer_to(&line, &id)) {
                greeted = true;
                if result.as_deref() != Some(said.as_str()) {
                    eprintln!("omni-mcp lazy: the server's answer to initialize is not the one in the record, which the client got");
                }
                let _ = started.send(());
            } else if let (false, Some(result)) = (listed, answer_to(&line, &own)) {
                listed = true;
                if result.as_deref() != Some(tools) {
                    // The client holds the record's list. The server says its tools can change, so this is how a
                    // client learns to ask again, and that question now reaches the server.
                    eprintln!("omni-mcp lazy: the server's tools are not the ones in the record. Telling the client to list them again");
                    pass(b"{\"method\":\"notifications/tools/list_changed\",\"jsonrpc\":\"2.0\"}\n");
                }
            } else {
                pass(&line);
            }
        }
    }
    while let Ok(bytes) = from.fill_buf() {
        let count = bytes.len();
        if count == 0 {
            break;
        }
        pass(bytes);
        from.consume(count);
    }
}

/// Starts the server and is its pipe from here on: says the handshake again, hands over the message that needed the
/// server, then copies both ways until one side ends. Exits with the server's code.
fn serve(command: &str, args: &[String], answers: &Answers, hello: Option<Hello>, first: &[u8], mut stdin: impl BufRead) -> ! {
    let mut child = match Command::new(command).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn() {
        Ok(child) => child,
        Err(why) => {
            eprintln!("omni-mcp lazy: {command} did not start: {why}");
            if let Some(Message::Request { id, .. }) = protocol::read(first.strip_suffix(b"\n").unwrap_or(first)) {
                say(protocol::error(&id, protocol::INTERNAL_ERROR, &format!("The server did not start: {why}")));
            }
            std::process::exit(1);
        }
    };
    let (Some(mut to), Some(from)) = (child.stdin.take(), child.stdout.take()) else { std::process::exit(1) };
    let (started, wait) = mpsc::channel();
    let known = hello.as_ref().map(|hello| (hello.id.clone(), hello.said.clone()));
    let tools = js::stringify(&answers.tools);
    let output = std::thread::spawn(move || {
        forward(from, known, &tools, &started);
        // Its output is over, so the server is done or about to be.
        std::process::exit(exit_code(child.wait()));
    });

    let mut send = |bytes: &[u8]| to.write_all(bytes).and_then(|()| to.flush());
    let greeted = match &hello {
        None => Ok(()),
        Some(hello) => send(&hello.line).map(|()| {
            // As a client would: nothing more goes in until the server has answered. An error here is the server
            // closing its output, which ends the process from the thread above.
            let _ = wait.recv();
        }),
    };
    let handed = greeted.and_then(|()| {
        if let Some(hello) = &hello {
            if let Some(ready) = &hello.ready {
                send(ready)?;
            }
            let list =
                JsValue::object([("jsonrpc", JsValue::str("2.0")), ("id", JsValue::str(OWN_LIST)), ("method", JsValue::str("tools/list"))]);
            send(format!("{}\n", js::stringify(&list)).as_bytes())?;
        }
        send(first)
    });
    if handed.is_ok() {
        while let Ok(bytes) = stdin.fill_buf() {
            let count = bytes.len();
            if count == 0 || send(bytes).is_err() {
                break;
            }
            stdin.consume(count);
        }
    }
    // The client is gone or the server stopped reading. Closing its stdin is how a stdio server is told to end.
    drop(to);
    let _ = output.join();
    std::process::exit(1);
}

pub fn run(args: &[String]) -> ! {
    let [file, command, args @ ..] = args else {
        eprintln!("{USAGE}");
        std::process::exit(2);
    };
    let answers = Answers::read(file).unwrap_or_else(|why| {
        eprintln!("omni-mcp lazy: {file}: {why}");
        std::process::exit(2);
    });
    let mut stdin = BufReader::new(std::io::stdin().lock());
    let mut hello: Option<Hello> = None;
    let mut line = Vec::new();
    loop {
        line.clear();
        // The harness closing stdin means it is gone. A last line with no newline never was a message.
        if !matches!(stdin.read_until(b'\n', &mut line), Ok(n) if n > 0) || line.last() != Some(&b'\n') {
            std::process::exit(0);
        }
        match protocol::read(&line[..line.len() - 1]) {
            Some(Message::Request { id, method, params }) => match answers.to(&method, params.as_ref()) {
                None => break,
                Some(Answer::Error(error)) => {
                    // The keys in the order the SDK writes an error.
                    say(js::stringify(&JsValue::object([("jsonrpc", JsValue::str("2.0")), ("id", id), ("error", error)])));
                }
                Some(Answer::Result(result)) => {
                    if let (true, Some(key)) = (method.eq_str("initialize"), IdKey::of(&id)) {
                        hello = Some(Hello { line: line.clone(), id: key, said: js::stringify(&result), ready: None });
                    }
                    say(protocol::result(&id, result));
                }
            },
            Some(Message::Notification { method, .. }) if method.eq_str("notifications/initialized") => {
                if let Some(hello) = &mut hello {
                    hello.ready = Some(line.clone());
                }
            }
            // A notice with nothing running to hear it, or a line the server would drop too.
            Some(Message::Notification { .. }) | None => {}
        }
    }
    serve(command, args, &answers, hello, &line, stdin)
}
