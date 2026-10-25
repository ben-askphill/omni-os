// Stdio MCP server every local thread without the conductor's `omni` server gets (apps/server/sandbox.ts): only
// read_referenced_thread, so an agent can read a thread Ben referenced and nothing else of Omni.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReferencedThread } from './referenced-thread.ts';

const server = new McpServer({ name: 'omni-threads', version: '0.1.0' });
registerReferencedThread(server);

// The harness closed our stdin: it is gone.
process.stdin.on('end', () => process.exit(0));

await server.connect(new StdioServerTransport());
