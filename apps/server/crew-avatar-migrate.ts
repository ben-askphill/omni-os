// Crew characters (ADR 0021, D3): an agent whose avatar is one of the shared glyph icons (`icon:<name>`) shows its
// crew character from this build on. Once per machine, at boot, the user's crew files in data/crew/ lose that icon,
// and with it a color outside the agent palette (D26), so the character takes the color its shape is paired with.
// Every other key and the charter stay as written. Emoji, SVG and photo avatars, a remote agent's offered photo
// included, were picked one by one and are left alone, and so is an icon picked after this ran.
import { readFileSync } from 'node:fs';
import YAML, { isMap } from 'yaml';
import { AGENT_PALETTE } from '@omni/shared/avatar-color.ts';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import { paths } from './config.ts';
import { avatarOf, CREW_ID, crewFiles, frontmatterOf, writeOwnCrew } from './crew.ts';
import { kv } from './db.ts';
import { record } from './db/sync.ts';

/** A `sync.` key, so it stays on this machine (db/sync.ts localKey): each machine switches its own files once. */
const DONE = 'sync.migrated.crew_glyph_icons';

const PALETTE = new Set<string>(AGENT_PALETTE.map((c) => c.hex));

/** The file without its glyph icon, or null when it shows no glyph: no avatar, another kind of icon, or a photo. */
function withoutGlyph(text: string): string | null {
  const parts = frontmatterOf(text);
  if (!parts) return null;
  const doc = YAML.parseDocument(parts.yaml);
  if (doc.errors.length || !isMap(doc.contents)) return null;
  const node = doc.get('avatar');
  // What the file shows, read as every other part of Omni reads it (crew.ts avatarOf).
  const shown = avatarOf(doc.toJS()?.avatar);
  if (!isMap(node) || !shown || shown.image || parseChannelIcon(shown.icon)?.kind !== 'glyph') return null;
  node.delete('icon');
  if (!shown.bg || !PALETTE.has(shown.bg)) node.delete('bg');
  if (!node.items.length) doc.delete('avatar');
  // A file left with no keys keeps only its charter: an overlay that names no keys reads the same either way.
  return doc.contents.items.length ? `---\n${doc.toString({ lineWidth: 0 })}---\n${parts.body}` : parts.body;
}

/** Run once at boot, after the database is open. The ids of the files it rewrote, each recorded for sync. */
export function migrateCrewAvatars(): string[] {
  if (kv.get(DONE)) return [];
  const changed: string[] = [];
  let failed = false;
  for (const [id, file] of crewFiles(paths.personalCrew)) {
    if (!CREW_ID.test(id)) continue;
    try {
      const text = withoutGlyph(readFileSync(file, 'utf8'));
      if (text === null) continue;
      writeOwnCrew(id, text);
      record('crew_file', id);
      changed.push(id);
    } catch (err) {
      // One file this machine cannot read or write never stops the server: the next start tries again.
      console.error(`[omni] crew characters: could not update data/crew/${id}.md:`, (err as Error).message);
      failed = true;
    }
  }
  if (!failed) kv.set(DONE, new Date().toISOString());
  return changed;
}
