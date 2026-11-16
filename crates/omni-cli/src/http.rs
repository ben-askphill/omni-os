//! One HTTP exchange, as Node's `fetch` makes it for the TypeScript command: no redirect is followed (the request
//! may carry the token), no proxy from the environment, and a time limit that covers the body.

use std::io::ErrorKind;
use std::sync::OnceLock;
use std::time::Duration;

use ureq::Agent;

pub struct Answer {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: String,
}

/// Why there is no answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dropped {
    /// Nothing listens on the port.
    Refused,
    /// The time limit passed, before or during the answer.
    TimedOut,
    /// The connection failed some other way, or what came back was not HTTP.
    Failed,
    /// The answer began and its body stopped short.
    Cut,
}

fn agent() -> &'static Agent {
    static AGENT: OnceLock<Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .max_redirects_will_error(false)
            .proxy(None)
            .max_idle_connections(0)
            .user_agent(concat!("omni-cli/", env!("CARGO_PKG_VERSION")))
            .build()
            .into()
    })
}

fn dropped(error: &ureq::Error) -> Dropped {
    match error {
        ureq::Error::Timeout(_) => Dropped::TimedOut,
        ureq::Error::Io(e) if e.kind() == ErrorKind::ConnectionRefused => Dropped::Refused,
        ureq::Error::Io(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => Dropped::TimedOut,
        _ => Dropped::Failed,
    }
}

/// The address as Node's URL parser sends it: in a query an apostrophe goes out as `%27`. Everything else this
/// command puts in an address is encoded already.
fn wire_url(url: &str) -> String {
    match url.split_once('?') {
        Some((path, query)) => format!("{path}?{}", query.replace('\'', "%27")),
        None => url.to_string(),
    }
}

/// Sends a GET, or a POST when there is a body, and reads the whole answer.
pub fn send(url: &str, headers: &[(&str, String)], body: Option<&str>, timeout: Duration) -> Result<Answer, Dropped> {
    let url = wire_url(url);
    let result = match body {
        None => {
            let mut request = agent().get(&url);
            for (name, value) in headers {
                request = request.header(*name, value);
            }
            request.config().timeout_global(Some(timeout)).build().call()
        }
        Some(body) => {
            let mut request = agent().post(&url);
            for (name, value) in headers {
                request = request.header(*name, value);
            }
            request.config().timeout_global(Some(timeout)).build().send(body)
        }
    };
    let mut response = result.map_err(|e| dropped(&e))?;
    let status = response.status().as_u16();
    let types: Vec<String> =
        response.headers().get_all("content-type").iter().map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned()).collect();
    let content_type = (!types.is_empty()).then(|| types.join(", "));
    let bytes = response.body_mut().with_config().limit(u64::MAX).read_to_vec().map_err(|e| match dropped(&e) {
        Dropped::TimedOut => Dropped::TimedOut,
        _ => Dropped::Cut,
    })?;
    // `Response.text()` drops a byte order mark and replaces bytes that are not UTF-8.
    let text = String::from_utf8_lossy(&bytes);
    let body = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
    Ok(Answer { status, content_type, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_an_apostrophe_in_a_query_only() {
        assert_eq!(wire_url("http://h/api/channels/it's?channel=it's"), "http://h/api/channels/it's?channel=it%27s");
        assert_eq!(wire_url("http://h/api/status"), "http://h/api/status");
    }
}
