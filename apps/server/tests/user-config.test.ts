import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expandHome,
  fillPlaceholders,
  isOnboarded,
  objectPronoun,
  readUserConfig,
  resolved,
  updateUserConfig,
  userConfig,
  userName,
  writeUserConfig,
} from '../user-config.ts';

// The user config (data/omni.config.json): defaults when it is missing, env over file, and the placeholders that
// keep the repo's charters and automations free of anyone's name or paths. Pure: no database.

let dir: string;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omni-config-'));
  process.env.OMNI_CONFIG = join(dir, 'omni.config.json');
  delete process.env.OMNI_TZ;
  delete process.env.OMNI_BRAIN_DIR;
  delete process.env.OMNI_HERMES_URL;
  delete process.env.OMNI_CENTRAL_BRAIN_DIR;
});
afterEach(() => {
  process.env = { ...saved };
});

describe('user config', () => {
  it('has no file and is not onboarded on a fresh install, with neutral defaults', () => {
    expect(readUserConfig()).toBeNull();
    expect(isOnboarded()).toBe(false);
    expect(userName()).toBe('the user');
    expect(resolved.pronouns()).toBe('they/them');
    expect(resolved.workspaceRoot()).toBe(join(homedir(), 'Omni'));
    expect(resolved.reposDir()).toBe(join(homedir(), 'code'));
    expect(resolved.timezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(resolved.hermesUrl()).toBe('');
    expect(resolved.centralBrainDir()).toBe('');
  });

  it('reads the file, expanding ~, and env vars still win', () => {
    writeUserConfig({
      ...userConfig(),
      onboardedAt: '2026-10-21T00:00:00.000Z',
      user: { name: 'Ada', pronouns: 'she/her', email: 'ada@example.com', timezone: 'Europe/London' },
      workspace: { root: '~/work', reposDir: '~/src', githubOwner: 'ada' },
      integrations: { hermesUrl: 'http://100.1.2.3:8642/', centralBrainDir: '~/brain' },
    });
    expect(isOnboarded()).toBe(true);
    expect(userName()).toBe('Ada');
    expect(resolved.timezone()).toBe('Europe/London');
    expect(resolved.workspaceRoot()).toBe(join(homedir(), 'work'));
    expect(resolved.hermesUrl()).toBe('http://100.1.2.3:8642');
    expect(resolved.centralBrainDir()).toBe(join(homedir(), 'brain'));
    process.env.OMNI_TZ = 'Asia/Tokyo';
    process.env.OMNI_BRAIN_DIR = '/elsewhere';
    expect(resolved.timezone()).toBe('Asia/Tokyo');
    expect(resolved.workspaceRoot()).toBe('/elsewhere');
  });

  it('merges a patch, keeps the rest, and drops an automation override on null', () => {
    updateUserConfig({ user: { name: 'Ada' }, automations: { 'brain-nightly': { enabled: true, channel: 'notes' } } });
    updateUserConfig({ workspace: { githubOwner: 'ada' } });
    expect(userConfig().user.name).toBe('Ada');
    expect(userConfig().automations['brain-nightly']).toEqual({ enabled: true, channel: 'notes' });
    updateUserConfig({ automations: { 'brain-nightly': null } });
    expect(userConfig().automations).toEqual({});
    // Saving settings is not finishing onboarding.
    expect(isOnboarded()).toBe(false);
    expect(JSON.parse(readFileSync(process.env.OMNI_CONFIG!, 'utf8')).workspace.githubOwner).toBe('ada');
  });

  it('notices edits made on disk while the server runs', () => {
    updateUserConfig({ user: { name: 'Ada' } });
    const raw = JSON.parse(readFileSync(process.env.OMNI_CONFIG!, 'utf8'));
    raw.user.name = 'Grace';
    writeFileSync(process.env.OMNI_CONFIG!, JSON.stringify(raw));
    // Force a different mtime on fast file systems.
    const later = new Date(Date.now() + 5000);
    utimesSync(process.env.OMNI_CONFIG!, later, later);
    expect(userName()).toBe('Grace');
  });

  it('survives a broken file: defaults, and no onboarding loop', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(process.env.OMNI_CONFIG!, '{ not json');
    expect(userName()).toBe('the user');
    expect(isOnboarded()).toBe(true);
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    updateUserConfig({ user: { name: 'Ada' }, workspace: { root: '~/work' }, integrations: { centralBrainDir: '~/brain' } });
    expect(fillPlaceholders('{{user}} works in {{workspace}}, brain {{centralBrain}}, {{nope}}')).toBe('Ada works in ~/work, brain ~/brain, {{nope}}');
  });

  it('turns pronouns into the object form prompts use', () => {
    expect(objectPronoun('he/him')).toBe('him');
    expect(objectPronoun('she/her')).toBe('her');
    expect(objectPronoun('they/them')).toBe('them');
    expect(objectPronoun('xe/xem')).toBe('xem');
    expect(objectPronoun('')).toBe('them');
  });

  it('expands ~ only at the start', () => {
    expect(expandHome('~')).toBe(homedir());
    expect(expandHome('~/a')).toBe(join(homedir(), 'a'));
    expect(expandHome('/abs/~/x')).toBe('/abs/~/x');
  });
});
