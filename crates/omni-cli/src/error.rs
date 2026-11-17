//! How a command fails, and the exit code each failure gets (`docs/user/cli.md`).

/// What a command answers.
pub mod exit {
    pub const OK: i32 = 0;
    /// `--wait`: the thread failed or was stopped. `doctor`: a check failed.
    pub const FAILED: i32 = 1;
    /// `--wait`: the thread needs you (a question, a usage limit, a setup failure).
    pub const NEEDS_YOU: i32 = 2;
    /// Omni could not do it: the server is down, refused the token, or refused the request.
    pub const ERROR: i32 = 3;
    /// The command line was wrong.
    pub const USAGE: i32 = 64;
}

/// Why a request got no usable answer: client-core's `HttpFailure`, less the kinds a command line cannot produce.
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    /// No answer at all: the server is down, the address is wrong, or the connection dropped.
    Unreachable { detail: String },
    /// A non-2xx answer. `message` is the server's `{error}` or its text.
    Http { status: u16, message: String },
    /// A 2xx answer that is not JSON, like the Web UI's index.html for a path the server does not route.
    NotJson { status: u16, content_type: Option<String> },
    /// JSON that does not parse.
    Decoding { detail: String },
    /// The server answered with a redirect. Refused: the token stays with the server.
    Redirect,
}

impl Failure {
    pub fn message(&self) -> String {
        match self {
            Self::Unreachable { .. } => "Cannot reach the Omni server. Is it running?".to_string(),
            Self::Http { message, .. } => message.clone(),
            Self::NotJson { status, content_type } => {
                format!("The server answered {status} with {}, not JSON.", content_type.as_deref().unwrap_or("no content type"))
            }
            Self::Decoding { detail } => format!("The server sent data this app can't read: {detail}"),
            Self::Redirect => "The server redirected the request to another address. The app refuses to follow it.".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    /// A wrong command line: the message, then the command's help.
    Usage(String),
    /// A refusal the command makes itself (no such machine, nothing to open).
    Cli(String),
    /// A request that failed.
    Http(Failure),
}

impl Error {
    pub fn usage(message: impl Into<String>) -> Self {
        Self::Usage(message.into())
    }

    pub fn cli(message: impl Into<String>) -> Self {
        Self::Cli(message.into())
    }

    pub fn unreachable(detail: &str) -> Self {
        Self::Http(Failure::Unreachable { detail: detail.to_string() })
    }

    /// The error's own words, as `err.message` reads in TypeScript.
    pub fn message(&self) -> String {
        match self {
            Self::Usage(message) | Self::Cli(message) => message.clone(),
            Self::Http(failure) => failure.message(),
        }
    }

    pub fn is_unreachable(&self) -> bool {
        matches!(self, Self::Http(Failure::Unreachable { .. }))
    }

    pub fn http_status(&self) -> Option<u16> {
        match self {
            Self::Http(Failure::Http { status, .. }) => Some(*status),
            _ => None,
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
