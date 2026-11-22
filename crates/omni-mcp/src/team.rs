//! `message_members`: a team's lead gives its members their parts (ADR 0019, slice 6). Omni starts this server only in
//! a team thread's lead (`apps/server/sandbox.ts`). The API decides the rest (`apps/server/runner/team.ts`): that the
//! call comes from that lead, by its own thread token, and that every name is a member seated now. It seats no one.
//! Written here, with no Node server before it, so its scenarios were written by hand
//! (`packages/test-fixtures/native/mcp/team.json`).

use omni_core::api::{Api, Method};
use omni_core::js::{self, JsString, JsValue};

use crate::server::{Outcome, Tool, user};
use crate::zod::{Field, Schema};

pub fn tool() -> Tool {
    let user = user();
    Tool {
        name: "message_members",
        description: format!(
            "Give members of your team their parts. Only for the lead of a team thread, and only to the members seated in it: it seats no one. \
             Plan first, then send each member its whole part in one message, both parts in one when a member has two, and end your turn. \
             The members start at once and work at the same time in this thread's worktree, and only you commit. \
             Omni wakes you once every member you messaged has finished, a failed or stopped one included, with their replies: then write your report. \
             A member waiting on {user} keeps you waiting too. An @name in the message is plain text."
        ),
        input: vec![
            Field::new("to", Schema::array(Schema::string()).min(1))
                .describe("The members this message goes to, by agent id or name, as your brief names them. Usually one."),
            Field::new("message", Schema::string().min(1))
                .describe("The member's part: what to do, what done looks like and what to report back. It sees the thread so far as a catch-up."),
        ],
        // The message is posted once the request lands, whether or not the call is still wanted.
        stops_when_cancelled: false,
        always_load: false,
    }
}

pub async fn run(api: &Api, arguments: &JsValue) -> Outcome {
    let Some(thread) = api.thread().and_then(|id| js::encode_uri_component(&JsString::from(id))) else {
        return Outcome::Refused("Omni did not say which thread this is (OMNI_THREAD_ID is not set), so there is no team to message.".into());
    };
    let to = arguments.get("to").cloned().unwrap_or(JsValue::Null);
    let message = arguments.get("message").cloned().unwrap_or(JsValue::Null);
    let body = js::stringify(&JsValue::object([("to", to), ("message", message)]));
    let sent = match api.call(Method::Post, &format!("/threads/{thread}/team/messages"), Some(&body)).await {
        Ok(sent) => sent,
        Err(error) => return Outcome::Refused(error.message),
    };
    let names: Vec<String> = match sent.get("sent") {
        Some(JsValue::Array(list)) => list
            .iter()
            .filter_map(|m| m.get("name").and_then(JsValue::as_js_string).map(|n| n.to_string_lossy()))
            .collect(),
        _ => Vec::new(),
    };
    let who = match names.as_slice() {
        [] => "your members".to_owned(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    };
    Outcome::Text(JsString::from(format!(
        "Sent to {who}, who started on it. Message the other members their parts, then end your turn: Omni wakes you with their replies once every member you messaged has finished."
    )))
}
