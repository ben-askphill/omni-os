import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.ts';
import { updateUserConfig, userConfig } from './user-config.ts';

// The automation YAML files on disk, with nothing but fs and the user config, so the sync handler
// (sync/handlers/automation-file.ts) can read and write them without importing the scheduler and the runner.
// automations.ts loads them; automation-files.ts edits them.

/** An automation's id, and its file's name in data/automations/: lowercase words and dashes. */
export const AUTOMATION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const YAML_FILE = /\.ya?ml$/;

/** The YAML files in dir, by automation id. */
export function yamlFiles(dir: string): [id: string, file: string][] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => YAML_FILE.test(f))
    .map((f) => [f.replace(YAML_FILE, ''), join(dir, f)]);
}

export const fileOf = (dir: string, id: string) => yamlFiles(dir).find(([x]) => x === id)?.[1];
export const personalFile = (id: string) => join(paths.personalAutomations, `${id}.yaml`);

/**
 * Write the user's file for this id whole: a tmp file the watcher ignores, then a rename. An `.yml` of the same id
 * would shadow it, and a per-machine on/off or channel override in data/omni.config.json would hide what the file now
 * says, so both go. A shipped one this machine hid stays hidden.
 */
export function writeOwnFile(id: string, text: string) {
  mkdirSync(paths.personalAutomations, { recursive: true });
  const file = personalFile(id);
  const tmp = join(paths.personalAutomations, `.${id}.yaml.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  for (const [x, other] of yamlFiles(paths.personalAutomations)) if (x === id && other !== file) rmSync(other);
  const o = userConfig().automations[id];
  if (!o || (o.enabled === undefined && o.channel === undefined)) return;
  updateUserConfig({ automations: { [id]: null } });
  if (o.deleted) updateUserConfig({ automations: { [id]: { deleted: true } } });
}

/** Remove the user's file for this id. False when there was none. */
export function removeOwnFileOnDisk(id: string): boolean {
  const own = yamlFiles(paths.personalAutomations).filter(([x]) => x === id);
  for (const [, file] of own) rmSync(file);
  return own.length > 0;
}

/** The user's file's text, or null when there is none. */
export function ownFileText(id: string): string | null {
  const file = fileOf(paths.personalAutomations, id);
  return file ? readFileSync(file, 'utf8') : null;
}
