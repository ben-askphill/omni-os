//! Whether the server on the install's port is this install's Omni, asked without the token: GET /api/auth/proof
//! answers an HMAC of its port and a nonce under its token. `doctor` reports it; every other command needs it
//! before it sends the token.

use std::time::Duration;

use omni_core::js::{self, JsValue};
use ring::hmac;

use crate::connection::{Connection, THREAD_TOKEN_PREFIX};
use crate::http::{self, Dropped};
use crate::sys;

pub const PROBE_MS: u64 = 2000;

/// What answers on the port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    Free,
    Slow,
    NotOmni {
        detail: String,
    },
    /// `mine` is `None` when there is no token to check the proof with (none, or a thread's own), or the server is remote.
    Omni {
        mine: Option<bool>,
    },
}

/// The proof an Omni server answers with: the hex HMAC-SHA256 of its port and the nonce under its token.
pub fn proof_for(token: &str, port: u16, nonce: &str) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, token.as_bytes());
    hmac::sign(&key, format!("omni-proof:{port}:{nonce}").as_bytes()).as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether the server at the address is this install's. Through a tunnel or proxy the server signs its own port, not
/// the one in OMNI_URL: only a local proof is checked.
pub fn probe(conn: &Connection) -> Probe {
    ask(conn, (!conn.remote).then_some(conn.port))
}

/// Whether the server at OMNI_URL on another machine is this install after all, reached through `tailscale serve` or
/// a tunnel: it signs the port it listens on, the install's own.
pub fn probe_install(conn: &Connection) -> Probe {
    ask(conn, Some(conn.install_port))
}

/// The probe, with the proof checked against `port` when there is one.
fn ask(conn: &Connection, port: Option<u16>) -> Probe {
    let nonce = sys::uuid().replace('-', "");
    let url = format!("{}/api/auth/proof?nonce={nonce}", conn.base_url);
    let answer = match http::send(&url, &[("accept", "*/*".to_string())], None, Duration::from_millis(PROBE_MS)) {
        Ok(answer) => answer,
        Err(Dropped::Refused) => return Probe::Free,
        Err(Dropped::TimedOut) => return Probe::Slow,
        Err(Dropped::Failed | Dropped::Cut) => return Probe::NotOmni { detail: "nothing answered as HTTP".to_string() },
    };
    let proof =
        js::parse(&answer.body).ok().and_then(|v| v.get("proof").and_then(JsValue::as_js_string).map(js::JsString::to_string_lossy));
    let Some(proof) = proof.filter(|_| answer.status == 200) else {
        return Probe::NotOmni { detail: format!("it answered {}, not an Omni proof", answer.status) };
    };
    // A thread's own token is not the one the server signs with, so it cannot check the proof.
    match (conn.token(), port) {
        (Some(token), Some(port)) if !token.starts_with(THREAD_TOKEN_PREFIX) => {
            Probe::Omni { mine: Some(proof == proof_for(&token, port, &nonce)) }
        }
        _ => Probe::Omni { mine: None },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_the_port_and_the_nonce() {
        // node -e "console.log(require('crypto').createHmac('sha256','test-token').update('omni-proof:4747:abc').digest('hex'))"
        assert_eq!(proof_for("test-token", 4747, "abc").len(), 64);
        assert_ne!(proof_for("test-token", 4747, "abc"), proof_for("test-token", 4748, "abc"));
        assert_ne!(proof_for("test-token", 4747, "abc"), proof_for("other", 4747, "abc"));
    }
}
