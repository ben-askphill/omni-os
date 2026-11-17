//! `ask_user_question`, Omni's own AskUserQuestion. The questions show as a card in the thread and in Needs you; the
//! call waits, polling the API, until the user acts.

use std::time::Duration;

use omni_core::api::{Api, Method};
use omni_core::js::{self, JsString, JsValue};

use crate::server::{Outcome, Tool, user};
use crate::zod::{Field, Schema};

/// Seconds each poll waits on the server. Under its 30s cap and under the 35s it counts a waiter as alive.
const WAIT: u32 = 25;
/// Between polls that could not reach Omni.
const RETRY: Duration = Duration::from_millis(2000);

// The limits of packages/shared/question.ts, which the server parses a call with.
// packages/shared/tests/question.test.ts checks that the two files agree.
const QUESTIONS_MAX: u32 = 4;
const OPTIONS_MIN: u32 = 2;
const OPTIONS_MAX: u32 = 4;
const HEADER_MAX: u32 = 12;

pub fn tool() -> Tool {
    let user = user();
    let option = Schema::Object(vec![
        Field::new("label", Schema::string()).describe("1 to 5 words, shown bold."),
        Field::new("description", Schema::string()).describe("One line under the label: what this choice means or what follows from it."),
    ]);
    let question = Schema::Object(vec![
        Field::new("question", Schema::string()).describe("The full question, ending with a question mark."),
        // No maximum: a schema limit makes the harness refuse the whole call over one extra character. Omni shortens it instead.
        Field::new("header", Schema::string()).optional().describe(format!(
            "A short tag shown with the question, at most {HEADER_MAX} characters, like \"Q4 focus\". A longer one is cut short."
        )),
        Field::new("options", Schema::array(option).min(OPTIONS_MIN).max(OPTIONS_MAX)).describe(format!(
            "{OPTIONS_MIN} to {OPTIONS_MAX} distinct choices, the one you recommend first. Never add \"Other\": the card always offers it."
        )),
        Field::new("multiSelect", Schema::Boolean).optional().describe("true when more than one option can apply. Default false."),
    ]);
    Tool {
        name: "ask_user_question",
        description: format!(
            "Ask {user} 1 to {QUESTIONS_MAX} multiple-choice questions and wait for the answers. Use it at a real fork only {user} can settle: \
             an ambiguous requirement, a choice between approaches with different tradeoffs, a preference, a go-ahead. \
             Not for what you can find out by reading or running things, and not to ask permission for routine steps. \
             The questions show as a card in the thread and in Needs you, where {user} can always type an answer of their own, so never offer \"Other\". \
             Your turn waits on this call until {user} answers or skips, which can take hours. If they send a message instead, it tells you to read that message."
        ),
        input: vec![Field::new("questions", Schema::array(question).min(1).max(QUESTIONS_MAX))],
        stops_when_cancelled: true,
    }
}

pub async fn run(api: &Api, arguments: &JsValue) -> Outcome {
    let Some(thread) = api.thread() else {
        return Outcome::Refused(
            "Omni did not say which thread this is (OMNI_THREAD_ID is not set), so the questions have nowhere to go.".into(),
        );
    };
    let questions = arguments.get("questions").cloned().unwrap_or(JsValue::Null);
    let body = js::stringify(&JsValue::object([("questions", questions)]));
    let id = match api.call(Method::Post, &format!("/threads/{thread}/questions"), Some(&body)).await {
        // What the Node server said when the answer had no body to take the id from.
        Ok(JsValue::Null) => return Outcome::Refused("Cannot destructure property 'id' of '(intermediate value)' as it is null.".into()),
        Ok(asked) => js::to_js_string(asked.get("id")).to_string_lossy(),
        // A 400 says what to fix in the call.
        Err(error) => return Outcome::Refused(error.message),
    };
    // The text the agent reads once the user acts. Polls until then; a call the harness cancels is dropped mid-wait.
    let poll = format!("/threads/{thread}/questions/{id}?wait={WAIT}");
    loop {
        match api.call(Method::Get, &poll, None).await {
            Ok(answer) if answer != JsValue::Null => {
                if answer.get("state").and_then(JsValue::as_js_string).is_some_and(|state| state.eq_str("pending")) {
                    continue;
                }
                return match answer.get("text") {
                    Some(JsValue::String(text)) => Outcome::Text(text.clone()),
                    Some(other) => Outcome::Text(JsString::from(js::stringify_pretty(other))),
                    None => Outcome::Broken,
                };
            }
            Err(error) if error.is_refusal() => return Outcome::Refused(error.message),
            // Omni is restarting or busy: try again.
            Ok(_) | Err(_) => tokio::time::sleep(RETRY).await,
        }
    }
}
