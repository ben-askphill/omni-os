//! JSON-RPC as the MCP SDK's stdio server reads and writes it: which lines count as a message, what a request must
//! look like before its handler runs, and the answers.

use omni_core::js::{self, JsObject, JsString, JsValue};

use crate::zod::{self, Field, Key, MAX_SAFE_INTEGER, Schema};

/// The protocol versions the SDK this was ported from speaks, newest first.
const VERSIONS: [&str; 5] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];

pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const INTERNAL_ERROR: i32 = -32603;

/// A request id as a map key: the SDK keys its running calls by the id itself, so `5` and `"5"` are two calls.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum IdKey {
    Number(u64),
    Text(JsString),
}

impl IdKey {
    /// `None` for what is no request id: not a string and not a whole number in the safe range.
    pub fn of(id: &JsValue) -> Option<Self> {
        match id {
            JsValue::String(text) => Some(Self::Text(text.clone())),
            // Adding zero turns -0 into 0, which JavaScript's Map treats as the same key.
            JsValue::Number(n) if is_safe_integer(*n) => Some(Self::Number((*n + 0.0).to_bits())),
            _ => None,
        }
    }
}

fn is_safe_integer(n: f64) -> bool {
    n.is_finite() && n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER
}

#[derive(Debug, PartialEq)]
pub enum Message {
    Request { id: JsValue, method: JsString, params: Option<JsValue> },
    Notification { method: JsString, params: Option<JsValue> },
}

/// `_meta`, where params carry one: an object whose progress token and related task, if there, are well formed.
fn meta_is_valid(params: &JsObject) -> bool {
    let Some(meta) = params.get("_meta") else { return true };
    let JsValue::Object(meta) = meta else { return false };
    let token = meta.get("progressToken").is_none_or(|token| IdKey::of(token).is_some());
    let task = meta.get("io.modelcontextprotocol/related-task").is_none_or(|task| matches!(task.get("taskId"), Some(JsValue::String(_))));
    token && task
}

/// One line of stdin as a message. `None` for what the SDK drops without an answer: text that is not JSON, a batch,
/// a response, a message with a key the protocol does not have, a malformed id or malformed params.
pub fn read(line: &[u8]) -> Option<Message> {
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    let JsValue::Object(message) = js::parse(&String::from_utf8_lossy(line)).ok()? else {
        return None;
    };
    if !message.get("jsonrpc")?.as_js_string()?.eq_str("2.0") {
        return None;
    }
    let method = message.get("method")?.as_js_string()?.clone();
    let params = match message.get("params") {
        None => None,
        Some(JsValue::Object(params)) if meta_is_valid(params) => Some(JsValue::Object(params.clone())),
        Some(_) => return None,
    };
    let only = |keys: &[&str]| message.iter().all(|(key, _)| keys.iter().any(|known| key.eq_str(known)));
    match message.get("id") {
        Some(id) => {
            IdKey::of(id)?;
            only(&["jsonrpc", "id", "method", "params"]).then(|| Message::Request { id: id.clone(), method, params })
        }
        None => only(&["jsonrpc", "method", "params"]).then_some(Message::Notification { method, params }),
    }
}

/// Whether the params ask for the call to run as a task, which these servers do not do.
pub fn asks_for_a_task(params: Option<&JsValue>) -> bool {
    let Some(task) = params.and_then(|p| p.get("task")) else {
        return false;
    };
    zod::parse(&task_schema(), Some(task), &[]).is_ok()
}

fn task_schema() -> Schema {
    Schema::Object(vec![Field::new("ttl", Schema::number()).optional()])
}

fn text() -> Schema {
    Schema::string()
}

/// What `initialize` must carry. The SDK also checks the shape of the rarer capabilities (experimental, elicitation,
/// tasks, extensions) and of `clientInfo.icons`; this checks the ones a client is known to send (docs/internals/rust-port.md).
fn initialize_params() -> Schema {
    let capabilities = Schema::Object(vec![
        Field::new("sampling", Schema::Object(vec![])).optional(),
        Field::new("roots", Schema::Object(vec![Field::new("listChanged", Schema::Boolean).optional()])).optional(),
    ]);
    let client = Schema::Object(vec![
        Field::new("name", text()),
        Field::new("title", text()).optional(),
        Field::new("version", text()),
        Field::new("websiteUrl", text()).optional(),
        Field::new("description", text()).optional(),
    ]);
    Schema::Object(vec![Field::new("protocolVersion", text()), Field::new("capabilities", capabilities), Field::new("clientInfo", client)])
}

fn list_params() -> Schema {
    Schema::Object(vec![Field::new("cursor", text()).optional()])
}

