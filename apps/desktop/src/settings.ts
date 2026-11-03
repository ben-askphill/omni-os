// The app's own settings (Quick Prompt, launch at login, zoom), in one JSON file in the app's user-data folder.
// The server's settings stay the server's. This holds only what the window and the OS need.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  applySettingsPatch,
  parseDesktopSettings,
  type DesktopSettings,
  type DesktopSettingsPatch,
} from '@omni/shared/desktop-bridge.ts';

export interface SettingsStore {
  get(): DesktopSettings;
  update(patch: DesktopSettingsPatch): DesktopSettings;
  /** Called after each change with the new and the previous settings. Returns the unsubscribe. */
  onChange(listener: (next: DesktopSettings, previous: DesktopSettings) => void): () => void;
}

export function openSettings(file: string): SettingsStore {
  let current = read(file);
  const listeners = new Set<(next: DesktopSettings, previous: DesktopSettings) => void>();
  return {
    get: () => current,
    update(patch) {
      const previous = current;
      current = applySettingsPatch(current, patch);
      write(file, current);
      for (const listener of listeners) listener(current, previous);
      return current;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function read(file: string): DesktopSettings {
  try {
    return parseDesktopSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return parseDesktopSettings(null);
  }
}

function write(file: string, settings: DesktopSettings): void {
  writeJsonAtomic(file, settings);
}

/** Writes JSON for this user only, then renames it into place, so a crash mid-write leaves the old file whole. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
