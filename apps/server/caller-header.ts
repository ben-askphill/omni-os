// The header Omni's MCP servers and the omni command name their thread with. Its own module so request-guard.ts, which
// never opens the db, and automation-guard.ts, which does, share the one name.
export const CALLER_HEADER = 'x-omni-thread';