fn call_params() -> Schema {
    Schema::Object(vec![
        Field::new("task", task_schema()).optional(),
        Field::new("name", text()),
        Field::new("arguments", Schema::Record).optional(),
    ])
}

/// Params that passed their request's schema, or the message of the error the SDK answers with.
fn checked(schema: &Schema, params: Option<&JsValue>, required: bool) -> Result<Option<JsValue>, String> {
    if params.is_none() && !required {
        return Ok(None);
    }
    zod::parse(schema, params, &[Key::Name("params")]).map(Some).map_err(|issues| zod::dump(&issues))
}

pub struct Initialize {
    pub version: &'static str,
}

/// The protocol version to answer with: the one asked for when it is known, else the newest.
pub fn initialize(params: Option<&JsValue>) -> Result<Initialize, String> {
    let params = checked(&initialize_params(), params, true)?;
    let asked = params.as_ref().and_then(|p| p.get("protocolVersion")).and_then(JsValue::as_js_string);
    let version = VERSIONS.iter().find(|known| asked.is_some_and(|asked| asked.eq_str(known))).unwrap_or(&VERSIONS[0]);
    Ok(Initialize { version })
}

pub fn list(params: Option<&JsValue>) -> Result<(), String> {
    checked(&list_params(), params, false).map(|_| ())
}

pub struct Call {
    pub name: JsString,
    pub arguments: Option<JsValue>,
}

pub fn call(params: Option<&JsValue>) -> Result<Call, String> {
    let params = checked(&call_params(), params, true)?.unwrap_or(JsValue::Null);
    let name = params.get("name").and_then(JsValue::as_js_string).cloned().unwrap_or_default();
    Ok(Call { name, arguments: params.get("arguments").cloned() })
}

/// A result, with its keys in the order the SDK writes them.
pub fn result(id: &JsValue, result: JsValue) -> String {
    js::stringify(&JsValue::object([("result", result), ("jsonrpc", JsValue::str("2.0")), ("id", id.clone())]))
}

pub fn error(id: &JsValue, code: i32, message: &str) -> String {
    let error = JsValue::object([("code", JsValue::Number(f64::from(code))), ("message", JsValue::str(message))]);
    js::stringify(&JsValue::object([("jsonrpc", JsValue::str("2.0")), ("id", id.clone()), ("error", error)]))
}

/// What a tool call answers: one block of text, marked when it is an error the agent should read.
pub fn tool_result(text: JsString, is_error: bool) -> JsValue {
    let block = JsValue::object([("type", JsValue::str("text")), ("text", JsValue::String(text))]);
    let mut result = JsObject::new();
    result.set("content", JsValue::Array(vec![block]));
    if is_error {
        result.set("isError", JsValue::Bool(true));
    }
    JsValue::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(line: &str) -> &'static str {
        match read(line.as_bytes()) {
            Some(Message::Request { .. }) => "request",
            Some(Message::Notification { .. }) => "notification",
            None => "dropped",
        }
    }

    #[test]
    fn a_line_is_a_request_a_notification_or_nothing() {
        assert_eq!(kind(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#), "request");
        assert_eq!(kind("  {\"jsonrpc\":\"2.0\",\"id\":\"\",\"method\":\"ping\",\"params\":{}}  \r"), "request");
        assert_eq!(kind(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#), "notification");
        for dropped in [
            "",
            "not json",
            r#"[{"jsonrpc":"2.0","id":1,"method":"ping"}]"#,
            r#"{"id":1,"method":"ping"}"#,
            r#"{"jsonrpc":"1.0","id":1,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":1.5,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":9007199254740993,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ping","extra":1}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ping","params":[1]}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ping","params":{"_meta":{"progressToken":1.5}}}"#,
            r#"{"jsonrpc":"2.0","method":"x","params":{"_meta":{"io.modelcontextprotocol/related-task":{"taskId":5}}}}"#,
        ] {
            assert_eq!(kind(dropped), "dropped", "{dropped}");
        }
    }

    #[test]
    fn ids_that_javascript_holds_equal_share_a_key() {
        let key = |json: &str| IdKey::of(&js::parse(json).unwrap());
        assert_eq!(key("-0"), key("0"));
        assert_eq!(key("1e2"), key("100"));
        assert_ne!(key("5"), key("\"5\""));
        assert_eq!(key("true"), None);
    }

    #[test]
    fn only_well_formed_task_params_ask_for_a_task() {
        let asks = |json: &str| asks_for_a_task(Some(&js::parse(json).unwrap()));
        assert!(asks(r#"{"task":{}}"#));
        assert!(asks(r#"{"task":{"ttl":1.5,"more":1}}"#));
        assert!(!asks(r#"{"task":{"ttl":null}}"#));
        assert!(!asks(r#"{"task":5}"#));
        assert!(!asks(r#"{}"#));
    }
}
