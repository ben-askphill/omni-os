//! Which Omni the command talks to and with what token, from the environment alone, and the client that sends its
//! requests.
//!
//! Inside an Omni thread the server sets OMNI_URL, OMNI_TOKEN or OMNI_TOKEN_FILE, OMNI_DATA_DIR and OMNI_THREAD_ID.
//! In a terminal the desktop app's shim sets the install's facts instead: OMNI_APP, OMNI_INSTALL_DATA_DIR,
//! OMNI_INSTALL_LOG and OMNI_INSTALL_PORT. Nothing here guesses a path.

use std::cell::Cell;
use std::net::Ipv6Addr;
use std::time::{Duration, Instant};

use omni_core::js::{self, JsValue};

use crate::error::{Error, Failure, Result};
use crate::http::{self, Dropped};
use crate::proof::{PROBE_MS, Probe, probe};
use crate::sys;
use crate::text::{path_join, slice16};

pub const DEFAULT_PORT: u16 = 4747;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenSource {
    /// OMNI_TOKEN.
    Env,
    File {
        path: String,
        from: &'static str,
    },
    None,
}

/// Where the token comes from, in words, for errors and doctor.
pub fn describe_source(source: &TokenSource) -> String {
    match source {
        TokenSource::Env => "OMNI_TOKEN".to_string(),
        TokenSource::File { path, from } => format!("{path} ({from})"),
        TokenSource::None => "nowhere: set OMNI_TOKEN, OMNI_TOKEN_FILE or OMNI_DATA_DIR".to_string(),
    }
}

#[derive(Debug, Clone)]
pub struct Connection {
    /// `scheme://host[:port][/prefix]`, no trailing slash.
    pub base_url: String,
    /// The port on this machine, when the server is local.
    pub port: u16,
    /// OMNI_URL set the address, so it may be another machine.
    pub remote: bool,
    /// The address is the install's port on this machine, not OMNI_URL: whatever holds that port proves it is this
    /// install's Omni (GET /api/auth/proof) before it gets the token.
    pub prove_first: bool,
    pub token_source: TokenSource,
    env_token: Option<String>,
    pub data_dir: Option<String>,
    /// The thread an agent runs this in.
    pub thread: Option<String>,
    /// The desktop app the shim runs on (the AppImage on Linux), when the shim ran it.
    pub app: Option<String>,
    pub log_file: Option<String>,
}

/// `Number(text)` as a port, or `None`.
fn port_of(text: Option<String>) -> Option<u16> {
    let n = js::to_number(Some(&JsValue::str(&text?)));
    (n.fract() == 0.0 && (1.0..=65535.0).contains(&n)).then_some(n as u16)
}

/// A server address split into what the command needs.
#[derive(Debug, PartialEq, Eq)]
pub struct BaseUrl {
    pub url: String,
    pub port: u16,
    pub loopback: bool,
}

/// The address in OMNI_URL, or `None` when it is not an http(s) server address: a scheme, a host with an optional
/// port, an optional path prefix, and nothing after it. Trailing slashes are dropped.
pub fn parse_base_url(input: &str) -> Option<BaseUrl> {
    let input = js::trim_str(input);
    let (https, rest) = match input.get(..8) {
        Some(head) if head.eq_ignore_ascii_case("https://") => (true, &input[8..]),
        _ => match input.get(..7) {
            Some(head) if head.eq_ignore_ascii_case("http://") => (false, &input[7..]),
            _ => return None,
        },
    };
    let is_space = |c: char| u16::try_from(c as u32).is_ok_and(js::is_space);
    if rest.contains(['?', '#']) || rest.contains(is_space) {
        return None;
    }
    let (authority, path) = rest.find('/').map_or((rest, ""), |i| rest.split_at(i));
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, port_text) = if authority.starts_with('[') {
        let end = authority.find(']')?;
        let (host, after) = authority.split_at(end + 1);
        (host, after.strip_prefix(':').or(after.is_empty().then_some(""))?)
    } else {
        authority.rsplit_once(':').unwrap_or((authority, ""))
    };
    if host.is_empty() || !port_text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let default = if https { 443 } else { 80 };
    let port = if port_text.is_empty() {
        default
    } else {
        match port_text.parse::<u32>().ok()? {
            0 => default,
            n => u16::try_from(n).ok()?,
        }
    };
    let host = host.to_ascii_lowercase();
    let loopback = host == "127.0.0.1"
        || host == "localhost"
        || host
            .strip_prefix('[')
            .and_then(|h| h.strip_suffix(']'))
            .and_then(|h| h.parse::<Ipv6Addr>().ok())
            .is_some_and(|ip| ip == Ipv6Addr::LOCALHOST);
    Some(BaseUrl { url: format!("{}://{authority}{}", if https { "https" } else { "http" }, path.trim_end_matches('/')), port, loopback })
}

