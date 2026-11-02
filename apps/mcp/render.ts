// Stdio MCP server every local thread gets (apps/server/sandbox.ts): html_render, which shows a page inline in the
// thread, above the reply. Omni saves it as an artifact (packages/shared/html-render.ts says how it is shown).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { RENDER_GUIDE, RENDER_MAX_BYTES, RENDER_MAX_TITLE, RENDER_SERVER, RENDER_TOOL, renderedText } from '@omni/shared/html-render.ts';
import { call, SELF, text } from './api.ts';

const USER = process.env.OMNI_USER || 'the user';

const server = new McpServer({ name: RENDER_SERVER, version: '0.1.0' });

server.registerTool(
  RENDER_TOOL,
  {
    description:
      `Show a finished HTML page inline in this thread, above your reply: a chart, diagram, table, mockup or before/after that ${USER} should see rather than read about. ` +
      'Pass a complete, self-contained document (inline <style> and <script>, no local files). It runs sandboxed, sized to its content, and can be interactive. ' +
      'Do not announce or restate the page in your reply. A report or document to keep goes into the artifacts folder as a file instead. ' +
      RENDER_GUIDE,
    inputSchema: {
      title: z.string().min(1).max(RENDER_MAX_TITLE).describe('A short name for the page, like "Commits by package".'),
      html: z.string().min(1).max(RENDER_MAX_BYTES).describe('A complete, self-contained HTML document.'),
    },
  },
  async ({ title, html }, extra) => {
    if (!SELF) return refused('Omni did not say which thread this is (OMNI_THREAD_ID is not set), so the page has nowhere to go.');
    try {
      const { artifact } = await call(`/threads/${SELF}/renders`, { method: 'POST', body: JSON.stringify({ title, html }), signal: extra.signal });
      return text(renderedText({ artifact: artifact.id, title: title.trim() }));
    } catch (err) {
      return refused((err as Error).message);
    }
  },
);

const refused = (message: string) => ({ ...text(message), isError: true });

process.stdin.on('end', () => process.exit(0));

await server.connect(new StdioServerTransport());
