//! Which Omni the command talks to and with what token, from the environment alone, and the client that sends its
//! requests.
//!
//! Inside an Omni thread the server sets OMNI_URL, OMNI_TOKEN or OMNI_TOKEN_FILE, OMNI_DATA_DIR and OMNI_THREAD_ID.
//! In a terminal the desktop app's shim sets the install's facts instead: OMNI_APP, OMNI_INSTALL_DATA_DIR,
//! OMNI_INSTALL_LOG and OMNI_INSTALL_PORT. Nothing here guesses a path.
//!
//! A data folder's token (OMNI_DATA_DIR, or the install's from the shim) stays on this machine: it goes only to a
//! server here that proves it holds it, never to another machine, which needs its own in OMNI_TOKEN or
//! OMNI_TOKEN_FILE. Plain http leaves this machine only for a Tailscale address, where Tailscale encrypts the link.

use std::cell::Cell;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::time::{Duration, Instant};

use omni_core::js::{self, JsValue};

use crate::error::{Error, Failure, Result};
use crate::http::{self, Dropped};
use crate::proof::{PROBE_MS, Probe, probe, probe_install};
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
    /// OMNI_URL set the address, and it is not this machine's loopback.
    pub remote: bool,
    /// OMNI_URL is a Tailscale address: it leads to a machine on your own tailnet.
    pub tailnet: bool,
    /// Whatever holds the address proves it holds the token (GET /api/auth/proof) before it gets it: the install's
    /// port without OMNI_URL, and any address on this machine when the token is a data folder's.
    pub prove_first: bool,
    /// The install's own port, which its server signs its proof with, also behind a tunnel or `tailscale serve`.
    pub install_port: u16,
    pub token_source: TokenSource,
    /// The token is a data folder's on this machine (OMNI_DATA_DIR or the install's), not one named for the address:
    /// it never goes to another machine.
    pub local_token: bool,
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
    pub https: bool,
    /// A Tailscale address: Tailscale encrypts the link, so plain http to it is not in the clear.
    pub tailnet: bool,
}

/// 100.64.0.0/10, fd7a:115c:a1e0::/48 or a MagicDNS name under .ts.net, the addresses Tailscale gives its machines.
fn on_tailnet(host: &str) -> bool {
    if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        return inner.parse::<Ipv6Addr>().is_ok_and(|ip| ip.segments()[..3] == [0xfd7a, 0x115c, 0xa1e0]);
    }
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        let [a, b, ..] = ip.octets();
        return a == 100 && (64..128).contains(&b);
    }
    host.strip_suffix('.').unwrap_or(host).ends_with(".ts.net")
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
    let loopback = host == "localhost"
        || host.parse::<Ipv4Addr>().is_ok_and(|ip| ip.is_loopback())
        || host
            .strip_prefix('[')
            .and_then(|h| h.strip_suffix(']'))
            .and_then(|h| h.parse::<Ipv6Addr>().ok())
            .is_some_and(|ip| ip == Ipv6Addr::LOCALHOST);
    Some(BaseUrl {
        url: format!("{}://{authority}{}", if https { "https" } else { "http" }, path.trim_end_matches('/')),
        port,
        loopback,
        https,
        tailnet: on_tailnet(&host),
    })
}

impl Connection {
    pub fn from_env() -> Result<Self> {
        Self::from_vars(sys::env)
    }