impl Connection {
    pub fn from_env() -> Result<Self> {
        let port = port_of(sys::env("OMNI_INSTALL_PORT")).or_else(|| port_of(sys::env("OMNI_PORT"))).unwrap_or(DEFAULT_PORT);
        let url = sys::env("OMNI_URL");
        let parsed = match &url {
            Some(url) => Some(parse_base_url(url).ok_or_else(|| Error::cli(format!("OMNI_URL is not an http(s) address: {url}")))?),
            None => None,
        };
        let own_data = sys::env("OMNI_DATA_DIR");
        let data_dir = own_data.clone().or_else(|| sys::env("OMNI_INSTALL_DATA_DIR"));
        let env_token = sys::env("OMNI_TOKEN");
        let token_source = if env_token.is_some() {
            TokenSource::Env
        } else if let Some(path) = sys::env("OMNI_TOKEN_FILE") {
            TokenSource::File { path, from: "OMNI_TOKEN_FILE" }
        } else if let Some(dir) = &data_dir {
            TokenSource::File { path: path_join(dir, "api-token"), from: if own_data.is_some() { "OMNI_DATA_DIR" } else { "the install" } }
        } else {
            TokenSource::None
        };
        Ok(Self {
            base_url: parsed.as_ref().map_or_else(|| format!("http://127.0.0.1:{port}"), |p| p.url.clone()),
            port: parsed.as_ref().map_or(port, |p| p.port),
            remote: parsed.as_ref().is_some_and(|p| !p.loopback),
            prove_first: parsed.is_none(),
            token_source,
            env_token,
            data_dir,
            thread: sys::env("OMNI_THREAD_ID"),
            app: sys::env("OMNI_APP"),
            log_file: sys::env("OMNI_INSTALL_LOG"),
        })
    }

    /// Read again on every request, so a rotated token file is picked up.
    pub fn token(&self) -> Option<String> {
        match &self.token_source {
            TokenSource::Env => self.env_token.clone(),
            TokenSource::File { path, .. } => {
                let text = sys::read_file(path)?;
                let trimmed = js::trim_str(&text);
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            }
            TokenSource::None => None,
        }
    }
}

/// How long a passed proof covers further requests: the requests one command makes together. A `--wait` also drops
/// the proof before each poll, so a server replaced between polls never gets the token.
const PROOF_FRESH: Duration = Duration::from_millis(250);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// `encodeURIComponent`.
pub fn encode(text: &str) -> String {
    js::encode_uri_component(&js::JsString::from(text)).unwrap_or_default()
}

fn is_json(content_type: Option<&str>) -> bool {
    let Some(content_type) = content_type else { return false };
    let media = js::trim_str(content_type.split(';').next().unwrap_or("")).to_lowercase();
    media == "application/json" || media.ends_with("+json")
}

/// What a refused request says: the server's `{error}` with its `detail` on a line of its own, else its text.
fn error_message(body: &str, content_type: Option<&str>, status: u16) -> String {
    let text = |v: Option<&JsValue>| v.and_then(JsValue::as_js_string).map(js::JsString::to_string_lossy).filter(|s| !s.is_empty());
    let data = if body.is_empty() { JsValue::Null } else { js::parse(body).unwrap_or_else(|_| JsValue::str(body)) };
    if let Some(error) = text(data.get("error")) {
        return match text(data.get("detail")) {
            Some(detail) => format!("{error}\n{detail}"),
            None => error,
        };
    }
    let html = content_type.is_some_and(|c| c.to_lowercase().starts_with("text/html"));
    match data.as_js_string().map(js::JsString::to_string_lossy) {
        Some(text) if !text.is_empty() && !html => slice16(&text, 300),
        _ => format!("Request failed ({status})"),
    }
}

