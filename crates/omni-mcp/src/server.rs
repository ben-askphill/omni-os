//! The server loop the three tools share: lines in on stdin, one line out per answer, a task per tool call.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::io::Write;
use std::rc::Rc;

use omni_core::api::Api;
use omni_core::js::{JsObject, JsString, JsValue};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::watch;

use crate::protocol::{self, IdKey, Message};
use crate::zod::{self, Field, Schema};
use crate::{ask, memory, render, steps, team, threads};

#[derive(Clone, Copy)]
pub enum Kind {
    Ask,
    Render,
    Steps,
    Threads,
    Memory,
    Team,
}

/// What a tool call came to.
pub enum Outcome {
    Text(JsString),
    /// An error the agent reads and can act on.
    Refused(JsString),
    /// The tool had no text to answer with, which the protocol does not allow in a result.
    Broken,
}

pub struct Tool {
    pub name: &'static str,
    pub description: String,
    pub input: Vec<Field>,
    /// Whether cancelling a call stops its work. Where it does not, the work runs on and only the answer is dropped.
    pub stops_when_cancelled: bool,
    /// Whether Claude Code loads the tool with the thread instead of deferring it behind its tool search, so the model
    /// calls it without a ToolSearch step first (`_meta` `anthropic/alwaysLoad`, https://code.claude.com/docs/en/mcp).
    /// Claude Code cuts the description of such a tool at 4,096 characters. Other harnesses ignore the key.
    pub always_load: bool,
}

/// Who the tool descriptions say the agent is working for.
pub fn user() -> String {
    std::env::var("OMNI_USER").ok().filter(|name| !name.is_empty()).unwrap_or_else(|| "the user".to_owned())
}

struct Server {
    kind: Kind,
    name: &'static str,
    tool: Tool,
    /// The tool's input as one schema, built once.
    input: Schema,
    api: Api,
    /// The tool calls that have not answered yet, each with the switch that cancels it. A later call with an id still
    /// in use takes the id over, as it does in the SDK, so the entry also says which call it belongs to.
    running: RefCell<HashMap<IdKey, (u64, watch::Sender<bool>)>>,
    calls: Cell<u64>,
}

fn write(line: &str) {
    let mut out = std::io::stdout().lock();
    // A closed stdout means the harness is gone, and stdin closing ends the process: nothing to do about it here.
    let _ = out.write_all(line.as_bytes()).and_then(|()| out.write_all(b"\n")).and_then(|()| out.flush());
}

impl Server {
    fn new(kind: Kind) -> Self {
        let (name, mut tool) = match kind {
            Kind::Ask => ("omni-ask", ask::tool()),
            Kind::Render => ("omni-render", render::tool()),
            Kind::Steps => ("omni-steps", steps::tool()),
            Kind::Threads => ("omni-threads", threads::tool()),
            Kind::Memory => ("omni-memory", memory::tool()),
            Kind::Team => ("omni-team", team::tool()),
        };
        let input = Schema::Object(std::mem::take(&mut tool.input));
        Self { kind, name, tool, input, api: Api::from_env(), running: RefCell::default(), calls: Cell::new(0) }
    }

    fn fields(&self) -> &[Field] {
        match &self.input {
            Schema::Object(fields) => fields,
            _ => &[],
        }
    }

    fn tools(&self) -> JsValue {
        let mut tool = vec![
            ("name", JsValue::str(self.tool.name)),
            ("description", JsValue::str(&self.tool.description)),
            ("inputSchema", zod::input_schema(self.fields())),
            ("execution", JsValue::object([("taskSupport", JsValue::str("forbidden"))])),
        ];
        if self.tool.always_load {
            tool.push(("_meta", JsValue::object([("anthropic/alwaysLoad", JsValue::Bool(true))])));
        }
        let tool = JsValue::object(tool);
        JsValue::object([("tools", JsValue::Array(vec![tool]))])
    }

    fn initialized(&self, version: &str) -> JsValue {
        JsValue::object([
            ("protocolVersion", JsValue::str(version)),
            ("capabilities", JsValue::object([("tools", JsValue::object([("listChanged", JsValue::Bool(true))]))])),
            ("serverInfo", JsValue::object([("name", JsValue::str(self.name)), ("version", JsValue::str("0.1.0"))])),
        ])
    }

    fn request(self: &Rc<Self>, id: JsValue, method: &JsString, params: Option<JsValue>) {
        let method = method.to_string_lossy();
        if !matches!(method.as_str(), "initialize" | "ping" | "tools/list" | "tools/call") {
            return write(&protocol::error(&id, protocol::METHOD_NOT_FOUND, "Method not found"));
        }
        if protocol::asks_for_a_task(params.as_ref()) {
            let message = format!("Server does not support task creation (required for {method})");
            return write(&protocol::error(&id, protocol::INTERNAL_ERROR, &message));
        }
        let params = params.as_ref();
        let answer = match method.as_str() {
            "ping" => Ok(JsValue::Object(JsObject::new())),
            "initialize" => protocol::initialize(params).map(|asked| self.initialized(asked.version)),
            "tools/list" => protocol::list(params).map(|()| self.tools()),
            _ => match protocol::call(params) {
                Ok(call) => return self.start(id, call),
                Err(message) => Err(message),
            },
        };
        match answer {
            Ok(result) => write(&protocol::result(&id, result)),
            Err(message) => write(&protocol::error(&id, protocol::INTERNAL_ERROR, &message)),
        }
    }

