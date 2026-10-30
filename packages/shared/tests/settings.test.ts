import { describe, expect, it } from 'vitest';
import { pageFields, SETTING_FIELDS, settingHint, settingPlaceholder, settingProblem, type SettingField } from '../settings.ts';

const field = (key: string): SettingField => SETTING_FIELDS.find((f) => f.key === key)!;

describe('settings contract', () => {
  it('names each field once, and each shown field has a Settings section', () => {
    const ids = SETTING_FIELDS.map((f) => `${f.section}.${f.key}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pageFields('general').map((f) => f.key)).toEqual(['name', 'pronouns', 'timezone', 'email']);
    expect(pageFields('workspace').map((f) => f.key)).toEqual(['root', 'reposDir', 'githubOwner', 'hermesUrl', 'centralBrainDir']);
  });

  it('checks a saved file for length and safe folder text only', () => {
    expect(settingProblem(field('name'), 'x'.repeat(61), 'file')).toMatch(/under 60/);
    expect(settingProblem(field('root'), '~/x\nrm -rf ~', 'file')).toMatch(/control characters/);
    expect(settingProblem(field('timezone'), 'Nowhere/Land', 'file')).toBeNull();
  });

  it('checks a save for format, and a form for required fields too', () => {
    expect(settingProblem(field('timezone'), 'Nowhere/Land', 'save')).toMatch(/Unknown timezone/);
    expect(settingProblem(field('timezone'), 'Europe/London', 'save')).toBeNull();
    expect(settingProblem(field('email'), 'nope', 'save')).toMatch(/valid email/);
    expect(settingProblem(field('githubOwner'), 'not an owner', 'save')).toMatch(/GitHub owner/);
    expect(settingProblem(field('hermesUrl'), 'ftp://x', 'save')).toMatch(/http:\/\/100\.64\.0\.1:8642/);
    expect(settingProblem(field('hermesUrl'), '', 'save')).toBeNull();
    expect(settingProblem(field('name'), ' ', 'save')).toBeNull();
    expect(settingProblem(field('name'), ' ', 'form')).toBe('Enter a name.');
  });

  it("fills a hint and placeholder from this machine's defaults", () => {
    expect(settingHint(field('timezone'), { timezone: 'Europe/London' })).toBe("Empty uses the server's: Europe/London.");
    expect(settingPlaceholder(field('root'), { workspaceRoot: '~/Omni' })).toBe('~/Omni');
    expect(settingPlaceholder(field('githubOwner'), { workspaceRoot: '~/Omni' })).toBe('octocat');
  });
});