/// Another program, or another install's Omni, can hold the install's port while this one is not running. On that
/// address the token goes only to a server that proved it holds the same token: before a request, unless a proof
/// passed within `PROOF_FRESH` and the connection has not dropped since. With no token there is nothing to prove
/// with, so nothing is sent at all.
pub struct Client {
    pub conn: Connection,
    proven_at: Cell<Option<Instant>>,
}

impl Client {
    pub fn from_env() -> Result<Self> {
        Ok(Self::new(Connection::from_env()?, false))
    }

    /// `proven` says a probe just passed.
    pub fn new(conn: Connection, proven: bool) -> Self {
        Self { conn, proven_at: Cell::new(proven.then(Instant::now)) }
    }

    /// A page of the Web UI.
    pub fn link(&self, route: &str) -> String {
        format!("{}/{route}", self.conn.base_url)
    }

    /// Drops a passed proof, so the next request proves the server again: before each poll of a `--wait`.
    pub fn forget(&self) {
        self.proven_at.set(None);
    }

    /// Makes sure the server may have the token, as before a request.
    pub fn prove(&self) -> Result<()> {
        if !self.conn.prove_first {
            return Ok(());
        }
        let at = &self.conn.base_url;
        // Without the token the proof cannot be checked, and the server would refuse the request anyway: a prompt or
        // a message must not go out to whatever holds the port.
        if self.conn.token().is_none() {
            return Err(Error::cli(format!(
                "No API token for {at}: {}. Nothing was sent. omni doctor checks it.",
                describe_source(&self.conn.token_source)
            )));
        }
        if self.proven_at.get().is_some_and(|t| t.elapsed() < PROOF_FRESH) {
            return Ok(());
        }
        let who = match probe(&self.conn) {
            Probe::Omni { mine: Some(true) } => {
                self.proven_at.set(Some(Instant::now()));
                return Ok(());
            }
            // Nothing listens, or nothing answers yet: an unreachable server, which `--wait` waits through.
            Probe::Free => return Err(Error::unreachable("connection refused")),
            Probe::Slow => return Err(Error::unreachable(&format!("no answer within {}s", PROBE_MS / 1000))),
            Probe::Omni { .. } => "answers as Omni, but not as this install's".to_string(),
            Probe::NotOmni { detail } => format!("answers, but not as Omni ({detail})"),
        };
        Err(Error::cli(format!(
            "{at} {who}: another install or another program holds the port. The token was not sent. omni doctor says more."
        )))
    }

    fn exchange(&self, path: &str, body: Option<&JsValue>) -> Result<JsValue> {
        let mut headers = vec![("accept", "application/json".to_string())];
        if let Some(token) = self.conn.token() {
            headers.push(("authorization", format!("Bearer {token}")));
        }
        if body.is_some() {
            headers.push(("content-type", "application/json".to_string()));
        }
        let url = format!("{}/api{path}", self.conn.base_url);
        let answer = match http::send(&url, &headers, body.map(js::stringify).as_deref(), REQUEST_TIMEOUT) {
            Ok(answer) => answer,
            Err(why) => {
                // The server went away: whatever answers next proves itself again.
                if why != Dropped::Cut {
                    self.proven_at.set(None);
                }
                return Err(Error::unreachable(match why {
                    Dropped::TimedOut => "timed out",
                    Dropped::Cut => "terminated",
                    Dropped::Refused | Dropped::Failed => "fetch failed",
                }));
            }
        };
        let status = answer.status;
        let content_type = answer.content_type;
        if (300..400).contains(&status) {
            return Err(Error::Http(Failure::Redirect));
        }
        if !(200..=299).contains(&status) {
            return Err(Error::Http(Failure::Http { status, message: error_message(&answer.body, content_type.as_deref(), status) }));
        }
        if !is_json(content_type.as_deref()) {
            return Err(Error::Http(Failure::NotJson { status, content_type }));
        }
        js::parse(&answer.body).map_err(|e| Error::Http(Failure::Decoding { detail: e.to_string() }))
    }