    /// Runs a tool call beside the read loop, so a call that waits for hours does not hold up the next line.
    fn start(self: &Rc<Self>, id: JsValue, call: protocol::Call) {
        let Some(key) = IdKey::of(&id) else { return };
        let (cancel, cancelled) = watch::channel(false);
        let number = self.calls.get() + 1;
        self.calls.set(number);
        self.running.borrow_mut().insert(key.clone(), (number, cancel));
        let server = Rc::clone(self);
        tokio::task::spawn_local(async move {
            let answer = server.call(&id, call, cancelled.clone()).await;
            let mut running = server.running.borrow_mut();
            if running.get(&key).is_some_and(|(owner, _)| *owner == number) {
                running.remove(&key);
            }
            drop(running);
            // A cancelled call answers nothing, whatever it came to.
            if let (Some(line), false) = (answer, *cancelled.borrow()) {
                write(&line);
            }
        });
    }

    async fn call(&self, id: &JsValue, call: protocol::Call, mut cancelled: watch::Receiver<bool>) -> Option<String> {
        let refused = |message: JsString| Some(protocol::result(id, protocol::tool_result(message, true)));
        if !call.name.eq_str(self.tool.name) {
            let mut message = JsString::from("MCP error -32602: Tool ");
            message.push_js(&call.name);
            message.push_str(" not found");
            return refused(message);
        }
        let arguments = match zod::parse(&self.input, call.arguments.as_ref(), &[]) {
            Ok(arguments) => arguments,
            Err(issues) => {
                let why = zod::lines(&issues);
                return refused(JsString::from(format!(
                    "MCP error -32602: Input validation error: Invalid arguments for tool {}: {why}",
                    self.tool.name
                )));
            }
        };
        let work = async {
            match self.kind {
                Kind::Ask => ask::run(&self.api, &arguments).await,
                Kind::Render => render::run(&self.api, &arguments).await,
                Kind::Steps => steps::run(&arguments),
                Kind::Threads => threads::run(&self.api, &arguments).await,
                Kind::Memory => memory::run(&self.api, &arguments).await,
                Kind::Team => team::run(&self.api, &arguments).await,
            }
        };
        let outcome = if self.tool.stops_when_cancelled {
            let stop = async {
                // A switch that is gone was never thrown: a later call took this one's id over.
                if cancelled.wait_for(|stop| *stop).await.is_err() {
                    std::future::pending::<()>().await;
                }
            };
            tokio::select! {
                biased;
                () = stop => return None,
                outcome = work => outcome,
            }
        } else {
            work.await
        };
        match outcome {
            Outcome::Text(text) => Some(protocol::result(id, protocol::tool_result(text, false))),
            Outcome::Refused(message) => refused(message),
            Outcome::Broken => Some(protocol::error(
                id,
                protocol::INVALID_PARAMS,
                "MCP error -32602: Invalid tools/call result: the tool answered without text",
            )),
        }
    }

    /// `notifications/cancelled`: stops the call it names, if that call is still running. A notice the SDK would not
    /// read (no params, a reason that is not text, an id that is no id) changes nothing.
    fn cancel(&self, params: Option<&JsValue>) {
        let Some(params) = params else { return };
        if params.get("reason").is_some_and(|reason| reason.as_js_string().is_none()) {
            return;
        }
        // The SDK tests the id for truth before it looks the call up, so 0 and "" name nothing.
        let Some(key) = params.get("requestId").filter(|id| id.is_truthy()).and_then(IdKey::of) else {
            return;
        };
        if let Some((_, cancel)) = self.running.borrow().get(&key) {
            let _ = cancel.send(true);
        }
    }
}

/// Serves until stdin closes. The harness closing it means the harness is gone, so calls still waiting end with it.
pub async fn serve(kind: Kind) {
    let server = Rc::new(Server::new(kind));
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut line = Vec::new();
    loop {
        line.clear();
        // A last line with no newline never was a message to the SDK either.
        if !matches!(stdin.read_until(b'\n', &mut line).await, Ok(n) if n > 0) || line.pop() != Some(b'\n') {
            std::process::exit(0);
        }
        match protocol::read(&line) {
            Some(Message::Request { id, method, params }) => server.request(id, &method, params),
            Some(Message::Notification { method, params }) if method.eq_str("notifications/cancelled") => server.cancel(params.as_ref()),
            Some(Message::Notification { .. }) | None => {}
        }
    }
}
