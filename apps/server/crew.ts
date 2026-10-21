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
    charter: fillPlaceholders((m ? m[2] : src).trim()),
    error,
  };
}

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
