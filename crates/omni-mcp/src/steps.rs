//! `set_steps`, the plain step list a thread shows as its progress. The call itself is the record: Omni reads the
//! list back out of the call in the transcript (`packages/shared/steps.ts`), so the tool only checks it and says
//! where the marker is. It calls no API.

use omni_core::js::{JsString, JsValue};

use crate::server::{Outcome, Tool, user};
use crate::zod::{Field, Schema};

pub fn tool() -> Tool {
    let user = user();
    Tool {
        name: "set_steps",
        description: format!(
            "Show {user} the plan for this task as a short list of steps in the thread, and move the marker as you work. \
             Call it before you start anything with more than one stage, with 3 to 6 steps, then again with the same list each time a step starts or finishes. \
             Write each step as a few plain words {user} would use, like \"Find candidate apps\" or \"Compare prices\": no tool names, file paths, commands or code. \
             Skip it for a quick answer."
        ),
        input: vec![
            // No length limits: a schema limit makes the harness refuse the whole call over one extra character.
            Field::new("steps", Schema::array(Schema::string()).min(1))
                .describe("Every step in order, the same list each call unless the plan changed. 3 to 6, each a few plain words."),
            // Optional: a caller that has not loaded the schema (a deferred tool) often leaves it out, and the
            // transcript reader (`packages/shared/steps.ts`) already reads a missing one as 0.
            Field::new("current", Schema::int().min(0)).optional().describe(
                "The index (from 0) of the step you are on now, 0 when left out. The ones before it are done. Pass the number of steps once all are done.",
            ),
        ],
        stops_when_cancelled: true,
    }
}

pub fn run(arguments: &JsValue) -> Outcome {
    let steps: Vec<JsString> = match arguments.get("steps") {
        Some(JsValue::Array(steps)) => steps.iter().filter_map(|step| step.as_js_string().map(JsString::trim)).collect(),
        _ => Vec::new(),
    };
    if steps.iter().any(JsString::is_empty) {
        return Outcome::Refused("Every step needs a title of a few words.".into());
    }
    let total = steps.len();
    let current = arguments.get("current").and_then(JsValue::as_f64).unwrap_or(0.0) as usize;
    if current > total {
        return Outcome::Refused(format!("current is {current}, but there are only {total} steps. Pass {total} once all are done.").into());
    }
    let mut text = JsString::from("Showing ");
    if current == total {
        text.push_str(&format!("all {total} steps as done."));
    } else {
        text.push_str(&format!("step {} of {total}, \"", current + 1));
        text.push_js(&steps[current]);
        text.push_str("\". Call set_steps again when it changes.");
    }
    Outcome::Text(text)
}
