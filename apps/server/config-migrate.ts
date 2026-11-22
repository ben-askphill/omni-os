// Installs from before the user config existed: their data dir already has threads but no data/omni.config.json.
// They skip onboarding, and the file keeps the name, email and GitHub owner Omni already used. Folders and the
// timezone take a fresh install's fallbacks (Settings shows them): the old code's own were one person's.
import { execFileSync } from 'node:child_process';
import { db, kv } from './db.ts';
import { configExists, omniRepo, writeUserConfig, userConfigSchema, type UserConfig } from './user-config.ts';

const git = (...args: string[]) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/** Who the old install worked for, from the old kv profile, git and the checkout's origin. */
export function legacyConfig(): UserConfig {
  const profile = kv.get<{ name?: string }>('profile');
  const gitName = git('config', '--global', 'user.name');
  return userConfigSchema.parse({
    onboardedAt: new Date().toISOString(),
    user: {
      // The greeting and prompts used a first name.
      name: profile?.name?.trim() || gitName.split(/\s+/)[0] || '',
      email: git('config', '--global', 'user.email'),
    },
    workspace: { githubOwner: omniRepo()?.split('/')[0] ?? '' },
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
