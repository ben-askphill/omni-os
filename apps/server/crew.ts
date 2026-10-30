import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { paths } from './config.ts';
import { fillPlaceholders } from './user-config.ts';

export interface CrewRole {
  id: string;
  name: string;
  description: string;
  harness?: string;
  model?: string;
  effort?: string;
  channel?: string;
  /** Extra MCP servers this role gets. "omni" = the conductor tools. */
  mcp: string[];
  /** The role routes work and never does it: no shell, file edits, browser or subagents (DELEGATE_ONLY_DENIED). */
  delegateOnly: boolean;
  charter: string;
  error?: string;
}

export function parseCrewFile(id: string, src: string): CrewRole {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let meta: any = {};
  let error: string | undefined;
  try {
    meta = (m ? YAML.parse(m[1]) : {}) ?? {};
  } catch (err) {
    // A typo in one charter must not break every thread that uses a role.
    error = `bad frontmatter: ${(err as Error).message}`;
  }
  return {
    id,
    name: meta.name ?? id,
    description: meta.description ?? '',
    harness: meta.harness,
    model: meta.model,
    effort: meta.effort,
    channel: meta.channel,
    mcp: Array.isArray(meta.mcp) ? meta.mcp : [],
    delegateOnly: meta.delegate_only === true,
    charter: fillPlaceholders((m ? m[2] : src).trim()),
    error,
  };
}

/**
 * The Claude Code tools a delegate-only role runs without: everything that changes files, runs commands, drives a
 * browser or starts work in-thread. Reading, searching, the omni tools and ask_user_question stay, so it can still
 * look up enough to write a brief. Codex gets a read-only sandbox instead (harness/codex/adapter.ts).
 */
export const DELEGATE_ONLY_DENIED = [
  'Bash', 'Edit', 'Write', 'NotebookEdit', 'Agent', 'Task', 'Workflow', 'Artifact', 'ArtifactData',
  'mcp__omni-browser', 'mcp__plugin_playwright_playwright', 'mcp__plugin_chrome-devtools-mcp_chrome-devtools',
];

/**
 * Why a delegate-only role cannot run on a remote harness (Hermes, Cursor Cloud): it would have no omni tools to
 * delegate with, and Omni cannot take its work tools away there, so it could only do the work itself.
 */
export const remoteDelegateOnlyRefusal = (role: string, where: string) =>
  `${role} only routes work, with Omni's delegate tools, and a thread that runs ${where} does not get them. Omni cannot take that agent's own tools away either, so it would do the work itself. Run ${role} on Claude Code, Codex or Cursor instead.`;

// Read from disk each time: charters are meant to be edited while the server runs. The shared charters live in
// crew/; a file of the same name in data/crew/ is the user's own and replaces it, so a fork never edits crew/.
export function listCrew(): CrewRole[] {
  const files = new Map<string, string>();
  for (const dir of [paths.crew, paths.personalCrew]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) files.set(f.slice(0, -3), join(dir, f));
  }
  return [...files]
    .map(([id, file]) => parseCrewFile(id, readFileSync(file, 'utf8')))
    .sort((a, b) => (a.id === 'conductor' ? -1 : b.id === 'conductor' ? 1 : a.id.localeCompare(b.id)));
}

export const getCrew = (id?: string | null) => (id ? listCrew().find((r) => r.id === id) : undefined);
