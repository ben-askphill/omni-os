//! The local Omni API as a thread's own helpers reach it, with the URL, token and thread id Omni hands each one
//! (`apps/server/sandbox.ts` `buildMcpConfig`). A port of `apps/mcp/api.ts`: the same requests, the same errors.

use std::fmt;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use reqwest::header::HeaderValue;

use crate::js::{self, JsObject, JsString, JsValue};

/// Where the server listens when `OMNI_URL` is not set.
pub const DEFAULT_URL: &str = "http://127.0.0.1:4747";

/// A request that failed. With a `status`, the API answered with an error: a 4xx means the call itself was wrong,
/// so trying again will not help. Without one, Omni did not answer at all.
#[derive(Debug, Clone, PartialEq)]
pub struct ApiError {
    pub message: JsString,
    pub status: Option<u16>,
}

impl ApiError {
    /// The API said the call was wrong (a 4xx): the caller's to fix, not to retry.
    pub fn is_refusal(&self) -> bool {
        self.status.is_some_and(|s| s < 500)
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ApiError {}

/// What Node's `fetch` says when the server cannot be reached, which is the text agents have always been shown.
const UNREACHABLE: &str = "fetch failed";

/// What reading `error` off a JSON `null` error body threw in JavaScript.
const NULL_BODY: &str = "Cannot read properties of null (reading 'error')";

pub enum Method {
    Get,
    Post,
}

pub struct Api {
    base: String,
    /// The API token: `OMNI_TOKEN` from the thread's env, else the file Omni named in `OMNI_TOKEN_FILE`
    /// (`data/api-token`). Rotating the install token rewrites that file but not the env of a running thread, so a
    /// 401 reads the file again and retries once with what it holds now.
    token: Mutex<String>,
    token_file: Option<PathBuf>,
    thread: Option<String>,
    http: reqwest::Client,
}

fn env(name: &str) -> Option<String> {
    std::env::var_os(name).map(|v| v.to_string_lossy().into_owned())
}

/// A header value as fetch sends it: trimmed, each character one Latin-1 byte. `None` for what fetch refuses to send:
/// a character beyond Latin-1, a NUL or a line break.
fn header_value(text: &str) -> Option<HeaderValue> {
    let text = text.trim_matches(['\t', '\n', '\r', ' ']);
    let bytes =
        text.chars().map(|c| u8::try_from(u32::from(c)).ok().filter(|b| !matches!(b, 0 | b'\n' | b'\r'))).collect::<Option<Vec<u8>>>()?;
    HeaderValue::from_bytes(&bytes).ok()
}

fn read_token(file: Option<&PathBuf>) -> String {
    file.and_then(|f| std::fs::read(f).ok()).map(|bytes| js::trim_str(&String::from_utf8_lossy(&bytes)).to_owned()).unwrap_or_default()
}

impl Api {
    /// From `OMNI_URL`, `OMNI_TOKEN`, `OMNI_TOKEN_FILE` and `OMNI_THREAD_ID`.
    pub fn from_env() -> Self {
        // An empty OMNI_TOKEN_FILE names no file, as an empty OMNI_TOKEN is no token.
        let token_file = env("OMNI_TOKEN_FILE").filter(|f| !f.is_empty()).map(PathBuf::from);
        let token = env("OMNI_TOKEN").filter(|t| !t.is_empty()).unwrap_or_else(|| read_token(token_file.as_ref()));
        Self::new(env("OMNI_URL").unwrap_or_else(|| DEFAULT_URL.to_owned()), token, token_file, env("OMNI_THREAD_ID"))
    }

    pub fn new(base: String, token: String, token_file: Option<PathBuf>, thread: Option<String>) -> Self {
        // As Node's fetch does it: no proxy from the environment, ten seconds to connect, and five minutes of silence
        // before a request counts as lost. The longest wait Omni's API is asked for is 25 seconds.
        let http = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(300))
            .build()
            .expect("an HTTP client with no TLS always builds");
        Self { base, token: Mutex::new(token), token_file, thread: thread.filter(|t| !t.is_empty()), http }
    }

    /// The thread this helper was started for.
    pub fn thread(&self) -> Option<&str> {
        self.thread.as_deref()
    }

    async fn send(&self, method: &Method, path: &str, body: Option<&str>, bearer: &str) -> Result<(u16, Vec<u8>), ApiError> {
        let unreachable = || ApiError { message: JsString::from(UNREACHABLE), status: None };
        let url = format!("{}/api{}", self.base, path);
        let mut request = match method {
            Method::Get => self.http.get(url),
            Method::Post => self.http.post(url),
        }
        .header("content-type", "application/json")
        .header("authorization", header_value(&format!("Bearer {bearer}")).ok_or_else(unreachable)?);
        // Names the thread on every call, so the API can hold an agent thread to what it may do
        // (apps/server/automation-guard.ts).
        if let Some(thread) = &self.thread {
            request = request.header("x-omni-thread", header_value(thread).ok_or_else(unreachable)?);
        }
        if let Some(body) = body {
            request = request.body(body.to_owned());
        }
        let response = request.send().await.map_err(|_| unreachable())?;
        let status = response.status().as_u16();
        // A body that breaks off is read as an empty one, as `res.json().catch(() => ({}))` reads it.
        let bytes = response.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
        Ok((status, bytes))
    }

    /// One call. The body of a 2xx answer, or why not. A body that is not JSON reads as an empty object; one that is
    /// JSON `null` stays `null`, which the callers treat the way their JavaScript did.
    pub async fn call(&self, method: Method, path: &str, body: Option<&str>) -> Result<JsValue, ApiError> {
        // Compare against the token this request sent, not the shared one: a parallel call may have swapped it already.
        let sent = self.token.lock().expect("token lock").clone();
        let (mut status, mut bytes) = self.send(&method, path, body, &sent).await?;
        if status == 401 {
            let fresh = read_token(self.token_file.as_ref());
            if !fresh.is_empty() && fresh != sent {
                self.token.lock().expect("token lock").clone_from(&fresh);
                (status, bytes) = self.send(&method, path, body, &fresh).await?;
            }
        }
        let body = js::parse_bytes(&bytes).unwrap_or_else(|_| JsValue::Object(JsObject::new()));
        if (200..300).contains(&status) {
            return Ok(body);
        }
        if body == JsValue::Null {
            // What JavaScript throws on `null.error`. It is no API refusal, so a caller that retries does.
            return Err(ApiError { message: JsString::from(NULL_BODY), status: None });
        }
        // A refusal's `detail` (such as git's reason under it) belongs to the message, so the agent reads both.
        let message = match body.get("error").filter(|e| e.is_truthy()) {
            Some(error) => match body.get("detail").filter(|d| d.is_truthy()) {
                Some(detail) => {
                    let mut text = error.to_js_string();
                    text.push_str(" ");
                    text.push_js(&detail.to_js_string());
                    text
                }
                None => error.to_js_string(),
            },
            None => JsString::from(format!("HTTP {status}")),
        };
        Err(ApiError { message, status: Some(status) })
    }
}
