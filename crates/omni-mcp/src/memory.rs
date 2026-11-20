//! `remember`: a crew role's thread proposes a lesson for the role's later threads (crew plan S6,
//! `docs/plans/2026-11-18-user-defined-crew.md`). OMNI_ROLE names the role: Omni starts this server only for a role
//! whose threads may propose (`apps/server/sandbox.ts`). The API decides the rest (`apps/server/memory-api.ts`): that
//! this thread runs as that role, which channel the lesson is for, and whether it waits for the user. Written here,
//! with no Node server before it, so its scenarios were written by hand (`packages/test-fixtures/native/mcp/memory.json`).

use omni_core::api::{Api, Method};
use omni_core::js::{self, JsString, JsValue};

use crate::server::{Outcome, Tool, user};
use crate::zod::{Field, Schema};

/// MEMORY_MAX of packages/shared/memory.ts, which the API holds a lesson to.
const MAX_TEXT: u32 = 500;

pub fn tool() -> Tool {
    let user = user();
    Tool {
        name: "remember",
        description: format!(
            "Propose a lesson for this agent's later threads: a correction {user} made to how this agent works, or a step it missed that every later thread of it should take. \
             One short sentence that still makes sense in a new thread, about how to work, never about this one task. Never put secrets, credentials or personal data in it. \
             It holds in this channel only, unless you pass everywhere: true for a lesson about the agent that holds in every channel. \
             It waits for {user}'s approval in Settings > Agents, unless {user} lets this agent keep its lessons at once; the answer says which."
        ),
        input: vec![
            Field::new("text", Schema::string().min(1).max(MAX_TEXT)).describe("The lesson, in one short sentence."),
            Field::new("everywhere", Schema::Boolean)
                .optional()
                .describe("true: for this agent in every channel. Leave it out for this channel only."),
        ],
        // The proposal is saved once the request lands, whether or not the call is still wanted.
        stops_when_cancelled: false,
    }
}

pub async fn run(api: &Api, arguments: &JsValue) -> Outcome {
    let role = std::env::var("OMNI_ROLE").ok().filter(|role| !role.is_empty());
    let Some(role) = role.as_deref().and_then(|role| js::encode_uri_component(&JsString::from(role))) else {
        return Outcome::Refused("This thread runs as no agent, so there is no agent memory to add to.".into());
    };
    let text = arguments.get("text").cloned().unwrap_or(JsValue::Null);
    let everywhere = arguments.get("everywhere").is_some_and(|v| matches!(v, JsValue::Bool(true)));
    // Left out, the channel is this thread's own; null is every channel.
    let body = if everywhere {
        js::stringify(&JsValue::object([("text", text), ("channel", JsValue::Null)]))
    } else {
        js::stringify(&JsValue::object([("text", text)]))
    };
    let fact = match api.call(Method::Post, &format!("/crew/{role}/memory"), Some(&body)).await {
        Ok(fact) => fact,
        Err(error) => return Outcome::Refused(error.message),
    };
    let user = user();
    let channel = fact.get("channel_id").and_then(JsValue::as_js_string).map(|c| format!("#{}", c.to_string_lossy()));
    let scope = channel.map_or_else(|| "every channel".to_owned(), |c| format!("{c} only"));
    let approved = fact.get("status").and_then(JsValue::as_js_string).is_some_and(|s| s.eq_str("approved"));
    Outcome::Text(JsString::from(if approved {
        format!("Kept for this agent's later threads in {scope}: {user} lets this agent keep its lessons at once.")
    } else {
        format!("Proposed for this agent's later threads in {scope}. It waits for {user} to approve it in Settings > Agents.")
    }))
}