    /// From the variables `var` reads, as `sys::env` does: trimmed, and `None` when empty.
    pub fn from_vars(var: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let install_port = port_of(var("OMNI_INSTALL_PORT")).or_else(|| port_of(var("OMNI_PORT"))).unwrap_or(DEFAULT_PORT);
        let url = var("OMNI_URL");
        let parsed = match &url {
            Some(url) => Some(parse_base_url(url).ok_or_else(|| Error::cli(format!("OMNI_URL is not an http(s) address: {url}")))?),
            None => None,
        };
        if let (Some(url), Some(p)) = (&url, &parsed)
            && !(p.https || p.loopback || p.tailnet)
        {
            return Err(Error::cli(format!(
                "OMNI_URL is plain http to another machine: {url}. Use https, or a Tailscale address (100.64.0.0/10, fd7a:115c:a1e0::/48 or a .ts.net name). Nothing was sent."
            )));
        }
        let own_data = var("OMNI_DATA_DIR");
        let data_dir = own_data.clone().or_else(|| var("OMNI_INSTALL_DATA_DIR"));
        let env_token = var("OMNI_TOKEN");
        let mut local_token = false;
        let token_source = if env_token.is_some() {
            TokenSource::Env
        } else if let Some(path) = var("OMNI_TOKEN_FILE") {
            TokenSource::File { path, from: "OMNI_TOKEN_FILE" }
        } else if let Some(dir) = &data_dir {
            local_token = true;
            TokenSource::File { path: path_join(dir, "api-token"), from: if own_data.is_some() { "OMNI_DATA_DIR" } else { "the install" } }
        } else {
            TokenSource::None
        };
        Ok(Self {
            base_url: parsed.as_ref().map_or_else(|| format!("http://127.0.0.1:{install_port}"), |p| p.url.clone()),
            port: parsed.as_ref().map_or(install_port, |p| p.port),
            remote: parsed.as_ref().is_some_and(|p| !p.loopback),
            tailnet: parsed.as_ref().is_some_and(|p| p.tailnet),
            prove_first: parsed.is_none() || local_token,
            install_port,
            token_source,
            local_token,
            env_token,
            data_dir,
            thread: var("OMNI_THREAD_ID"),
            app: var("OMNI_APP"),
            log_file: var("OMNI_INSTALL_LOG"),
        })
    }

