//! One module per command family: write (`new`, `send`), read (`threads`, `show`), status, doctor and open.

pub mod doctor;
pub mod open;
pub mod read;
pub mod status;
pub mod write;