    pub fn get(&self, path: &str) -> Result<JsValue> {
        self.prove()?;
        self.exchange(path, None)
    }

    pub fn post(&self, path: &str, body: &JsValue) -> Result<JsValue> {
        self.prove()?;
        self.exchange(path, Some(body))
    }

    /// The requests the TypeScript command sends together: one proof covers them, each is sent even when an earlier
    /// one failed, and they go out in this order. After a dropped connection the next one proves the server again.
    pub fn get_all(&self, paths: &[&str]) -> Vec<Result<JsValue>> {
        if let Err(e) = self.prove() {
            return paths.iter().map(|_| Err(e.clone())).collect();
        }
        let mut dropped = false;
        paths
            .iter()
            .map(|path| {
                if dropped {
                    self.prove()?;
                }
                let answer = self.exchange(path, None);
                dropped = self.conn.prove_first && self.proven_at.get().is_none();
                answer
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(input: &str) -> Option<(String, u16, bool)> {
        parse_base_url(input).map(|b| (b.url, b.port, b.loopback))
    }

    #[test]
    fn reads_a_server_address() {
        assert_eq!(base(" http://127.0.0.1:4757/ "), Some(("http://127.0.0.1:4757".into(), 4757, true)));
        assert_eq!(base("HTTPS://Omni.Example.com/prefix//"), Some(("https://Omni.Example.com/prefix".into(), 443, false)));
        assert_eq!(base("http://localhost"), Some(("http://localhost".into(), 80, true)));
        assert_eq!(base("http://[::1]:8080/a/b"), Some(("http://[::1]:8080/a/b".into(), 8080, true)));
        assert_eq!(base("http://[0:0:0:0:0:0:0:1]"), Some(("http://[0:0:0:0:0:0:0:1]".into(), 80, true)));
        assert_eq!(base("http://host:0"), Some(("http://host:0".into(), 80, false)));
        for bad in [
            "",
            "ftp://host",
            "http://",
            "http:///path",
            "http://user@host",
            "http://host?x=1",
            "http://host/#a",
            "http://ho st",
            "host:4747",
            "http://host:99999",
            "http://host:port",
        ] {
            assert_eq!(base(bad), None, "{bad}");
        }
    }

    #[test]
    fn reads_a_port_as_a_javascript_number() {
        let port = |t: &str| port_of(Some(t.to_string()));
        assert_eq!(port("4757"), Some(4757));
        assert_eq!(port("0x1F90"), Some(8080));
        assert_eq!(port("8.08e3"), Some(8080));
        assert_eq!(port("0"), None);
        assert_eq!(port("65536"), None);
        assert_eq!(port("80.5"), None);
        assert_eq!(port("port"), None);
        assert_eq!(port_of(None), None);
    }

    #[test]
    fn words_a_refused_request() {
        assert_eq!(error_message(r#"{"error":"No such thread","detail":"gone"}"#, Some("application/json"), 404), "No such thread\ngone");
        assert_eq!(error_message(r#"{"error":""}"#, Some("application/json"), 500), "Request failed (500)");
        assert_eq!(error_message("plain words", Some("text/plain"), 502), "plain words");
        assert_eq!(error_message("<html>", Some("Text/HTML; charset=utf-8"), 502), "Request failed (502)");
        assert_eq!(error_message("", None, 503), "Request failed (503)");
        assert_eq!(error_message(&"x".repeat(400), None, 500).len(), 300);
    }

    #[test]
    fn knows_json_by_its_media_type() {
        assert!(is_json(Some("application/json")));
        assert!(is_json(Some(" Application/Problem+JSON ; charset=utf-8")));
        assert!(!is_json(Some("text/html")));
        assert!(!is_json(None));
    }
}