    /// A data folder's token, and OMNI_URL leads to another machine: nothing goes there.
    pub fn token_stays_here(&self) -> bool {
        self.remote && self.local_token
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
/// address, and on any address here when the token is a data folder's, the token goes only to a server that proved
/// it holds the same token: before a request, unless a proof passed within `PROOF_FRESH` and the connection has not
/// dropped since. With no token there is nothing to prove with, so nothing is sent at all. A data folder's token
/// never goes to another machine.
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

    fn stays_here(&self) -> Error {
        Error::cli(format!(
            "{} is another machine. The only token here is this machine's own, {}, so nothing was sent. Put that machine's token in OMNI_TOKEN or OMNI_TOKEN_FILE.",
            self.conn.base_url,
            describe_source(&self.conn.token_source)
        ))
    }

    /// Makes sure the server may have the token, as before a request.
    pub fn prove(&self) -> Result<()> {
        if self.conn.token_stays_here() {
            return Err(self.stays_here());
        }
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

    /// Before a link that carries the token is printed (`open --pair`), which takes it wherever the link points. To
    /// another machine with a data folder's token, only when that address is this Mac's own on your tailnet, as
    /// `tailscale serve` gives it: the server behind it proves it with the port it listens on, the install's. A public
    /// address does not get that pass, since a server there could hand on the proof from this install's own public
    /// address (Omni Connect).
    pub fn prove_for_link(&self) -> Result<()> {
        if !self.conn.token_stays_here() {
            return self.prove();
        }
        let at = &self.conn.base_url;
        if !self.conn.tailnet {
            return Err(Error::cli(format!(
                "{at} is another machine, and the link would take this machine's own token there, so it was not printed. Pair through this Mac's Tailscale address, or put that machine's token in OMNI_TOKEN."
            )));
        }
        let who = match probe_install(&self.conn) {
            Probe::Omni { mine: Some(true) } => return Ok(()),
            Probe::Free => return Err(Error::unreachable("connection refused")),
            Probe::Slow => return Err(Error::unreachable(&format!("no answer within {}s", PROBE_MS / 1000))),
            Probe::Omni { .. } => "answers as Omni, but not as this install".to_string(),
            Probe::NotOmni { detail } => format!("answers, but not as Omni ({detail})"),
        };
        Err(Error::cli(format!(
            "{at} {who}. The link would take this machine's token there, so it was not printed. To pair with that machine, put its token in OMNI_TOKEN."
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

    /// The variables a test names, read as `sys::env` reads the environment.
    fn vars(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let pairs: Vec<(String, String)> = pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect();
        move |name| pairs.iter().find(|(k, _)| k == name).map(|(_, v)| js::trim_str(v).to_string()).filter(|v| !v.is_empty())
    }

    fn connect(pairs: &[(&str, &str)]) -> Connection {
        Connection::from_vars(vars(pairs)).unwrap_or_else(|e| panic!("{pairs:?}: {}", e.message()))
    }

    #[test]
    fn knows_loopback_and_tailnet_addresses() {
        let reach = |input: &str| parse_base_url(input).map(|b| (b.loopback, b.tailnet, b.https));
        assert_eq!(reach("http://127.0.0.2:4747"), Some((true, false, false)));
        assert_eq!(reach("http://LOCALHOST"), Some((true, false, false)));
        assert_eq!(reach("http://[::1]"), Some((true, false, false)));
        assert_eq!(reach("http://100.64.0.1:4747"), Some((false, true, false)));
        assert_eq!(reach("http://100.127.255.255"), Some((false, true, false)));
        assert_eq!(reach("http://[FD7A:115C:A1E0::42]:4747"), Some((false, true, false)));
        assert_eq!(reach("http://omarchy.tail1234.ts.net:4747"), Some((false, true, false)));
        assert_eq!(reach("http://omarchy.tail1234.TS.NET.:4747"), Some((false, true, false)));
        assert_eq!(reach("https://omni.example.com"), Some((false, false, true)));
        for outside in [
            "http://100.63.255.255",
            "http://100.128.0.1",
            "http://[fd7a:115c:a1e1::1]",
            "http://evilts.net",
            "http://ts.net.example.com",
            "http://100.64.0.1.example.com",
            "http://192.168.1.20:4747",
        ] {
            assert_eq!(reach(outside), Some((false, false, false)), "{outside}");
        }
    }

    #[test]
    fn sends_plain_http_off_this_machine_only_over_a_tailnet() {
        for refused in ["http://192.168.1.20:4747", "http://omni.example.com", "http://100.128.0.1:4747", "HTTP://mac.local:4747"] {
            let Err(e) = Connection::from_vars(vars(&[("OMNI_URL", refused), ("OMNI_TOKEN", "test-token")])) else {
                panic!("{refused} was taken");
            };
            assert!(
                e.message().starts_with(&format!("OMNI_URL is plain http to another machine: {refused}. Use https")),
                "{}",
                e.message()
            );
        }
        for taken in [
            "https://omni.example.com",
            "http://127.0.0.1:4747",
            "http://localhost:4747",
            "http://100.101.102.103:4747",
            "http://[fd7a:115c:a1e0::1]:4747",
            "http://mac.tail1234.ts.net:4747",
        ] {
            connect(&[("OMNI_URL", taken), ("OMNI_TOKEN", "test-token")]);
        }
    }

    #[test]
    fn keeps_a_data_folder_token_on_this_machine() {
        let remote = "https://omni.example.test";
        for data in [("OMNI_INSTALL_DATA_DIR", "/nowhere/install"), ("OMNI_DATA_DIR", "/nowhere/data")] {
            let conn = connect(&[("OMNI_URL", remote), data]);
            assert!(conn.remote && conn.local_token && conn.token_stays_here(), "{data:?}");
            let refused = Client::new(conn, false).prove().expect_err("another machine with a data folder's token");
            assert!(refused.message().contains("is another machine. The only token here is this machine's own"), "{}", refused.message());
            assert!(refused.message().contains("OMNI_TOKEN or OMNI_TOKEN_FILE"), "{}", refused.message());
        }
        // A token named for the address goes there, as before: no proof, since a tunnel signs another port.
        for named in [("OMNI_TOKEN", "that-machine"), ("OMNI_TOKEN_FILE", "/nowhere/tok")] {
            let conn = connect(&[("OMNI_URL", remote), named, ("OMNI_INSTALL_DATA_DIR", "/nowhere/install")]);
            assert!(conn.remote && !conn.local_token && !conn.prove_first, "{named:?}");
            assert!(Client::new(conn, false).prove().is_ok(), "{named:?}");
        }
        // Inside a thread: OMNI_URL on loopback with the thread's token, which the server set for it.
        assert!(connect(&[("OMNI_URL", "https://mac.tail1234.ts.net"), ("OMNI_INSTALL_DATA_DIR", "/i")]).tailnet);
        assert!(!connect(&[("OMNI_URL", remote), ("OMNI_INSTALL_DATA_DIR", "/i")]).tailnet);
        let thread = connect(&[("OMNI_URL", "http://127.0.0.1:4747"), ("OMNI_TOKEN", "thread-token"), ("OMNI_INSTALL_DATA_DIR", "/i")]);
        assert!(!thread.remote && !thread.local_token && !thread.prove_first);
        // A data folder's token on an address here goes only to a server that proves it holds it.
        let here =
            connect(&[("OMNI_URL", "http://localhost:4757"), ("OMNI_INSTALL_DATA_DIR", "/nowhere/install"), ("OMNI_INSTALL_PORT", "4800")]);
        assert!(!here.remote && here.local_token && here.prove_first);
        assert_eq!((here.port, here.install_port), (4757, 4800));
        // Without OMNI_URL: the install's port, proved first, whatever the token.
        let port = connect(&[("OMNI_TOKEN", "t"), ("OMNI_INSTALL_PORT", "4800")]);
        assert_eq!((port.base_url.as_str(), port.prove_first, port.local_token), ("http://127.0.0.1:4800", true, false));
    }

    /// A stand-in Omni on a local port that answers every proof as `signs` says, and notes what it was asked.
    struct Answerer {
        port: u16,
        seen: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    }

    fn answerer(signs: impl Fn(&str) -> String + Send + 'static) -> Answerer {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a local port");
        let port = listener.local_addr().expect("its address").port();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let noted = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut head = Vec::new();
                let mut byte = [0u8; 1];
                while !head.ends_with(b"\r\n\r\n") && stream.read(&mut byte).is_ok_and(|n| n == 1) {
                    head.push(byte[0]);
                }
                let head = String::from_utf8_lossy(&head).to_string();
                let line = head.lines().next().unwrap_or_default().to_string();
                let authorized = head.lines().any(|l| l.to_ascii_lowercase().starts_with("authorization:"));
                noted.lock().unwrap().push(format!("{line}{}", if authorized { " +token" } else { "" }));
                let nonce = line.split("nonce=").nth(1).and_then(|r| r.split(' ').next()).unwrap_or_default();
                let body = format!(r#"{{"proof":"{}"}}"#, signs(nonce));
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        Answerer { port, seen }
    }

    #[test]
    fn prints_a_pairing_link_to_a_tailnet_address_only_when_it_leads_back_to_this_install() {
        let dir = std::env::temp_dir().join(format!("omni-cli-pair-{}", sys::uuid()));
        std::fs::create_dir_all(&dir).expect("a temp folder");
        std::fs::write(dir.join("api-token"), "install-token\n").expect("the token file");
        let dir_text = dir.to_string_lossy().to_string();
        // `tailscale serve` or a tunnel in front of the install on 4999: another address, the install's server behind it.
        let through = |a: &Answerer| {
            let url = format!("http://127.0.0.1:{}", a.port);
            let mut conn = connect(&[("OMNI_URL", &url), ("OMNI_INSTALL_DATA_DIR", &dir_text), ("OMNI_INSTALL_PORT", "4999")]);
            (conn.remote, conn.tailnet) = (true, true);
            Client::new(conn, false)
        };

        let install = answerer(|nonce| crate::proof::proof_for("install-token", 4999, nonce));
        let c = through(&install);
        assert!(c.prove_for_link().is_ok());
        // An API request still never takes this machine's token there: only the printed link, for this install.
        assert!(c.prove().is_err());
        assert_eq!(install.seen.lock().unwrap().len(), 1);
        assert!(install.seen.lock().unwrap().iter().all(|r| r.starts_with("GET /api/auth/proof?nonce=") && !r.ends_with("+token")));

        let other_port = answerer(|nonce| crate::proof::proof_for("install-token", 4747, nonce));
        let other_token = answerer(|nonce| crate::proof::proof_for("another-install", 4999, nonce));
        for a in [&other_port, &other_token] {
            let refused = through(a).prove_for_link().expect_err("not this install");
            assert!(
                refused.message().contains("answers as Omni, but not as this install. The link would take this machine's token there"),
                "{}",
                refused.message()
            );
            assert!(a.seen.lock().unwrap().iter().all(|r| !r.ends_with("+token")));
        }

        // A public address, even one that would prove itself: a server there can hand on this install's own proof.
        let public = answerer(|nonce| crate::proof::proof_for("install-token", 4999, nonce));
        let c = through(&public);
        let mut conn = c.conn.clone();
        conn.tailnet = false;
        let refused = Client::new(conn, false).prove_for_link().expect_err("a public address");
        assert!(refused.message().contains("so it was not printed. Pair through this Mac's Tailscale address"), "{}", refused.message());
        assert!(public.seen.lock().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
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
