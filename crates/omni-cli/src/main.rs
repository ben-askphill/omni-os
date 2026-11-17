//! The omni command (`docs/user/cli.md`, ADR 0014): six commands over Omni's HTTP API. It replaced a TypeScript
//! command and is held to a record of what that one printed, sent and started (`packages/test-fixtures/native/cli`,
//! `tests/goldens.rs`). `docs/internals/rust-port.md` says where the two differed on purpose.

mod api;
mod args;
mod commands;
mod connection;
#[cfg(test)]
mod corpus;
mod disk;
mod error;
mod format;
mod help;
mod http;
mod num;
mod proof;
mod resolve;
mod sys;
mod text;
mod time;
mod val;
mod version;
mod wait;

use connection::{Connection, describe_source};
use error::{Error, Failure, exit};
use help::Command;

/// What a failed request means for someone at a terminal, and what to try.
fn http_message(failure: &Failure) -> String {
    let conn = Connection::from_env().ok();
    let at = conn.as_ref().map_or("the server", |c| c.base_url.as_str());
    match failure {
        Failure::Unreachable { detail } => format!("cannot reach Omni at {at} ({detail}). Is it running? omni doctor says why not."),
        Failure::Http { status: 401, .. } => {
            let source = conn.as_ref().map_or_else(|| "the environment".to_string(), |c| describe_source(&c.token_source));
            format!("Omni at {at} refused the token from {source}. omni doctor checks it.")
        }
        Failure::Http { status: 404, message } => {
            format!("{message}: Omni at {at} has nothing by that id. Check it, or update Omni if it is older than this command.")
        }
        Failure::NotJson { status, content_type } => {
            format!("{at} answered, but not as Omni's API ({status} {}). Is OMNI_URL right?", content_type.as_deref().unwrap_or(""))
        }
        other => other.message(),
    }
}

fn run(argv: &[String]) -> i32 {
    let first = argv.first().map_or("", String::as_str);
    let rest = argv.get(1..).unwrap_or_default();
    if matches!(first, "" | "-h" | "--help" | "help") {
        let topic = rest.first().filter(|_| first == "help").and_then(|t| Command::named(t));
        sys::out(&topic.map_or_else(help::usage, Command::usage));
        return if first.is_empty() { exit::USAGE } else { exit::OK };
    }
    if matches!(first, "--version" | "-v") {
        sys::out(&format!("omni {}\n", version::VERSION));
        return exit::OK;
    }
    let Some(command) = Command::named(first) else {
        sys::err(&format!("omni: unknown command {first}\n\n{}", help::usage()));
        return exit::USAGE;
    };
    if rest.iter().any(|a| a == "-h" || a == "--help") {
        sys::out(&command.usage());
        return exit::OK;
    }
    let done = match command {
        Command::New => commands::write::new_command(rest),
        Command::Send => commands::write::send_command(rest),
        Command::Threads => commands::read::threads_command(rest),
        Command::Show => commands::read::show_command(rest),
        Command::Status => commands::status::status_command(rest),
        Command::Doctor => commands::doctor::doctor_command(rest),
        Command::Open => commands::open::open_command(rest),
    };
    match done {
        Ok(code) => code,
        Err(Error::Usage(message)) => {
            sys::err(&format!("omni {first}: {message}\n\n{}", command.usage()));
            exit::USAGE
        }
        Err(Error::Cli(message)) => {
            sys::err(&format!("omni {first}: {message}\n"));
            exit::ERROR
        }
        Err(Error::Http(failure)) => {
            sys::err(&format!("omni {first}: {}\n", http_message(&failure)));
            exit::ERROR
        }
    }
}

fn main() {
    let argv: Vec<String> = std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    std::process::exit(run(&argv));
}
