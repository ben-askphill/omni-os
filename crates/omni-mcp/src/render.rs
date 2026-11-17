//! `html_render`, which shows a page inline in the thread, above the reply. Omni saves it as an artifact
//! (`packages/shared/html-render.ts` says how it is shown, and holds the limits and the theme variables named here).

use omni_core::api::{Api, Method};
use omni_core::js::{self, JsString, JsValue};

use crate::server::{Outcome, Tool, user};
use crate::zod::{Field, Schema};

// RENDER_MAX_TITLE and RENDER_MAX_BYTES of packages/shared/html-render.ts, which the server holds a call to.
// packages/shared/tests/html-render.test.ts checks that the two files agree.
const MAX_TITLE: u32 = 200;
const MAX_HTML: u32 = 512_000;

/// What a page must do to look like part of the thread. It names every theme variable the frame sets
/// (RENDER_COLORS and RENDER_OTHER of packages/shared/html-render.ts).
const GUIDE: &str = "Use the theme variables on :root, never fixed colours, so the page matches Omni in light and dark: \
    --background, --foreground, --muted, --muted-foreground, --card, --card-foreground, --border, --primary, --primary-foreground, \
    --accent, --accent-foreground, --destructive, --warning, --success, --code-background, \
    --chart-1, --chart-2, --chart-3, --chart-4, --chart-5, --chart-6, --radius, --font-sans, --font-mono. \
    The frame is the reply column (about 680px on desktop, 360px on a phone) on the thread background. \
    Leave html and body with no background, outer card, border, page title banner or side padding: the base sheet sets text colour and font. \
    A box that needs its own background gets var(--card), 16px padding and var(--radius) corners. \
    Give charts a fixed pixel height and fluid width. \
    Use --chart-1 to --chart-6 in that order for series, and label them or add a legend: never colour alone. \
    Let the content set the height: no vh units and no height:100% on html or body.";

pub fn tool() -> Tool {
    let user = user();
    Tool {
        name: "html_render",
        description: format!(
            "Show a finished HTML page inline in this thread, above your reply: a chart, diagram, table, mockup or before/after that {user} should see rather than read about. \
             Pass a complete, self-contained document (inline <style> and <script>, no local files). It runs sandboxed, sized to its content, and can be interactive. \
             Do not announce or restate the page in your reply. A report or document to keep goes into the artifacts folder as a file instead. \
             {GUIDE}"
        ),
        input: vec![
            Field::new("title", Schema::string().min(1).max(MAX_TITLE)).describe("A short name for the page, like \"Commits by package\"."),
            Field::new("html", Schema::string().min(1).max(MAX_HTML)).describe("A complete, self-contained HTML document."),
        ],
        stops_when_cancelled: true,
    }
}

pub async fn run(api: &Api, arguments: &JsValue) -> Outcome {
    let Some(thread) = api.thread() else {
        return Outcome::Refused(
            "Omni did not say which thread this is (OMNI_THREAD_ID is not set), so the page has nowhere to go.".into(),
        );
    };
    let field = |name: &str| arguments.get(name).cloned().unwrap_or(JsValue::Null);
    let title = field("title");
    let body = js::stringify(&JsValue::object([("title", title.clone()), ("html", field("html"))]));
    let saved = match api.call(Method::Post, &format!("/threads/{thread}/renders"), Some(&body)).await {
        Ok(saved) => saved,
        Err(error) => return Outcome::Refused(error.message),
    };
    // An answer without the artifact reads as it did from the Node server, which let JavaScript's own error through.
    let id = match (&saved, saved.get("artifact")) {
        (JsValue::Null, _) => {
            return Outcome::Refused("Cannot destructure property 'artifact' of '(intermediate value)' as it is null.".into());
        }
        (_, None) => return Outcome::Refused("Cannot read properties of undefined (reading 'id')".into()),
        (_, Some(JsValue::Null)) => return Outcome::Refused("Cannot read properties of null (reading 'id')".into()),
        (_, Some(artifact)) => js::to_js_string(artifact.get("id")),
    };
    // `renderedText` of packages/shared/html-render.ts, which the web client matches to find the page's card.
    let mut text = JsString::from("Shown inline in the thread as \"");
    text.push_js(&title.as_js_string().map(JsString::trim).unwrap_or_default());
    text.push_str("\" (artifact ");
    text.push_js(&id);
    text.push_str("). Do not restate or describe the page: say what it means, or nothing.");
    Outcome::Text(text)
}
