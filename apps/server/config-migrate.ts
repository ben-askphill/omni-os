// Installs from before the user config existed: their data dir already has threads but no data/omni.config.json.
// They skip onboarding, and the file is written with what Omni assumed before, so nothing changes for them.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { db, kv } from './db.ts';
import { configExists, omniRepo, writeUserConfig, userConfigSchema, type UserConfig } from './user-config.ts';

/**
 * The defaults the code had before the user config, used only here. They are the original author's, and an install
 * this old ran on them, so writing them keeps that install as it was. A fresh install never sees them.
 */
const LEGACY = { workspaceRoot: '~/phillbert', timezone: 'Europe/Amsterdam' };

const git = (...args: string[]) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/** What the old install used, from the old kv profile, git and the env the server already runs with. */
export function legacyConfig(): UserConfig {
  const profile = kv.get<{ name?: string }>('profile');
  const gitName = git('config', '--global', 'user.name');
  const env = process.env;
  const brain = env.OMNI_BRAIN_DIR ? '' : existsSync(join(homedir(), 'phillbert')) ? LEGACY.workspaceRoot : '';
  return userConfigSchema.parse({
    onboardedAt: new Date().toISOString(),
    user: {
      // The greeting and prompts used a first name.
      name: profile?.name?.trim() || gitName.split(/\s+/)[0] || '',
      email: git('config', '--global', 'user.email'),
      timezone: env.OMNI_TZ ? '' : LEGACY.timezone,
    },
    workspace: { root: brain, githubOwner: omniRepo()?.split('/')[0] ?? '' },
    integrations: { centralBrainDir: existsSync(join(homedir(), 'central-brain')) ? '~/central-brain' : '' },
  });
}

/** True when it wrote the file. Run once at boot, after the database is open. */
export function migrateLegacyConfig() {
  if (configExists()) return false;
  // A fresh install has no threads before onboarding, and onboarding (or Skip) writes the file.
  const hasHistory = db.prepare('SELECT 1 FROM threads LIMIT 1').get();
  if (!hasHistory) return false;
  writeUserConfig(legacyConfig());
  console.log('[omni] wrote data/omni.config.json from this install\'s existing settings (no onboarding needed)');
  return true;
}
