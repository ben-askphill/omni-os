import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { paths } from './config.ts';

export interface CrewRole {
  id: string;
  name: string;
  description: string;
  model?: string;
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
    model: meta.model,
    channel: meta.channel,
    mcp: Array.isArray(meta.mcp) ? meta.mcp : [],
    charter: (m ? m[2] : src).trim(),
    error,
  };
}

// Read from disk each time: charters are meant to be edited while the server runs.
export function listCrew(): CrewRole[] {
  if (!existsSync(paths.crew)) return [];
  return readdirSync(paths.crew)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseCrewFile(f.slice(0, -3), readFileSync(join(paths.crew, f), 'utf8')))
    .sort((a, b) => (a.id === 'conductor' ? -1 : b.id === 'conductor' ? 1 : a.id.localeCompare(b.id)));
}

export const getCrew = (id?: string | null) => (id ? listCrew().find((r) => r.id === id) : undefined);
