//! The command's version: the desktop app's, which the desktop build passes in as OMNI_CLI_VERSION. "dev" from a
//! checkout, as the TypeScript command says there.

pub const VERSION: &str = match option_env!("OMNI_CLI_VERSION") {
    Some(version) => version,
    None => "dev",
};
