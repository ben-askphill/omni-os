//! What Omni's native binaries share (docs/internals/rust-port.md).
//!
//! - [`js`]: JSON values that parse and print the way JavaScript's `JSON.parse` and `JSON.stringify` do, so a
//!   binary that replaces a Node script sends and answers the same bytes.
//! - `api` (feature `api`): the local Omni API as a thread's own helpers reach it.

#[cfg(feature = "api")]
pub mod api;
pub mod js;
