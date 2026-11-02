import { describe, expect, it } from 'vitest';

import { automationsDetail, versionLabel } from '../src/settings/settings-model';

describe('automationsDetail', () => {
  it('counts the automations on the server', () => {
    expect(automationsDetail(3, null, 'Mac')).toBe('3 on Mac');
    expect(automationsDetail(1, null, null)).toBe('1');
    expect(automationsDetail(0, null, 'Mac')).toBe('None yet');
  });

  it('says why the count is missing', () => {
    expect(automationsDetail(null, null, 'Mac')).toBe('Loading');
    expect(automationsDetail(null, 'Cannot reach the Omni server. Is it running?', 'Mac')).toBe('Could not load');
  });
});

describe('versionLabel', () => {
  it('shows the version and, when there is one, the build', () => {
    expect(versionLabel('0.1.0', '42')).toBe('Omni OS 0.1.0 (42)');
    expect(versionLabel('0.1.0', undefined)).toBe('Omni OS 0.1.0');
    expect(versionLabel(undefined, undefined)).toBe('Omni OS');
  });
});
